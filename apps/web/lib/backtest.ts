// The backtest: every Perpl liquidation replayed through Airbag's engine. spike/backtest.ts
// writes backtest.json from public chain data; the /backtest pages read it on the server, so the
// file never ships to the browser.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    block: number;
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

let cached: Backtest | undefined;

/** The committed results. Server-only: it reads the file the spike wrote. */
export function loadBacktest(): Backtest {
  cached ??= JSON.parse(readFileSync(join(process.cwd(), 'lib/backtest.json'), 'utf8')) as Backtest;
  return cached;
}
