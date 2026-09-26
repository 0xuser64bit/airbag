// Simulation mode (ADR 0012): the real engine, guard and API against a paper exchange and a
// scripted price feed. Used for development, CI and demos without funds. Everything it shows
// is labelled as simulated; no transaction hashes are invented.

import type { Context, Market, MarketFeed, PerplPosition } from '@airbag/perpl';
import { PaperExchange } from './exchange.ts';

const market = (
  id: number,
  symbol: string,
  pd: number,
  sd: number,
  maintenance: number,
  initial: number,
  mark: number,
): Market => ({
  id,
  perpetual_id: id,
  symbol,
  name: `${symbol} Perp`,
  order_ttl_blocks: 20,
  funding_interval_blocks: 8571,
  funding_interval_sec: 2580,
  order_max_market_slippage_bps: 1000,
  config: {
    price_decimals: pd,
    size_decimals: sd,
    initial_margin: initial,
    maintenance_margin: maintenance,
    funding_sum_scaling_exp: 0,
    is_open: true,
    taker_fee: 0,
  },
  state: { at: { b: 0 }, orl: mark, mrk: mark, lst: mark, bid: mark, ask: mark },
  funding: { at: { b: 0 }, feb: 0, rate: 0, sum: 0, div: 1 },
});

/** Perpl testnet's BTC and ETH terms: 4% and 5% maintenance, 1 and 2 price decimals. */
export const SIM_CONTEXT: Context = {
  chain: { chain_id: 10143 },
  instances: [
    { id: 1, address: '0x0000000000000000000000000000000000000001', collateral_token_id: 1 },
  ],
  tokens: [{ id: 1, symbol: 'AUSD', decimals: 6 }],
  markets: [
    market(16, 'BTC', 1, 5, 2500, 1500, 994_200),
    market(32, 'ETH', 2, 3, 2000, 1200, 306_000),
  ],
};

/** The design's sample account: BTC long 1.000 at $100,000 (10x), ETH long 2.000 at $3,000. */
export function samplePositions(accountId: number): PerplPosition[] {
  const base = { at: { b: 0 }, acc: accountId, st: 1, sd: 1 as const, efs: 0 };
  return [
    { ...base, mkt: 16, pid: 1, c: '10000000000', ep: 1_000_000, s: 100_000, lv: 1000 },
    { ...base, mkt: 32, pid: 2, c: '1200000000', ep: 300_000, s: 2_000, lv: 500 },
  ];
}

export const SAMPLE_SPARE_CNS = 420_000_000n;

/** The landing page's crash test: the trigger fires at index 14, the fill lands at 15. */
export const LANDING_PATH = [
  100000, 99900, 99960, 99700, 99420, 99500, 99100, 98800, 98900, 98400, 98100, 98200, 97700, 97300,
  97000, 97000, 96400, 95900, 95300, 94800, 94400, 94000, 94500, 95200, 95900, 96600, 97200, 97700,
  98200, 98600, 98900, 99200, 99100, 99400, 99600, 99500, 99800, 99900, 100000, 100000, 100000,
];

/** A block clock and scripted marks for the simulated markets. */
export class SimChain {
  head = 1_000_000;
  readonly feed: MarketFeed;
  private readonly markets: Map<number, Market>;
  private timer: ReturnType<typeof setInterval> | undefined;
  private script: { marketId: number; prices: number[]; i: number } | undefined;

  constructor(feed: MarketFeed, markets: Market[]) {
    this.feed = feed;
    this.markets = new Map(markets.map((m) => [m.id, m]));
  }

  paper(wallet: string, accountId: number): PaperExchange {
    return new PaperExchange({
      wallet,
      accountId,
      balanceCns: SAMPLE_SPARE_CNS,
      positions: samplePositions(accountId),
      markets: this.markets,
      collateralDecimals: 6,
      markOf: (id) => this.feed.mark(id),
    });
  }

  /** Sets a market's mark, in dollars. It lands with the next block. */
  setPrice(marketId: number, price: number): void {
    const m = this.markets.get(marketId);
    if (!m) throw new Error(`no simulated market ${marketId}`);
    const mrk = Math.round(price * 10 ** m.config.price_decimals);
    this.feed.apply({
      mt: 9,
      d: { [marketId]: { at: { b: this.head }, orl: mrk, mrk, lst: mrk, bid: mrk, ask: mrk } },
    });
  }

  /** Plays one price per block, like the landing page's replay. */
  play(marketId: number, prices: number[]): void {
    this.script = { marketId, prices, i: 0 };
  }

  /** One block: the next scripted price (if any), then the heartbeat that drives the tick. */
  step(): number {
    this.head += 1;
    const s = this.script;
    if (s) {
      const p = s.prices[s.i++];
      if (p !== undefined) this.setPrice(s.marketId, p);
      if (s.i >= s.prices.length) this.script = undefined;
    }
    this.feed.apply({ mt: 100, sn: this.head, h: this.head });
    return this.head;
  }

  start(blockMs = 300): void {
    this.timer ??= setInterval(() => this.step(), blockMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
