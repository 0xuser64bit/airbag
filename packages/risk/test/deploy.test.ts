import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  airbagLine,
  applyMargin,
  applyTrim,
  counterfactualReturn,
  crossed,
  cushionUsed,
  distanceToLiquidation,
  equity,
  leverage,
  liquidationAfterTrim,
  liquidationPrice,
  type Plan,
  type Policy,
  type Position,
  planDeploy,
  SENSITIVITY,
  saveValue,
  triggered,
} from '../src/index.ts';

// Golden vectors: docs/RISK-MODEL.md, compared at the precision the design displays.
const usd = (v: number | null) => Math.round(v ?? Number.NaN).toLocaleString('en-US');
const pct = (v: number, dp = 2) => (v * 100).toFixed(dp);

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
const balanced: Policy = { target: 0.1, maxTrim: 0.5, useSpare: true };
const SPARE = 420;

const trimOf = (plan: Plan) => {
  if (plan.kind !== 'trim') throw new Error(`expected a trim, got ${plan.kind}`);
  return plan;
};

describe('golden vectors: the Airbag line', () => {
  it('C0 is $6,000 and the lines are $98,000 / $97,000 / $95,500', () => {
    expect(usd(airbagLine(btc, btc.entry, SENSITIVITY.balanced).cushion)).toBe('6,000');
    expect(usd(airbagLine(btc, btc.entry, SENSITIVITY.early).price)).toBe('98,000');
    expect(usd(airbagLine(btc, btc.entry, SENSITIVITY.balanced).price)).toBe('97,000');
    expect(usd(airbagLine(btc, btc.entry, SENSITIVITY.late).price)).toBe('95,500');
  });

  it('at mark $99,420 the line is 2.43% below and 9.7% of the cushion is used', () => {
    const line = airbagLine(btc, btc.entry, SENSITIVITY.balanced);
    expect(pct((99_420 - line.price) / 99_420)).toBe('2.43');
    expect(pct(cushionUsed(btc, 99_420, line), 1)).toBe('9.7');
    expect(triggered(btc, 99_420, line)).toBe(false);
    expect(triggered(btc, 97_000, line)).toBe(true);
  });

  it('a mark exactly on the line triggers, whatever the float noise', () => {
    // 500,000 MON short from $0.034 at 20% maintenance: the line is $0.0366, and equity there
    // computes as $4,700.000000000001 against a $4,700 trigger.
    const mon: Position = {
      side: 'short',
      size: 500_000,
      entry: 0.034,
      deposit: 6_000,
      funding: 0,
      maintenance: 0.2,
    };
    const line = airbagLine(mon, mon.entry, SENSITIVITY.balanced);
    expect(line.price).toBeCloseTo(0.0366, 12);
    expect(triggered(mon, 0.0366, line)).toBe(true);
    expect(triggered(mon, 0.03659, line)).toBe(false);
  });

  it('ETH: Balanced line $2,775', () => {
    expect(usd(airbagLine(eth, eth.entry, SENSITIVITY.balanced).price)).toBe('2,775');
  });
});

describe('golden vectors: the deploy', () => {
  it('spare $420 would only move liquidation to $93,580 (3.53%), so it is not used', () => {
    expect(usd(liquidationPrice(applyMargin(btc, SPARE)))).toBe('93,580');
    expect(pct(distanceToLiquidation(applyMargin(btc, SPARE), 97_000))).toBe('3.53');
    expect(planDeploy(btc, 97_000, SPARE, balanced).kind).toBe('trim');
  });

  it('Balanced trims 0.489 BTC (48.9%), leaving 0.511, liquidation $87,300 (10.00%)', () => {
    const plan = trimOf(planDeploy(btc, 97_000, SPARE, balanced));
    expect(plan.fraction.toFixed(3)).toBe('0.489');
    expect(pct(plan.fraction, 1)).toBe('48.9');
    expect((1 - plan.fraction).toFixed(3)).toBe('0.511');
    expect(plan.capped).toBe(false);
    expect(usd(plan.liquidation)).toBe('87,300');
    expect(pct(distanceToLiquidation(applyTrim(btc, plan.fraction, 97_000).position, 97_000))).toBe(
      '10.00',
    );
  });

  it('realizes −$1,467 and takes leverage from 13.9x to 7.1x', () => {
    const plan = trimOf(planDeploy(btc, 97_000, SPARE, balanced));
    const after = applyTrim(btc, plan.fraction, 97_000);
    expect(usd(after.realizedPnl)).toBe('-1,467');
    expect(leverage(btc, 97_000).toFixed(1)).toBe('13.9');
    expect(leverage(after.position, 97_000).toFixed(1)).toBe('7.1');
  });

  it('re-arms at $92,150 with the fill price as the new reference', () => {
    const plan = trimOf(planDeploy(btc, 97_000, SPARE, balanced));
    const { position } = applyTrim(btc, plan.fraction, 97_000);
    expect(usd(airbagLine(position, 97_000, SENSITIVITY.balanced).price)).toBe('92,150');
  });

  it('Early trims 0.420 BTC to $88,200', () => {
    const plan = trimOf(planDeploy(btc, 98_000, SPARE, balanced));
    expect(plan.fraction.toFixed(3)).toBe('0.420');
    expect(usd(plan.liquidation)).toBe('88,200');
  });

  it('Late is capped at 50%: 0.500 BTC, liquidation $88,500 (7.33%)', () => {
    const plan = trimOf(planDeploy(btc, 95_500, SPARE, balanced));
    expect(plan.capped).toBe(true);
    expect(plan.fraction.toFixed(3)).toBe('0.500');
    expect(usd(plan.liquidation)).toBe('88,500');
    expect(pct((95_500 - (plan.liquidation ?? 0)) / 95_500)).toBe('7.33');
  });
});

describe('golden vectors: save versus liquidation', () => {
  const plan = trimOf(planDeploy(btc, 97_000, SPARE, balanced));
  const { position } = applyTrim(btc, plan.fraction, 97_000);
  const counterfactual = counterfactualReturn(btc);

  it('without Airbag, $94,000 liquidates and returns $3,200 (80% of $4,000)', () => {
    expect(usd(counterfactual)).toBe('3,200');
  });

  it('with Airbag, the position is open at $94,000 with $5,467 of equity', () => {
    expect(crossed('long', 94_000, liquidationPrice(btc))).toBe(true);
    expect(usd(equity(position, 94_000))).toBe('5,467');
  });

  it('back at $100,000: $3,200 versus $8,533, kept $5,333', () => {
    const withAirbag = equity(position, 100_000);
    expect(usd(withAirbag)).toBe('8,533');
    expect(usd(saveValue(withAirbag, 0, counterfactual))).toBe('5,333');
  });

  it('if BTC keeps falling to $87,300, the smaller position is liquidated too: $1,635', () => {
    // The released margin went back in, so this liquidation returns less than the first.
    expect(usd(liquidationPrice(position))).toBe('87,300');
    expect(usd(counterfactualReturn(position))).toBe('1,635');
  });

  it('spare margin Airbag added is not counted as kept', () => {
    expect(saveValue(5_000, 300, 3_200)).toBe(1_500);
  });
});

describe('planning edge cases', () => {
  it('sizes long and short trims to reach the target after closing fees', () => {
    for (const side of ['long', 'short'] as const) {
      const p = { ...btc, side, closeFeeRate: 0.000345 };
      const price = side === 'long' ? 97_000 : 103_000;
      const policy = { ...balanced, maxTrim: 0.75, useSpare: false };
      const plan = trimOf(planDeploy(p, price, 0, policy));
      const withoutFees = trimOf(planDeploy({ ...p, closeFeeRate: 0 }, price, 0, policy));
      expect(plan.fraction).toBeGreaterThan(withoutFees.fraction);
      const after = applyTrim(p, plan.fraction, price);
      expect(distanceToLiquidation(after.position, price)).toBeCloseTo(policy.target, 10);
      expect(equity(p, price) - equity(after.position, price)).toBeCloseTo(
        plan.fraction * p.size * price * p.closeFeeRate,
        8,
      );
    }
  });
  it('uses spare margin when it alone reaches the target, with the smallest amount', () => {
    const plan = planDeploy(btc, 97_000, 10_000, balanced);
    expect(plan.kind).toBe('margin');
    if (plan.kind !== 'margin') return;
    expect(usd(plan.amount)).toBe('6,700');
    expect(usd(liquidationPrice(applyMargin(btc, plan.amount)))).toBe('87,300');
  });

  it('ignores spare margin when the user turned it off', () => {
    expect(planDeploy(btc, 97_000, 10_000, { ...balanced, useSpare: false }).kind).toBe('trim');
  });

  it('does nothing when liquidation is already far enough away', () => {
    expect(planDeploy(btc, 99_000, 0, { ...balanced, target: 0.03 }).kind).toBe('none');
  });

  it('trims what the target needs even when that is most of the position', () => {
    const plan = trimOf(planDeploy(btc, 94_500, 0, { ...balanced, target: 0.2, maxTrim: 1 }));
    expect(plan.fraction.toFixed(3)).toBe('0.803');
    expect(usd(plan.liquidation)).toBe('75,600');
  });

  it('closes in full only when no equity is left and the cap allows it', () => {
    const plan = trimOf(planDeploy(btc, 89_000, 0, { ...balanced, maxTrim: 1 }));
    expect(plan.fraction).toBe(1);
    expect(plan.liquidation).toBeNull();
  });

  it('a short mirrors a long', () => {
    const short: Position = { ...btc, side: 'short' };
    const line = airbagLine(short, short.entry, SENSITIVITY.balanced);
    expect(usd(line.price)).toBe('103,000');
    const plan = trimOf(planDeploy(short, 103_000, 0, { ...balanced, maxTrim: 0.75 }));
    expect(plan.fraction.toFixed(3)).toBe('0.510');
    expect(usd(plan.liquidation)).toBe('113,300');
    expect(crossed('short', 106_000, liquidationPrice(short))).toBe(true);
    expect(crossed('short', 105_999, liquidationPrice(short))).toBe(false);
  });
});

// Generated positions: 1.1x–20x, funding within ±1% of notional, Perpl's maintenance margins.
const genPosition = fc
  .record({
    side: fc.constantFrom<Position['side']>('long', 'short'),
    size: fc.double({ min: 1e-3, max: 1e3, noNaN: true }),
    entry: fc.double({ min: 1e-2, max: 1e6, noNaN: true }),
    leverage: fc.double({ min: 1.1, max: 20, noNaN: true }),
    funding: fc.double({ min: -0.01, max: 0.01, noNaN: true }),
    maintenance: fc.constantFrom(0.04, 0.05, 0.0556, 0.1, 0.2),
  })
  .map(
    (g): Position => ({
      side: g.side,
      size: g.size,
      entry: g.entry,
      deposit: (g.size * g.entry) / g.leverage,
      funding: g.funding * g.size * g.entry,
      maintenance: g.maintenance,
    }),
  )
  // Positions that start above maintenance, as any open Perpl position does.
  .filter((p) => equity(p, p.entry) > p.maintenance * p.entry * p.size * 1.01);

const genPolicy = fc.record({
  target: fc.double({ min: 0.06, max: 0.2, noNaN: true }),
  maxTrim: fc.constantFrom(0.25, 0.5, 0.75, 1),
  useSpare: fc.boolean(),
});
const genSensitivity = fc.constantFrom(SENSITIVITY.early, SENSITIVITY.balanced, SENSITIVITY.late);

/** The mark at the trigger for a position armed at its entry. */
const atLine = (p: Position, f: number) => airbagLine(p, p.entry, f).price;

describe('properties', () => {
  it('the line sits between the reference price and liquidation', () => {
    fc.assert(
      fc.property(genPosition, genSensitivity, (p, f) => {
        const d = p.side === 'long' ? 1 : -1;
        const line = airbagLine(p, p.entry, f).price;
        expect(d * (p.entry - line)).toBeGreaterThan(0);
        expect(d * (line - liquidationPrice(p))).toBeGreaterThan(0);
      }),
    );
  });

  it('the mark at the line triggers, and its liquidation price is crossed at itself', () => {
    fc.assert(
      fc.property(genPosition, genSensitivity, (p, f) => {
        const line = airbagLine(p, p.entry, f);
        expect(triggered(p, line.price, line)).toBe(true);
        expect(crossed(p.side, liquidationPrice(p), liquidationPrice(p))).toBe(true);
      }),
    );
  });

  it('a trim never grows or flips the position and stays under the cap', () => {
    fc.assert(
      fc.property(genPosition, genSensitivity, genPolicy, fc.nat(1e6), (p, f, policy, spare) => {
        const plan = planDeploy(p, atLine(p, f), spare, policy);
        if (plan.kind !== 'trim') return;
        expect(plan.fraction).toBeGreaterThan(0);
        expect(plan.fraction).toBeLessThanOrEqual(policy.maxTrim);
        const { position } = applyTrim(p, plan.fraction, atLine(p, f));
        expect(position.side).toBe(p.side);
        expect(position.size).toBeLessThan(p.size);
        expect(position.size).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('an uncapped deploy always reaches the target distance', () => {
    fc.assert(
      fc.property(genPosition, genSensitivity, genPolicy, fc.nat(1e6), (p, f, policy, spare) => {
        const price = atLine(p, f);
        const plan = planDeploy(p, price, spare, policy);
        if (plan.kind === 'trim' && plan.capped) return;
        const after =
          plan.kind === 'margin'
            ? applyMargin(p, plan.amount)
            : plan.kind === 'trim'
              ? applyTrim(p, plan.fraction, price).position
              : p;
        expect(distanceToLiquidation(after, price)).toBeGreaterThanOrEqual(policy.target - 1e-9);
      }),
    );
  });

  it('fee-aware planning reaches the target across generated positions', () => {
    fc.assert(
      fc.property(
        genPosition,
        genPolicy,
        fc.double({ min: 0, max: 0.01, noNaN: true }),
        (before, policy, closeFeeRate) => {
          const p = { ...before, closeFeeRate };
          const price = atLine(p, SENSITIVITY.balanced);
          const plan = planDeploy(p, price, 0, { ...policy, useSpare: false });
          if (plan.kind !== 'trim' || plan.capped || plan.fraction === 1) return;
          expect(
            distanceToLiquidation(applyTrim(p, plan.fraction, price).position, price),
          ).toBeGreaterThanOrEqual(policy.target - 1e-9);
        },
      ),
    );
  });

  it('spare margin is only used when it is enough', () => {
    fc.assert(
      fc.property(genPosition, genSensitivity, genPolicy, fc.nat(1e6), (p, f, policy, spare) => {
        const plan = planDeploy(p, atLine(p, f), spare, policy);
        if (plan.kind !== 'margin') return;
        expect(policy.useSpare).toBe(true);
        expect(plan.amount).toBeLessThanOrEqual(spare);
      }),
    );
  });

  it('re-adding the released equity keeps equity at the fill price', () => {
    fc.assert(
      fc.property(genPosition, fc.double({ min: 0.01, max: 0.99, noNaN: true }), (p, fraction) => {
        const price = liquidationPrice(p) * 0.5 + p.entry * 0.5;
        const { position } = applyTrim(p, fraction, price);
        const scale = Math.max(1, Math.abs(equity(p, price)));
        expect(equity(position, price) / scale).toBeCloseTo(equity(p, price) / scale, 9);
      }),
    );
  });

  it('liquidation after a trim moves toward the price as more of the position is kept', () => {
    fc.assert(
      fc.property(
        genPosition,
        fc.double({ min: 0.05, max: 0.9, noNaN: true }),
        fc.double({ min: 0.01, max: 0.09, noNaN: true }),
        (p, s, ds) => {
          const price = atLine(p, SENSITIVITY.balanced);
          const d = p.side === 'long' ? 1 : -1;
          const nearer = liquidationAfterTrim(p, price, s + ds);
          const further = liquidationAfterTrim(p, price, s);
          expect(d * (nearer - further)).toBeGreaterThan(0);
        },
      ),
    );
  });

  it('mirroring a position around its entry mirrors its line and its trims', () => {
    fc.assert(
      fc.property(
        genPosition,
        genSensitivity,
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        (p, f, s) => {
          const long = { ...p, side: 'long' as const };
          const short = { ...p, side: 'short' as const };
          const two = 2 * p.entry;
          const lineL = airbagLine(long, p.entry, f).price;
          const lineS = airbagLine(short, p.entry, f).price;
          expect((lineL + lineS) / two).toBeCloseTo(1, 9);
          const after =
            liquidationAfterTrim(long, lineL, s) + liquidationAfterTrim(short, lineS, s);
          expect(after / two).toBeCloseTo(1, 9);
        },
      ),
    );
  });
});
