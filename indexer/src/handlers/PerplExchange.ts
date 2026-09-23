// Perpl's liquidations, for the landing page's "liquidated on Perpl in the last 30 days".

import { indexer } from 'envio';

const DAY = 86_400;

indexer.onEvent(
  { contract: 'PerplExchange', event: 'PositionLiquidated' },
  async ({ event, context }) => {
    const p = event.params;
    context.Liquidation.set({
      id: `${event.chainId}-${event.block.number}-${event.logIndex}`,
      perpId: p.perpId,
      accountId: p.posAccountId,
      // The contract's PositionEnum: 0 long, 1 short.
      side: p.positionType === 0n ? 'long' : 'short',
      markPrice: p.markPricePNS,
      liqPrice: p.liqPricePNS,
      lots: p.liqLotLNS,
      positionLots: p.posLotLNS,
      deposit: p.posDepositCNS,
      onOrderBook: p.onOrderBook,
      block: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    });
    const day = Math.floor(event.block.timestamp / DAY);
    const id = `${event.chainId}-${p.perpId}-${day}`;
    const stat = (await context.DailyLiquidations.get(id)) ?? {
      id,
      perpId: p.perpId,
      day,
      count: 0,
      lots: 0n,
      deposits: 0n,
    };
    context.DailyLiquidations.set({
      ...stat,
      count: stat.count + 1,
      lots: stat.lots + p.liqLotLNS,
      deposits: stat.deposits + p.posDepositCNS,
    });
  },
);
