// Replays a recorded mark path through the real engine: one position on a paper exchange, the
// production guard, and the marks Perpl published, block by block. The backtest
// (spike/backtest.ts) runs every Perpl liquidation through it. Nothing is sent anywhere.

import type { Market, PerplPosition } from '@airbag/perpl';
import { scaled, toRiskPosition } from '@airbag/perpl';
import { equity, type Position, type Side } from '@airbag/risk';
import { DEFAULT_SETTINGS, type Deploy, openStore, type Settings } from './db.ts';
import { Engine } from './engine.ts';
import { PaperExchange, type PaperLiquidation } from './exchange.ts';
import type { Feed } from './guard.ts';
import { createLogger } from './log.ts';

const WALLET = '0x000000000000000000000000000000000000a1b0';
const Q16 = 65_536;

export interface ReplayInput {
  /** The market as Perpl's context describes it, fee schedule included. */
  market: Market;
  side: Side;
  /** Human units. Funding so far belongs in the deposit: the paper exchange accrues none. */
  size: number;
  entry: number;
  deposit: number;
  /** Scaled marks for this market, [block, price], in block order. */
  marks: readonly (readonly [number, number])[];
  from: number;
  to: number;
  settings?: Partial<Omit<Settings, 'updatedAt'>>;
  /** Blocks between sending an order and its fill. */
  delayBlocks?: number;
  fillSlippageBps?: number;
  userShare?: number;
  /** Blocks at which to record what the trader holds, like the block Perpl liquidated. */
  checkpoints?: number[];
}

export interface ReplayResult {
  deploys: Deploy[];
  liquidation?: PaperLiquidation;
  /** The last block replayed: `to`, or where the position closed. */
  end: number;
  /** The position at `end`, if still open. */
  position?: Position;
  /** What the trader holds at `end`: the open position's equity plus the free balance. */
  value: number;
  /** The same, at each checkpoint the replay reached, by block. */
  values: Map<number, number>;
}

/** Perpl's scaled entry and Q16 residue for an effective entry price (see effectiveEntryPrice). */
export function scaledEntry(side: Side, entry: number, priceDecimals: number) {
  const x = entry * 10 ** priceDecimals;
  const whole = Math.floor(x);
  const residue = Math.round((x - whole) * Q16);
  if (residue === 0 || residue === Q16) return { ep: whole + (residue ? 1 : 0), epr: 0 };
  return { ep: side === 'long' ? whole + 1 : whole, epr: residue };
}

/** Index of the last mark at or before `block`, or -1. */
function at(marks: ReplayInput['marks'], block: number): number {
  let lo = 0;
  let hi = marks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((marks[mid]?.[0] ?? 0) <= block) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Lets the guard's continuations (settlement waits of a few ms) run before the next block. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 10));
};

export async function replay(input: ReplayInput): Promise<ReplayResult> {
  const { market: m, marks } = input;
  const pd = m.config.price_decimals;
  const store = openStore(':memory:');
  store.putSettings(WALLET, { ...DEFAULT_SETTINGS, armed: true, ...input.settings });
  let head = input.from;
  let i = at(marks, head);
  if (i < 0) throw new Error(`no mark at or before block ${head}`);
  const feed: Feed = {
    get head() {
      return head;
    },
    mark: (id) => (id === m.id ? marks[i]?.[1] : undefined),
    configs: new Map([[m.id, m.config]]),
    fundingAt: () => undefined,
    staleness: () => ({ stale: false, lagBlocks: 0 }),
  };
  const byId = new Map([[m.id, m]]);
  const userShare = input.userShare ?? 0.8;
  const engine = new Engine({
    store,
    log: createLogger('error', {}, () => {}),
    markets: { byId, covered: new Set([m.id]), collateralDecimals: 6, userShare },
    feed,
    notify: { deployed() {}, saved() {}, alert() {} },
    slippageBps: 50,
    maxAttempts: 3,
    demoMove: 0.003,
    pollMs: 1,
    settleMs: 5,
  });
  const lots = Math.round(input.size * 10 ** m.config.size_decimals);
  const position: PerplPosition = {
    at: { b: head },
    mkt: m.id,
    acc: 1,
    pid: 1,
    st: 1,
    sd: input.side === 'long' ? 1 : 2,
    c: BigInt(Math.max(0, Math.round(input.deposit * 1e6))).toString(),
    ...scaledEntry(input.side, input.entry, pd),
    s: lots,
    efs: 0,
    // Opening leverage isn't in the record; entry notional over deposit stands in for it.
    lv: Math.round(((input.size * input.entry) / Math.max(input.deposit, 1e-9)) * 100),
  };
  const paper = new PaperExchange({
    wallet: WALLET,
    accountId: 1,
    balanceCns: 0n,
    positions: [position],
    markets: byId,
    collateralDecimals: 6,
    markOf: (id) => feed.mark(id),
    userShare,
    ...(input.delayBlocks ? { delayBlocks: input.delayBlocks } : {}),
    ...(input.fillSlippageBps ? { fillSlippageBps: input.fillSlippageBps } : {}),
  });
  const guard = engine.add(WALLET, paper);
  const holding = () => {
    const open = paper.positions.get(m.id);
    const risk = open ? toRiskPosition(open, m, 6, open.efs) : undefined;
    return {
      risk,
      value: paper.spare() + (risk ? equity(risk, scaled(feed.mark(m.id) ?? 0, pd)) : 0),
    };
  };
  const values = new Map<number, number>();
  const pending = [...(input.checkpoints ?? [])].sort((a, b) => a - b);

  // Between mark updates nothing changes for an idle guard, so it jumps to the next one; while
  // a deploy is in flight it steps every block, as orders fill a block or two after sending.
  for (;;) {
    engine.tick(head);
    if (head >= input.to || paper.positions.size === 0) break;
    let next = head + 1;
    if (guard.hasPendingDeploy) await settle();
    else next = Math.min(input.to, marks[i + 1]?.[0] ?? input.to);
    // Nothing changes before `next`, so a checkpoint in between holds what the trader holds now.
    while (pending.length && (pending[0] ?? 0) < next)
      values.set(pending.shift() ?? 0, holding().value);
    head = next;
    i = at(marks, head);
  }
  // A deploy can still be settling its last order; let it finish so its record is complete.
  for (let n = 0; n < 50 && guard.hasPendingDeploy && paper.positions.size > 0; n++) {
    await settle();
    engine.tick(++head);
    i = at(marks, head);
  }
  engine.stop();

  const { risk, value } = holding();
  // Checkpoints past a liquidation hold what it returned.
  for (const cp of pending) if (cp <= input.to) values.set(cp, value);
  const result: ReplayResult = {
    deploys: store
      .deploys(WALLET, 1_000)
      .sort((a, b) => a.data.trigger.block - b.data.trigger.block),
    end: head,
    value,
    values,
  };
  const liquidation = paper.liquidations[0];
  if (liquidation) result.liquidation = liquidation;
  if (risk) result.position = risk;
  store.close();
  return result;
}
