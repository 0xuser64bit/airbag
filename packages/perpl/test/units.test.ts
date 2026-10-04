import { describe, expect, it } from 'vitest';
import { closeFeeRate, fromChainPosition } from '../src/position.ts';
import type { Market } from '../src/types.ts';
import { effectiveEntryPrice, lotsToClose, worstClosePrice } from '../src/units.ts';

it('reads fee tiers and refuses missing or invalid fee schedules', () => {
  const market = { config: { taker_fee: 345, taker_fees: [345, 300] } } as Market;
  expect(closeFeeRate(market, 1)).toBe(0.0003);
  expect(closeFeeRate(market, 99)).toBe(0.000345);
  expect(() => closeFeeRate({ config: {} } as Market)).toThrow(/taker fee/);
  market.config.taker_fee = -1;
  expect(() => closeFeeRate(market, 99)).toThrow(/taker fee/);
});

describe('effectiveEntryPrice (Q16 residue, vectors from dex-sdk position.rs)', () => {
  it.each([
    ['long', 1, 0, 0.0001],
    ['long', 1, 1, 1 / 65536 / 1e4],
    ['long', 10001, 8, 1 + 8 / 65536 / 1e4],
    ['long', 10000, 65535, 1 - 1 / 65536 / 1e4],
    ['short', 1, 0, 0.0001],
    ['short', 0, 1, 1 / 65536 / 1e4],
    ['short', 10000, 8, 1 + 8 / 65536 / 1e4],
    ['short', 9999, 65535, 1 - 1 / 65536 / 1e4],
  ] as const)('%s ep=%i residue=%i', (side, ep, residue, expected) => {
    expect(effectiveEntryPrice(side, ep, residue, 4)).toBeCloseTo(expected, 12);
  });
});

describe('safe rounding (ADR 0008)', () => {
  it('rounds trims up to the next lot, never past the position', () => {
    expect(lotsToClose(100_000, 0.48905)).toBe(48_905);
    expect(lotsToClose(100_000, 0.489051)).toBe(48_906);
    expect(lotsToClose(3, 0.5)).toBe(2);
    expect(lotsToClose(3, 1.2)).toBe(3);
  });

  it('puts the worst price on the far side of the mark, in scaled integers', () => {
    // BTC testnet has 1 price decimal: mark $97,000 is 970000. Worst price 0.5% = 50 bps.
    // Long closes sell, so the limit rounds down; short closes buy, so it rounds up.
    expect(worstClosePrice('long', 970_000, 50)).toBe(965_150); // $96,515, the golden vector
    expect(worstClosePrice('long', 970_001, 50)).toBe(965_150);
    expect(worstClosePrice('short', 970_000, 50)).toBe(974_850);
    expect(worstClosePrice('short', 970_001, 50)).toBe(974_852);
  });
});

it("converts a contract position to human units, with the contract's funding", () => {
  const market = {
    config: { price_decimals: 1, size_decimals: 5, maintenance_margin: 2500 },
  } as Parameters<typeof fromChainPosition>[1];
  const p = {
    side: 'long' as const,
    depositCns: 41_612_829n,
    pricePns: 697_422n,
    residueQ16: 0n,
    lots: 179n,
    entryBlock: 55_355_560n,
    deltaPnlCns: 26_906_385n,
    premiumPnlCns: 6_563_572n,
    markPns: 847_737n,
  };
  // A real BTC long on Perpl mainnet: 0.00179 BTC from $69,742.2.
  expect(fromChainPosition(p, market, 6)).toEqual({
    side: 'long',
    size: 0.00179,
    entry: 69_742.2,
    deposit: 41.612829,
    funding: 6.563572,
    maintenance: 0.04,
  });
  expect(fromChainPosition({ ...p, side: null }, market, 6)).toBeNull();
});
