// The other side of the backtest: what Airbag's trims cost when Perpl didn't liquidate. The
// backtest replays positions Perpl liquidated, so it can only show what a trim saved. Here every
// position opened in the backtest's own window (apps/web/lib/backtest.json) is followed from its
// PositionOpened event to the next event that touched it: closed, resized, margin moved,
// liquidated, or nothing by the window's end. Until then it is the position the event opened, so
// the marks say whether it crossed its Airbag line (Balanced, armed at entry). Each one that did
// is replayed through Airbag's engine to that next event, or a day after the line, whichever comes
// first, beside the same position untouched (the paused replay), under the backtest's own fill
// assumptions. Writes apps/web/lib/false-alarms.json.
//   PERPL_NETWORK=mainnet MONAD_RPC_URL=https://rpc2.monad.xyz \
//     pnpm --filter @airbag/tools false-alarms

import { readFileSync, writeFileSync } from 'node:fs';
import {
  closeFeeRate,
  collateralDecimals,
  fetchContext,
  maintenanceFraction,
  networkFromEnv,
  scaled,
  symbolOf,
} from '@airbag/perpl';
import { airbagLine, crossed, type Position, SENSITIVITY } from '@airbag/risk';
import { toEventSelector } from 'viem';
import { replay } from '../apps/engine/src/replay.ts';
import type { Backtest } from '../apps/web/lib/backtest.ts';
import type { FalseAlarms, Outcome } from '../apps/web/lib/false-alarms.ts';
import { type Log, logHistory, markHistory, word } from './marks.ts';
import { percentile } from './stats.ts';

const DAY = 286_000;
const sig = (name: string, types: string) => toEventSelector(`${name}(${types})`);
// What a row's kind says happened to the position, from Perpl's Exchange ABI (dex-sdk).
const OPENED = [
  sig(
    'PositionOpened',
    'uint256,uint256,uint8,uint256,uint256,int256,uint256,uint256,uint256,uint256',
  ),
  sig(
    'PositionOpenedV2',
    'uint256,uint256,uint8,uint256,uint256,int256,uint256,uint256,uint256,uint256,uint256',
  ),
];
const LIQUIDATED = [
  sig(
    'PositionLiquidated',
    'uint256,uint256,uint8,uint256,uint256,uint256,uint256,int256,int256,int256,uint256,int256,uint256,bool',
  ),
];
const CLOSED = [sig('PositionClosed', 'uint256,uint256,uint8,uint256,int256,int256')];
const CHANGED = [
  sig('PositionDecreased', 'uint256,uint256,uint8,uint256,uint256,uint256,uint256,int256,int256'),
  sig(
    'PositionIncreased',
    'uint256,uint256,uint8,uint256,uint256,uint256,int256,int256,uint256,uint256,uint256,uint256,uint256,uint256',
  ),
  sig(
    'PositionIncreasedV2',
    'uint256,uint256,uint8,uint256,uint256,uint256,int256,int256,uint256,uint256,uint256,uint256,uint256,uint256,uint256',
  ),
  sig(
    'PositionInverted',
    'uint256,uint256,uint8,uint256,uint256,uint256,int256,uint256,uint256,uint256,int256,int256,uint256,uint256',
  ),
  sig('IncreasePositionCollateral', 'uint256,uint256,uint256,uint256,uint256'),
  sig(
    'PositionCollateralDecreased',
    'uint256,uint256,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256',
  ),
  sig(
    'PositionDeleveraged',
    'uint256,uint256,bool,uint8,uint256,uint256,uint256,int256,int256,uint256,uint256,uint256,uint256,uint256,uint256',
  ),
  sig(
    'PositionDeleveragedV2',
    'uint256,uint256,bool,uint8,uint256,uint256,uint256,int256,int256,uint256,uint256,uint256,uint256,uint256,uint256,uint256',
  ),
  sig(
    'PositionUnwound',
    'uint256,uint256,uint256,uint8,uint256,uint256,uint256,int256,uint256,uint256',
  ),
  sig(
    'PositionUnwoundV2',
    'uint256,uint256,uint256,uint8,uint256,uint256,uint256,int256,uint256,uint256,uint256',
  ),
  sig(
    'PositionUnwoundWithoutPayment',
    'uint256,uint256,uint256,uint8,uint256,uint256,uint256,int256,uint256',
  ),
  sig(
    'PositionUnwoundWithoutPaymentV2',
    'uint256,uint256,uint256,uint8,uint256,uint256,uint256,int256,uint256,uint256',
  ),
];
const KINDS = [OPENED, LIQUIDATED, CLOSED, CHANGED];
const [OPEN, LIQ, CLOSE] = [0, 1, 2];
const kindOf = new Map<string, number>(
  KINDS.flatMap((topics, kind) => topics.map((t) => [t, kind])),
);

// Every event starts with perpId and accountId; an opening also carries the position:
// [block, kind, perpId, accountId, positionType, depositCNS, pricePNS, lotLNS].
const row = (l: Log) => {
  const kind = kindOf.get(l.topics[0] ?? '') ?? -1;
  const at = [Number.parseInt(l.blockNumber, 16), kind, word(l, 0), word(l, 1)];
  return kind === OPEN
    ? [...at, word(l, 2), word(l, 4), word(l, 6), word(l, 7)]
    : [...at, 0, 0, 0, 0];
};

const backtest = JSON.parse(
  readFileSync(new URL('../apps/web/lib/backtest.json', import.meta.url), 'utf8'),
) as Backtest;
const { fromBlock, head, exchange, assumptions } = backtest;
const cfg = networkFromEnv();
if (cfg.network !== backtest.network) throw new Error(`the backtest ran on ${backtest.network}`);
const ctx = await fetchContext(cfg.apiUrl);
const cd = collateralDecimals(ctx);
const byPerp = new Map(ctx.markets.map((m) => [m.perpetual_id, m]));
const limit = Number(process.env.LIMIT ?? Infinity);

const progress = (what: string) => (done: number, total: number) => {
  if (done % 50 === 0 || done === total) console.error(`${what} ${done}/${total}`);
};
const events = await logHistory(
  cfg.rpcUrl,
  exchange,
  { name: 'positions', topics: KINDS.flat(), row, width: 8 },
  fromBlock,
  head,
  progress('positions'),
);
const marks = await markHistory(cfg.rpcUrl, exchange, fromBlock - DAY, head, progress('marks'));

// Each opening, until the next event for the same account and market.
interface Segment {
  opened: number[];
  end: number;
  outcome: Outcome;
}
const segments: Segment[] = [];
const live = new Map<string, number[]>();
for (const e of events) {
  const [block = 0, kind = 0, perp, account] = e;
  const key = `${perp}:${account}`;
  const opened = live.get(key);
  if (opened) {
    const outcome = kind === LIQ ? 'liquidated' : kind === CLOSE ? 'closed' : 'changed';
    segments.push({ opened, end: block, outcome });
    live.delete(key);
  }
  if (kind === OPEN) live.set(key, e);
}
for (const opened of live.values()) segments.push({ opened, end: head, outcome: 'held' });

/** Index of the first mark after `block`. */
function after(hist: readonly (readonly [number, number])[], block: number): number {
  let lo = 0;
  let hi = hist.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((hist[mid]?.[0] ?? 0) <= block) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// The positions that crossed their line before anything else happened to them.
const todo = [];
const tally = { opened: 0, unknownMarket: 0 };
for (const { opened, end, outcome } of segments) {
  const [open = 0, , perp = 0, , type, depositCns = 0, pricePns = 0, lots = 0] = opened;
  const m = byPerp.get(perp);
  if (!m) {
    tally.unknownMarket++;
    continue;
  }
  tally.opened++;
  if (lots === 0 || depositCns === 0) continue;
  const pd = m.config.price_decimals;
  const position: Position = {
    side: type === 0 ? 'long' : 'short',
    size: scaled(lots, m.config.size_decimals),
    entry: scaled(pricePns, pd),
    deposit: scaled(depositCns, cd),
    funding: 0,
    maintenance: maintenanceFraction(m),
    closeFeeRate: closeFeeRate(m),
  };
  const line = airbagLine(position, position.entry, SENSITIVITY.balanced).price;
  const hist = marks.get(perp) ?? [];
  let k = after(hist, open);
  while (
    k < hist.length &&
    (hist[k]?.[0] ?? 0) < end &&
    !crossed(position.side, scaled(hist[k]?.[1] ?? 0, pd), line)
  )
    k++;
  const cross = hist[k]?.[0];
  if (cross === undefined || cross >= end || k === 0) continue;
  // From the last mark before the line, to the next event or a day after the line.
  const from = Math.max(open, hist[k - 1]?.[0] ?? open);
  todo.push({ m, position, hist, open, cross, from, to: Math.min(end, cross + DAY), end, outcome });
}
console.error(`${tally.opened} positions opened, ${todo.length} crossed their line; replaying…`);

const rows: FalseAlarms['rows'] = [];
for (const { m, position, hist, open, cross, from, to, end, outcome } of todo.slice(0, limit)) {
  const base = {
    market: m,
    side: position.side,
    size: position.size,
    entry: position.entry,
    deposit: position.deposit,
    marks: hist,
    from,
    to,
    delayBlocks: assumptions.delayBlocks,
    fillSlippageBps: assumptions.fillSlippageBps,
  } as const;
  const [airbag, untouched] = [
    await replay(base),
    await replay({ ...base, settings: { armed: false } }),
  ];
  // The paused replay has to agree with the chain: liquidated by `end` if Perpl liquidated it
  // there, and not before the trader's next move otherwise.
  const agrees =
    outcome === 'liquidated' && to === end
      ? untouched.liquidation !== undefined
      : untouched.liquidation === undefined;
  rows.push({
    market: symbolOf(m),
    side: position.side,
    notional: Math.round(position.size * position.entry),
    deposit: Math.round(position.deposit * 100) / 100,
    opened: open,
    crossed: cross,
    to,
    outcome: to < end ? 'held' : outcome,
    trimmed: airbag.deploys.some((d) => (d.data.close?.filledLots ?? 0) > 0),
    agrees,
    untouched: Math.round(untouched.value * 100) / 100,
    airbag: Math.round(airbag.value * 100) / 100,
  });
  if (rows.length % 100 === 0) console.error(`replayed ${rows.length}/${todo.length}`);
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const sum = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));
const kept = rows.filter((r) => r.agrees && r.trimmed);
const side = (alarm: boolean) => {
  const rs = kept.filter((r) => (r.outcome !== 'liquidated') === alarm);
  const diff = rs.map((r) => r.airbag - r.untouched);
  return {
    count: rs.length,
    better: diff.filter((d) => d > 0).length,
    worse: diff.filter((d) => d < 0).length,
    untouched: sum(rs.map((r) => r.untouched)),
    airbag: sum(rs.map((r) => r.airbag)),
    medianDiff: r2(percentile(diff, 50)),
    /** The difference as a share of the position's margin, in percent. */
    medianDiffPct: r2(
      percentile(
        rs.map((r) => (100 * (r.airbag - r.untouched)) / r.deposit),
        50,
      ),
    ),
    worstTenthPct: r2(
      percentile(
        rs.map((r) => (100 * (r.airbag - r.untouched)) / r.deposit),
        10,
      ),
    ),
  };
};
const out: FalseAlarms = {
  generatedAt: new Date().toISOString(),
  network: backtest.network,
  fromBlock,
  head,
  days: backtest.days,
  assumptions: { ...assumptions, horizonBlocks: DAY },
  summary: {
    ...tally,
    crossed: todo.length,
    outcomes: Object.fromEntries(
      (['liquidated', 'closed', 'changed', 'held'] as const).map((o) => [
        o,
        rows.filter((r) => r.outcome === o).length,
      ]),
    ) as Record<Outcome, number>,
    disagree: rows.filter((r) => !r.agrees).length,
    untrimmed: rows.filter((r) => r.agrees && !r.trimmed).length,
    falseAlarms: side(true),
    needed: side(false),
  },
  rows,
};
writeFileSync(
  new URL('../apps/web/lib/false-alarms.json', import.meta.url),
  `${JSON.stringify(out)}\n`,
);
console.log(JSON.stringify(out.summary, null, 2));
