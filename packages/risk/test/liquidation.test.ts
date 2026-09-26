import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  distanceToLiquidation,
  equity,
  liquidationPrice,
  maintenanceRequirement,
  type Position,
} from '../src/index.ts';

// Golden vectors: docs/RISK-MODEL.md. Compared at the precision the design displays.
const usd = (v: number) => Math.round(v).toLocaleString('en-US');
const pct = (v: number) => (v * 100).toFixed(2);

const btc: Position = {
  side: 'long',
  size: 1,
  entry: 100_000,
  deposit: 10_000,
  funding: 0,
  maintenance: 0.04,
};
const eth: Position = {
  side: 'long',
  size: 2,
  entry: 3_000,
  deposit: 1_200,
  funding: 0,
  maintenance: 0.05,
};

describe('golden vectors', () => {
  it('BTC long: MMR $4,000, liquidation $94,000', () => {
    expect(usd(maintenanceRequirement(btc))).toBe('4,000');
    expect(usd(liquidationPrice(btc))).toBe('94,000');
  });

  it('BTC long at mark $99,420: 5.45% to liquidation, equity $9,420', () => {
    expect(pct(distanceToLiquidation(btc, 99_420))).toBe('5.45');
    expect(usd(equity(btc, 99_420))).toBe('9,420');
  });

  it('BTC long at $94,000 has equity equal to MMR ($4,000 residual)', () => {
    expect(usd(equity(btc, 94_000))).toBe('4,000');
  });

  it('ETH long: liquidation $2,550; 16.67% at $3,060; 15.34% at $3,012', () => {
    expect(usd(liquidationPrice(eth))).toBe('2,550');
    expect(pct(distanceToLiquidation(eth, 3_060))).toBe('16.67');
    expect(pct(distanceToLiquidation(eth, 3_012))).toBe('15.34');
  });

  it('funding received moves liquidation away, funding paid moves it closer', () => {
    expect(liquidationPrice({ ...btc, funding: 500 })).toBe(93_500);
    expect(liquidationPrice({ ...btc, funding: -500 })).toBe(94_500);
  });
});

const positions = fc.record({
  size: fc.double({ min: 1e-3, max: 1e3, noNaN: true }),
  entry: fc.double({ min: 1e-2, max: 1e6, noNaN: true }),
  leverage: fc.double({ min: 1.1, max: 20, noNaN: true }),
  funding: fc.double({ min: -0.01, max: 0.01, noNaN: true }),
  maintenance: fc.constantFrom(0.04, 0.05, 0.1, 0.2),
});

describe('properties', () => {
  it('equity at the liquidation price equals the maintenance requirement', () => {
    fc.assert(
      fc.property(positions, fc.constantFrom<Position['side']>('long', 'short'), (g, side) => {
        const notional = g.size * g.entry;
        const p: Position = {
          side,
          size: g.size,
          entry: g.entry,
          deposit: notional / g.leverage,
          funding: g.funding * notional,
          maintenance: g.maintenance,
        };
        const liq = liquidationPrice(p);
        expect(equity(p, liq)).toBeCloseTo(maintenanceRequirement(p), 6);
      }),
    );
  });

  it('long and short mirror each other around the entry price', () => {
    fc.assert(
      fc.property(positions, (g) => {
        const notional = g.size * g.entry;
        const base = {
          size: g.size,
          entry: g.entry,
          deposit: notional / g.leverage,
          funding: g.funding * notional,
          maintenance: g.maintenance,
        };
        const long = liquidationPrice({ ...base, side: 'long' });
        const short = liquidationPrice({ ...base, side: 'short' });
        expect(long - g.entry).toBeCloseTo(g.entry - short, 6);
      }),
    );
  });
});
