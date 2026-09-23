// The engine: one guard per linked account, all driven by the shared market feed's per-block
// tick. It also keeps the block tape the dashboard shows ("every block, checked").

import type { Store } from './db.ts';
import type { Exchange, PaperExchange } from './exchange.ts';
import { AccountGuard, type Feed, type Markets, type Notifier } from './guard.ts';
import type { Logger } from './log.ts';

export interface EngineDeps {
  store: Store;
  log: Logger;
  markets: Markets;
  feed: Feed;
  notify: Notifier;
  slippageBps: number;
  maxAttempts: number;
  demoMove: number;
  pollMs?: number;
  settleMs?: number;
}

export interface TapeEntry {
  block: number;
  /** Checked on fresh data. False for stale blocks and for blocks we never saw. */
  ok: boolean;
}

const TAPE = 60;

export class Engine {
  readonly guards = new Map<string, AccountGuard>();
  readonly tape: TapeEntry[] = [];
  lastTickAt = 0;
  private readonly deps: EngineDeps;
  private readonly listeners = new Set<() => void>();

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  get markets(): Markets {
    return this.deps.markets;
  }

  get feed(): Feed {
    return this.deps.feed;
  }

  add(wallet: string, exchange: Exchange): AccountGuard {
    const guard = new AccountGuard(wallet, exchange, this.deps.store.settings(wallet), this.deps);
    this.guards.set(wallet, guard);
    return guard;
  }

  remove(wallet: string): Exchange | undefined {
    const guard = this.guards.get(wallet);
    this.guards.delete(wallet);
    return guard?.exchange;
  }

  /** Re-reads a wallet's settings after the API changes them. */
  reloadSettings(wallet: string): void {
    const guard = this.guards.get(wallet);
    if (guard) guard.settings = this.deps.store.settings(wallet);
  }

  /** Called on every new head. Never throws: one bad account can't stop the others. */
  tick(head: number): void {
    this.lastTickAt = Date.now();
    const ok = !this.deps.feed.staleness().stale;
    for (const guard of this.guards.values()) {
      try {
        (guard.exchange as Partial<PaperExchange>).onBlock?.(head);
        guard.onBlock(head);
      } catch (err) {
        this.deps.log.error('guard.error', { wallet: guard.wallet, head, err });
      }
    }
    const last = this.tape.at(-1)?.block;
    if (last !== undefined && head - last > 1) {
      for (let b = Math.max(last + 1, head - TAPE); b < head; b++)
        this.tape.push({ block: b, ok: false });
    }
    this.tape.push({ block: head, ok });
    if (this.tape.length > TAPE) this.tape.splice(0, this.tape.length - TAPE);
    for (const fn of this.listeners) fn();
  }

  /** Subscribes to ticks (for the live stream). Returns an unsubscribe function. */
  onTick(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
