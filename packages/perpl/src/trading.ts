// One authenticated trading connection per linked account.
// Protocol: https://github.com/PerplFoundation/api-docs/blob/main/websocket.md#trading-websocket
//
// - Signs in with mt:29 as the first frame, fresh signature on every connect.
// - Keeps wallet, account, open orders and open positions from snapshots (mt:19/23/26) and
//   updates (mt:21/24/27). Snapshots arrive again after every reconnect.
// - Tracks heartbeat `sn` from the WalletSnapshot's `sn`; a gap forces a reconnect.
// - Pings every 30 s, and spends a token-bucket budget under Perpl's request limit.
// - Sends orders only through the allowlisted `sendOrder`, with a unique `sn` and a strictly
//   increasing `rq` seeded from `Account.lfr`, and reconciles outcomes from mt:3 and mt:24.

import type { KeyObject } from 'node:crypto';
import { signInFrame } from './auth.ts';
import { type AllowedOrderFrame, sendOrder } from './orders.ts';
import {
  backoff,
  closeWhenSilent,
  openSocket,
  type Socket,
  sleep,
  untilClosed,
  type WebSocketCtor,
} from './socket.ts';
import {
  type Account,
  type Fill,
  type Message,
  MT,
  type Order,
  OrderStatus,
  type PerplPosition,
  PositionStatus,
  type StatusResponse,
  type Wallet,
} from './types.ts';

export type ConnectionState =
  | 'connecting'
  /** Snapshots received; heartbeats flowing. */
  | 'live'
  /** Closed with 3401: revoked or expired key, wrong secret, or an IP outside the allow-list. */
  | 'rejected'
  /** Closed with 1008 "too many connections": 4 per wallet, shared with browser tabs. */
  | 'limited'
  | 'down'
  | 'stopped';

export type TradingEvent =
  | { type: 'state'; state: ConnectionState; code?: number; reason?: string }
  | { type: 'snapshot' }
  | { type: 'account'; account: Account }
  | { type: 'position'; position: PerplPosition }
  | { type: 'order'; order: Order }
  | { type: 'fill'; fill: Fill }
  | { type: 'heartbeat'; head: number };

export interface TradingOptions {
  url: string;
  chainId: number;
  apiKey: string;
  key: KeyObject;
  /** Perpl's trading limit: 60/min on testnet, 120 on mainnet. */
  requestsPerMinute: number;
  onEvent?: (e: TradingEvent) => void;
  WebSocket?: WebSocketCtor;
}

type OrderResult =
  | 'filled'
  | 'partial'
  | 'unfilled'
  | 'executed'
  | 'failed'
  /** Refused at the gateway (mt:3 code ≠ 0). Nothing reached the chain. */
  | 'rejected'
  /** The socket closed or `lb` passed with no final status. Reconcile from positions. */
  | 'lost';

export interface OrderOutcome {
  result: OrderResult;
  rq: number;
  code?: number;
  error?: string;
  /** The final order update, when one arrived. */
  order?: Order;
}

interface Pending {
  frame: AllowedOrderFrame;
  onStatus?: ((code: number) => void) | undefined;
  /** Settle as lost after this block. `lb: 0` means Perpl's max window, which we don't know. */
  deadline: number;
  sawNonFailure: boolean;
  last?: Order;
  resolve: (o: OrderOutcome) => void;
}

/** An `lb: 0` order's window is `order_ttl_blocks` (20 today); give up well after that. */
const MAX_WINDOW = 60;
/** Perpl sends a heartbeat every block. This long without any frame means the socket is dead. */
const SILENT_MS = 10_000;

const FINAL = new Set<number>([
  OrderStatus.Filled,
  OrderStatus.Canceled,
  OrderStatus.Expired,
  OrderStatus.Executed,
]);

/** Token bucket. Kept under the published limit so a burst never trips a 1008 close. */
export class TokenBucket {
  private tokens: number;
  private at = performance.now();
  private readonly capacity: number;
  private readonly perSecond: number;
  private queue: Promise<void> = Promise.resolve();
  constructor(capacity: number, perSecond: number) {
    this.capacity = capacity;
    this.perSecond = perSecond;
    this.tokens = capacity;
  }
  private refill() {
    const now = performance.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.at) / 1000) * this.perSecond);
    this.at = now;
  }
  take(signal?: AbortSignal): Promise<void> {
    const next = this.queue.then(async () => {
      this.refill();
      while (this.tokens < 1 && !signal?.aborted) {
        await sleep(((1 - this.tokens) / this.perSecond) * 1000, signal);
        this.refill();
      }
      if (!signal?.aborted) this.tokens -= 1;
    });
    this.queue = next;
    return next;
  }
}

export class TradingClient {
  state: ConnectionState = 'connecting';
  wallet: string | undefined;
  account: Account | undefined;
  /** Open positions by market id. */
  readonly positions = new Map<number, PerplPosition>();
  /** The account's open orders by order id. */
  readonly openOrders = new Map<number, Order>();
  head = 0;
  /** Date.now() of the last frame received. */
  lastMessageAt = 0;

  private socket: Socket | undefined;
  private lastSn: number | undefined;
  private sn = 0;
  private rq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly bySn = new Map<number, Pending>();
  private readonly bucket: TokenBucket;
  private readonly stop = new AbortController();
  private running: Promise<void> | undefined;
  private gotWallet = false;
  private readonly waitReady = new Set<(s: ConnectionState, reason?: string) => void>();
  private readonly opts: TradingOptions;

  constructor(opts: TradingOptions) {
    this.opts = opts;
    // 80% of the published rate, burst 5: at most 0.8·limit + 5 in any minute.
    this.bucket = new TokenBucket(5, (opts.requestsPerMinute / 60) * 0.8);
  }

  start(): void {
    this.running ??= this.loop();
  }

  async close(): Promise<void> {
    this.stop.abort();
    await this.running;
  }

  /** Resolves once snapshots have arrived; rejects if the key is refused or on timeout. */
  ready(timeoutMs = 15_000): Promise<void> {
    if (this.stop.signal.aborted) return Promise.reject(new Error('stopped'));
    if (this.state === 'live') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waitReady.delete(check);
        reject(new Error(`no snapshot within ${timeoutMs} ms (state ${this.state})`));
      }, timeoutMs);
      const check = (state: ConnectionState, reason?: string) => {
        if (state === 'live') resolve();
        else if (state === 'rejected' || state === 'limited' || state === 'stopped')
          reject(new Error(reason ?? state));
        else return;
        clearTimeout(timer);
        this.waitReady.delete(check);
      };
      this.waitReady.add(check);
    });
  }

  /**
   * Sends one allowlisted order. `build` gets the frame's `sn` and `rq`. Resolves with the
   * outcome from mt:3 and mt:24; `lost` means no final status arrived and the caller must
   * reconcile from positions. Retries once with a new `rq` on sr:32, as Perpl's docs advise,
   * except a t:6: Perpl reports an add that already executed as failed with sr:32 (testnet,
   * 2026-10-10), so resending would add the margin twice. Reconcile a t:6 from the deposit.
   * `onStatus` hears the gateway's admission code (mt:3) as soon as it arrives.
   */
  async submit(
    build: (ids: { sn: number; rq: number }) => AllowedOrderFrame,
    onStatus?: (code: number) => void,
  ): Promise<OrderOutcome> {
    const first = await this.sendOnce(build, onStatus);
    if (first.result === 'failed' && first.order?.sr === 32 && first.order.t !== 6)
      return this.sendOnce(build, onStatus);
    return first;
  }

  private async sendOnce(
    build: (ids: { sn: number; rq: number }) => AllowedOrderFrame,
    onStatus?: (code: number) => void,
  ): Promise<OrderOutcome> {
    await this.bucket.take(this.stop.signal);
    const socket = this.socket;
    if (this.stop.signal.aborted || !socket?.isOpen || this.state !== 'live' || !this.account) {
      return { result: 'lost', rq: 0, error: `not connected (${this.state})` };
    }
    this.rq = Math.max(this.rq, this.account.lfr) + 1;
    this.sn += 1;
    const frame = build({ sn: this.sn, rq: this.rq });
    return new Promise<OrderOutcome>((resolve) => {
      const deadline = frame.lb > 0 ? frame.lb : this.head + MAX_WINDOW;
      const p: Pending = { frame, onStatus, deadline, sawNonFailure: false, resolve };
      this.pending.set(frame.rq, p);
      this.bySn.set(frame.sn, p);
      try {
        sendOrder(socket, frame);
      } catch (err) {
        this.settle(p, { result: 'rejected', rq: frame.rq, error: String(err) });
      }
    });
  }

  private settle(p: Pending, outcome: OrderOutcome) {
    if (!this.pending.delete(p.frame.rq)) return;
    this.bySn.delete(p.frame.sn);
    p.resolve(outcome);
  }

  private emit(e: TradingEvent) {
    this.opts.onEvent?.(e);
  }

  private setState(state: ConnectionState, code?: number, reason?: string) {
    if (this.state === state) return;
    this.state = state;
    for (const check of [...this.waitReady]) check(state, reason);
    this.emit({
      type: 'state',
      state,
      ...(code === undefined ? {} : { code }),
      ...(reason ? { reason } : {}),
    });
  }

  private async loop(): Promise<void> {
    let attempt = 0;
    while (!this.stop.signal.aborted) {
      this.setState('connecting');
      let closed = { code: 1006, reason: 'could not connect' };
      try {
        const socket = await openSocket(
          this.opts.url,
          () => JSON.stringify(signInFrame(this.opts.chainId, this.opts.apiKey, this.opts.key)),
          this.opts.WebSocket,
          this.stop.signal,
        );
        this.socket = socket;
        this.lastSn = undefined;
        this.gotWallet = false;
        socket.listen((m) => this.handle(m));
        const ping = setInterval(() => {
          void this.bucket.take(this.stop.signal).then(() => {
            if (socket.isOpen) socket.send(JSON.stringify({ mt: MT.Ping, t: Date.now() }));
          });
        }, 30_000);
        const unwatch = closeWhenSilent(socket, SILENT_MS);
        closed = await untilClosed(socket, this.stop.signal);
        clearInterval(ping);
        unwatch();
      } catch {
        // Could not open; closed stays 1006.
      }
      this.socket = undefined;
      // A close carries no per-request status: everything in flight is unknown.
      for (const p of [...this.pending.values()]) {
        this.settle(p, { result: 'lost', rq: p.frame.rq, error: `socket closed (${closed.code})` });
      }
      if (this.stop.signal.aborted) break;
      if (this.state === 'live') attempt = 0;
      if (closed.code === 3401) this.setState('rejected', closed.code, closed.reason);
      else if (closed.code === 1008 && /too many connections/i.test(closed.reason)) {
        this.setState('limited', closed.code, closed.reason);
      } else this.setState('down', closed.code, closed.reason);
      await sleep(closed.code === 1001 ? 0 : backoff(attempt++), this.stop.signal);
    }
    this.setState('stopped');
  }

  private handle(m: Message) {
    this.lastMessageAt = Date.now();
    switch (m.mt) {
      case MT.WalletSnapshot: {
        const w = m as unknown as Wallet;
        this.wallet = w.addr;
        this.account = w.as?.[0];
        this.lastSn = m.sn;
        this.gotWallet = true;
        if (this.account) this.emit({ type: 'account', account: this.account });
        break;
      }
      case MT.OrdersSnapshot:
        this.openOrders.clear();
        for (const o of (m.d as Order[] | undefined) ?? []) this.openOrders.set(o.oid, o);
        break;
      case MT.PositionsSnapshot: {
        this.positions.clear();
        for (const p of (m.d as PerplPosition[] | undefined) ?? []) {
          if (p.st === PositionStatus.Open) this.positions.set(p.mkt, p);
        }
        if (this.gotWallet) {
          this.setState('live');
          this.emit({ type: 'snapshot' });
        }
        break;
      }
      case MT.AccountUpdate: {
        const a = m as unknown as Account;
        if (!this.account || a.id === this.account.id) {
          this.account = { ...this.account, ...a };
          this.emit({ type: 'account', account: this.account });
        }
        break;
      }
      case MT.PositionsUpdate:
        for (const p of (m.d as PerplPosition[] | undefined) ?? []) {
          if (p.st === PositionStatus.Open) this.positions.set(p.mkt, p);
          else if (this.positions.get(p.mkt)?.pid === p.pid) this.positions.delete(p.mkt);
          this.emit({ type: 'position', position: p });
        }
        break;
      case MT.OrdersUpdate:
        for (const o of (m.d as Order[] | undefined) ?? []) {
          if (o.r || FINAL.has(o.st) || o.st === OrderStatus.Failed) this.openOrders.delete(o.oid);
          else this.openOrders.set(o.oid, o);
          this.onOrder(o);
          this.emit({ type: 'order', order: o });
        }
        break;
      case MT.Fills:
        for (const f of (m.d as Fill[] | undefined) ?? []) this.emit({ type: 'fill', fill: f });
        break;
      case MT.Status: {
        const s = m as unknown as StatusResponse;
        const p = s.cid === undefined ? undefined : this.bySn.get(s.cid);
        p?.onStatus?.(s.status.code);
        if (p && s.status.code !== 0) {
          this.settle(p, {
            result: 'rejected',
            rq: p.frame.rq,
            code: s.status.code,
            ...(s.status.error ? { error: s.status.error } : {}),
          });
        }
        break;
      }
      case MT.Heartbeat: {
        const sn = m.sn;
        if (this.lastSn !== undefined && sn !== this.lastSn + 1) {
          // A gap means messages may have been lost: reconnect for fresh snapshots.
          this.socket?.close(4000, `heartbeat sn gap ${this.lastSn} -> ${sn}`);
          return;
        }
        this.lastSn = sn;
        this.head = m.h as number;
        this.expire();
        this.emit({ type: 'heartbeat', head: this.head });
        break;
      }
    }
  }

  /**
   * Keeps the first non-failure status as definitive and waits for a final one; if only
   * failures arrive, the first one is the outcome (Perpl's dedup rules).
   */
  private onOrder(o: Order) {
    const p = this.pending.get(o.rq);
    if (!p || (this.account && o.acc !== this.account.id)) return;
    if (o.st === OrderStatus.Failed) {
      if (!p.sawNonFailure) this.settle(p, { result: 'failed', rq: o.rq, order: o });
      return;
    }
    p.sawNonFailure = true;
    p.last = o;
    if (!FINAL.has(o.st)) return;
    const result: OrderResult =
      o.st === OrderStatus.Filled
        ? 'filled'
        : o.st === OrderStatus.Executed
          ? 'executed'
          : o.fs > 0
            ? 'partial'
            : 'unfilled';
    this.settle(p, { result, rq: o.rq, order: o });
  }

  /** An order whose window has passed with no final status is lost. */
  private expire() {
    for (const p of [...this.pending.values()]) {
      if (this.head > p.deadline + 2) {
        this.settle(p, {
          result: p.last && p.last.fs > 0 ? 'partial' : 'lost',
          rq: p.frame.rq,
          ...(p.last ? { order: p.last } : {}),
          error: `no final status by block ${p.deadline}`,
        });
      }
    }
  }
}
