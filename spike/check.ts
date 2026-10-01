// Keyless check against the live chain: does Airbag's position math agree with Perpl's contract?
// For each account, reads every market's position onchain and compares the unrealized PnL that
// Airbag derives (side decoding, the Q16 entry residue, sizes and decimals) with the contract's
// own deltaPnlCNS, then prints the liquidation price Airbag computes from the same inputs.
// No key, no funds. Usage: pnpm --filter @airbag/spike check [accountId ...]   (default: 1 2)

import {
  collateralDecimals,
  effectiveEntryPrice,
  fetchContext,
  maintenanceFraction,
  networkFromEnv,
  perplChain,
  scaled,
  symbolOf,
} from '@airbag/perpl';
import { distanceToLiquidation, liquidationPrice, type Position } from '@airbag/risk';

const cfg = networkFromEnv();
const ctx = await fetchContext(cfg.apiUrl);
const cd = collateralDecimals(ctx);
const chain = perplChain(cfg.rpcUrl, ctx.instances[0]?.address ?? '', cfg.chainId);
const ids = process.argv.slice(2).map(Number);

const rows = [];
let worst = 0;
for (const accountId of ids.length ? ids : [1, 2]) {
  const positions = await Promise.all(
    ctx.markets.map(async (m) => ({ m, p: await chain.position(m.perpetual_id, accountId) })),
  );
  for (const { m, p } of positions) {
    if (!p.side) continue;
    const pd = m.config.price_decimals;
    const risk: Position = {
      side: p.side,
      size: scaled(Number(p.lots), m.config.size_decimals),
      entry: effectiveEntryPrice(p.side, Number(p.pricePns), Number(p.residueQ16), pd),
      deposit: scaled(Number(p.depositCns), cd),
      funding: scaled(Number(p.premiumPnlCns), cd),
      maintenance: maintenanceFraction(m),
    };
    const mark = scaled(Number(p.markPns), pd);
    const ours = (p.side === 'long' ? 1 : -1) * risk.size * (mark - risk.entry);
    const perpl = scaled(Number(p.deltaPnlCns), cd);
    worst = Math.max(worst, Math.abs(ours - perpl));
    rows.push({
      account: accountId,
      market: symbolOf(m),
      side: p.side,
      size: risk.size,
      entry: risk.entry.toFixed(pd + 2),
      mark,
      'pnl airbag': ours.toFixed(4),
      'pnl perpl': perpl.toFixed(4),
      liquidation: liquidationPrice(risk).toFixed(pd),
      'to liq': `${(distanceToLiquidation(risk, mark) * 100).toFixed(2)}%`,
    });
  }
}
if (rows.length === 0) {
  console.log('No open positions on these accounts; pass ids of accounts that have some.');
  process.exit(1);
}
console.table(rows);
console.log(
  `${rows.length} positions on ${cfg.network}; largest PnL difference $${worst.toFixed(6)}.`,
);
if (worst > 0.01) process.exitCode = 1;
