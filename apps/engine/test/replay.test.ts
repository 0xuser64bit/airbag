import { effectiveEntryPrice } from '@airbag/perpl';
import { describe, expect, it } from 'vitest';
import { replay, scaledEntry } from '../src/replay.ts';
import { LANDING_PATH, SIM_CONTEXT } from '../src/sim.ts';

const btc = SIM_CONTEXT.markets[0];
if (!btc) throw new Error('no BTC in the simulated context');
// The landing's crash test as a recorded path: one BTC mark per block from block 1,000.
const marks = LANDING_PATH.map((p, i) => [1_000 + i, p * 10] as const);
const design = { market: btc, side: 'long', size: 1, entry: 100_000, deposit: 10_000 } as const;
const to = 1_000 + LANDING_PATH.length + 5;
// The block the wick reaches $94,000, the old liquidation price.
const bottom = 1_000 + LANDING_PATH.indexOf(94_000);

describe('replaying a recorded mark path through the engine', () => {
  it('trims at the line, re-adds, and the trimmed position rides out the wick', async () => {
    const r = await replay({ ...design, marks, from: 1_000, to, checkpoints: [bottom] });
    expect(r.deploys).toHaveLength(1);
    const [d] = r.deploys;
    expect(d?.data.trigger.mark).toBe(97_000);
    expect(d?.outcome).toBe('save');
    expect(r.liquidation).toBeUndefined();
    // At $94,000 the trimmed position still holds the design's $5,467.
    expect(Math.round(r.values.get(bottom) ?? 0)).toBe(5_467);
    // Back at $100,000: the design's $8,533, against the $3,200 a liquidation returns.
    expect(Math.round(r.value)).toBe(8_533);
    expect(r.position?.size).toBeCloseTo(0.51094, 5);
  });

  it('with Airbag paused, liquidates at the liquidation price like Perpl', async () => {
    const r = await replay({
      ...design,
      marks,
      from: 1_000,
      to,
      settings: { armed: false },
      checkpoints: [bottom, to],
    });
    expect(r.deploys).toHaveLength(0);
    expect(r.liquidation).toMatchObject({ price: 94_000, returned: 3_200 });
    expect(r.liquidation?.block).toBe(1_000 + LANDING_PATH.indexOf(94_000));
    expect(r.value).toBeCloseTo(3_200, 6);
    expect(r.values.get(bottom)).toBeCloseTo(3_200, 6);
    expect(r.values.get(to)).toBeCloseTo(3_200, 6);
    expect(r.position).toBeUndefined();
  });

  it('encodes an entry price the way Perpl stores it', () => {
    for (const side of ['long', 'short'] as const) {
      for (const entry of [100_000, 97_123.45678, 0.006367, 2_684.5]) {
        const { ep, epr } = scaledEntry(side, entry, entry < 1 ? 6 : 1);
        const back = effectiveEntryPrice(side, ep, epr, entry < 1 ? 6 : 1);
        expect(Math.abs(back - entry)).toBeLessThan(10 ** -(entry < 1 ? 6 : 1) / 65_536 + 1e-12);
      }
    }
  });
});
