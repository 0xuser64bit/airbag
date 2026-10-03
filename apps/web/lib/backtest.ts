// The backtest: every Perpl liquidation replayed through Airbag's engine. spike/backtest.ts
// writes backtest.json from public chain data; the /backtest pages read it on the server
// (app/backtest/data.ts), so the file never ships to the browser. This module is its shape and
// the formatting both sides share.

import { fmt } from '@airbag/risk';

/**
 * open: Airbag trimmed in time and the position was still open when Perpl liquidated the
 * original. liquidated-later: open then, liquidated at its new price within the day after.
 * liquidated: trimmed, but liquidated by then anyway. untrimmed: one lot, too small to trim
 * within the 50% cap, so liquidated like the original.
 */
export type Outcome = 'open' | 'liquidated-later' | 'liquidated' | 'untrimmed';

export interface BacktestRow {
  /** Block and log index of Perpl's PositionLiquidated event. */
  id: string;
  tx: string;
  block: number;
  at: number;
  accountId: number;
  market: string;
  side: 'long' | 'short';
  size: number;
  sizeDecimals: number;
  entry: number;
  /** Entry notional over the deposit. */
  leverage: number;
  /** The liquidation price Airbag computes for the position. */
  liquidation: number;
  markAtLiquidation: number;
  /** The price Perpl's liquidation filled at on the book. */
  liquidatedAt: number;
  /** What the liquidation returned to the trader. */
  returned: number;
  /** The Airbag line: Balanced, armed at entry. */
  line: number;
  /** Where the replay first deployed. */
  trigger: { block: number; at: number; mark: number } | null;
  deploys: {
    /** Where the line was crossed, and where the close filled. */
    block: number;
    filled: number | null;
    /** Share of the position the deploy closed. */
    trimmed: number;
    fill: number | null;
    fee: number | null;
    liquidationAfter: number | null;
  }[];
  outcome: Outcome;
  /** What the Airbag path held at the block Perpl liquidated: equity plus released margin. */
  atLiquidation: number;
  /** The same a day later, or what its own liquidation returned. */
  end: { block: number; value: number; liquidated: { block: number; price: number } | null };
  /** The replay with Airbag paused: where it liquidated the position. */
  control: { block: number } | null;
  /** The mark around it, as [blocks from the liquidation, price]. */
  path: [number, number][];
}

export interface Backtest {
  generatedAt: string;
  network: string;
  chainId: number;
  exchange: string;
  head: number;
  fromBlock: number;
  span: number;
  days: number;
  assumptions: {
    sensitivity: string;
    targetPct: number;
    maxTrimPct: number;
    spare: number;
    delayBlocks: number;
    fillSlippageBps: number;
    horizonBlocks: number;
  };
  summary: {
    liquidations: number;
    full: number;
    replayed: number;
    skipped: { beforeData: number };
    actedBefore: number;
    open: number;
    liquidatedLater: number;
    liquidated: number;
    untrimmed: number;
    aheadAtLiquidation: number;
    aheadAfterDay: number;
    leadSeconds: { p10: number; p50: number; p90: number };
    returned: number;
    atLiquidation: number;
    afterDay: number;
    control: { liquidated: number; medianBlocksEarly: number };
  };
  rows: BacktestRow[];
}

/** MonadVision for the backtest's chain. */
export const explorerFor = (chainId: number): string =>
  chainId === 143 ? 'https://monadvision.com' : 'https://testnet.monadvision.com';

/** Oct 3, 21:14 UTC. */
export const utc = (ms: number): string =>
  `${new Date(ms).toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })} UTC`;

/** Seconds from the replay's first deploy to Perpl's liquidation. */
export const warningSeconds = (r: BacktestRow): number | null =>
  r.trigger ? (r.block - r.trigger.block) * BLOCK_S : null;

/** Seconds per Monad block, measured over 6M mainnet blocks. */
export const BLOCK_S = 0.302;

/** −50 min · 0 · +2 h, from blocks relative to the liquidation. */
export function relative(blocks: number): string {
  if (blocks === 0) return '0';
  return `${blocks < 0 ? '−' : '+'}${fmt.duration(Math.abs(blocks) * BLOCK_S * 1000)}`;
}
