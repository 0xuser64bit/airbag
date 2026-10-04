// AirbagLog: one Deploy per DeployRecorded; SaveRecorded marks it saved, and SaveProven
// (ADR 0016) adds what the chain showed when the save was proven and who proved it.

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
    prover: undefined,
    provenMark: undefined,
    provenLots: undefined,
  });
  const t = await totals(context, event.chainId);
  context.AirbagTotals.set({ ...t, deploys: t.deploys + 1 });
});

indexer.onEvent({ contract: 'AirbagLog', event: 'SaveRecorded' }, async ({ event, context }) => {
  const id = `${event.chainId}-${event.params.deployId}`;
  const deploy = await context.Deploy.get(id);
  if (!deploy || deploy.saved) return; // Also handles duplicate saves emitted by older contracts.
  context.Deploy.set({ ...deploy, saved: true, oldLiqHitBlock: event.params.oldLiqHitBlock });
  const t = await totals(context, event.chainId);
  context.AirbagTotals.set({ ...t, saves: t.saves + 1 });
});

indexer.onEvent({ contract: 'AirbagLog', event: 'SaveProven' }, async ({ event, context }) => {
  const deploy = await context.Deploy.get(`${event.chainId}-${event.params.deployId}`);
  if (!deploy || deploy.prover) return;
  context.Deploy.set({
    ...deploy,
    prover: event.params.prover,
    provenMark: event.params.markPNS,
    provenLots: event.params.lotsOpen,
  });
});
