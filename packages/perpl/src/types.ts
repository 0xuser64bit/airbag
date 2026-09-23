// Subset of Perpl's API types that Airbag reads. Field comments follow the docs.
// https://github.com/PerplFoundation/api-docs/blob/main/types.md

export interface BlockTimestamp {
  b?: number;
  t?: number;
}

export interface TxTimestamp extends BlockTimestamp {
  txid?: string;
}

export interface MarketConfig {
  price_decimals: number;
  size_decimals: number;
  /** Leverage in hundredths: 1500 = 15x max = 6.67% initial margin. */
  initial_margin: number;
  /** Leverage in hundredths: 2500 = 25x = 4% maintenance margin. */
  maintenance_margin: number;
  funding_sum_scaling_exp: number;
  is_open: boolean;
}

export interface MarketState {
  at: BlockTimestamp;
  /** Oracle price, scaled. */
  orl: number;
  /** Mark price, scaled. Liquidation is triggered on it. */
  mrk: number;
  lst: number;
  bid: number;
  ask: number;
}

export interface FundingEvent {
  /** The block the rate applies at; can run ahead of the head for the newest event. */
  at: BlockTimestamp;
  /** Funding event block: identifies the interval. */
  feb: number;
  rate: number;
  /** Cumulative funding sum, price-scaled, divided by `div`. */
  sum: number;
  div: number;
}

export interface Market {
  id: number;
  /** The exchange contract's perpId for this market. */
  perpetual_id: number;
  /** Empty on some mainnet markets; fall back to `name`. */
  symbol: string;
  name: string;
  order_ttl_blocks: number;
  funding_interval_blocks: number;
  funding_interval_sec: number;
  order_max_market_slippage_bps: number;
  config: MarketConfig;
  state: MarketState;
  funding: FundingEvent;
}

export interface Context {
  chain: { chain_id: number; block_explorer_urls?: string[] };
  instances: { id: number; address: string; collateral_token_id: number }[];
  tokens: { id?: number; address?: string; symbol: string; decimals: number }[];
  markets: Market[];
}

export interface Account {
  id: number;
  /** Frozen. */
  fr: boolean;
  /** Order forwarding ("One-Click Trading"). Orders fail with sr:34 while false. */
  fw: boolean;
  /** Last forwarded request id: seed for rq. */
  lfr: number;
  /** Balance, CNS. */
  b: string;
  /** Locked balance, CNS. */
  lb: string;
}

/** WalletSnapshot (mt:19). Its `sn` seeds heartbeat sequence tracking. */
export interface Wallet {
  addr: string;
  as?: Account[];
}

export const PositionStatus = { Open: 1, Closed: 2, Liquidated: 3 } as const;

/** Perpl position as sent on the trading WS (mt:26/27). Scaled integers. */
export interface PerplPosition {
  at: TxTimestamp;
  mkt: number;
  acc: number;
  pid: number;
  /** 1 Open, 2 Closed, 3 Liquidated, 4 Deleveraged, 5 Unwound, 6 Failed. */
  st: number;
  /** 1 long, 2 short. */
  sd: 1 | 2;
  /** Collateral (deposit), CNS. */
  c: string;
  ep: number;
  epr?: number;
  s: number;
  /** Entry funding sum. */
  efs: number;
  lv: number;
}

export const OrderStatus = {
  Open: 2,
  PartiallyFilled: 3,
  Filled: 4,
  Canceled: 5,
  Expired: 6,
  Failed: 7,
  Executed: 10,
} as const;

export interface Order {
  at: TxTimestamp;
  rq: number;
  mkt: number;
  acc: number;
  oid: number;
  /** See OrderStatus. */
  st: number;
  /** OrderStatusReason, e.g. 34 = order forwarding not allowed. */
  sr: number;
  /** OrderFailureReason on post/settlement failures. */
  fr?: number;
  t: number;
  /** Fill price, weighted average, scaled. */
  fp: number;
  /** Filled size, lots. */
  fs: number;
  /** Original size, lots. */
  os: number;
  /** Fee paid, CNS. */
  f: string;
  /** Remove from open orders. */
  r?: boolean;
}

export interface Fill {
  at: TxTimestamp;
  mkt: number;
  acc: number;
  oid: number;
  t: number;
  p?: number;
  s: number;
  f: string;
}

/** mt:3: gateway admission for one mt:22 frame. `code: 0` means accepted, not filled. */
export interface StatusResponse {
  mt: 3;
  cid?: number;
  status: { code: number; error?: string };
}

/** Every message has a type; the rest depends on it. */
export type Message = { mt: number; sn?: number; cid?: number } & Record<string, unknown>;

export const MT = {
  Ping: 1,
  Pong: 2,
  Status: 3,
  Subscribe: 5,
  Subscribed: 6,
  MarketConfig: 8,
  MarketState: 9,
  Funding: 10,
  WalletSnapshot: 19,
  AccountUpdate: 21,
  OrderRequest: 22,
  OrdersSnapshot: 23,
  OrdersUpdate: 24,
  Fills: 25,
  PositionsSnapshot: 26,
  PositionsUpdate: 27,
  SignIn: 29,
  Heartbeat: 100,
} as const;
