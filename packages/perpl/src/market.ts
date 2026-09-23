// The one shared market-data connection: heartbeat (head block), marks, funding and market
// config, plus an optional Monad newHeads subscription to cross-check Perpl's head.
// https://github.com/PerplFoundation/api-docs/blob/main/websocket.md#market-data-websocket
//
// The stale guard measures how far our data trails the chain, never the age of a mark: an
// unchanged mark is legitimately up to ~169 blocks old (docs/RESEARCH.md §3a).

import { backoff, openSocket, sleep, untilClosed, type WebSocketCtor } from './socket.ts';
import type { FundingEvent, Market, MarketConfig, MarketState, Message } from './types.ts';
import { MT } from './types.ts';

export interface Staleness {
  stale: boolean;
  reason?: 'no-data' | 'feed-silent' | 'behind-chain';
  /** Monad head minus Perpl's head, when Monad's head is known. */
  lagBlocks: number;
}

export interface MarketFeedOptions {
  /** wss://…/ws/v1/market-data */
  url: string;
  chainId: number;
  markets: Market[];
  /** Never act when data trails the head by more than this many blocks (brief §5). */
  staleBlocks: number;
  /** Monad JSON-RPC websocket for newHeads. Optional cross-check. */
  monadWsUrl?: string;
  /** Called on every Perpl heartbeat: the per-block tick. */
  onBlock?: (head: number) => void;
  onState?: (connected: boolean, reason?: string) => void;
  WebSocket?: WebSocketCtor;
}

/** Expected block interval, with headroom for Monad's p95 arrival jitter (~470 ms). */
const BLOCK_MS = 400;

export class MarketFeed {
  /** Perpl's head block, from the heartbeat. */
  head = 0;
  headAt = 0;
  monadHead = 0;
  monadHeadAt = 0;
  connected = false;
  readonly marks = new Map<number, MarketState>();
  readonly configs = new Map<number, MarketConfig>();
  private readonly funding = new Map<number, FundingEvent[]>();
  private readonly stop = new AbortController();
  private readonly running: Promise<void>[] = [];
  private readonly opts: MarketFeedOptions;

  constructor(opts: MarketFeedOptions) {
    this.opts = opts;
    for (const m of opts.markets) {
      this.marks.set(m.id, m.state);
      this.configs.set(m.id, m.config);
      this.addFunding(m.id, m.funding);
    }
  }

  start(): void {
    if (this.running.length) return;
    this.running.push(this.perplLoop());
    if (this.opts.monadWsUrl) this.running.push(this.monadLoop(this.opts.monadWsUrl));
  }

  async close(): Promise<void> {
    this.stop.abort();
    await Promise.all(this.running);
  }

  /** Scaled mark price for a market. */
  mark(marketId: number): number | undefined {
    return this.marks.get(marketId)?.mrk;
  }

  /** Seeds funding history (the newest event may apply ahead of the head). */
  seedFunding(byMarket: Record<string, FundingEvent[]>): void {
    for (const [id, events] of Object.entries(byMarket)) {
      for (const e of events) this.addFunding(Number(id), e);
    }
  }

  /** The funding event in force at `block`: the newest one whose block is at or before it. */
  fundingAt(marketId: number, block: number): FundingEvent | undefined {
    const events = this.funding.get(marketId) ?? [];
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e && e.feb <= block) return e;
    }
    return undefined;
  }

  staleness(now = Date.now()): Staleness {
    const limit = this.opts.staleBlocks;
    const lagBlocks = this.monadHead && this.head ? this.monadHead - this.head : 0;
    if (!this.head) return { stale: true, reason: 'no-data', lagBlocks };
    if (now - this.headAt > (limit + 1) * BLOCK_MS) {
      return { stale: true, reason: 'feed-silent', lagBlocks };
    }
    // Only trust Monad's head while it is itself fresh.
    const monadFresh = now - this.monadHeadAt < (limit + 1) * BLOCK_MS;
    if (monadFresh && lagBlocks > limit) return { stale: true, reason: 'behind-chain', lagBlocks };
    return { stale: false, lagBlocks };
  }

  private addFunding(marketId: number, e: FundingEvent | undefined) {
    if (!e || !Number.isFinite(e.feb)) return;
    // A repeat of a known `feb` is the same interval republished with its final timestamp.
    const list = (this.funding.get(marketId) ?? []).filter((x) => x.feb !== e.feb);
    list.push(e);
    list.sort((a, b) => a.feb - b.feb);
    this.funding.set(marketId, list.slice(-4));
  }

  /** Applies one market-data frame. Public so the simulator and tests can drive the feed. */
  apply(m: Message, now = Date.now()): void {
    switch (m.mt) {
      case MT.Heartbeat: {
        const h = m.h as number;
        if (h <= this.head) return;
        this.head = h;
        this.headAt = now;
        this.opts.onBlock?.(h);
        return;
      }
      case MT.MarketState:
        for (const [id, s] of Object.entries((m.d as Record<string, MarketState>) ?? {})) {
          if (s) this.marks.set(Number(id), s);
        }
        return;
      case MT.Funding:
        for (const [id, e] of Object.entries((m.d as Record<string, FundingEvent>) ?? {})) {
          this.addFunding(Number(id), e);
        }
        return;
      case MT.MarketConfig:
        for (const [id, c] of Object.entries((m.d as Record<string, MarketConfig>) ?? {})) {
          if (c) this.configs.set(Number(id), { ...this.configs.get(Number(id)), ...c });
        }
        return;
    }
  }

  private async perplLoop() {
    const streams = ['heartbeat', 'market-state', 'funding', 'market-config'];
    const subscribe = () =>
      JSON.stringify({
        mt: MT.Subscribe,
        subs: streams.map((s) => ({ stream: `${s}@${this.opts.chainId}`, subscribe: true })),
      });
    let attempt = 0;
    while (!this.stop.signal.aborted) {
      let reason = 'could not connect';
      try {
        // Market-data sockets need no pings: data arrives every block (Perpl docs).
        const socket = await openSocket(this.opts.url, subscribe, this.opts.WebSocket);
        this.connected = true;
        this.opts.onState?.(true);
        attempt = 0;
        socket.listen((m) => this.apply(m));
        const closed = await untilClosed(socket, this.stop.signal);
        reason = `${closed.code} ${closed.reason}`.trim();
      } catch {
        // Could not open.
      }
      this.connected = false;
      this.opts.onState?.(false, reason);
      if (this.stop.signal.aborted) break;
      await sleep(backoff(attempt++), this.stop.signal);
    }
  }

  private async monadLoop(url: string) {
    let attempt = 0;
    const subscribe = () =>
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] });
    while (!this.stop.signal.aborted) {
      try {
        const socket = await openSocket(url, subscribe, this.opts.WebSocket);
        attempt = 0;
        socket.listen((m) => {
          const head = (m as { params?: { result?: { number?: string } } }).params?.result?.number;
          if (!head) return;
          this.monadHead = Number.parseInt(head, 16);
          this.monadHeadAt = Date.now();
        });
        await untilClosed(socket, this.stop.signal);
      } catch {
        // Could not open; the cross-check is optional.
      }
      if (this.stop.signal.aborted) break;
      await sleep(backoff(attempt++), this.stop.signal);
    }
  }
}
