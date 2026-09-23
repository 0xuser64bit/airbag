// Subset of Perpl's API types that Airbag reads.
// https://github.com/PerplFoundation/api-docs/blob/main/types.md

export interface BlockTimestamp {
  b?: number;
  t?: number;
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
  orl: number;
  mrk: number;
  lst: number;
  bid: number;
  ask: number;
}

export interface FundingEvent {
  at: BlockTimestamp;
  feb: number;
  rate: number;
  sum: number;
  div: number;
}

export interface Market {
  id: number;
  /** The exchange contract's perpId for this market. */
  perpetual_id: number;
  symbol: string;
  name: string;
  order_ttl_blocks: number;
  funding_interval_blocks: number;
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

/** Perpl position as sent on the trading WS (mt:26/27). Scaled integers. */
export interface PerplPosition {
  at: BlockTimestamp;
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

export interface Order {
  at: BlockTimestamp & { txid?: string };
  rq: number;
  mkt: number;
  acc: number;
  oid: number;
  /** 2 Open, 3 PartiallyFilled, 4 Filled, 5 Canceled, 6 Expired, 7 Failed. */
  st: number;
  sr: number;
  fr?: number;
  t: number;
  fp: number;
  fs: number;
  os: number;
  f: string;
  r?: boolean;
}

export interface Fill {
  at: BlockTimestamp & { txid?: string };
  mkt: number;
  acc: number;
  oid: number;
  t: number;
  p?: number;
  s: number;
  f: string;
}

/** Every message has a type; the rest depends on it. */
export type Message = { mt: number; sn?: number; cid?: number } & Record<string, unknown>;

export const MT = {
  Ping: 1,
  Status: 3,
  Subscribe: 5,
  Subscribed: 6,
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
