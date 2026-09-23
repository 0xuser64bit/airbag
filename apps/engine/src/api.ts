// The engine's HTTP API (ADR 0003, 0011): health, onboarding, settings, the live dashboard
// stream, deploy receipts and public save reports. Plain node:http: a handful of routes.
// Browsers call it cross-origin with a bearer token; only WEB_ORIGIN origins get CORS.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { effectiveEntryPrice, type PerplChain, symbolOf } from '@airbag/perpl';
import { distanceToLiquidation, liquidationPrice, type Position } from '@airbag/risk';
import { getAddress, type Hex, isAddress, isHex } from 'viem';
import { type Accounts, LinkError } from './accounts.ts';
import type { Auth } from './auth.ts';
import type { Config } from './config.ts';
import type { Deploy, Settings, Store } from './db.ts';
import type { Engine } from './engine.ts';
import type { Logger } from './log.ts';
import { LANDING_PATH, SAMPLE_SPARE_CNS, type SimChain, samplePositions } from './sim.ts';

export interface ApiDeps {
  cfg: Config;
  store: Store;
  engine: Engine;
  auth: Auth;
  accounts: Accounts;
  log: Logger;
  chain?: PerplChain;
  sim?: SimChain;
  vapidPublicKey?: string;
  /** Header that carries the client IP behind a proxy, e.g. fly-client-ip. */
  clientIpHeader?: string;
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bad = (message: string) => new HttpError(400, 'bad_request', message);

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  ip: string;
  token?: string;
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

/** Per-IP token buckets, per route group. */
class Limiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  take(key: string, perMinute: number, now = Date.now()): boolean {
    if (this.buckets.size > 50_000) this.buckets.clear();
    const b = this.buckets.get(key) ?? { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }
}

async function readJson(req: IncomingMessage, limit = 16_384): Promise<Record<string, unknown>> {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) throw bad('Send JSON.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'too_large', 'Request body too large.');
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw bad('Body is not a JSON object.');
  }
}

const str = (v: unknown, name: string, max = 512): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw bad(`${name} is required.`);
  return v.trim();
};

export function createApi(deps: ApiDeps): Server {
  const { cfg, store, engine, auth, accounts, log } = deps;
  const limiter = new Limiter();
  const routes: {
    method: string;
    pattern: RegExp;
    keys: string[];
    limit: number;
    auth: boolean;
    handler: Handler;
  }[] = [];
  const route = (
    method: string,
    path: string,
    opts: { auth?: boolean; limit?: number },
    handler: Handler,
  ) => {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/:(\w+)/g, (_, k: string) => {
        keys.push(k);
        return '([^/]+)';
      })}$`,
    );
    routes.push({
      method,
      pattern,
      keys,
      limit: opts.limit ?? 120,
      auth: opts.auth ?? false,
      handler,
    });
  };
  const wallet = (ctx: Ctx): string => {
    const w = auth.wallet(ctx.token);
    if (!w) throw new HttpError(401, 'unauthorized', 'Sign in again.');
    return w;
  };
  const simOnly = () => {
    if (!deps.sim) throw new HttpError(404, 'not_found', 'Simulation is off on this server.');
    return deps.sim;
  };

  // ---- Public ----------------------------------------------------------------------------

  route('GET', '/health', {}, () => {
    const st = engine.feed.staleness();
    const accounts = [...engine.guards.values()].map((g) => g.exchange.state);
    return {
      ok: !st.stale,
      mode: cfg.mode,
      network: cfg.network.network,
      head: engine.feed.head,
      stale: st.stale,
      staleReason: st.reason ?? null,
      lagBlocks: st.lagBlocks,
      lastTickMsAgo: engine.lastTickAt ? Date.now() - engine.lastTickAt : null,
      accounts: accounts.length,
      accountsLive: accounts.filter((s) => s === 'live').length,
    };
  });

  route('GET', '/v1/config', {}, () => ({
    mode: cfg.mode,
    network: cfg.network.network,
    chainId: cfg.network.chainId,
    explorerUrl: cfg.network.explorerUrl,
    perplUrl: cfg.network.apiUrl.replace(/\/api$/, ''),
    egressIps: cfg.egressIps,
    markets: [...engine.markets.covered].map((id) => {
      const m = engine.markets.byId.get(id);
      return m ? { id, symbol: symbolOf(m) } : { id, symbol: String(id) };
    }),
    vapidPublicKey: deps.vapidPublicKey ?? null,
    slippageBps: cfg.slippageBps,
  }));

  route('GET', '/v1/lookup/:address', { limit: 20 }, async (ctx) => {
    const raw = ctx.params.address ?? '';
    if (!isAddress(raw)) throw bad('Not a wallet address.');
    return lookup(getAddress(raw).toLowerCase() as `0x${string}`);
  });

  route('POST', '/v1/auth/nonce', { limit: 20 }, () => ({ nonce: auth.nonce() }));

  route('POST', '/v1/auth/verify', { limit: 20 }, async (ctx) => {
    const body = await readJson(ctx.req);
    const message = str(body.message, 'message', 4_000);
    const signature = str(body.signature, 'signature', 4_000);
    if (!isHex(signature)) throw bad('signature must be hex.');
    try {
      return await auth.verify(message, signature as Hex);
    } catch (err) {
      throw new HttpError(
        401,
        'bad_signature',
        err instanceof Error ? err.message : 'Sign-in failed.',
      );
    }
  });

  route('GET', '/v1/saves/:id', { limit: 60 }, (ctx) => {
    const d = store.deploy(ctx.params.id ?? '');
    if (d?.outcome !== 'save') throw new HttpError(404, 'not_found', 'No save report here.');
    return saveReport(engine.guards.get(d.wallet)?.live(d.id) ?? d);
  });

  // ---- Signed in -------------------------------------------------------------------------

  route('POST', '/v1/auth/logout', { auth: true }, (ctx) => {
    wallet(ctx);
    if (ctx.token) auth.logout(ctx.token);
    return { ok: true };
  });

  route('GET', '/v1/me', { auth: true }, (ctx) => {
    const w = wallet(ctx);
    const link = store.link(w);
    return {
      wallet: w,
      link: link
        ? { accountId: link.accountId, keyHint: link.keyHint, linkedAt: link.linkedAt }
        : null,
      settings: store.settings(w),
      demoAllowed: cfg.demoWallets.has(w),
    };
  });

  route('POST', '/v1/key', { auth: true, limit: 6 }, async (ctx) => {
    const w = wallet(ctx);
    const body = await readJson(ctx.req);
    const apiKey = str(body.apiKey, 'API key', 512);
    const apiSecret = str(body.apiSecret, 'API secret', 130);
    if (body.ipLocked !== true) {
      throw bad("Confirm you added Airbag's addresses to the key's IP allow-list.");
    }
    try {
      return await accounts.link(w, apiKey, apiSecret);
    } catch (err) {
      if (err instanceof LinkError) throw new HttpError(err.status, err.code, err.message);
      throw err;
    }
  });

  route('DELETE', '/v1/key', { auth: true }, async (ctx) => {
    await accounts.unlink(wallet(ctx));
    return { ok: true };
  });

  route('PUT', '/v1/settings', { auth: true, limit: 60 }, async (ctx) => {
    const w = wallet(ctx);
    const body = await readJson(ctx.req);
    const next = parseSettings(store.settings(w), body);
    if (next.demo && !cfg.demoWallets.has(w)) {
      throw new HttpError(
        403,
        'demo_not_allowed',
        'Demo mode is only for wallets on the demo list.',
      );
    }
    if (next.armed && !store.link(w)) throw bad('Link a Perpl key before arming Airbag.');
    store.putSettings(w, next);
    engine.reloadSettings(w);
    log.info('settings.changed', { wallet: w, ...next });
    return store.settings(w);
  });

  route('GET', '/v1/state', { auth: true, limit: 240 }, (ctx) => dashboard(wallet(ctx)));

  route('GET', '/v1/stream', { auth: true, limit: 30 }, (ctx) => {
    const w = wallet(ctx);
    const { res } = ctx;
    res.writeHead(200, {
      ...cors(ctx.req),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    const send = () => {
      if (!auth.wallet(ctx.token)) return res.end();
      res.write(`data: ${JSON.stringify(dashboard(w))}\n\n`);
    };
    send();
    const off = engine.onTick(send);
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
    ctx.req.on('close', () => {
      off();
      clearInterval(keepAlive);
    });
    return STREAMING;
  });

  route('GET', '/v1/deploys', { auth: true }, (ctx) => {
    const w = wallet(ctx);
    return store.deploys(w, 50).map((d) => summary(engine.guards.get(w)?.live(d.id) ?? d));
  });

  route('GET', '/v1/deploys/:id', { auth: true }, (ctx) => {
    const w = wallet(ctx);
    const d = store.deploy(ctx.params.id ?? '');
    if (!d || d.wallet !== w) throw new HttpError(404, 'not_found', 'No deploy with that id.');
    return detail(engine.guards.get(w)?.live(d.id) ?? d);
  });

  route('POST', '/v1/push', { auth: true, limit: 20 }, async (ctx) => {
    const w = wallet(ctx);
    const body = await readJson(ctx.req);
    const endpoint = str(body.endpoint, 'endpoint', 2_048);
    const keys = body.keys as { p256dh?: unknown; auth?: unknown } | undefined;
    if (!endpoint.startsWith('https://')) throw bad('endpoint must be https.');
    store.addPush(w, {
      endpoint,
      keys: {
        p256dh: str(keys?.p256dh, 'keys.p256dh', 256),
        auth: str(keys?.auth, 'keys.auth', 256),
      },
    });
    return { ok: true };
  });

  route('DELETE', '/v1/push', { auth: true }, async (ctx) => {
    const w = wallet(ctx);
    const body = await readJson(ctx.req);
    store.removePush(str(body.endpoint, 'endpoint', 2_048), w);
    return { ok: true };
  });

  // ---- Simulation controls (ENGINE_MODE=simulation only) ---------------------------------

  route('POST', '/v1/sim/price', { auth: true, limit: 120 }, async (ctx) => {
    wallet(ctx);
    const sim = simOnly();
    const body = await readJson(ctx.req);
    const id = marketId(str(body.symbol, 'symbol', 16));
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) throw bad('price must be a positive number.');
    sim.setPrice(id, price);
    return { ok: true };
  });

  route('POST', '/v1/sim/wick', { auth: true, limit: 20 }, async (ctx) => {
    wallet(ctx);
    const sim = simOnly();
    const body = await readJson(ctx.req);
    const id = marketId(str(body.symbol, 'symbol', 16));
    // The landing page's wick, scaled to the market's sample entry price.
    const entry = id === 16 ? 100_000 : 3_000;
    sim.play(
      id,
      LANDING_PATH.map((p) => (p / 100_000) * entry),
    );
    return { ok: true, blocks: LANDING_PATH.length };
  });

  route('POST', '/v1/sim/reset', { auth: true, limit: 20 }, async (ctx) => {
    const w = wallet(ctx);
    const sim = simOnly();
    const link = store.link(w);
    if (!link) throw bad('Link a key first.');
    engine.remove(w);
    store.deleteReference(w, 16);
    store.deleteReference(w, 32);
    engine.add(w, sim.paper(w, link.accountId));
    sim.setPrice(16, 99_420);
    sim.setPrice(32, 3_060);
    return { ok: true };
  });

  // ---- Views -----------------------------------------------------------------------------

  function marketId(symbol: string): number {
    for (const id of engine.markets.covered) {
      const m = engine.markets.byId.get(id);
      if (m && symbolOf(m).toUpperCase() === symbol.toUpperCase()) return id;
    }
    throw bad(`No covered market ${symbol}.`);
  }

  const lookupCache = new Map<string, { at: number; value: unknown }>();
  async function lookup(address: `0x${string}`) {
    const cached = lookupCache.get(address);
    if (cached && Date.now() - cached.at < 15_000) return cached.value;
    const value = deps.sim ? simLookup(address) : await liveLookup(address);
    if (lookupCache.size > 5_000) lookupCache.clear();
    lookupCache.set(address, { at: Date.now(), value });
    return value;
  }

  function simLookup(address: string) {
    const guard = engine.guards.get(address);
    if (guard) {
      return {
        address,
        simulated: true,
        account: { id: guard.exchange.account?.id ?? 0, spare: guard.spare(), frozen: false },
        positions: guard.views.map((v) => ({
          marketId: v.marketId,
          symbol: v.symbol,
          side: v.side,
          size: v.size,
          sizeDecimals: v.sizeDecimals,
          nominalLeverage: v.nominalLeverage,
          mark: v.mark,
          liquidation: v.liquidation,
          distance: v.distance,
          covered: v.covered,
        })),
      };
    }
    const cd = engine.markets.collateralDecimals;
    return {
      address,
      simulated: true,
      account: {
        id: 4000 + (Number.parseInt(address.slice(-4), 16) % 1000),
        spare: Number(SAMPLE_SPARE_CNS) / 10 ** cd,
        frozen: false,
      },
      positions: samplePositions(0).flatMap((p) => {
        const m = engine.markets.byId.get(p.mkt);
        const mark = engine.feed.mark(p.mkt);
        if (!m || mark === undefined) return [];
        const pd = m.config.price_decimals;
        const risk: Position = {
          side: p.sd === 1 ? 'long' : 'short',
          size: p.s / 10 ** m.config.size_decimals,
          entry: p.ep / 10 ** pd,
          deposit: Number(p.c) / 10 ** cd,
          funding: 0,
          maintenance: 100 / m.config.maintenance_margin,
        };
        return [positionRow(p.mkt, risk, mark / 10 ** pd, p.lv / 100, m.config.size_decimals)];
      }),
    };
  }

  function positionRow(id: number, risk: Position, mark: number, nominal: number, sd: number) {
    const m = engine.markets.byId.get(id);
    return {
      marketId: id,
      symbol: m ? symbolOf(m) : String(id),
      side: risk.side,
      size: risk.size,
      sizeDecimals: sd,
      nominalLeverage: nominal,
      mark,
      liquidation: liquidationPrice(risk),
      distance: distanceToLiquidation(risk, mark),
      covered: engine.markets.covered.has(id),
    };
  }

  async function liveLookup(address: `0x${string}`) {
    const chain = deps.chain;
    if (!chain) throw new HttpError(503, 'unavailable', 'Chain reads are not configured.');
    try {
      return await readAccount(chain, address);
    } catch (err) {
      log.warn('lookup.error', { address, err });
      throw new HttpError(
        502,
        'chain_unavailable',
        "Couldn't read this wallet from Monad. Try again.",
      );
    }
  }

  async function readAccount(chain: PerplChain, address: `0x${string}`) {
    const account = await chain.account(address);
    if (!account) return { address, simulated: false, account: null, positions: [] };
    const cd = engine.markets.collateralDecimals;
    // A failed read must not look like "no positions": fail the lookup instead.
    const rows = await Promise.all(
      [...engine.markets.byId.values()].map(async (m) => {
        const p = await chain.position(m.perpetual_id, account.id);
        if (!p.side) return undefined;
        const pd = m.config.price_decimals;
        const risk: Position = {
          side: p.side,
          size: Number(p.lots) / 10 ** m.config.size_decimals,
          entry: effectiveEntryPrice(p.side, Number(p.pricePns), Number(p.residueQ16), pd),
          deposit: Number(p.depositCns) / 10 ** cd,
          funding: Number(p.premiumPnlCns) / 10 ** cd,
          maintenance: 100 / m.config.maintenance_margin,
        };
        const markRaw = engine.feed.mark(m.id) ?? Number(p.markPns);
        const mark = markRaw / 10 ** pd;
        // Opening leverage isn't onchain; entry notional over deposit approximates it.
        const nominal = (risk.size * risk.entry) / Math.max(risk.deposit, 1e-9);
        return positionRow(m.id, risk, mark, nominal, m.config.size_decimals);
      }),
    );
    return {
      address,
      simulated: false,
      account: {
        id: account.id,
        spare: Number(account.balanceCns - account.lockedCns) / 10 ** cd,
        frozen: account.frozen,
      },
      positions: rows.filter((r) => r !== undefined),
    };
  }

  function summary(d: Deploy) {
    const trimmed = d.data.close
      ? (d.data.close.filledLots / d.data.before.lots) * d.data.before.size
      : 0;
    return {
      id: d.id,
      symbol: d.symbol,
      side: d.side,
      kind: d.kind,
      phase: d.phase,
      outcome: d.outcome,
      createdAt: d.createdAt,
      savedAt: d.savedAt,
      closedAt: d.closedAt,
      trimmed,
      fillPrice: d.data.close?.fillPrice ?? null,
      spareAdded: d.data.spareAdded,
      liquidationBefore: d.data.before.liquidation,
      liquidationAfter: d.data.after?.liquidation ?? null,
      saveAfterMs: d.data.save ? d.data.save.at - d.createdAt : null,
      kept: d.data.kept ?? null,
    };
  }

  function sizeDecimals(marketId: number) {
    return engine.markets.byId.get(marketId)?.config.size_decimals ?? 3;
  }

  function detail(d: Deploy) {
    return {
      ...summary(d),
      marketId: d.marketId,
      sizeDecimals: sizeDecimals(d.marketId),
      simulated: cfg.mode === 'simulation',
      explorerUrl: cfg.network.explorerUrl,
      data: d.data,
    };
  }

  function saveReport(d: Deploy) {
    const filled = d.data.timeline.find(
      (e) => e.text.startsWith('Filled') || e.text.startsWith('Added'),
    );
    const kept = d.data.kept ?? 0;
    return {
      id: d.id,
      symbol: d.symbol,
      side: d.side,
      kind: d.kind,
      date: d.createdAt,
      nominalLeverage: d.data.before.nominal ?? null,
      kept,
      counterfactual: d.data.counterfactual,
      // Net of spare margin Airbag added (it was the user's either way), so kept = with − without.
      withAirbag: kept + d.data.counterfactual,
      measuredAt: d.data.keptMark ?? null,
      closed: d.closedAt !== null,
      trimmed: d.data.close
        ? (d.data.close.filledLots / d.data.before.lots) * d.data.before.size
        : 0,
      sizeDecimals: sizeDecimals(d.marketId),
      spareAdded: d.data.spareAdded,
      fillPrice: d.data.close?.fillPrice ?? null,
      oldLiquidation: d.data.before.liquidation,
      lineToFillMs: filled ? filled.at - d.data.trigger.at : null,
      lineToFillBlocks: filled ? filled.block - d.data.trigger.block : null,
      hitAfterMs: d.data.save && filled ? d.data.save.at - filled.at : null,
      tx: d.data.close?.tx ?? d.data.margin?.tx ?? null,
      explorerUrl: cfg.network.explorerUrl,
      simulated: cfg.mode === 'simulation',
    };
  }

  function dashboard(w: string) {
    const guard = engine.guards.get(w);
    const link = store.link(w);
    const settings = store.settings(w);
    const st = engine.feed.staleness();
    const positions = [...(guard?.views ?? [])].sort(
      (a, b) => Number(b.covered) - Number(a.covered) || a.distance - b.distance,
    );
    const spare = guard?.spare() ?? 0;
    const account = guard?.exchange.account;
    return {
      mode: cfg.mode,
      network: cfg.network.network,
      explorerUrl: cfg.network.explorerUrl,
      wallet: w,
      block: {
        head: engine.feed.head,
        at: engine.lastTickAt,
        stale: st.stale,
        staleReason: st.reason ?? null,
        lagBlocks: st.lagBlocks,
      },
      tape: engine.tape,
      status: guard ? guard.status() : link ? 'connecting' : 'unlinked',
      account: account
        ? {
            id: account.id,
            spare,
            value: spare + positions.reduce((sum, p) => sum + p.equity, 0),
            forwarding: account.fw,
            frozen: account.fr,
          }
        : null,
      key: link
        ? {
            keyHint: link.keyHint,
            linkedAt: link.linkedAt,
            state: guard?.exchange.state ?? 'connecting',
            lastMessageAt: guard?.exchange.lastMessageAt ?? null,
          }
        : null,
      settings,
      demoAllowed: cfg.demoWallets.has(w),
      positions,
      deploys: store.deploys(w, 10).map((d) => summary(guard?.live(d.id) ?? d)),
    };
  }

  // ---- Server ----------------------------------------------------------------------------

  function cors(req: IncomingMessage): Record<string, string> {
    const origin = req.headers.origin;
    if (!origin || !cfg.webOrigins.includes(origin)) return { vary: 'Origin' };
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-max-age': '600',
      vary: 'Origin',
    };
  }

  function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
    if (res.headersSent) return;
    res.writeHead(status, {
      ...cors(req),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(JSON.stringify(body));
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://engine');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors(req));
      return res.end();
    }
    const forwarded = deps.clientIpHeader ? req.headers[deps.clientIpHeader] : undefined;
    const ip =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.socket.remoteAddress ?? '?';
    const authz = req.headers.authorization;
    const token = authz?.startsWith('Bearer ') ? authz.slice(7) : undefined;
    const started = performance.now();
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        if (!limiter.take(`${ip}:${r.method}:${r.pattern.source}`, r.limit)) {
          throw new HttpError(429, 'rate_limited', 'Too many requests. Slow down a little.');
        }
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decode(m[i + 1] ?? '')]));
        if (r.auth && !token) throw new HttpError(401, 'unauthorized', 'Sign in first.');
        const out = await r.handler({ req, res, params, ip, ...(token ? { token } : {}) });
        if (out !== STREAMING) send(req, res, 200, out);
        return;
      }
      throw new HttpError(404, 'not_found', 'No such route.');
    } catch (err) {
      if (err instanceof HttpError) {
        send(req, res, err.status, { error: { code: err.code, message: err.message } });
      } else {
        log.error('api.error', { method: req.method, path: url.pathname, err });
        send(req, res, 500, {
          error: { code: 'internal', message: 'Something went wrong on our side.' },
        });
      }
    } finally {
      if (!url.pathname.endsWith('/stream')) {
        log.debug('api.request', {
          method: req.method,
          path: url.pathname,
          status: res.statusCode,
          ms: Math.round(performance.now() - started),
        });
      }
    }
  });
}

const STREAMING = Symbol('streaming');

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    throw bad('Malformed URL.');
  }
};

/** Merges a partial settings update onto the current settings, validating every field. */
export function parseSettings(
  current: Settings,
  body: Record<string, unknown>,
): Omit<Settings, 'updatedAt'> {
  const next: Omit<Settings, 'updatedAt'> = {
    sensitivity: current.sensitivity,
    targetPct: current.targetPct,
    maxTrimPct: current.maxTrimPct,
    useSpare: current.useSpare,
    push: current.push,
    armed: current.armed,
    demo: current.demo,
  };
  const bool = (k: 'useSpare' | 'push' | 'armed' | 'demo') => {
    if (body[k] === undefined) return;
    if (typeof body[k] !== 'boolean') throw bad(`${k} must be true or false.`);
    next[k] = body[k];
  };
  if (body.sensitivity !== undefined) {
    if (
      body.sensitivity !== 'early' &&
      body.sensitivity !== 'balanced' &&
      body.sensitivity !== 'late'
    ) {
      throw bad('sensitivity must be early, balanced or late.');
    }
    next.sensitivity = body.sensitivity;
  }
  if (body.targetPct !== undefined) {
    const v = body.targetPct;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 6 || v > 20) {
      throw bad('targetPct must be a whole number from 6 to 20.');
    }
    next.targetPct = v;
  }
  if (body.maxTrimPct !== undefined) {
    const v = body.maxTrimPct;
    if (v !== 25 && v !== 50 && v !== 75 && v !== 100)
      throw bad('maxTrimPct must be 25, 50, 75 or 100.');
    next.maxTrimPct = v;
  }
  bool('useSpare');
  bool('push');
  bool('armed');
  bool('demo');
  return next;
}
