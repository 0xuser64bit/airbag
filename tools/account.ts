// Sign in to the trading WS, read the account and its positions, and compute each
// liquidation price two ways: from the WS data (what the engine will use) and from the chain.
// Compare both with Perpl's UI. Usage: pnpm --filter @airbag/tools account

import {
  type Account,
  collateralDecimals,
  ed25519Key,
  effectiveEntryPrice,
  fetchContext,
  type Message,
  MT,
  maintenanceFraction,
  networkFromEnv,
  openSocket,
  type PerplPosition,
  perplChain,
  scaled,
  signInFrame,
  toRiskPosition,
} from '@airbag/perpl';
import { distanceToLiquidation, liquidationPrice, type Position } from '@airbag/risk';

import { requireEnv } from './env.ts';

const cfg = networkFromEnv();
const ctx = await fetchContext(cfg.apiUrl);
const cd = collateralDecimals(ctx);
const onchain = perplChain(cfg.rpcUrl, ctx.instances[0]?.address ?? '', cfg.chainId);
const key = ed25519Key(requireEnv('PERPL_API_SECRET'));

const ws = await openSocket(`${cfg.wsUrl}/ws/v1/trading`, () =>
  JSON.stringify(signInFrame(cfg.chainId, requireEnv('PERPL_API_KEY'), key)),
);
const [wallet, positions, beat] = await Promise.all([
  ws.next<Message & { as?: Account[] }>((m) => m.mt === MT.WalletSnapshot),
  ws.next<Message & { d: PerplPosition[] }>((m) => m.mt === MT.PositionsSnapshot),
  ws.next<Message & { h: number }>((m) => m.mt === MT.Heartbeat),
]);
ws.close();

const account = wallet.as?.[0];
if (!account) throw new Error('signed in, but this wallet has no Perpl exchange account');
const usd = (cns: string | bigint) => scaled(Number(cns), cd);
console.log({
  network: cfg.network,
  head: beat.h,
  account: account.id,
  orderForwarding: account.fw
    ? 'on'
    : 'OFF: enable One-Click Trading in Perpl, or orders fail with sr:34',
  frozen: account.fr,
  balance: usd(account.b),
  locked: usd(account.lb),
  spare: usd(BigInt(account.b) - BigInt(account.lb)),
  lastForwardedRq: account.lfr,
});

const rows = [];
for (const p of positions.d.filter((x) => x.st === 1)) {
  const market = ctx.markets.find((m) => m.id === p.mkt);
  if (!market) continue;
  const fundingSum = await onchain.fundingSumAt(market.perpetual_id, beat.h);
  const fromWs = toRiskPosition(p, market, cd, fundingSum);
  const info = await onchain.position(market.perpetual_id, account.id);
  const pd = market.config.price_decimals;
  const fromChain: Position = {
    side: fromWs.side,
    size: scaled(Number(info.lots), market.config.size_decimals),
    entry: effectiveEntryPrice(fromWs.side, Number(info.pricePns), Number(info.residueQ16), pd),
    deposit: usd(info.depositCns),
    funding: usd(info.premiumPnlCns),
    maintenance: maintenanceFraction(market),
  };
  const mark = scaled(Number(info.markPns), pd);
  rows.push({
    market: market.symbol || market.name,
    side: fromWs.side,
    size: fromWs.size,
    entry: fromWs.entry,
    'deposit ws/chain': `${fromWs.deposit} / ${fromChain.deposit}`,
    'funding ws/chain': `${fromWs.funding.toFixed(6)} / ${fromChain.funding.toFixed(6)}`,
    'liq ws': liquidationPrice(fromWs).toFixed(pd),
    'liq chain': liquidationPrice(fromChain).toFixed(pd),
    mark,
    'to liq': `${(distanceToLiquidation(fromChain, mark) * 100).toFixed(2)}%`,
  });
}
console.table(rows);
process.exit(0);
