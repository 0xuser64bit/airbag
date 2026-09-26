import { createTestIndexer } from 'envio';
import { describe, expect, it } from 'vitest';

const LOG = '0x0000000000000000000000000000000000000000';
const EXCHANGE = '0x1964C32f0bE608E7D29302AFF5E61268E72080cc';
// 2026-09-23 00:00 UTC and a block that day.
const DAY = Math.floor(Date.UTC(2026, 8, 23) / 1000 / 86_400);
const block = (number: number, hour = 12) => ({ number, timestamp: DAY * 86_400 + hour * 3_600 });

const deployRecorded = {
  contract: 'AirbagLog',
  event: 'DeployRecorded',
  srcAddress: LOG,
  block: block(100),
  transaction: { hash: `0x${'ab'.repeat(32)}` },
  params: {
    deployId: 1n,
    accountId: 4127n,
    market: 16n,
    perplTxHash: `0x${'9c'.repeat(32)}`,
    sizeBefore: 100_000n,
    sizeAfter: 51_094n,
    liqBefore: 940_000n,
    liqAfter: 872_998n,
    reason: 0n,
  },
} as const;

const liquidation = (perpId: bigint, positionType: bigint, blockNumber: number, deposit: bigint) =>
  ({
    contract: 'PerplExchange',
    event: 'PositionLiquidated',
    srcAddress: EXCHANGE,
    block: block(blockNumber),
    logIndex: 0,
    params: {
      perpId,
      posAccountId: 9n,
      positionType,
      markPricePNS: 940_000n,
      liqPricePNS: 940_010n,
      liqLotLNS: 2_000n,
      posLotLNS: 2_000n,
      deltaPnlCNS: -1n,
      fundingCNS: 0n,
      posAmountCNS: 0n,
      posDepositCNS: deposit,
      accAmountCNS: 0n,
      accBalanceCNS: 0n,
      onOrderBook: true,
    },
  }) as const;

describe('AirbagLog', () => {
  it('records a deploy in Perpl units, then marks it saved', async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            deployRecorded,
            {
              contract: 'AirbagLog',
              event: 'SaveRecorded',
              srcAddress: LOG,
              block: block(107),
              params: { deployId: 1n, oldLiqHitBlock: 107n },
            },
            {
              contract: 'AirbagLog',
              event: 'SaveRecorded',
              srcAddress: LOG,
              block: block(108),
              params: { deployId: 1n, oldLiqHitBlock: 108n },
            },
          ],
        },
      },
    });
    const d = await indexer.Deploy.getOrThrow('10143-1');
    expect(d).toMatchObject({
      accountId: 4127n,
      market: 16n,
      sizeBefore: 100_000n,
      sizeAfter: 51_094n,
      liqBefore: 940_000n,
      liqAfter: 872_998n,
      reason: 'trim',
      block: 100n,
      txHash: `0x${'ab'.repeat(32)}`,
      saved: true,
      oldLiqHitBlock: 107n,
    });
    expect(await indexer.AirbagTotals.getOrThrow('10143')).toMatchObject({ deploys: 1, saves: 1 });
  });

  it('ignores a save for a deploy it never saw', async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            {
              contract: 'AirbagLog',
              event: 'SaveRecorded',
              srcAddress: LOG,
              block: block(5),
              params: { deployId: 9n, oldLiqHitBlock: 5n },
            },
          ],
        },
      },
    });
    expect(await indexer.Deploy.getAll()).toHaveLength(0);
  });
});

describe('Perpl liquidations', () => {
  it('keeps each liquidation and a per-market, per-day tally', async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            liquidation(16n, 0n, 200, 4_000_000_000n),
            liquidation(16n, 1n, 201, 1_000_000_000n),
            liquidation(32n, 0n, 202, 500_000_000n),
          ],
        },
      },
    });
    const all = await indexer.Liquidation.getAll();
    expect(all.map((l) => l.side).sort()).toEqual(['long', 'long', 'short']);
    expect(await indexer.DailyLiquidations.getOrThrow(`10143-16-${DAY}`)).toMatchObject({
      day: DAY,
      count: 2,
      lots: 4_000n,
      deposits: 5_000_000_000n,
    });
    expect(await indexer.DailyLiquidations.getOrThrow(`10143-32-${DAY}`)).toMatchObject({
      count: 1,
    });
  });
});
