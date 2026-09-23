import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { DEFAULT_SETTINGS, type Deploy, openStore } from '../src/db.ts';
import { createLogger } from '../src/log.ts';
import { type MasterKeys, masterKeysFromEnv, open, rewrap, seal } from '../src/vault.ts';

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');
const WALLET = '0x7a3f00000000000000000000000000000000c21e';

describe('logger', () => {
  it('writes JSON lines and redacts secrets at any depth', () => {
    const lines: string[] = [];
    const log = createLogger('info', { svc: 'engine' }, (l) => lines.push(l));
    log.debug('hidden');
    log.info('key.linked', {
      wallet: WALLET,
      apiSecret: 'deadbeef',
      nested: { api_key: 'tok', signature: 'sig', ok: 1, deeper: [{ privateKey: 'pk' }] },
      err: new Error('boom'),
    });
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0] ?? '{}');
    expect(rec).toMatchObject({
      level: 'info',
      event: 'key.linked',
      svc: 'engine',
      wallet: WALLET,
    });
    expect(rec.apiSecret).toBe('[redacted]');
    expect(rec.nested).toEqual({
      api_key: '[redacted]',
      signature: '[redacted]',
      ok: 1,
      deeper: [{ privateKey: '[redacted]' }],
    });
    expect(rec.err).toEqual({ name: 'Error', message: 'boom' });
    expect(lines[0]).not.toContain('deadbeef');
  });
});

describe('vault', () => {
  const master: MasterKeys = { current: 1, keys: new Map([[1, Buffer.from(KEY_A, 'base64')]]) };

  it('round-trips and binds the ciphertext to its row', () => {
    const sealed = seal('{"apiKey":"k","secret":"s"}', `${WALLET}:42`, master);
    expect(JSON.stringify(sealed)).not.toContain('secret');
    expect(open(sealed, `${WALLET}:42`, master)).toBe('{"apiKey":"k","secret":"s"}');
    expect(() => open(sealed, `${WALLET}:43`, master)).toThrow();
  });

  it('detects tampering', () => {
    const sealed = seal('hello', 'aad', master);
    const flipped = Buffer.from(sealed.ct, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => open({ ...sealed, ct: flipped.toString('base64url') }, 'aad', master)).toThrow();
  });

  it('rewraps under a new master key, after which the old one can go', () => {
    const sealed = seal('hello', 'aad', master);
    const both: MasterKeys = {
      current: 2,
      keys: new Map([
        [1, Buffer.from(KEY_A, 'base64')],
        [2, Buffer.from(KEY_B, 'base64')],
      ]),
    };
    const moved = rewrap(sealed, 'aad', both);
    expect(moved.kv).toBe(2);
    expect(moved.ct).toBe(sealed.ct);
    const onlyNew: MasterKeys = { current: 2, keys: new Map([[2, Buffer.from(KEY_B, 'base64')]]) };
    expect(open(moved, 'aad', onlyNew)).toBe('hello');
  });

  it('reads master keys from the environment', () => {
    expect(masterKeysFromEnv({})).toBeUndefined();
    const keys = masterKeysFromEnv({
      MASTER_KEY: KEY_B,
      MASTER_KEY_VERSION: '2',
      MASTER_KEY_1: KEY_A,
    });
    expect(keys?.current).toBe(2);
    expect([...(keys?.keys.keys() ?? [])].sort()).toEqual([1, 2]);
    expect(() => masterKeysFromEnv({ MASTER_KEY: 'c2hvcnQ=' })).toThrow(/32 bytes/);
  });
});

describe('config', () => {
  it('requires a master key in live mode only', () => {
    expect(() => loadConfig({})).toThrow(/MASTER_KEY is required/);
    expect(loadConfig({ ENGINE_MODE: 'simulation' }).mode).toBe('simulation');
  });

  it('parses and validates the rest', () => {
    const cfg = loadConfig({
      MASTER_KEY: KEY_A,
      WEB_ORIGIN: 'https://airbag.example, http://localhost:3000',
      ENGINE_EGRESS_IPS: '203.0.113.24/32,203.0.113.25/32',
      MARKETS: 'btc,eth,sol',
      DEMO_WALLETS: WALLET,
    });
    expect(cfg.webOrigins).toEqual(['https://airbag.example', 'http://localhost:3000']);
    expect(cfg.egressIps).toHaveLength(2);
    expect(cfg.markets).toEqual(['BTC', 'ETH', 'SOL']);
    expect(cfg.demoWallets.has(WALLET)).toBe(true);
    expect(cfg.network.network).toBe('testnet');
    expect(() => loadConfig({ MASTER_KEY: KEY_A, WEB_ORIGIN: 'https://a.example/path' })).toThrow();
    expect(() => loadConfig({ MASTER_KEY: KEY_A, STALE_BLOCKS: '0' })).toThrow(/STALE_BLOCKS/);
    expect(() =>
      loadConfig({ MASTER_KEY: KEY_A, AIRBAG_LOG_ADDRESS: '0x1', AIRBAG_LOG_PRIVATE_KEY: '0x2' }),
    ).toThrow();
  });
});

describe('store', () => {
  const deploy = (id: string, createdAt: number): Deploy => ({
    id,
    wallet: WALLET,
    accountId: 42,
    marketId: 16,
    symbol: 'BTC',
    side: 'long',
    kind: 'trim',
    phase: 'closing',
    outcome: 'pending',
    createdAt,
    savedAt: null,
    closedAt: null,
    data: {
      trigger: { block: 1, at: 1, mark: 97_000, line: 97_000, reference: 100_000 },
      before: {
        size: 1,
        lots: 100_000,
        entry: 100_000,
        deposit: 10_000,
        funding: 0,
        maintenance: 0.04,
        liquidation: 94_000,
        distance: 0.0309,
        leverage: 13.9,
      },
      positionId: 7,
      target: 0.1,
      maxTrim: 0.5,
      spare: 420,
      plannedLiquidation: 87_300,
      capped: false,
      counterfactual: 3_200,
      spareAdded: 0,
      attempts: 1,
      timeline: [],
    },
  });

  it('migrates a fresh database and is idempotent on reopen', () => {
    const s = openStore(':memory:');
    expect(s.schemaVersion()).toBe(1);
    s.close();
  });

  it('keeps sessions until they expire', () => {
    const s = openStore(':memory:');
    s.createSession(WALLET, 'h1', 2_000, 1_000);
    expect(s.sessionWallet('h1', 1_500)).toBe(WALLET);
    expect(s.sessionWallet('h1', 2_000)).toBeUndefined();
    s.purgeSessions(3_000);
    expect(s.sessionWallet('h1', 0)).toBeUndefined();
  });

  it('returns defaults, then stored settings; the schema refuses out-of-range values', () => {
    const s = openStore(':memory:');
    expect(s.settings(WALLET)).toMatchObject({ ...DEFAULT_SETTINGS, updatedAt: 0 });
    s.putSettings(WALLET, { ...DEFAULT_SETTINGS, sensitivity: 'late', armed: true }, 5);
    expect(s.settings(WALLET)).toMatchObject({ sensitivity: 'late', armed: true, updatedAt: 5 });
    expect(() => s.putSettings(WALLET, { ...DEFAULT_SETTINGS, targetPct: 30 })).toThrow();
    expect(() => s.putSettings(WALLET, { ...DEFAULT_SETTINGS, maxTrimPct: 60 as 50 })).toThrow();
    expect(() => s.ensureUser('not-a-wallet')).toThrow();
  });

  it('stores links, deploys and push subscriptions', () => {
    const s = openStore(':memory:');
    const sealed = {
      v: 1 as const,
      kv: 1,
      iv: 'a',
      tag: 'b',
      ct: 'c',
      wiv: 'd',
      wtag: 'e',
      wk: 'f',
    };
    s.putLink({ wallet: WALLET, accountId: 42, keyHint: '3f9a', sealed, linkedAt: 1 });
    expect(s.link(WALLET)).toMatchObject({ accountId: 42, sealed });
    expect(s.links()).toHaveLength(1);

    s.insertDeploy(deploy('d1', 10));
    s.insertDeploy(deploy('d2', 20));
    expect(s.deploys(WALLET).map((d) => d.id)).toEqual(['d2', 'd1']);
    expect(s.unfinishedDeploys()).toHaveLength(2);
    const d1 = s.deploy('d1');
    if (!d1) throw new Error('missing');
    s.updateDeploy({ ...d1, phase: 'done', data: { ...d1.data, attempts: 2 } });
    expect(s.deploy('d1')?.data.attempts).toBe(2);
    expect(s.trackedDeploys().map((d) => d.id)).toEqual(['d1']);

    s.addPush(WALLET, { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } });
    expect(s.pushSubscriptions(WALLET)).toHaveLength(1);
    s.removePush('https://push.example/1');
    expect(s.pushSubscriptions(WALLET)).toHaveLength(0);

    s.putReference(WALLET, 16, { positionId: 7, reference: 97_000, lots: 51_095 });
    expect(s.reference(WALLET, 16)).toEqual({ positionId: 7, reference: 97_000, lots: 51_095 });
    s.deleteLink(WALLET);
    expect(s.link(WALLET)).toBeUndefined();
  });
});
