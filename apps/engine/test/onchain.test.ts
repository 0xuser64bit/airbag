import { describe, expect, it } from 'vitest';
import type { Deploy } from '../src/db.ts';
import { deployArgs } from '../src/onchain.ts';
import { SIM_CONTEXT } from '../src/sim.ts';

const btc = SIM_CONTEXT.markets[0];

const deploy = (over: Partial<Deploy['data']> = {}, kind: Deploy['kind'] = 'trim'): Deploy =>
  ({
    id: 'd',
    wallet: '0x7a3f00000000000000000000000000000000c21e',
    accountId: 4127,
    marketId: 16,
    symbol: 'BTC',
    side: 'long',
    kind,
    phase: 'done',
    outcome: 'pending',
    createdAt: 0,
    savedAt: null,
    closedAt: null,
    data: {
      before: { lots: 100_000, liquidation: 94_000 },
      after: { size: 0.51094, liquidation: 87_299.76 },
      close: { tx: `0x${'9c'.repeat(32)}` },
      ...over,
    },
  }) as unknown as Deploy;

describe('AirbagLog arguments', () => {
  it('are in Perpl units: lots and price-scaled integers', () => {
    if (!btc) throw new Error('no market');
    expect(deployArgs(deploy(), btc)).toEqual([
      4127n,
      16n,
      `0x${'9c'.repeat(32)}`,
      100_000n,
      51_094n,
      940_000n,
      872_998n,
      0,
    ]);
  });

  it('use a zero hash without a Perpl tx, zero for a closed position, and reason 1 for margin', () => {
    if (!btc) throw new Error('no market');
    const args = deployArgs(
      deploy({ close: undefined, after: { size: 0, liquidation: null } } as never, 'margin'),
      btc,
    );
    expect(args[2]).toBe(`0x${'0'.repeat(64)}`);
    expect(args[4]).toBe(0n);
    expect(args[6]).toBe(0n);
    expect(args[7]).toBe(1);
  });
});
