// Composes the engine from config. main.ts runs it; the API tests build the same thing in
// simulation mode, so they exercise the real wiring.

import type { Server } from 'node:http';
import {
  type Context,
  collateralDecimals,
  fetchContext,
  fetchRecentFunding,
  MarketFeed,
  perplChain,
  symbolOf,
  TradingClient,
} from '@airbag/perpl';
import { Accounts } from './accounts.ts';
import { createApi } from './api.ts';
import { Auth } from './auth.ts';
import type { Config } from './config.ts';
import { openStore, type Store } from './db.ts';
import { Engine } from './engine.ts';
import type { Markets } from './guard.ts';
import { createLogger, type Logger } from './log.ts';
import { notifier, type OnchainLog, Push } from './notify.ts';
import { airbagLog } from './onchain.ts';
import { SIM_CONTEXT, SimChain } from './sim.ts';

export interface App {
  cfg: Config;
  log: Logger;
  store: Store;
  feed: MarketFeed;
  engine: Engine;
  accounts: Accounts;
  api: Server;
  sim?: SimChain;
  /** Starts the feed (and the simulated clock) and accounts. Doesn't listen. */
  start(): void;
  stop(): Promise<void>;
}

export interface BuildOptions {
  log?: Logger;
  onchain?: OnchainLog;
  /** Tests drive the simulated chain by hand. */
  manualClock?: boolean;
}

export async function buildApp(cfg: Config, opts: BuildOptions = {}): Promise<App> {
  const log =
    opts.log ??
    createLogger(cfg.logLevel, { svc: 'engine', network: cfg.network.network, mode: cfg.mode });
  const live = cfg.mode === 'live';
  const ctx: Context = live ? await fetchContext(cfg.network.apiUrl) : SIM_CONTEXT;
  if (live && ctx.chain.chain_id !== cfg.network.chainId)
    throw new Error('Perpl context chain does not match PERPL_NETWORK');
  const exchange = ctx.instances[0]?.address ?? '';
  const chain = live ? perplChain(cfg.network.rpcUrl, exchange, cfg.network.chainId) : undefined;

  const byId = new Map(ctx.markets.map((m) => [m.id, m]));
  const covered = new Set<number>();
  for (const symbol of cfg.markets) {
    const m = ctx.markets.find((x) => symbolOf(x).toUpperCase() === symbol);
    if (live && m?.config.is_open && !Number.isFinite(m.config.taker_fee))
      throw new Error(`Perpl fee schedule missing for ${symbol}; refusing a fee-free assumption`);
    if (m?.config.is_open) covered.add(m.id);
    else log.warn('market.not-covered', { symbol, reason: m ? 'closed' : 'unknown' });
  }
  const probeMarketId = [...covered][0];
  if (probeMarketId === undefined)
    throw new Error(`none of MARKETS=${cfg.markets.join(',')} is open`);
  const userShare = chain
    ? await chain
        .liquidationUserShare(byId.get(probeMarketId)?.perpetual_id ?? probeMarketId)
        .catch(() => 0.8)
    : 0.8;
  const markets: Markets = {
    byId,
    covered,
    collateralDecimals: collateralDecimals(ctx),
    userShare,
  };

  const store = openStore(cfg.databasePath);
  try {
    store.bindEnvironment(`${cfg.mode}:${cfg.network.chainId}`);
  } catch (err) {
    store.close();
    throw err;
  }
  let engine: Engine | undefined;
  const feed = new MarketFeed({
    url: `${cfg.network.wsUrl}/ws/v1/market-data`,
    chainId: cfg.network.chainId,
    markets: ctx.markets,
    staleBlocks: cfg.staleBlocks,
    ...(live ? { requireFundingFor: [...covered] } : {}),
    ...(live ? { monadWsUrl: cfg.network.rpcWsUrl } : {}),
    onBlock: (h) => engine?.tick(h),
    onState: (up, reason) => log[up ? 'info' : 'warn']('feed.state', { up, reason }),
  });
  if (live) {
    try {
      feed.seedFunding(
        await fetchRecentFunding(cfg.network.apiUrl, ctx.markets[0]?.funding_interval_sec ?? 2_580),
      );
    } catch (err) {
      store.close();
      throw err;
    }
  }
  const push = new Push(store, log, cfg.vapid);
  const onchain =
    opts.onchain ??
    (cfg.airbagLog
      ? airbagLog({ ...cfg.airbagLog, chainId: cfg.network.chainId }, byId, store, log)
      : undefined);
  const sim = live ? undefined : new SimChain(feed, ctx.markets);
  // Simulation on Monad's real blocks: only Perpl's public heartbeat, never its prices.
  const monadClock =
    sim && cfg.simClock === 'monad'
      ? new MarketFeed({
          url: `${cfg.network.wsUrl}/ws/v1/market-data`,
          chainId: cfg.network.chainId,
          markets: [],
          staleBlocks: cfg.staleBlocks,
          streams: ['heartbeat'],
          onBlock: (h) => sim.onMonadHead(h),
          onState: (up, reason) => log[up ? 'info' : 'warn']('sim.clock', { up, reason }),
        })
      : undefined;
  engine = new Engine({
    store,
    log,
    markets,
    feed,
    notify: notifier(push, log, onchain),
    slippageBps: cfg.slippageBps,
    maxAttempts: cfg.maxAttempts,
    demoMove: cfg.demoMove,
    staleBlocks: cfg.staleBlocks,
    ...(sim ? { feedFor: (wallet: string) => sim.feedFor(wallet) } : {}),
  });
  const alerted = new Map<string, number>();
  const accounts = new Accounts({
    store,
    engine,
    log,
    master: cfg.master,
    probeMarketId,
    ...(sim ? { sim } : {}),
    openTrading: (apiKey, key, onEvent) =>
      new TradingClient({
        url: `${cfg.network.wsUrl}/ws/v1/trading`,
        chainId: cfg.network.chainId,
        apiKey,
        key,
        requestsPerMinute: cfg.network.network === 'mainnet' ? 120 : 60,
        onEvent,
      }),
    onState: (wallet, state) => {
      // Tell the user once an hour at most that their key stopped working.
      if (state !== 'rejected' || Date.now() - (alerted.get(wallet) ?? 0) < 3_600_000) return;
      alerted.set(wallet, Date.now());
      void push.send(wallet, {
        title: "Perpl refused Airbag's key",
        body: "Airbag can't protect your positions until you link a working key.",
        url: '/link-key',
        tag: 'key',
      });
    },
  });
  const auth = new Auth({
    store,
    domains: cfg.webOrigins.map((o) => new URL(o).host),
    chainId: cfg.network.chainId,
    ...(live ? { rpcUrl: cfg.network.rpcUrl } : {}),
  });
  const api = createApi({
    cfg,
    store,
    engine,
    auth,
    accounts,
    log,
    ...(chain ? { chain } : {}),
    ...(sim ? { sim } : {}),
    ...(cfg.vapid ? { vapidPublicKey: cfg.vapid.publicKey } : {}),
    ...(cfg.clientIpHeader ? { clientIpHeader: cfg.clientIpHeader } : {}),
  });

  let purge: ReturnType<typeof setInterval> | undefined;
  return {
    cfg,
    log,
    store,
    feed,
    engine,
    accounts,
    api,
    ...(sim ? { sim } : {}),
    start() {
      if (live) {
        feed.start();
      } else if (sim && !opts.manualClock) {
        monadClock?.start();
        sim.start(300, !!monadClock);
      }
      accounts.startAll();
      purge = setInterval(() => store.purgeSessions(), 3_600_000);
      log.info('engine.start', {
        covered: [...covered],
        stale: cfg.staleBlocks,
        ...(sim ? { simClock: cfg.simClock } : {}),
        push: push.enabled,
        onchainLog: cfg.airbagLog?.address ?? null,
      });
    },
    async stop() {
      clearInterval(purge);
      sim?.stop();
      await monadClock?.close();
      engine.stop();
      const closed = new Promise<void>((resolve) => api.close(() => resolve()));
      api.closeAllConnections(); // open dashboard streams never end on their own
      await closed;
      await accounts.closeAll();
      await feed.close();
      await engine.drain();
      store.close();
    },
  };
}
