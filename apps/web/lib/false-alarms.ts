// The backtest's other side: positions whose mark crossed their Airbag line, liquidated or not.
// tools/false-alarms.ts writes false-alarms.json over the backtest's own window; /backtest reads
// it on the server. This module is its shape.

/**
 * What happened next to the position, as Perpl's events say: liquidated; closed by the trader;
 * changed by the trader (resized or margin moved); held (untouched a day after the line).
 */
export type Outcome = 'liquidated' | 'closed' | 'changed' | 'held';

interface FalseAlarmRow {
  market: string;
  side: 'long' | 'short';
  notional: number;
  deposit: number;
  /** Blocks: the PositionOpened event, the first mark past the line, and where both replays end. */
  opened: number;
  crossed: number;
  to: number;
  outcome: Outcome;
  /** Airbag's replay trimmed (a one-lot position can't be within the 50% cap). */
  trimmed: boolean;
  /** The paused replay matched the chain: liquidated where Perpl did, and only there. */
  agrees: boolean;
  /** What the trader held at `to` without Airbag, and with it: equity plus released margin. */
  untouched: number;
  airbag: number;
}

export interface Side {
  count: number;
  /** Positions where Airbag's path held more, or less, than the untouched one at `to`. */
  better: number;
  worse: number;
  untouched: number;
  airbag: number;
  medianDiff: number;
  medianDiffPct: number;
  worstTenthPct: number;
}

export interface FalseAlarms {
  generatedAt: string;
  network: string;
  fromBlock: number;
  head: number;
  days: number;
  assumptions: { delayBlocks: number; fillSlippageBps: number; horizonBlocks: number };
  summary: {
    /** Positions opened in the window, on markets Perpl lists today. */
    opened: number;
    unknownMarket: number;
    /** Of those, the ones whose mark crossed the line before anything else happened to them. */
    crossed: number;
    outcomes: Record<Outcome, number>;
    disagree: number;
    untrimmed: number;
    /** Crossed, trimmed, and not liquidated: what the trims cost or saved. */
    falseAlarms: Side;
    /** Crossed, trimmed, and liquidated by Perpl. */
    needed: Side;
  };
  rows: FalseAlarmRow[];
}
