import { describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_ORDER_TYPES,
  assertAllowed,
  closeOrder,
  increaseCollateral,
  scopeProbe,
  sendOrder,
} from '../src/orders.ts';

const base = { sn: 1, rq: 10, mkt: 16, acc: 42, lb: 0 };

describe('order-type allowlist (brief section 5)', () => {
  it('allows exactly 3, 4, 5 and 6', () => {
    expect([...ALLOWED_ORDER_TYPES].sort()).toEqual([3, 4, 5, 6]);
  });

  it('every builder emits an allowed type', () => {
    const frames = [
      closeOrder({ ...base, side: 'long', lots: 100, limitPrice: 960_000, leverage: 1000 }),
      closeOrder({ ...base, side: 'short', lots: 100, limitPrice: 960_000, leverage: 1000 }),
      increaseCollateral({ ...base, amountCns: 1_000_000n }),
      scopeProbe(base, new Set([1])),
    ];
    expect(frames.map((f) => f.t)).toEqual([3, 4, 6, 5]);
    for (const f of frames) expect(() => assertAllowed(f)).not.toThrow();
  });

  it.each([0, 1, 2, 7, 8, -1, 3.5, '3', undefined, null])('rejects t = %s', (t) => {
    expect(() => assertAllowed({ mt: 22, ...base, t })).toThrow(/not allowed/);
  });

  it('rejects anything that is not an order frame', () => {
    expect(() => assertAllowed({ mt: 29, t: 3 })).toThrow();
    expect(() => assertAllowed(null)).toThrow();
  });

  it('sendOrder never puts a forbidden frame on the wire', () => {
    const socket = { send: vi.fn() };
    const forged = { mt: 22, ...base, t: 1, s: 100, p: 0, fl: 4, lv: 1000 };
    // @ts-expect-error: an OpenLong frame is not an AllowedOrderFrame
    expect(() => sendOrder(socket, forged)).toThrow(/not allowed/);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('sendOrder sends allowed frames as JSON', () => {
    const socket = { send: vi.fn() };
    sendOrder(socket, increaseCollateral({ ...base, amountCns: 5n }));
    expect(JSON.parse(socket.send.mock.calls[0]?.[0])).toMatchObject({ mt: 22, t: 6, a: '5' });
  });

  it('close orders are IOC limit orders', () => {
    const f = closeOrder({ ...base, side: 'long', lots: 1, limitPrice: 5, leverage: 1000 });
    expect(f).toMatchObject({ fl: 4, p: 5, s: 1 });
  });

  it('rejects empty or fractional sizes and amounts', () => {
    expect(() =>
      closeOrder({ ...base, side: 'long', lots: 0, limitPrice: 5, leverage: 1 }),
    ).toThrow();
    expect(() =>
      closeOrder({ ...base, side: 'long', lots: 1.5, limitPrice: 5, leverage: 1 }),
    ).toThrow();
    expect(() => increaseCollateral({ ...base, amountCns: 0n })).toThrow();
  });
});

describe('scope probe', () => {
  it('is an allowed cancel that never targets one of the account’s open orders', () => {
    const open = new Set([1, 2, 4, Number.MAX_SAFE_INTEGER]);
    const frame = scopeProbe(base, open);
    expect(frame).toMatchObject({ mt: 22, t: 5, oid: Number.MAX_SAFE_INTEGER - 1 });
    expect(open.has(frame.oid)).toBe(false);
    expect(() => assertAllowed(frame)).not.toThrow();
    expect(scopeProbe(base, new Set()).oid).toBe(Number.MAX_SAFE_INTEGER);
  });
});
