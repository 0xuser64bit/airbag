// AirbagLog: one Deploy per DeployRecorded; SaveRecorded marks it saved.

import { indexer } from 'envio';

const totals = async (
  context: {
    AirbagTotals: {
      get: (id: string) => Promise<{ id: string; deploys: number; saves: number } | undefined>;
    };
  },
  chainId: number,
) =>
  (await context.AirbagTotals.get(String(chainId))) ?? {
    id: String(chainId),
    deploys: 0,
    saves: 0,
  };

indexer.onEvent({ contract: 'AirbagLog', event: 'DeployRecorded' }, async ({ event, context }) => {
  const p = event.params;
  context.Deploy.set({
    id: `${event.chainId}-${p.deployId}`,
    deployId: p.deployId,
    accountId: p.accountId,
    market: p.market,
    perplTxHash: p.perplTxHash,
    sizeBefore: p.sizeBefore,
    sizeAfter: p.sizeAfter,
    liqBefore: p.liqBefore,
    liqAfter: p.liqAfter,
    reason: p.reason === 0n ? 'trim' : 'margin',
    block: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    saved: false,
    oldLiqHitBlock: undefined,
  });
  const t = await totals(context, event.chainId);
  context.AirbagTotals.set({ ...t, deploys: t.deploys + 1 });
});

indexer.onEvent({ contract: 'AirbagLog', event: 'SaveRecorded' }, async ({ event, context }) => {
  const id = `${event.chainId}-${event.params.deployId}`;
  const deploy = await context.Deploy.get(id);
  if (!deploy) return; // The contract rejects saves for unknown deploys; nothing to mark.
  context.Deploy.set({ ...deploy, saved: true, oldLiqHitBlock: event.params.oldLiqHitBlock });
  const t = await totals(context, event.chainId);
  context.AirbagTotals.set({ ...t, saves: t.saves + 1 });
});
