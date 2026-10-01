// Checks Airbag's risk model against Perpl's own liquidations, from public chain data, no key.
// A full liquidation's PositionLiquidated event gives back the position it closed: the deposit it
// removed, the PnL realized at the execution price, and funding. Two questions for each: was the
// mark at or past the liquidation price Airbag computes for that position when Perpl liquidated
// it, and did the trader get the share of what was left that save reports assume?
// Testnet rarely liquidates; on mainnet rpc1 serves the wide log ranges this needs:
//   PERPL_NETWORK=mainnet MONAD_RPC_URL=https://rpc1.monad.xyz \
//     pnpm --filter @airbag/spike liquidations [blocks, default 3000000]

import {
  type ChainLiquidation,
  collateralDecimals,
  fetchContext,
  maintenanceFraction,
  networkFromEnv,
  perplChain,
  scaled,
  symbolOf,
} from '@airbag/perpl';
import { liquidationPrice, type Position } from '@airbag/risk';

const cfg = networkFromEnv();
const ctx = await fetchContext(cfg.apiUrl);
const cd = collateralDecimals(ctx);
const chain = perplChain(cfg.rpcUrl, ctx.instances[0]?.address ?? '', cfg.chainId);
const byPerp = new Map(ctx.markets.map((m) => [m.perpetual_id, m]));

const head = await chain.head();
const span = BigInt(process.argv[2] ?? 3_000_000);
const events: ChainLiquidation[] = [];
let step = 100_000n;
for (let to = head; to > head - span; ) {
  const from = to - step + 1n;
  try {
    events.push(...(await chain.liquidations(from, to)));
    to = from - 1n;
  } catch (err) {
    if (step === 100n || !/range/i.test(String(err))) throw err;
    console.error(
      'This RPC caps log ranges at 100 blocks; on mainnet use MONAD_RPC_URL=https://rpc1.monad.xyz.',
    );
    step = 100n;
  }
}

const shares = new Map<number, number>();
const rows = [];
const traderShares: number[] = [];
let early = 0;
let offShare = 0;
for (const l of events) {
  const m = byPerp.get(l.perpId);
  if (!m || l.remainingLots !== 0n || l.lots === 0n) continue; // full liquidations only
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
  };
  const mark = scaled(Number(l.markPns), pd);
  const liq = liquidationPrice(position);
  // Ticks the mark had gone past Airbag's liquidation price; below -1 would be an early one.
  const pastTicks = s * (liq - mark) * 10 ** pd;
  if (pastTicks < -1) early++;
  const left = position.deposit + position.funding + realized;
  const expected =
    shares.get(l.perpId) ??
    shares.set(l.perpId, await chain.liquidationUserShare(l.perpId)).get(l.perpId) ??
    0.8;
  const share = left > 0 ? scaled(Number(l.toAccountCns), cd) / left : null;
  if (share !== null) {
    traderShares.push(share);
    if (Math.abs(share - expected) > 1e-3) offShare++;
  }
  rows.push({
    block: Number(l.block),
    market: symbolOf(m),
    side: l.side,
    size,
    mark,
    'airbag liq': Number(liq.toFixed(pd)),
    executed,
    'mark past liq': `${((s * (liq - mark) * 100) / mark).toFixed(3)}%`,
    'trader share': share === null ? 'n/a' : `${(share * 100).toFixed(2)}%`,
  });
}

if (rows.length === 0) {
  console.log(`No full liquidations in the last ${span} blocks on ${cfg.network}.`);
  process.exit(0);
}
console.table(rows.slice(0, 20));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
console.log(
  `${rows.length} full liquidations on ${cfg.network} in ${new Set(rows.map((r) => r.market)).size} markets over ${span} blocks.`,
);
console.log(
  `Liquidated before Airbag's liquidation price (more than a tick early): ${early}. Trader share of what was left: median ${(median(traderShares) * 100).toFixed(3)}%, ${offShare} off the market's configured share.`,
);
if (early > 0 || offShare > 0) process.exitCode = 1;
