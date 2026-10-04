// The engine API's response shapes (apps/engine/src/api.ts). Kept by hand: the web app talks
// to the engine over HTTP only, so it doesn't import engine code.

import type { Position, Side } from '@airbag/risk';

export type { Position, Side };

export interface EngineConfig {
  mode: 'live' | 'simulation';
  network: 'testnet' | 'mainnet';
  chainId: number;
  explorerUrl: string;
  perplUrl: string;
  egressIps: string[];
  markets: { id: number; symbol: string }[];
  vapidPublicKey: string | null;
  /** The bot's @username, when the engine sends Telegram alerts. */
  telegram: string | null;
  slippageBps: number;
}

export interface LookupPosition {
  marketId: number;
  symbol: string;
  side: Side;
  size: number;
  sizeDecimals: number;
  nominalLeverage: number;
  mark: number;
  liquidation: number;
  distance: number;
  covered: boolean;
}

export interface Lookup {
  address: string;
  simulated: boolean;
  account: { id: number; spare: number; frozen: boolean } | null;
  positions: LookupPosition[];
}

export type Sensitivity = 'early' | 'balanced' | 'late';

export interface Settings {
  sensitivity: Sensitivity;
  targetPct: number;
  maxTrimPct: 25 | 50 | 75 | 100;
  useSpare: boolean;
  push: boolean;
  armed: boolean;
  demo: boolean;
  updatedAt: number;
}

export interface Me {
  wallet: string;
  link: { accountId: number; keyHint: string; linkedAt: number } | null;
  settings: Settings;
  demoAllowed: boolean;
  /** A Telegram chat is linked for alerts. */
  telegram: boolean;
}

export interface Linked {
  accountId: number;
  keyHint: string;
  forwarding: boolean;
  /** The scope probe got past Perpl's gateway. */
  tradeScope: boolean;
  simulated: boolean;
}

export type GuardStatus =
  | 'unlinked'
  | 'paused'
  | 'key-rejected'
  | 'too-many-connections'
  | 'forwarding-off'
  | 'frozen'
  | 'connecting'
  | 'stale'
  | 'deploying'
  | 're-armed'
  | 'armed';

export type PositionStatus =
  | 'armed'
  | 'deploying'
  | 're-armed'
  | 'paused'
  | 'blocked'
  | 'not-covered';

export interface PositionView {
  marketId: number;
  positionId: number;
  symbol: string;
  side: Side;
  size: number;
  sizeDecimals: number;
  entry: number;
  mark: number;
  equity: number;
  leverage: number;
  nominalLeverage: number;
  liquidation: number;
  distance: number;
  covered: boolean;
  status: PositionStatus;
  position: Position;
  line?: number;
  reference?: number;
  cushionUsed?: number;
  atLine?: {
    kind: 'none' | 'margin' | 'trim';
    fraction?: number;
    amount?: number;
    liquidation: number | null;
    capped?: boolean;
  };
}

export type DeployPhase = 'closing' | 'readding' | 'done' | 'failed';
export type DeployOutcome = 'pending' | 'save' | 'precaution';

export interface DeploySummary {
  id: string;
  symbol: string;
  side: Side;
  sizeDecimals: number;
  kind: 'trim' | 'margin';
  phase: DeployPhase;
  outcome: DeployOutcome;
  createdAt: number;
  savedAt: number | null;
  closedAt: number | null;
  trimmed: number;
  fillPrice: number | null;
  spareAdded: number;
  liquidationBefore: number;
  liquidationAfter: number | null;
  saveAfterMs: number | null;
  kept: number | null;
}

export interface TimelineEntry {
  block: number;
  at: number;
  text: string;
  tx?: string;
  tone?: 'airbag' | 'liquidation';
}

export interface DeployData {
  trigger: { block: number; at: number; mark: number; line: number; reference: number };
  before: {
    size: number;
    lots: number;
    entry: number;
    deposit: number;
    funding: number;
    maintenance: number;
    liquidation: number;
    distance: number;
    leverage: number;
    nominal?: number;
  };
  target: number;
  maxTrim: number;
  spare: number;
  plannedLiquidation: number | null;
  capped: boolean;
  close?: {
    lots: number;
    limitPrice: number;
    filledLots: number;
    fillPrice: number;
    realizedPnl: number;
    fee?: number;
    tx?: string;
  };
  margin?: { amount: number; reason: 'spare' | 'readd'; tx?: string };
  after?: {
    size: number;
    liquidation: number | null;
    distance: number | null;
    leverage: number | null;
    line: number | null;
  };
  counterfactual: number;
  spareAdded: number;
  save?: { block: number; at: number; mark: number };
  kept?: number;
  keptMark?: number;
  latency?: { detectToSendMs: number; sendToFillMs: number; fillToReaddMs: number; blocks: number };
  attempts: number;
  onchain?: { deployId: number; tx: string; saveTx?: string };
  timeline: TimelineEntry[];
}

export interface DeployDetail extends DeploySummary {
  marketId: number;
  simulated: boolean;
  explorerUrl: string;
  data: DeployData;
}

export interface Dashboard {
  mode: 'live' | 'simulation';
  network: string;
  explorerUrl: string;
  wallet: string;
  block: {
    head: number;
    /** A real Monad block (live, or simulation on Monad's clock), so the explorer can show it. */
    onchain: boolean;
    at: number;
    stale: boolean;
    staleReason: string | null;
    lagBlocks: number;
  };
  tape: { block: number; ok: boolean; at: number }[];
  status: GuardStatus;
  account: {
    id: number;
    spare: number;
    value: number;
    forwarding: boolean;
    frozen: boolean;
  } | null;
  key: {
    keyHint: string;
    linkedAt: number;
    state: string;
    lastMessageAt: number | null;
  } | null;
  settings: Settings;
  demoAllowed: boolean;
  positions: PositionView[];
  deploys: DeploySummary[];
  /** Simulation only: positions the paper exchange liquidated, newest first. */
  liquidations: {
    symbol: string;
    side: Side;
    size: number;
    sizeDecimals: number;
    block: number;
    price: number;
    returned: number;
  }[];
}

export interface SaveReport {
  id: string;
  symbol: string;
  side: Side;
  kind: 'trim' | 'margin';
  date: number;
  nominalLeverage: number | null;
  kept: number;
  counterfactual: number;
  withAirbag: number;
  measuredAt: number | null;
  closed: boolean;
  trimmed: number;
  sizeDecimals: number;
  spareAdded: number;
  fillPrice: number | null;
  /** The mark when the line was crossed. */
  triggerMark: number;
  fee: number | null;
  oldLiquidation: number;
  lineToFillMs: number | null;
  lineToFillBlocks: number | null;
  hitAfterMs: number | null;
  tx: string | null;
  explorerUrl: string;
  simulated: boolean;
}
