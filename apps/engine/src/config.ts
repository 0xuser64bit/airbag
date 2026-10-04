// Engine configuration from the environment, validated once at startup. Everything
// network-specific beyond URLs comes from Perpl's /pub/context at runtime.

import { type NetworkConfig, networkFromEnv } from '@airbag/perpl';
import { isAddress } from 'viem';
import { isLevel } from './log.ts';
import { type MasterKeys, masterKeysFromEnv } from './vault.ts';

export interface Config {
  network: NetworkConfig;
  /** `simulation` runs the same engine against a paper exchange and scripted prices. */
  mode: 'live' | 'simulation';
  /**
   * Simulation's block clock: `monad` follows Perpl's public heartbeat (real Monad blocks) and
   * falls back to a local clock while it is quiet; `local` never connects anywhere.
   */
  simClock: 'monad' | 'local';
  host: string;
  port: number;
  databasePath: string;
  master: MasterKeys;
  /** Origins allowed to call the API from a browser. The first is the SIWE domain. */
  webOrigins: string[];
  /** The engine's static egress addresses, for the key's IP allow-list. */
  egressIps: string[];
  staleBlocks: number;
  /** Symbols Airbag protects. Others are shown as not covered. */
  markets: string[];
  slippageBps: number;
  maxAttempts: number;
  demoWallets: Set<string>;
  /** Share of the cushion that demo mode lets go before deploying: a 0.3% adverse move. */
  demoMove: number;
  vapid?: { publicKey: string; privateKey: string; subject: string };
  /** Telegram alerts: a bot's token and @username, from BotFather. */
  telegram?: { token: string; username: string };
  airbagLog?: { address: `0x${string}`; privateKey: `0x${string}`; rpcUrl: string };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Header with the client IP behind a proxy (rate limits), e.g. x-real-ip set by Caddy. */
  clientIpHeader?: string;
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name];
  const v = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}, got ${raw}`);
  }
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = env.ENGINE_MODE ?? 'live';
  if (mode !== 'live' && mode !== 'simulation') {
    throw new Error(`ENGINE_MODE must be live or simulation, got ${mode}`);
  }
  let master = masterKeysFromEnv(env);
  if (!master) {
    if (mode === 'live') {
      throw new Error(
        'MASTER_KEY is required: 32 random bytes, base64 (openssl rand -base64 32). Keep it in the host secret store.',
      );
    }
    // Simulation stores no real keys; an ephemeral master key keeps the code path identical.
    master = { current: 1, keys: new Map([[1, crypto.getRandomValues(Buffer.alloc(32))]]) };
  }
  const simClock = env.SIM_CLOCK ?? 'monad';
  if (simClock !== 'monad' && simClock !== 'local')
    throw new Error(`SIM_CLOCK must be monad or local, got ${simClock}`);
  const webOrigins = list(env.WEB_ORIGIN ?? 'http://localhost:3000');
  if (webOrigins.length === 0) throw new Error('WEB_ORIGIN must contain at least one origin');
  for (const o of webOrigins) {
    if (new URL(o).origin !== o || !['https:', 'http:'].includes(new URL(o).protocol))
      throw new Error(`WEB_ORIGIN entries must be HTTP(S) bare origins: ${o}`);
  }
  const demoWallets = new Set(list(env.DEMO_WALLETS).map((w) => w.toLowerCase()));
  for (const w of demoWallets) if (!isAddress(w)) throw new Error(`DEMO_WALLETS: bad address ${w}`);

  const level = env.LOG_LEVEL ?? 'info';
  if (!isLevel(level)) throw new Error(`LOG_LEVEL must be debug, info, warn or error`);

  const network = networkFromEnv(env);
  const cfg: Config = {
    network,
    mode,
    simClock,
    host: env.HOST ?? '0.0.0.0',
    port: int(env, 'PORT', 8787, 1, 65_535),
    databasePath: env.DATABASE_PATH ?? `./data/airbag-${mode}-${network.network}.db`,
    master,
    webOrigins,
    egressIps: list(env.ENGINE_EGRESS_IPS),
    staleBlocks: int(env, 'STALE_BLOCKS', 3, 1, 50),
    markets: list(env.MARKETS ?? 'BTC,ETH,MON').map((s) => s.toUpperCase()),
    slippageBps: int(env, 'SLIPPAGE_BPS', 50, 1, 500),
    maxAttempts: int(env, 'MAX_DEPLOY_ATTEMPTS', 3, 1, 10),
    demoWallets,
    demoMove: 0.003,
    logLevel: level,
  };
  if (mode === 'live' && cfg.databasePath === ':memory:')
    throw new Error('Live protection requires a persistent DATABASE_PATH');
  if (env.CLIENT_IP_HEADER) cfg.clientIpHeader = env.CLIENT_IP_HEADER.toLowerCase();
  if (!!env.VAPID_PUBLIC_KEY !== !!env.VAPID_PRIVATE_KEY)
    throw new Error('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY');
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    cfg.vapid = {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT ?? 'mailto:security@airbag.invalid',
    };
  }
  const tgToken = env.TELEGRAM_BOT_TOKEN;
  const tgName = env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
  if (!!tgToken !== !!tgName)
    throw new Error('Set both TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME');
  if (tgToken && tgName) {
    if (!/^\d+:[\w-]{30,}$/.test(tgToken)) throw new Error('TELEGRAM_BOT_TOKEN is not a bot token');
    if (!/^\w{5,32}$/.test(tgName)) throw new Error('TELEGRAM_BOT_USERNAME is not a bot username');
    cfg.telegram = { token: tgToken, username: tgName };
  }
  const logAddress = env.AIRBAG_LOG_ADDRESS;
  const logKey = env.AIRBAG_LOG_PRIVATE_KEY;
  if (!!logAddress !== !!logKey)
    throw new Error('Set both AIRBAG_LOG_ADDRESS and AIRBAG_LOG_PRIVATE_KEY');
  if (logAddress && logKey) {
    if (mode === 'simulation')
      throw new Error('Simulation cannot write to a real AirbagLog contract');
    if (!isAddress(logAddress)) throw new Error('AIRBAG_LOG_ADDRESS is not an address');
    if (!/^0x[0-9a-fA-F]{64}$/.test(logKey))
      throw new Error('AIRBAG_LOG_PRIVATE_KEY must be 0x + 64 hex');
    cfg.airbagLog = {
      address: logAddress,
      privateKey: logKey as `0x${string}`,
      rpcUrl: cfg.network.rpcUrl,
    };
  }
  return cfg;
}
