import { encodeAbiParameters, encodeEventTopics, type Log } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Deploy } from '../src/db.ts';
import { airbagLogAbi, confirmedDeployId, deployArgs } from '../src/onchain.ts';
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

it('only accepts a successful receipt with an event from the configured log contract', () => {
  const address = `0x${'1'.repeat(40)}` as const;
  const event = {
    address,
    topics: encodeEventTopics({
      abi: airbagLogAbi,
      eventName: 'DeployRecorded',
      args: { deployId: 1n, accountId: 4127n, market: 16n },
    }) as [`0x${string}`, ...`0x${string}`[]],
    data: encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint8' },
      ],
      [`0x${'9c'.repeat(32)}`, 100_000n, 51_094n, 940_000n, 872_998n, 0],
    ),
    blockHash: `0x${'3'.repeat(64)}`,
    blockNumber: 100n,
    logIndex: 0,
    transactionHash: `0x${'4'.repeat(64)}`,
    transactionIndex: 0,
    removed: false,
  } satisfies Log<bigint, number, false>;
  expect(confirmedDeployId({ status: 'success', logs: [event] }, address)).toBe(1);
  expect(() => confirmedDeployId({ status: 'reverted', logs: [event] }, address)).toThrow(
    /reverted/,
  );
  expect(() => confirmedDeployId({ status: 'success', logs: [] }, address)).toThrow(/missing/);
  expect(() =>
    confirmedDeployId({ status: 'success', logs: [event] }, `0x${'2'.repeat(40)}`),
  ).toThrow(/missing/);
});
