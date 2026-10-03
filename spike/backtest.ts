// What Airbag would have done for every trader Perpl liquidated, from public chain data, no key.
// Each full liquidation's PositionLiquidated event gives back the position it closed (as in
// liquidations.ts). From there: find the block where the mark crossed that position's Airbag
// line (Balanced, armed at entry), and replay the marks Perpl actually published, from just
// before it to a day after the liquidation, through Airbag's own engine on a paper exchange
// (apps/engine/src/replay.ts). A control replay with Airbag paused has to liquidate where Perpl
// did. Writes apps/web/lib/backtest.json, the site's /backtest page.
//   PERPL_NETWORK=mainnet MONAD_RPC_URL=https://rpc1.monad.xyz \
//     pnpm --filter @airbag/spike backtest [blocks, default 6000000]

import { writeFileSync } from 'node:fs';
import {
  type ChainLiquidation,
  closeFeeRate,
  collateralDecimals,
  fetchContext,
  maintenanceFraction,
  networkFromEnv,
  perplChain,
  scaled,
  symbolOf,
} from '@airbag/perpl';
import { airbagLine, crossed, liquidationPrice, type Position, SENSITIVITY } from '@airbag/risk';
import { replay } from '../apps/engine/src/replay.ts';
import type { Backtest, BacktestRow, Outcome } from '../apps/web/lib/backtest.ts';
import { markHistory } from './marks.ts';
import { percentile } from './stats.ts';

/** A day of Monad blocks (302 ms each, measured over 6M mainnet blocks). */
const DAY = 286_000;
const ASSUMPTIONS = {
  sensitivity: 'balanced',
  targetPct: 10,
  maxTrimPct: 50,
  /** Spare margin in the account, unknown from the event, so none: Airbag trims. */
  spare: 0,
  /** Blocks from sending an order to its fill. Perpl's feed trails Monad's head by one. */
  delayBlocks: Number(process.env.DELAY_BLOCKS ?? 2),
  /**
   * Each close fills this far past the mark, against the trader: half the engine's 0.5% worst
   * price, as the book at the time can't be read back.
   */
  fillSlippageBps: Number(process.env.FILL_SLIPPAGE_BPS ?? 25),
  horizonBlocks: DAY,
};
/** Six significant figures: plenty for a price or a dollar amount, and half the file. */
const r6 = (x: number) => Number(x.toPrecision(6));

const cfg = networkFromEnv();
const ctx = await fetchContext(cfg.apiUrl);
const cd = collateralDecimals(ctx);
const exchange = ctx.instances[0]?.address ?? '';
const chain = perplChain(cfg.rpcUrl, exchange, cfg.chainId);
const byPerp = new Map(ctx.markets.map((m) => [m.perpetual_id, m]));
const head = Number(await chain.head());
const span = Number(process.argv[2] ?? 6_000_000);
const limit = Number(process.env.LIMIT ?? Infinity);

async function blockTime(block: number): Promise<number> {
  const res = await fetch(cfg.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBlockByNumber',
      params: [`0x${block.toString(16)}`, false],
    }),
  });
  const body = (await res.json()) as { result: { timestamp: string } };
  return Number.parseInt(body.result.timestamp, 16) * 1000;
}

// Liquidations, and a block time every 500k blocks to date them by.
const events: ChainLiquidation[] = [];
const anchors: [number, number][] = [];
for (let to = head; to > head - span; to -= 500_000) {
  const from = Math.max(head - span + 1, to - 499_999);
  events.push(...(await chain.liquidations(BigInt(from), BigInt(to))));
  anchors.push([to, await blockTime(to)]);
}
anchors.push([head - span, await blockTime(head - span)]);
anchors.sort((a, b) => a[0] - b[0]);
const timeOf = (block: number) => {
  const j = Math.max(
    1,
    anchors.findIndex(([b]) => b >= block),
  );
  const [b0, t0] = anchors[j - 1] ?? [0, 0];
  const [b1, t1] = anchors[j] ?? [1, 0];
  return Math.round(t0 + ((block - b0) * (t1 - t0)) / (b1 - b0));
};
events.sort((a, b) => Number(a.block - b.block) || a.logIndex - b.logIndex);
const full = events.filter((l) => l.remainingLots === 0n && l.lots > 0n && byPerp.has(l.perpId));
const first = Number(full[0]?.block ?? head);
console.error(`${events.length} liquidations, ${full.length} full; reading marks from ${first}…`);
const marks = await markHistory(cfg.rpcUrl, exchange, first - 3 * DAY, head, (done, total) => {
  if (done % 50 === 0 || done === total) console.error(`marks ${done}/${total}`);
});

/** Min and max per bucket, so a wick survives the thinning. */
function thin(path: readonly (readonly [number, number])[], buckets: number): [number, number][] {
  if (path.length <= buckets * 2) return path.map(([b, p]) => [b, p]);
  const out: [number, number][] = [];
  const size = path.length / buckets;
  for (let k = 0; k < buckets; k++) {
    const slice = path.slice(Math.floor(k * size), Math.floor((k + 1) * size));
    let lo = slice[0];
    let hi = slice[0];
    for (const x of slice) {
      if (lo && x[1] < lo[1]) lo = x;
      if (hi && x[1] > hi[1]) hi = x;
    }
    for (const x of [lo, hi].sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0)))
      if (x && out.at(-1)?.[0] !== x[0]) out.push([x[0], x[1]]);
  }
  return out;
}

const rows: BacktestRow[] = [];
/** Lines crossed before the mark history this run reads (three days before the first). */
const skipped = { beforeData: 0 };
for (const l of full.slice(0, limit)) {
  const m = byPerp.get(l.perpId);
  if (!m) continue;
  const pd = m.config.price_decimals;
  const s = l.side === 'long' ? 1 : -1;
  const size = scaled(Number(l.lots), m.config.size_decimals);
  const executed = scaled(Number(l.pricePns), pd);
  const realized = scaled(Number(l.deltaPnlCns), cd);
  const position: Position = {
    side: l.side,
    size,
    entry: executed - realized / (s * size),
    deposit: scaled(Number(l.depositCns), cd),
    funding: scaled(Number(l.fundingCns), cd),
    maintenance: maintenanceFraction(m),
    closeFeeRate: closeFeeRate(m),
  };
  const block = Number(l.block);
  const returned = scaled(Number(l.toAccountCns), cd);
  const line = airbagLine(position, position.entry, SENSITIVITY.balanced);
  const hist = marks.get(l.perpId) ?? [];
  let i = hist.findLastIndex(([b]) => b <= block);
  while (i >= 0 && crossed(l.side, scaled(hist[i]?.[1] ?? 0, pd), line.price)) i--;
  const from = hist[i]?.[0];
  if (from === undefined) {
    skipped.beforeData++;
    continue;
  }
  const to = Math.min(block + DAY, head);
  const base = {
    market: m,
    side: l.side,
    size,
    entry: position.entry,
    // The paper exchange accrues no funding, so what accrued so far rides in the deposit.
    deposit: position.deposit + position.funding,
    marks: hist,
    from,
    delayBlocks: ASSUMPTIONS.delayBlocks,
    fillSlippageBps: ASSUMPTIONS.fillSlippageBps,
  };
  const [airbag, control] = [
    await replay({ ...base, to, checkpoints: [block] }),
    await replay({ ...base, to: Math.min(block + 1_000, head), settings: { armed: false } }),
  ];
  const trigger = airbag.deploys[0]?.data.trigger;
  const trimmed = airbag.deploys.some((d) => (d.data.close?.filledLots ?? 0) > 0);
  const gone = airbag.liquidation;
  // open: still open when Perpl liquidated the original. untrimmed: a position too small to trim
  // within the 50% cap (one lot), liquidated like the original.
  const outcome: Outcome =
    gone && gone.block <= block
      ? trimmed
        ? 'liquidated'
        : 'untrimmed'
      : gone
        ? 'liquidated-later'
        : 'open';
  // The chart shows the approach to the line too, and a while after the liquidation.
  const chartStart = from - Math.max(1_200, Math.round((block - from) / 4));
  const chartEnd = Math.min(to, block + Math.max(24_000, 2 * (block - from)));
  rows.push({
    id: `${block}-${l.logIndex}`,
    tx: l.tx,
    block,
    at: timeOf(block),
    accountId: l.accountId,
    market: symbolOf(m),
    side: l.side,
    size,
    sizeDecimals: m.config.size_decimals,
    entry: r6(position.entry),
    leverage: r6((size * position.entry) / Math.max(position.deposit + position.funding, 1e-9)),
    liquidation: r6(liquidationPrice(position)),
    markAtLiquidation: scaled(Number(l.markPns), pd),
    liquidatedAt: executed,
    returned: r6(returned),
    line: r6(line.price),
    trigger: trigger
      ? { block: trigger.block, at: timeOf(trigger.block), mark: trigger.mark }
      : null,
    deploys: airbag.deploys.map((d) => ({
      block: d.data.trigger.block,
      filled: d.data.timeline.find((e) => e.text.startsWith('Filled'))?.block ?? null,
      trimmed: r6(d.data.close ? d.data.close.filledLots / d.data.before.lots : 0),
      fill: d.data.close?.fillPrice ?? null,
      fee: d.data.close?.fee === undefined ? null : r6(d.data.close.fee),
      liquidationAfter: d.data.after?.liquidation ? r6(d.data.after.liquidation) : null,
    })),
    outcome,
    // What the Airbag path held at the block Perpl liquidated, and a day later.
    atLiquidation: r6(airbag.values.get(block) ?? 0),
    end: {
      block: airbag.end,
      value: r6(airbag.value),
      liquidated: gone ? { block: gone.block, price: gone.price } : null,
    },
    control: control.liquidation ? { block: control.liquidation.block } : null,
    // The mark around it, as [blocks from the liquidation, price].
    path: thin(
      hist
        .filter(([b]) => b >= chartStart && b <= chartEnd)
        .map(([b, p]) => [b, scaled(p, pd)] as const),
      40,
    ).map(([b, p]) => [b - block, r6(p)]),
  });
  if (rows.length % 25 === 0) console.error(`replayed ${rows.length}/${full.length}`);
}

const sum = (xs: number[]) => r6(xs.reduce((a, b) => a + b, 0));
const count = (o: string) => rows.filter((r) => r.outcome === o).length;
const acted = rows.filter((r) => r.trigger && r.trigger.block < r.block);
const leads = acted.map((r) => ((r.block - (r.trigger?.block ?? r.block)) * 302) / 1000);
const agree = rows.filter((r) => r.control && r.control.block <= r.block);
const open = rows.filter((r) => r.outcome === 'open' || r.outcome === 'liquidated-later');
const summary = {
  liquidations: events.length,
  full: full.length,
  replayed: rows.length,
  skipped,
  actedBefore: acted.length,
  open: count('open'),
  liquidatedLater: count('liquidated-later'),
  liquidated: count('liquidated'),
  untrimmed: count('untrimmed'),
  /** Of those open when Perpl liquidated: ahead of the liquidation then, and a day later. */
  aheadAtLiquidation: open.filter((r) => r.atLiquidation > r.returned).length,
  aheadAfterDay: open.filter((r) => r.end.value > r.returned).length,
  leadSeconds: {
    p10: Math.round(percentile(leads, 10)),
    p50: Math.round(percentile(leads, 50)),
    p90: Math.round(percentile(leads, 90)),
  },
  returned: sum(rows.map((r) => r.returned)),
  atLiquidation: sum(rows.map((r) => r.atLiquidation)),
  afterDay: sum(rows.map((r) => r.end.value)),
  control: {
    liquidated: agree.length,
    medianBlocksEarly: percentile(
      agree.map((r) => r.block - (r.control?.block ?? r.block)),
      50,
    ),
  },
};
const out: Backtest = {
  generatedAt: new Date().toISOString(),
  network: cfg.network,
  chainId: cfg.chainId,
  exchange,
  head,
  fromBlock: head - span + 1,
  span,
  days: (timeOf(head) - timeOf(head - span)) / 86_400_000,
  assumptions: ASSUMPTIONS,
  summary,
  rows,
};
writeFileSync(
  new URL('../apps/web/lib/backtest.json', import.meta.url),
  `${JSON.stringify(out)}\n`,
);
console.table(
  rows.slice(-15).map((r) => ({
    block: r.block,
    market: r.market,
    side: r.side,
    'lead s': r.trigger ? Math.round(((r.block - r.trigger.block) * 302) / 1000) : '—',
    deploys: r.deploys.length,
    returned: r.returned.toFixed(2),
    'airbag at liq': r.atLiquidation.toFixed(2),
    'airbag +1d': r.end.value.toFixed(2),
    outcome: r.outcome,
    control: r.control ? r.block - r.control.block : 'none',
  })),
);
console.log(JSON.stringify(summary, null, 2));
