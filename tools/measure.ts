// Measures Monad block time, Perpl market-state cadence, and how far Perpl's prices trail the chain.
// Public data only: no key, no funds. Usage: node measure.ts [seconds=60]

import { type Message, MT, networkFromEnv, openSocket } from '@airbag/perpl';
import { diffs, percentile, round } from './stats.ts';

const cfg = networkFromEnv();
const seconds = Number(process.argv[2] ?? 60);

// Monad heads: block number -> local arrival (ms) and header timestamp (s).
const heads = new Map<number, { at: number; ts: number }>();
const rpc = await openSocket(cfg.rpcWsUrl, () =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }),
);
rpc.listen((m, at) => {
  const head = (m as unknown as { params?: { result?: { number: string; timestamp: string } } })
    .params?.result;
  if (head)
    heads.set(Number.parseInt(head.number, 16), { at, ts: Number.parseInt(head.timestamp, 16) });
});

// Perpl market data: heartbeat (head block) and market-state (marks, every block).
const beats: { at: number; h: number; sn: number }[] = [];
const states: { at: number; block: number; markets: number }[] = [];
// Per market: the blocks at which its mark price actually changed.
const markChanges = new Map<string, { block: number; mrk: number }[]>();
const md = await openSocket(`${cfg.wsUrl}/ws/v1/market-data`, () =>
  JSON.stringify({
    mt: MT.Subscribe,
    subs: [
      { stream: `heartbeat@${cfg.chainId}`, subscribe: true },
      { stream: `market-state@${cfg.chainId}`, subscribe: true },
    ],
  }),
);
md.listen((m: Message, at) => {
  if (m.mt === MT.Heartbeat) beats.push({ at, h: m.h as number, sn: m.sn as number });
  if (m.mt === MT.MarketState) {
    const d = m.d as Record<string, { at: { b: number }; mrk: number }>;
    const all = Object.values(d);
    const newest = all.reduce((a, s) => (s.at.b > a.at.b ? s : a));
    states.push({ at, block: newest.at.b, markets: all.length });
    for (const [id, st] of Object.entries(d)) {
      const seen = markChanges.get(id) ?? [];
      if (seen.at(-1)?.mrk !== st.mrk) seen.push({ block: st.at.b, mrk: st.mrk });
      markChanges.set(id, seen);
    }
  }
});

await new Promise((r) => setTimeout(r, seconds * 1000));
rpc.close();
md.close();

const blocks = [...heads.keys()].sort((a, b) => a - b);
const first = heads.get(blocks[0] ?? 0);
const last = heads.get(blocks.at(-1) ?? 0);
const blockSpan = (blocks.at(-1) ?? 0) - (blocks[0] ?? 0);
const headArrivals = blocks.map((b) => heads.get(b)?.at ?? 0);

// Lag: when a market-state for block b arrives, how long after Monad's newHeads for b, and
// how many blocks behind the newest head we've seen by then.
const lagMs: number[] = [];
const lagBlocks: number[] = [];
for (const s of states) {
  const h = heads.get(s.block);
  if (h) lagMs.push(s.at - h.at);
  const seen = blocks.filter((b) => (heads.get(b)?.at ?? Infinity) <= s.at).at(-1);
  if (seen !== undefined) lagBlocks.push(seen - s.block);
}
const stateBlocks = states.map((s) => s.block);
const stateGaps = diffs(stateBlocks).filter((d) => d > 1);

console.log(
  JSON.stringify(
    {
      network: cfg.network,
      seconds,
      monad: {
        headsSeen: blocks.length,
        blockSpan,
        meanBlockTimeMs: first && last ? round(((last.ts - first.ts) * 1000) / blockSpan) : null,
        arrivalIntervalMs: {
          p50: round(percentile(diffs(headArrivals), 50)),
          p95: round(percentile(diffs(headArrivals), 95)),
        },
      },
      perplHeartbeat: {
        count: beats.length,
        headSpan: (beats.at(-1)?.h ?? 0) - (beats[0]?.h ?? 0),
        snGaps: diffs(beats.map((b) => b.sn)).filter((d) => d !== 1).length,
        intervalMs: {
          p50: round(percentile(diffs(beats.map((b) => b.at)), 50)),
          p95: round(percentile(diffs(beats.map((b) => b.at)), 95)),
        },
      },
      perplMarketState: {
        messages: states.length,
        markets: states[0]?.markets,
        blockSpan: (stateBlocks.at(-1) ?? 0) - (stateBlocks[0] ?? 0),
        messagesPerBlock: round(
          states.length / Math.max(1, (stateBlocks.at(-1) ?? 0) - (stateBlocks[0] ?? 0)),
          2,
        ),
        skippedBlockRuns: stateGaps.length,
        largestSkip: Math.max(0, ...stateGaps) - 1,
        intervalMs: {
          p50: round(percentile(diffs(states.map((s) => s.at)), 50)),
          p95: round(percentile(diffs(states.map((s) => s.at)), 95)),
        },
        lagBehindMonadHeadMs: {
          p50: round(percentile(lagMs, 50)),
          p95: round(percentile(lagMs, 95)),
          samples: lagMs.length,
        },
        lagBehindMonadHeadBlocks: {
          p50: percentile(lagBlocks, 50),
          p95: percentile(lagBlocks, 95),
          max: Math.max(...lagBlocks),
        },
      },
      // Blocks between mark-price changes, per market id: how often a mark actually moves.
      markChangeEveryBlocks: Object.fromEntries(
        [...markChanges].map(([id, xs]) => {
          const gaps = diffs(xs.map((x) => x.block));
          return [
            id,
            { changes: xs.length - 1, p50: percentile(gaps, 50), max: Math.max(0, ...gaps) },
          ];
        }),
      ),
    },
    null,
    2,
  ),
);
process.exit(0);
