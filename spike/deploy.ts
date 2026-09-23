// M0: one real deploy on testnet, timed per step.
//
//   trim: reduce-only IOC close of a fraction of a position, then IncreasePositionCollateral
//         of the equity the close released (ADR 0002). Proves t:3/4 and t:6 work with a
//         Trade key, and that re-adding moves the liquidation price.
//   add:  t:6 only, moving an amount from free balance into the position.
//
// Usage (from spike/, with ../.env filled in):
//   node --env-file-if-exists=../.env deploy.ts trim --market BTC --fraction 0.2 [--send]
//   node --env-file-if-exists=../.env deploy.ts add --market BTC --amount 1 [--send]
// Without --send it prints what it would send and exits. It refuses to run on mainnet.

import { parseArgs } from 'node:util';
import {
  type Account,
  type AllowedOrderFrame,
  closeOrder,
  collateralDecimals,
  ed25519Key,
  fetchContext,
  increaseCollateral,
  lotsToClose,
  type Message,
  MT,
  marketBySymbol,
  networkFromEnv,
  type Order,
  openSocket,
  type PerplPosition,
  perplChain,
  scaled,
  sendOrder,
  signInFrame,
  toRiskPosition,
  worstClosePrice,
} from '@airbag/perpl';
import { liquidationPrice } from '@airbag/risk';

import { requireEnv } from './env.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    market: { type: 'string', default: 'BTC' },
    fraction: { type: 'string', default: '0.2' },
    amount: { type: 'string', default: '1' },
    slippage: { type: 'string', default: '50' },
    send: { type: 'boolean', default: false },
  },
});
const mode = positionals[0];
if (mode !== 'trim' && mode !== 'add') throw new Error('usage: deploy.ts trim|add [options]');

const cfg = networkFromEnv();
if (cfg.network !== 'testnet') throw new Error('the spike only runs on testnet');

const ctx = await fetchContext(cfg.apiUrl);
const market = marketBySymbol(ctx, values.market);
const cd = collateralDecimals(ctx);
const onchain = perplChain(cfg.rpcUrl, ctx.instances[0]?.address ?? '');
const usd = (cns: bigint) => scaled(Number(cns), cd);

// Live state from the trading socket. Every message is kept with its receive time for the timeline.
const state = {
  account: undefined as Account | undefined,
  position: undefined as PerplPosition | undefined,
  head: 0,
  orders: [] as { at: number; o: Order }[],
};
const key = ed25519Key(requireEnv('PERPL_API_SECRET'));
const ws = await openSocket(`${cfg.wsUrl}/ws/v1/trading`, () =>
  JSON.stringify(signInFrame(cfg.chainId, requireEnv('PERPL_API_KEY'), key)),
);
ws.listen((m: Message, at) => {
  if (m.mt === MT.WalletSnapshot) state.account = (m.as as Account[] | undefined)?.[0];
  if (m.mt === MT.AccountUpdate) state.account = m as unknown as Account;
  if (m.mt === MT.Heartbeat) state.head = m.h as number;
  if (m.mt === MT.PositionsSnapshot || m.mt === MT.PositionsUpdate) {
    for (const p of m.d as PerplPosition[]) if (p.mkt === market.id) state.position = p;
  }
  if (m.mt === MT.OrdersUpdate) for (const o of m.d as Order[]) state.orders.push({ at, o });
});
const ping = setInterval(() => ws.send(JSON.stringify({ mt: MT.Ping, t: Date.now() })), 30_000);

// Current mark from the market-data snapshot.
const md = await openSocket(`${cfg.wsUrl}/ws/v1/market-data`, () =>
  JSON.stringify({
    mt: MT.Subscribe,
    subs: [{ stream: `market-state@${cfg.chainId}`, subscribe: true }],
  }),
);
const snapshot = await md.next(
  (m) => m.mt === MT.MarketState && !!(m.d as Record<string, unknown>)[market.id],
);
const markState = (snapshot.d as Record<string, { mrk: number; at: { b: number } }>)[market.id];
md.close();
if (!markState) throw new Error(`no market-state for ${values.market}`);

await ws.next((m) => m.mt === MT.PositionsSnapshot);
await ws.next((m) => m.mt === MT.Heartbeat);
const account = state.account;
const pos0 = state.position;
if (!account) throw new Error('no exchange account for this key');
if (!account.fw)
  throw new Error('order forwarding is off: enable One-Click Trading in Perpl first');
if (pos0?.st !== 1) throw new Error(`no open ${values.market} position`);

const liqOf = async (p: PerplPosition) =>
  liquidationPrice(
    toRiskPosition(p, market, cd, await onchain.fundingSumAt(market.perpetual_id, state.head)),
  );
const px = (v: number) => v.toFixed(market.config.price_decimals);
const balance = () => BigInt(state.account?.b ?? '0');

let sn = 0;
let rq = account.lfr;
const envelope = () => ({
  sn: ++sn,
  rq: ++rq,
  mkt: market.id,
  acc: account.id,
  lb: state.head + market.order_ttl_blocks,
});

// Times are measured from the moment we start acting (the spike's stand-in for "detect").
const timeline: { step: string; block: number; ms: number; note?: string }[] = [];
let t0 = performance.now();
const mark = (step: string, block: number, note?: string) => {
  if (timeline.length === 0) t0 = performance.now();
  timeline.push({ step, block, ms: Math.round(performance.now() - t0), ...(note ? { note } : {}) });
};

/** Sends a frame and waits for its mt:3 ack and its final mt:24 status (or a position change). */
async function place(
  frame: AllowedOrderFrame,
  label: string,
  done: () => boolean,
): Promise<Order | undefined> {
  const since = performance.now();
  sendOrder(ws, frame);
  mark(`${label}: sent`, state.head, `rq ${frame.rq}`);
  const ack = await ws.next<Message & { status: { code: number; error: string } }>(
    (m) => m.mt === MT.Status && m.cid === frame.sn,
  );
  mark(
    `${label}: ack mt:3`,
    state.head,
    `code ${ack.status.code} ${ack.status.error ?? ''}`.trim(),
  );
  if (ack.status.code !== 0)
    throw new Error(`${label} rejected at the gateway: ${ack.status.error}`);
  const terminal = new Set([4, 5, 6, 7, 10]);
  for (let waited = 0; waited < 30_000; waited += 50) {
    const final = state.orders.find(
      (x) => x.at >= since && x.o.rq === frame.rq && terminal.has(x.o.st),
    );
    if (final) {
      mark(`${label}: mt:24 st ${final.o.st}`, final.o.at.b ?? state.head, final.o.at.txid);
      if (final.o.st === 7)
        throw new Error(`${label} failed: sr ${final.o.sr} fr ${final.o.fr ?? '-'}`);
      return final.o;
    }
    if (done()) {
      mark(`${label}: position updated`, state.head);
      return undefined;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${label}: no final status within 30 s`);
}

const settle = async (changed: () => boolean) => {
  for (let i = 0; i < 100 && !changed(); i++) await new Promise((r) => setTimeout(r, 50));
};

const liq0 = await liqOf(pos0);
console.log({
  mode,
  market: values.market,
  account: account.id,
  head: state.head,
  mark: px(scaled(markState.mrk, market.config.price_decimals)),
  markBlock: markState.at.b,
  size: scaled(pos0.s, market.config.size_decimals),
  deposit: usd(BigInt(pos0.c)),
  spare: usd(balance() - BigInt(account.lb)),
  liquidation: px(liq0),
});

if (mode === 'add') {
  const amountCns = BigInt(Math.round(Number(values.amount) * 10 ** cd));
  const frame = increaseCollateral({ ...envelope(), amountCns });
  console.log('frame', frame);
  if (!values.send) process.exit(0);
  mark('start', state.head);
  const before = pos0.c;
  await place(frame, 't:6 add', () => state.position?.c !== before);
  await settle(() => state.position?.c !== before);
  const pos1 = state.position ?? pos0;
  console.log({
    depositBefore: usd(BigInt(before)),
    depositAfter: usd(BigInt(pos1.c)),
    liqBefore: px(liq0),
    liqAfter: px(await liqOf(pos1)),
  });
} else {
  const lots = lotsToClose(pos0.s, Number(values.fraction));
  const side = pos0.sd === 1 ? 'long' : 'short';
  const limitPrice = worstClosePrice(side, markState.mrk, Number(values.slippage));
  const close = closeOrder({ ...envelope(), side, lots, limitPrice, leverage: pos0.lv });
  console.log('close frame', close);
  if (!values.send) process.exit(0);

  mark('detect (mark block)', markState.at.b);
  const balanceBefore = balance();
  const sizeBefore = pos0.s;
  await place(close, 'close', () => false);
  await settle(() => state.position?.s !== sizeBefore && balance() !== balanceBefore);
  const pos1 = state.position ?? pos0;
  const released = balance() - balanceBefore;
  mark('close: balance + position updated', state.head, `released ${usd(released)}`);
  const liq1 = await liqOf(pos1);

  if (released > 0n) {
    const depositBefore = pos1.c;
    await place(
      increaseCollateral({ ...envelope(), amountCns: released }),
      're-add',
      () => state.position?.c !== depositBefore,
    );
    await settle(() => state.position?.c !== depositBefore);
  }
  const pos2 = state.position ?? pos1;
  const liq2 = await liqOf(pos2);
  console.log({
    size: `${scaled(pos0.s, market.config.size_decimals)} -> ${scaled(pos1.s, market.config.size_decimals)}`,
    depositAfterClose: `${usd(BigInt(pos0.c))} -> ${usd(BigInt(pos1.c))} (size ratio ${(pos1.s / pos0.s).toFixed(4)}, deposit ratio ${(Number(pos1.c) / Number(pos0.c)).toFixed(4)})`,
    released: usd(released),
    depositAfterReadd: usd(BigInt(pos2.c)),
    liquidation: `${px(liq0)} -> ${px(liq1)} after close -> ${px(liq2)} after re-add`,
  });
}

console.table(timeline);
clearInterval(ping);
ws.close();
process.exit(0);
