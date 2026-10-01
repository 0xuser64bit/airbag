// Keyless check against the live chain: does the engine's position math agree with Perpl's
// contract? For each account it reads every market's position onchain, rebuilds the position the
// way the live guard does (toRiskPosition: side decoding, the Q16 entry residue, decimals, and
// funding from cumulative sums since the entry block), and compares the unrealized PnL and the
// funding with the contract's own deltaPnlCNS and premiumPnlCNS. No key, no funds.
// Usage: pnpm --filter @airbag/spike check [accountId ...]
// Without ids it checks the first 25 accounts that hold a position. PERPL_NETWORK picks the chain.

import {
  collateralDecimals,
  fetchContext,
  networkFromEnv,
  type PerplPosition,
  perplChain,
  scaled,
  symbolOf,
  toRiskPosition,
} from '@airbag/perpl';
import { distanceToLiquidation, liquidationPrice } from '@airbag/risk';

const cfg = networkFromEnv();
const ctx = await fetchContext(cfg.apiUrl);
const cd = collateralDecimals(ctx);
const chain = perplChain(cfg.rpcUrl, ctx.instances[0]?.address ?? '', cfg.chainId);
const ids = process.argv.slice(2).map(Number);

/** The first `want` exchange accounts, by id, that hold a position. */
async function withPositions(want: number): Promise<number[]> {
  const found: number[] = [];
  for (let start = 1; found.length < want && start < 10_000; start += 100) {
    const batch = await Promise.all(
      Array.from({ length: 100 }, (_, i) => chain.accountById(start + i)),
    );
    if (batch.every((a) => a === null)) break;
    for (const a of batch) if (a?.hasPositions && found.length < want) found.push(a.id);
  }
  return found;
}

const accounts = ids.length ? ids : await withPositions(25);
const head = Number(await chain.head());
// Everything is read at once, so Multicall3 batches it: public RPCs rate-limit hard.
const pairs = accounts.flatMap((accountId) => ctx.markets.map((m) => ({ accountId, m })));
const read = await Promise.all(
  pairs.map(({ accountId, m }) => chain.position(m.perpetual_id, accountId)),
);
const open = pairs.map((x, i) => ({ ...x, p: read[i] })).filter((x) => x.p?.side);
const sums = await Promise.all(
  open.flatMap(({ m, p }) => [
    chain.fundingSumAt(m.perpetual_id, Number(p?.entryBlock ?? 0)),
    chain.fundingSumAt(m.perpetual_id, head),
  ]),
);

const rows = [];
let worstPnl = 0;
let worstFunding = 0;
for (const [i, { accountId, m, p }] of open.entries()) {
  if (!p?.side) continue;
  // The position as the trading socket reports it, with the entry funding sum from the chain.
  const ws: PerplPosition = {
    at: {},
    mkt: m.id,
    acc: accountId,
    pid: 0,
    st: 1,
    sd: p.side === 'long' ? 1 : 2,
    c: p.depositCns.toString(),
    ep: Number(p.pricePns),
    epr: Number(p.residueQ16),
    s: Number(p.lots),
    efs: sums[2 * i] ?? 0,
    lv: 0,
  };
  const risk = toRiskPosition(ws, m, cd, sums[2 * i + 1] ?? 0);
  const mark = scaled(Number(p.markPns), m.config.price_decimals);
  const pnl = (p.side === 'long' ? 1 : -1) * risk.size * (mark - risk.entry);
  const perplPnl = scaled(Number(p.deltaPnlCns), cd);
  const perplFunding = scaled(Number(p.premiumPnlCns), cd);
  worstPnl = Math.max(worstPnl, Math.abs(pnl - perplPnl));
  worstFunding = Math.max(worstFunding, Math.abs(risk.funding - perplFunding));
  rows.push({
    account: accountId,
    market: symbolOf(m),
    side: p.side,
    size: risk.size,
    mark,
    'pnl airbag': pnl.toFixed(4),
    'pnl perpl': perplPnl.toFixed(4),
    'funding airbag': risk.funding.toFixed(6),
    'funding perpl': perplFunding.toFixed(6),
    liquidation: liquidationPrice(risk).toFixed(m.config.price_decimals),
    'to liq': `${(distanceToLiquidation(risk, mark) * 100).toFixed(2)}%`,
  });
}
if (rows.length === 0) {
  console.log('No open positions on these accounts; pass ids of accounts that have some.');
  process.exit(1);
}
console.table(rows);
console.log(
  `${rows.length} positions on ${cfg.network}; largest difference: PnL $${worstPnl.toFixed(6)}, funding $${worstFunding.toFixed(6)}.`,
);
if (worstPnl > 0.01 || worstFunding > 0.01) process.exitCode = 1;
