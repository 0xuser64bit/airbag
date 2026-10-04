import { describe, expect, it } from 'vitest';
import { type Radar, tally } from './radar.ts';

const empty = (): Radar => ({
  at: 0,
  positions: 0,
  notional: 0,
  near: { count: 0, notional: 0 },
  pastLine: { count: 0, notional: 0 },
});
// The design's BTC long: liquidation $94,000, Balanced line $97,000.
const btc = {
  side: 'long',
  size: 1,
  entry: 100_000,
  deposit: 10_000,
  funding: 0,
  maintenance: 0.04,
} as const;

describe('the radar', () => {
  it('counts a position near liquidation and past its line only where it is', () => {
    const r = empty();
    tally(r, btc, 99_420); // 5.45% away, above the line
    tally(r, btc, 98_000); // 4.08% away: near, still above the line
    tally(r, btc, 96_500); // past the line
    tally(r, { ...btc, side: 'short' }, 103_500); // a short past its $103,000 line
    expect(r.positions).toBe(4);
    expect(r.notional).toBe(99_420 + 98_000 + 96_500 + 103_500);
    expect(r.near).toEqual({ count: 3, notional: 98_000 + 96_500 + 103_500 });
    expect(r.pastLine).toEqual({ count: 2, notional: 96_500 + 103_500 });
  });
});
