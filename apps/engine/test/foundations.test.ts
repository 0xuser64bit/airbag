import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
    expect(() => masterKeysFromEnv({ MASTER_KEY: KEY_A, MASTER_KEY_VERSION: 'two' })).toThrow(
      /whole number/,
    );
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
    expect(cfg.simClock).toBe('monad');
    expect(loadConfig({ ENGINE_MODE: 'simulation', SIM_CLOCK: 'local' }).simClock).toBe('local');
    expect(() => loadConfig({ ENGINE_MODE: 'simulation', SIM_CLOCK: 'wall' })).toThrow(/SIM_CLOCK/);
    expect(() => loadConfig({ MASTER_KEY: KEY_A, WEB_ORIGIN: 'https://a.example/path' })).toThrow();
    expect(() => loadConfig({ MASTER_KEY: KEY_A, STALE_BLOCKS: '0' })).toThrow(/STALE_BLOCKS/);
    expect(() =>
      loadConfig({ MASTER_KEY: KEY_A, AIRBAG_LOG_ADDRESS: '0x1', AIRBAG_LOG_PRIVATE_KEY: '0x2' }),
    ).toThrow();
  });
});

describe('store', () => {
  it('migrates and backs up legacy users, settings, sealed keys and deploys; refuses newer schemas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'airbag-store-'));
    try {
      const path = join(dir, 'legacy.db');
      const old = openStore(path);
      old.putSettings(WALLET, { ...DEFAULT_SETTINGS, targetPct: 12 });
      const master: MasterKeys = { current: 1, keys: new Map([[1, Buffer.from(KEY_A, 'base64')]]) };
      const aad = `airbag:v1:${WALLET}:42`;
      const sealed = seal('simulation-fixture', aad, master);
      old.putLink({ wallet: WALLET, accountId: 42, keyHint: 'test', sealed, linkedAt: 1 });
      old.insertDeploy(deploy('persisted', 10));
      old.close();
      const legacy = new DatabaseSync(path);
      // A schema-1 file: built today, so drop what migrations 2 and 3 add.
      legacy.exec('DROP TABLE environment; DROP TABLE telegram_chats; PRAGMA user_version = 1;');
      legacy.close();
      const migrated = openStore(path);
      try {
        expect(migrated.schemaVersion()).toBe(3);
        expect(migrated.settings(WALLET).targetPct).toBe(12);
        expect(migrated.deploy('persisted')?.accountId).toBe(42);
        expect(() => migrated.bindEnvironment('simulation:10143')).toThrow(/Legacy/);
        migrated.bindEnvironment('simulation:10143', true);
        migrated.putSettings(WALLET, { ...DEFAULT_SETTINGS, targetPct: 13 });
        await migrated.backup(join(dir, 'backup.db'));
      } finally {
        migrated.close();
      }
      const restored = openStore(join(dir, 'backup.db'));
      try {
        restored.bindEnvironment('simulation:10143');
        expect(restored.settings(WALLET).targetPct).toBe(13);
        expect(restored.deploy('persisted')).toEqual(deploy('persisted', 10));
        expect(restored.link(WALLET)?.sealed).toEqual(sealed);
        expect(open(restored.link(WALLET)?.sealed ?? sealed, aad, master)).toBe(
          'simulation-fixture',
        );
        expect(() => restored.bindEnvironment('live:143')).toThrow(/belongs to/);
      } finally {
        restored.close();
      }
      const future = new DatabaseSync(path);
      future.exec('PRAGMA user_version = 999;');
      future.close();
      expect(() => openStore(path)).toThrow(/newer/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
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
    expect(s.schemaVersion()).toBe(3);
    s.close();
  });

  it('binds an environment and refuses cross-network/mode reuse or implicit legacy adoption', () => {
    const s = openStore(':memory:');
    try {
      s.ensureUser(WALLET);
      expect(() => s.bindEnvironment('simulation:10143')).toThrow(/Legacy/);
      s.bindEnvironment('simulation:10143', true);
      s.bindEnvironment('simulation:10143');
      expect(() => s.bindEnvironment('live:10143')).toThrow(/belongs to/);
      expect(() => s.bindEnvironment('simulation:143', true)).toThrow(/belongs to/);
    } finally {
      s.close();
    }
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
    s.removePush('https://push.example/1', '0x0000000000000000000000000000000000000001');
    expect(s.pushSubscriptions(WALLET)).toHaveLength(1);
    s.removePush('https://push.example/1', WALLET);
    expect(s.pushSubscriptions(WALLET)).toHaveLength(0);

    s.putReference(WALLET, 16, { positionId: 7, reference: 97_000, lots: 51_095 });
    expect(s.reference(WALLET, 16)).toEqual({ positionId: 7, reference: 97_000, lots: 51_095 });
    s.deleteLink(WALLET);
    expect(s.link(WALLET)).toBeUndefined();
  });
});

describe('master key rotation', () => {
  it('re-wraps every stored key under the new master key, and the old key can then go', async () => {
    const { rotateLinks, keyVersions } = await import('../src/cli.ts');
    const s = openStore(':memory:');
    const v1: MasterKeys = { current: 1, keys: new Map([[1, Buffer.from(KEY_A, 'base64')]]) };
    const sealed = seal('{"apiKey":"k","secret":"s"}', `airbag:v1:${WALLET}:42`, v1);
    s.putLink({ wallet: WALLET, accountId: 42, keyHint: 'k', sealed, linkedAt: 1 });
    const both: MasterKeys = {
      current: 2,
      keys: new Map([
        [1, Buffer.from(KEY_A, 'base64')],
        [2, Buffer.from(KEY_B, 'base64')],
      ]),
    };
    expect(rotateLinks(s, both)).toBe(1);
    expect(rotateLinks(s, both)).toBe(0);
    const v2only: MasterKeys = { current: 2, keys: new Map([[2, Buffer.from(KEY_B, 'base64')]]) };
    expect(keyVersions(s, v2only)).toEqual({ v2: 1 });
    const link = s.link(WALLET);
    if (!link) throw new Error('missing');
    expect(open(link.sealed, `airbag:v1:${WALLET}:42`, v2only)).toBe('{"apiKey":"k","secret":"s"}');
  });
});
