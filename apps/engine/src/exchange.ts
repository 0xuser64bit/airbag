// The exchange port the guard trades through (ADR 0012). TradingClient is the live adapter;
// PaperExchange is the simulated one used by simulation mode and the tests. Both enforce the
// order-type allowlist, and the paper one mimics what matters on Perpl: IOC closes fill at the
// mark within the limit on a later block, the deposit shrinks pro-rata, the closed part's
// equity settles to the free balance, and t:6 moves free balance into the position.

import {
  type Account,
  type AllowedOrderFrame,
  assertAllowed,
  type ConnectionState,
  closeFeeRate,
  effectiveEntryPrice,
  fromCns,
  type Market,
  type Order,
  type OrderOutcome,
  OrderStatus,
  type PerplPosition,
  scaled,
  type TradingClient,
  toCnsFloor,
} from '@airbag/perpl';
import { direction } from '@airbag/risk';

export type Exchange = Pick<
  TradingClient,
  'state' | 'wallet' | 'account' | 'positions' | 'openOrders' | 'head' | 'lastMessageAt' | 'submit'
>;

interface Queued {
  frame: AllowedOrderFrame;
  at: number;
  resolve: (o: OrderOutcome) => void;
}

export interface PaperOptions {
  wallet: string;
  accountId: number;
  balanceCns: bigint;
  positions: PerplPosition[];
  markets: ReadonlyMap<number, Market>;
  collateralDecimals: number;
  /** Scaled mark for a market at the current block. */
  markOf: (marketId: number) => number | undefined;
  /** Blocks between sending and filling. Perpl forwards within a block or two. */
  delayBlocks?: number;
  /** Share of a close that fills, for partial-fill tests. */
  fillShare?: (frame: AllowedOrderFrame) => number;
}

export class PaperExchange implements Exchange {
  state: ConnectionState = 'live';
  wallet: string | undefined;
  account: Account | undefined;
  readonly positions = new Map<number, PerplPosition>();
  readonly openOrders = new Map<number, Order>();
  head = 0;
  lastMessageAt = Date.now();
  /** Every frame accepted, for tests and the allowlist audit. */
  readonly sent: AllowedOrderFrame[] = [];
  private readonly queue: Queued[] = [];
  private rq: number;
  private oid = 1;
  private readonly opts: PaperOptions;

  constructor(opts: PaperOptions) {
    this.opts = opts;
    this.wallet = opts.wallet;
    this.account = {
      id: opts.accountId,
      fr: false,
      fw: true,
      lfr: 0,
      b: opts.balanceCns.toString(),
      lb: '0',
    };
    this.rq = 0;
    for (const p of opts.positions) this.positions.set(p.mkt, { ...p });
  }

  submit(build: (ids: { sn: number; rq: number }) => AllowedOrderFrame): Promise<OrderOutcome> {
    this.rq += 1;
    const frame = build({ sn: this.rq, rq: this.rq });
    assertAllowed(frame);
    this.sent.push(frame);
    return new Promise((resolve) => this.queue.push({ frame, at: this.head, resolve }));
  }

  close(): void {
    this.state = 'stopped';
    for (const q of this.queue.splice(0)) q.resolve({ result: 'lost', rq: q.frame.rq });
  }

  /** Advances to `head`, settling every order whose delay has passed. */
  onBlock(head: number): void {
    this.head = head;
    this.lastMessageAt = Date.now();
    const due = this.queue.filter((q) => head - q.at >= (this.opts.delayBlocks ?? 1));
    for (const q of due) {
      this.queue.splice(this.queue.indexOf(q), 1);
      q.resolve(this.settle(q.frame));
    }
  }

  private order(frame: AllowedOrderFrame, st: number, fs: number, fp: number, sr = 0): Order {
    const order: Order = {
      at: { b: this.head },
      rq: frame.rq,
      mkt: frame.mkt,
      acc: frame.acc,
      oid: this.oid++,
      st,
      sr,
      t: frame.t,
      fp,
      fs,
      os: frame.s,
      f: '0',
    };
    if (this.account) this.account.lfr = frame.rq;
    return order;
  }

  private settle(frame: AllowedOrderFrame): OrderOutcome {
    const account = this.account;
    const pos = this.positions.get(frame.mkt);
    const market = this.opts.markets.get(frame.mkt);
    if (!account || !market) return { result: 'failed', rq: frame.rq, error: 'no account' };
    const cd = this.opts.collateralDecimals;

    if (frame.t === 6) {
      const amount = BigInt(frame.a);
      const free = BigInt(account.b) - BigInt(account.lb);
      // fillShare 0 on a t:6 simulates Perpl failing it.
      if (!pos || amount > free || this.opts.fillShare?.(frame) === 0) {
        return {
          result: 'failed',
          rq: frame.rq,
          order: this.order(frame, OrderStatus.Failed, 0, 0, 1),
        };
      }
      account.b = (BigInt(account.b) - amount).toString();
      pos.c = (BigInt(pos.c) + amount).toString();
      return {
        result: 'executed',
        rq: frame.rq,
        order: this.order(frame, OrderStatus.Executed, 0, 0),
      };
    }

    if (frame.t === 5) {
      return {
        result: 'failed',
        rq: frame.rq,
        order: this.order(frame, OrderStatus.Failed, 0, 0, 33),
      };
    }

    // CloseLong (3) / CloseShort (4): IOC at the mark if it's within the limit.
    const mark = this.opts.markOf(frame.mkt);
    const side = frame.t === 3 ? 'long' : 'short';
    if (!pos || (pos.sd === 1) !== (side === 'long') || mark === undefined) {
      return {
        result: 'failed',
        rq: frame.rq,
        order: this.order(frame, OrderStatus.Failed, 0, 0, 11),
      };
    }
    const withinLimit = direction(side) * (mark - frame.p) >= 0;
    const share = this.opts.fillShare?.(frame) ?? 1;
    const lots = withinLimit ? Math.min(pos.s, Math.floor(frame.s * share)) : 0;
    if (lots === 0) {
      return {
        result: 'unfilled',
        rq: frame.rq,
        order: this.order(frame, OrderStatus.Canceled, 0, 0, 16),
      };
    }
    const pd = market.config.price_decimals;
    const sd = market.config.size_decimals;
    const entry = effectiveEntryPrice(side, pos.ep, pos.epr ?? 0, pd);
    const depositBefore = BigInt(pos.c);
    const depositAfter = (depositBefore * BigInt(pos.s - lots)) / BigInt(pos.s);
    const realized = direction(side) * scaled(lots, sd) * (scaled(mark, pd) - entry);
    const fee = toCnsFloor(
      scaled(lots, sd) * scaled(mark, pd) * closeFeeRate(market, account.ft ?? 0),
      cd,
    );
    const released =
      depositBefore -
      depositAfter +
      (realized >= 0 ? toCnsFloor(realized, cd) : -toCnsFloor(-realized, cd)) -
      fee;
    account.b = (BigInt(account.b) + released).toString();
    pos.s -= lots;
    pos.c = depositAfter.toString();
    if (pos.s === 0) {
      pos.st = 2;
      this.positions.delete(frame.mkt);
    }
    const full = lots === frame.s;
    return {
      result: full ? 'filled' : 'partial',
      rq: frame.rq,
      order: {
        ...this.order(frame, full ? OrderStatus.Filled : OrderStatus.Canceled, lots, mark),
        f: fee.toString(),
      },
    };
  }

  /** Free balance in collateral units, for tests. */
  spare(): number {
    return this.account
      ? fromCns(BigInt(this.account.b) - BigInt(this.account.lb), this.opts.collateralDecimals)
      : 0;
  }
}
