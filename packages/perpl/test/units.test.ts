import { describe, expect, it } from 'vitest';
import { effectiveEntryPrice, lotsToClose, worstClosePrice } from '../src/units.ts';

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
