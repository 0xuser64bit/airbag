// The engine owns all state in one SQLite file (ADR 0010). node:sqlite is synchronous, which
// suits a single process that writes on deploys and settings changes only, never per block.
// Migrations are an append-only list tracked by PRAGMA user_version.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type { Sensitivity, Side } from '@airbag/risk';
import type { Sealed } from './vault.ts';

const MIGRATIONS = [
  `
  CREATE TABLE users (
    wallet TEXT PRIMARY KEY CHECK (wallet GLOB '0x[0-9a-f]*' AND length(wallet) = 42),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    wallet TEXT NOT NULL REFERENCES users(wallet) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_wallet ON sessions(wallet);
  CREATE TABLE links (
    wallet TEXT PRIMARY KEY REFERENCES users(wallet) ON DELETE CASCADE,
    account_id INTEGER NOT NULL,
    key_hint TEXT NOT NULL,
    sealed TEXT NOT NULL,
    linked_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    wallet TEXT PRIMARY KEY REFERENCES users(wallet) ON DELETE CASCADE,
    sensitivity TEXT NOT NULL CHECK (sensitivity IN ('early', 'balanced', 'late')),
    target_pct INTEGER NOT NULL CHECK (target_pct BETWEEN 6 AND 20),
    max_trim_pct INTEGER NOT NULL CHECK (max_trim_pct IN (25, 50, 75, 100)),
    use_spare INTEGER NOT NULL CHECK (use_spare IN (0, 1)),
    push INTEGER NOT NULL CHECK (push IN (0, 1)),
    armed INTEGER NOT NULL CHECK (armed IN (0, 1)),
    demo INTEGER NOT NULL CHECK (demo IN (0, 1)),
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE deploys (
    id TEXT PRIMARY KEY,
    wallet TEXT NOT NULL REFERENCES users(wallet) ON DELETE CASCADE,
    account_id INTEGER NOT NULL,
    market_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    kind TEXT NOT NULL CHECK (kind IN ('trim', 'margin')),
    phase TEXT NOT NULL CHECK (phase IN ('closing', 'readding', 'done', 'failed')),
    outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'save', 'precaution')),
    created_at INTEGER NOT NULL,
    saved_at INTEGER,
    closed_at INTEGER,
    data TEXT NOT NULL
  );
  CREATE INDEX deploys_wallet ON deploys(wallet, created_at DESC);
  CREATE INDEX deploys_open ON deploys(phase) WHERE phase IN ('closing', 'readding');
  CREATE INDEX deploys_pending ON deploys(outcome) WHERE outcome = 'pending';
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    wallet TEXT NOT NULL REFERENCES users(wallet) ON DELETE CASCADE,
    keys TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX push_wallet ON push_subscriptions(wallet);
  CREATE TABLE references_ (
    wallet TEXT NOT NULL REFERENCES users(wallet) ON DELETE CASCADE,
    market_id INTEGER NOT NULL,
    position_id INTEGER NOT NULL,
    reference REAL NOT NULL,
    lots INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (wallet, market_id)
  );
  `,
  `CREATE TABLE environment (id INTEGER PRIMARY KEY CHECK (id = 1), identity TEXT NOT NULL);`,
  `
  CREATE TABLE telegram_chats (
    wallet TEXT PRIMARY KEY REFERENCES users(wallet) ON DELETE CASCADE,
    chat_id TEXT NOT NULL,
    linked_at INTEGER NOT NULL
  );
  CREATE INDEX telegram_chat ON telegram_chats(chat_id);
  `,
  // Session expiry purges scan expires_at: index it instead of full-scanning sessions hourly.
  `CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);`,
];

export interface Settings {
  sensitivity: Sensitivity;
  /** d as a whole percent, 6–20. */
  targetPct: number;
  maxTrimPct: 25 | 50 | 75 | 100;
  useSpare: boolean;
  push: boolean;
  /** Off until the user arms Airbag at the end of onboarding, and when they pause it. */
  armed: boolean;
  /** Aggressive thresholds for demos; only for wallets in DEMO_WALLETS. */
  demo: boolean;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Omit<Settings, 'updatedAt'> = {
  sensitivity: 'balanced',
  targetPct: 10,
  maxTrimPct: 50,
  useSpare: true,
  push: true,
  armed: false,
  demo: false,
};

export interface Link {
  wallet: string;
  accountId: number;
  keyHint: string;
  sealed: Sealed;
  linkedAt: number;
}

export type DeployKind = 'trim' | 'margin';
export type DeployPhase = 'closing' | 'readding' | 'done' | 'failed';
export type DeployOutcome = 'pending' | 'save' | 'precaution';

export interface TimelineEntry {
  block: number;
  at: number;
  text: string;
  tx?: string;
  tone?: 'airbag' | 'liquidation';
}

/** Numbers are human units (dollars, base units): receipts, not balances (ADR 0010). */
export interface DeployData {
  trigger: { block: number; at: number; mark: number; line: number; reference: number };
  before: {
    size: number;
    lots: number;
    entry: number;
    deposit: number;
    funding: number;
    maintenance: number;
    liquidation: number;
    distance: number;
    leverage: number;
    /** Opening leverage, as Perpl shows it. */
    nominal?: number;
  };
  positionId: number;
  target: number;
  maxTrim: number;
  spare: number;
  plannedLiquidation: number | null;
  capped: boolean;
  close?: {
    lots: number;
    limitPrice: number;
    filledLots: number;
    fillPrice: number;
    realizedPnl: number;
    /** Gross observed trading fee; absent if a lost outcome cannot be attributed. */
    fee?: number | undefined;
    tx?: string;
  };
  margin?: { amount: number; reason: 'spare' | 'readd'; tx?: string };
  after?: {
    size: number;
    liquidation: number | null;
    distance: number | null;
    leverage: number | null;
    line: number | null;
  };
  /** 80% of the pre-deploy maintenance requirement: what a liquidation would have returned. */
  counterfactual: number;
  /** Spare margin Airbag added: already the user's, so not counted as kept. */
  spareAdded: number;
  save?: { block: number; at: number; mark: number };
  /** Save value at the last check, frozen when the position closes. */
  kept?: number;
  /** The mark `kept` was measured at. */
  keptMark?: number;
  latency?: { detectToSendMs: number; sendToFillMs: number; fillToReaddMs: number; blocks: number };
  attempts: number;
  /** The AirbagLog record of this deploy, when the onchain log is on. */
  onchain?: { deployId: number; tx: string; saveTx?: string };
  /** State when the latest close was sent, for finishing it after a restart. CNS as strings. */
  attempt?: { lots: number; deposit: string; balance: string; filledBefore?: number };
  /** Write-ahead record: a lost order may still execute until this block. */
  pendingOrder?: { rq: number; deadline: number };
  marginAttempt?: { deposit: string; amount: string };
  /** Exact deposit target for a re-add, persisted before sending it. */
  readd?: { deposit: string; amount: string; fill: number };
  useSpare?: boolean;
  error?: string;
  timeline: TimelineEntry[];
}

export interface Deploy {
  id: string;
  wallet: string;
  accountId: number;
  marketId: number;
  symbol: string;
  side: Side;
  kind: DeployKind;
  phase: DeployPhase;
  outcome: DeployOutcome;
  createdAt: number;
  savedAt: number | null;
  closedAt: number | null;
  data: DeployData;
}

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

type Row = Record<string, string | number | bigint | null | Uint8Array>;

const toDeploy = (r: Row): Deploy => ({
  id: String(r.id),
  wallet: String(r.wallet),
  accountId: Number(r.account_id),
  marketId: Number(r.market_id),
  symbol: String(r.symbol),
  side: r.side as Side,
  kind: r.kind as DeployKind,
  phase: r.phase as DeployPhase,
  outcome: r.outcome as DeployOutcome,
  createdAt: Number(r.created_at),
  savedAt: r.saved_at === null ? null : Number(r.saved_at),
  closedAt: r.closed_at === null ? null : Number(r.closed_at),
  data: JSON.parse(String(r.data)) as DeployData,
});

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
  if (version > MIGRATIONS.length) {
    db.close();
    throw new Error('Database schema is newer than this engine. Do not downgrade it.');
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v] ?? '');
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const q = (sql: string) => db.prepare(sql);
  const ensureUser = q(
    'INSERT INTO users (wallet, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING',
  );

  return {
    close: () => db.close(),
    schemaVersion: () => Number((db.prepare('PRAGMA user_version').get() as Row).user_version),
    backup: (destination: string) => backup(db, destination),
    bindEnvironment(identity: string, adoptLegacy = false) {
      const current = q('SELECT identity FROM environment WHERE id = 1').get() as Row | undefined;
      if (current && current.identity !== identity)
        throw new Error(
          `Database belongs to ${current.identity}, not ${identity}. Use a separate DATABASE_PATH.`,
        );
      if (current) return;
      const users = Number((q('SELECT count(*) AS n FROM users').get() as Row).n);
      if (users > 0 && !adoptLegacy)
        throw new Error(
          `Legacy database is unbound. Back it up, verify its mode/network, then run cli.ts bind-database ${identity}.`,
        );
      q('INSERT INTO environment (id, identity) VALUES (1, ?)').run(identity);
    },

    ensureUser: (wallet: string, now = Date.now()) => ensureUser.run(wallet, now),

    createSession(wallet: string, tokenHash: string, expiresAt: number, now = Date.now()) {
      ensureUser.run(wallet, now);
      q(
        'INSERT INTO sessions (token_hash, wallet, created_at, expires_at) VALUES (?, ?, ?, ?)',
      ).run(tokenHash, wallet, now, expiresAt);
    },
    sessionWallet(tokenHash: string, now = Date.now()): string | undefined {
      const r = q('SELECT wallet FROM sessions WHERE token_hash = ? AND expires_at > ?').get(
        tokenHash,
        now,
      ) as Row | undefined;
      return r ? String(r.wallet) : undefined;
    },
    deleteSession: (tokenHash: string) =>
      q('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash),
    /** Revokes every session for a wallet (stolen bearer response), including the caller. */
    deleteSessionsForWallet: (wallet: string) =>
      q('DELETE FROM sessions WHERE wallet = ?').run(wallet),
    purgeSessions: (now = Date.now()) => q('DELETE FROM sessions WHERE expires_at <= ?').run(now),

    putLink(link: Link) {
      ensureUser.run(link.wallet, link.linkedAt);
      q(
        `INSERT INTO links (wallet, account_id, key_hint, sealed, linked_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (wallet) DO UPDATE SET account_id = excluded.account_id,
           key_hint = excluded.key_hint, sealed = excluded.sealed, linked_at = excluded.linked_at`,
      ).run(link.wallet, link.accountId, link.keyHint, JSON.stringify(link.sealed), link.linkedAt);
    },
    link(wallet: string): Link | undefined {
      const r = q('SELECT * FROM links WHERE wallet = ?').get(wallet) as Row | undefined;
      return r && toLink(r);
    },
    links: (): Link[] => (q('SELECT * FROM links').all() as Row[]).map(toLink),
    deleteLink: (wallet: string) => q('DELETE FROM links WHERE wallet = ?').run(wallet),

    settings(wallet: string): Settings {
      const r = q('SELECT * FROM settings WHERE wallet = ?').get(wallet) as Row | undefined;
      if (!r) return { ...DEFAULT_SETTINGS, updatedAt: 0 };
      return {
        sensitivity: r.sensitivity as Sensitivity,
        targetPct: Number(r.target_pct),
        maxTrimPct: Number(r.max_trim_pct) as Settings['maxTrimPct'],
        useSpare: r.use_spare === 1,
        push: r.push === 1,
        armed: r.armed === 1,
        demo: r.demo === 1,
        updatedAt: Number(r.updated_at),
      };
    },
    putSettings(wallet: string, s: Omit<Settings, 'updatedAt'>, now = Date.now()) {
      ensureUser.run(wallet, now);
      q(
        `INSERT INTO settings (wallet, sensitivity, target_pct, max_trim_pct, use_spare, push, armed, demo, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (wallet) DO UPDATE SET sensitivity = excluded.sensitivity,
           target_pct = excluded.target_pct, max_trim_pct = excluded.max_trim_pct,
           use_spare = excluded.use_spare, push = excluded.push, armed = excluded.armed,
           demo = excluded.demo, updated_at = excluded.updated_at`,
      ).run(
        wallet,
        s.sensitivity,
        s.targetPct,
        s.maxTrimPct,
        s.useSpare ? 1 : 0,
        s.push ? 1 : 0,
        s.armed ? 1 : 0,
        s.demo ? 1 : 0,
        now,
      );
    },

    insertDeploy(d: Deploy) {
      q(
        `INSERT INTO deploys (id, wallet, account_id, market_id, symbol, side, kind, phase, outcome,
           created_at, saved_at, closed_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        d.id,
        d.wallet,
        d.accountId,
        d.marketId,
        d.symbol,
        d.side,
        d.kind,
        d.phase,
        d.outcome,
        d.createdAt,
        d.savedAt,
        d.closedAt,
        JSON.stringify(d.data),
      );
    },
    updateDeploy(d: Deploy) {
      q(
        `UPDATE deploys SET kind = ?, phase = ?, outcome = ?, saved_at = ?, closed_at = ?, data = ?
         WHERE id = ?`,
      ).run(d.kind, d.phase, d.outcome, d.savedAt, d.closedAt, JSON.stringify(d.data), d.id);
    },
    deploy(id: string): Deploy | undefined {
      const r = q('SELECT * FROM deploys WHERE id = ?').get(id) as Row | undefined;
      return r && toDeploy(r);
    },
    deploys: (wallet: string, limit = 20): Deploy[] =>
      (
        q('SELECT * FROM deploys WHERE wallet = ? ORDER BY created_at DESC LIMIT ?').all(
          wallet,
          limit,
        ) as Row[]
      ).map(toDeploy),
    /** Deploys a crash may have interrupted between the close and the re-add. */
    unfinishedDeploys: (wallet?: string): Deploy[] =>
      (wallet === undefined
        ? q(`SELECT * FROM deploys WHERE phase IN ('closing', 'readding')`).all()
        : q(`SELECT * FROM deploys WHERE wallet = ? AND phase IN ('closing', 'readding')`).all(
            wallet,
          )
      ).map((r) => toDeploy(r as Row)),
    /** Finished deploys whose position is still open: pending, or saves still counting. */
    trackedDeploys: (): Deploy[] =>
      (
        q(
          `SELECT * FROM deploys WHERE phase = 'done' AND closed_at IS NULL AND outcome IN ('pending', 'save')`,
        ).all() as Row[]
      ).map(toDeploy),

    addPush(wallet: string, sub: PushSubscription, now = Date.now()) {
      q(
        `INSERT INTO push_subscriptions (endpoint, wallet, keys, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET wallet = excluded.wallet, keys = excluded.keys`,
      ).run(sub.endpoint, wallet, JSON.stringify(sub.keys), now);
    },
    /** Without a wallet: a push service said the endpoint is gone. */
    removePush: (endpoint: string, wallet?: string) =>
      wallet === undefined
        ? q('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
        : q('DELETE FROM push_subscriptions WHERE endpoint = ? AND wallet = ?').run(
            endpoint,
            wallet,
          ),
    pushSubscriptions: (wallet: string): PushSubscription[] =>
      (
        q('SELECT endpoint, keys FROM push_subscriptions WHERE wallet = ?').all(wallet) as Row[]
      ).map((r) => ({ endpoint: String(r.endpoint), keys: JSON.parse(String(r.keys)) })),

    /** The Telegram chat a wallet linked for alerts, if any. */
    telegramChat: (wallet: string): string | undefined => {
      const r = q('SELECT chat_id FROM telegram_chats WHERE wallet = ?').get(wallet) as
        | Row
        | undefined;
      return r ? String(r.chat_id) : undefined;
    },
    putTelegramChat(wallet: string, chatId: string, now = Date.now()) {
      ensureUser.run(wallet, now);
      q(
        `INSERT INTO telegram_chats (wallet, chat_id, linked_at) VALUES (?, ?, ?)
         ON CONFLICT (wallet) DO UPDATE SET chat_id = excluded.chat_id, linked_at = excluded.linked_at`,
      ).run(wallet, chatId, now);
    },
    /** By wallet, from the app; by chat, when the trader sends /stop or blocks the bot. */
    deleteTelegramChat: (by: { wallet: string } | { chatId: string }) =>
      'wallet' in by
        ? q('DELETE FROM telegram_chats WHERE wallet = ?').run(by.wallet)
        : q('DELETE FROM telegram_chats WHERE chat_id = ?').run(by.chatId),

    reference(wallet: string, marketId: number) {
      const r = q('SELECT * FROM references_ WHERE wallet = ? AND market_id = ?').get(
        wallet,
        marketId,
      ) as Row | undefined;
      return r
        ? {
            positionId: Number(r.position_id),
            reference: Number(r.reference),
            lots: Number(r.lots),
          }
        : undefined;
    },
    putReference(
      wallet: string,
      marketId: number,
      ref: { positionId: number; reference: number; lots: number },
      now = Date.now(),
    ) {
      q(
        `INSERT INTO references_ (wallet, market_id, position_id, reference, lots, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (wallet, market_id) DO UPDATE SET position_id = excluded.position_id,
           reference = excluded.reference, lots = excluded.lots, updated_at = excluded.updated_at`,
      ).run(wallet, marketId, ref.positionId, ref.reference, ref.lots, now);
    },
    deleteReference: (wallet: string, marketId: number) =>
      q('DELETE FROM references_ WHERE wallet = ? AND market_id = ?').run(wallet, marketId),
  };
}

const toLink = (r: Row): Link => ({
  wallet: String(r.wallet),
  accountId: Number(r.account_id),
  keyHint: String(r.key_hint),
  sealed: JSON.parse(String(r.sealed)) as Sealed,
  linkedAt: Number(r.linked_at),
});
