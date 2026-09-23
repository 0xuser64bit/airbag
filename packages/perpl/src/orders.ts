// The order-type allowlist (docs/BRIEF.md section 5, ADR 0003). Airbag may only close or
// reduce (3, 4), add the user's own collateral (6), or cancel an order it placed itself (5).
// It must never open (1, 2), change (7), increase or flip a position.
//
// Three layers: these builders are the only way to make an order frame and can only produce
// allowed types; sendOrder() asserts again right before the socket; tests cover both.
// Frame fields: https://github.com/PerplFoundation/api-docs/blob/main/websocket.md#placing-orders

import type { Side } from '@airbag/risk';

export const ALLOWED_ORDER_TYPES = [3, 4, 5, 6] as const;
export type AllowedOrderType = (typeof ALLOWED_ORDER_TYPES)[number];

/** Order flags: Perpl `fl`. Closes are always immediate-or-cancel. */
export const IOC = 4;

/** Fields every mt:22 frame carries. `sn` is echoed as `cid` on mt:3; `rq` is the idempotency key. */
interface Envelope {
  /** Unique, non-zero per frame. */
  sn: number;
  /** Strictly increasing per account, seeded from Account.lfr. */
  rq: number;
  mkt: number;
  acc: number;
  /** Last execution block: 0 (server max) or head < lb <= head + order_ttl_blocks. */
  lb: number;
}

export interface CloseFrame extends Envelope {
  mt: 22;
  t: 3 | 4;
  /** Worst acceptable price, scaled. */
  p: number;
  /** Lots to close, scaled. */
  s: number;
  fl: typeof IOC;
  lv: number;
}

export interface IncreaseCollateralFrame extends Envelope {
  mt: 22;
  t: 6;
  /** Collateral amount, scaled integer (CNS) as a decimal string. */
  a: string;
  s: 0;
  fl: 0;
  lv: 0;
}

export interface CancelFrame extends Envelope {
  mt: 22;
  t: 5;
  oid: number;
  s: 0;
  fl: 0;
  lv: 0;
}

export type AllowedOrderFrame = CloseFrame | IncreaseCollateralFrame | CancelFrame;

const positiveInt = (name: string, v: number) => {
  if (!Number.isSafeInteger(v) || v <= 0)
    throw new RangeError(`${name} must be a positive integer, got ${v}`);
};

/** Reduce-only close: CloseLong (3) for longs, CloseShort (4) for shorts. Perpl clamps it to the position. */
export function closeOrder(
  args: Envelope & { side: Side; lots: number; limitPrice: number; leverage: number },
): CloseFrame {
  positiveInt('lots', args.lots);
  positiveInt('limitPrice', args.limitPrice);
  const { side, lots, limitPrice, leverage, ...envelope } = args;
  return {
    mt: 22,
    ...envelope,
    t: side === 'long' ? 3 : 4,
    p: limitPrice,
    s: lots,
    fl: IOC,
    lv: leverage,
  };
}

/** IncreasePositionCollateral (6): moves the account's own free balance into the position's deposit. */
export function increaseCollateral(
  args: Envelope & { amountCns: bigint },
): IncreaseCollateralFrame {
  if (args.amountCns <= 0n)
    throw new RangeError(`amountCns must be positive, got ${args.amountCns}`);
  const { amountCns, ...envelope } = args;
  return { mt: 22, ...envelope, t: 6, a: amountCns.toString(), s: 0, fl: 0, lv: 0 };
}

/** Cancel (5), only for an order id this engine placed. */
export function cancelOwnOrder(
  args: Envelope & { orderId: number },
  placedByAirbag: ReadonlySet<number>,
): CancelFrame {
  if (!placedByAirbag.has(args.orderId)) {
    throw new Error(`order ${args.orderId} was not placed by Airbag; refusing to cancel it`);
  }
  const { orderId, ...envelope } = args;
  return { mt: 22, ...envelope, t: 5, oid: orderId, s: 0, fl: 0, lv: 0 };
}

/** Runtime guard. Throws on anything that isn't an mt:22 frame with t in {3, 4, 5, 6}. */
export function assertAllowed(frame: unknown): asserts frame is AllowedOrderFrame {
  const f = frame as { mt?: unknown; t?: unknown } | null;
  if (f?.mt !== 22) throw new Error('not an order frame (mt !== 22)');
  if (!(ALLOWED_ORDER_TYPES as readonly unknown[]).includes(f.t)) {
    throw new Error(`order type ${String(f.t)} is not allowed: Airbag only sends 3, 4, 5 and 6`);
  }
}

/** The only path from the engine to the trading socket for orders. */
export function sendOrder(socket: { send(data: string): void }, frame: AllowedOrderFrame): void {
  assertAllowed(frame);
  socket.send(JSON.stringify(frame));
}
