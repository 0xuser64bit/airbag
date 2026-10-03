// Simulation mode (ADR 0012): the real engine, guard and API against a paper exchange and a
// scripted price feed. Used for development, CI and demos without funds. Everything it shows
// is labelled as simulated; no transaction hashes are invented.
//
// Blocks are shared; prices are per wallet. Each wallet sees the shared marks until it sets or
// plays its own, so one visitor's wick or reset never moves another visitor's positions.

import type { Context, Market, MarketFeed, PerplPosition } from '@airbag/perpl';
import { PaperExchange } from './exchange.ts';
import type { Feed } from './guard.ts';

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

/**
 * Perpl testnet's BTC, ETH and MON terms: 4%, 5% and 20% maintenance (MON trades at up to 3x
 * there), 1, 2 and 5 price decimals.
 */
export const SIM_CONTEXT: Context = {
  chain: { chain_id: 10143 },
  instances: [
    { id: 1, address: '0x0000000000000000000000000000000000000001', collateral_token_id: 1 },
  ],
  tokens: [{ id: 1, symbol: 'AUSD', decimals: 6 }],
  markets: [
    market(16, 'BTC', 1, 5, 2500, 1500, 994_200),
    market(32, 'ETH', 2, 3, 2000, 1200, 306_000),
    market(64, 'MON', 5, 0, 500, 300, 3_366),
  ],
};

/**
 * The design's sample account: BTC long 1.000 at $100,000 (10x), ETH long 2.000 at $3,000, and
 * a short on Monad's own token, 500,000 MON at $0.034 (about 3x): one trim, one spare-margin
 * add and one trim on a short, between them.
 */
export function samplePositions(accountId: number): PerplPosition[] {
  const base = { at: { b: 0 }, acc: accountId, st: 1, sd: 1 as const, efs: 0 };
  return [
    { ...base, mkt: 16, pid: 1, c: '10000000000', ep: 1_000_000, s: 100_000, lv: 1000 },
    { ...base, mkt: 32, pid: 2, c: '1200000000', ep: 300_000, s: 2_000, lv: 500 },
    { ...base, mkt: 64, pid: 3, sd: 2, c: '6000000000', ep: 3_400, s: 500_000, lv: 283 },
  ];
}

export const SAMPLE_SPARE_CNS = 420_000_000n;

/** The landing page's crash test: the trigger fires at index 14, the fill lands at 15. */
export const LANDING_PATH = [
  100000, 99900, 99960, 99700, 99420, 99500, 99100, 98800, 98900, 98400, 98100, 98200, 97700, 97300,
  97000, 97000, 96400, 95900, 95300, 94800, 94400, 94000, 94500, 95200, 95900, 96600, 97200, 97700,
  98200, 98600, 98900, 99200, 99100, 99400, 99600, 99500, 99800, 99900, 100000, 100000, 100000,
];
// Its levels: the entry it starts and ends at, the Airbag line, the liquidation price.
const [TOP, LINE, BOTTOM] = [100_000, 97_000, 94_000];
const BOTTOM_AT = LANDING_PATH.indexOf(BOTTOM);

/**
 * The landing's crash test, reshaped for one position: from its mark down through its Airbag
 * line (held two blocks, for the trigger and the fill, as at $97,000) to its liquidation price,
 * then back to the mark or the reference, whichever is further from liquidation. The BTC sample
 * gets the landing's own numbers; ETH, and a position re-armed after a deploy, get a wick that
 * reaches their own line instead of stopping short of it. The line and the liquidation price
 * are rounded past themselves to the market's tick, so a rounding can't miss them: reaching the
 * old liquidation price is what makes a deploy a save.
 */
export function wickPath(
  p: { side: 'long' | 'short'; mark: number; reference: number; line: number; liquidation: number },
  priceDecimals: number,
): { prices: number[]; line: number; low: number } {
  const k = 10 ** priceDecimals;
  const past = (v: number) => (p.side === 'long' ? Math.floor(v * k) : Math.ceil(v * k)) / k;
  const line = past(p.line);
  const low = past(p.liquidation);
  const dir = p.side === 'long' ? 1 : -1;
  const back = dir * p.mark >= dir * p.reference ? p.mark : p.reference;
  const prices = LANDING_PATH.map((v, i) => {
    if (i > BOTTOM_AT) return low + ((v - BOTTOM) / (TOP - BOTTOM)) * (back - low);
    if (v === LINE) return line;
    if (v === BOTTOM) return low;
    if (v > LINE) return p.mark - ((TOP - v) / (TOP - LINE)) * (p.mark - line);
    return line - ((LINE - v) / (LINE - BOTTOM)) * (line - low);
  });
  return { prices, line, low };
}

interface WalletPrices {
  /** Scaled marks this wallet has set; other markets follow the shared feed. */
  marks: Map<number, number>;
  /** A scripted path: one scaled price per block from `start`, the last one holding. */
  script?: { marketId: number; prices: number[]; start: number };
}

/**
 * The simulated markets' prices and their block clock. The clock is either local or Monad's
 * own: Perpl's public heartbeat, the same blocks the live engine checks. Following Monad, the
 * local clock steps in only while that heartbeat is quiet, continuing from its last head.
 */
export class SimChain {
  readonly feed: MarketFeed;
  private readonly markets: Map<number, Market>;
  private readonly wallets = new Map<string, WalletPrices>();
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Where the local clock starts when it has never seen a Monad head. */
  private readonly origin = 1_000_000;
  private lastLocal = 0;
  /** When Monad's heartbeat last arrived (or until when to wait for the first one). */
  private monadAt = 0;
  /**
   * Position ids for new paper accounts. Never reused, even across restarts, so a reset or a
   * restart can't hand an old deploy the new account's position as if it were the same one.
   */
  private lastPid = Date.now() * 1_000;

  constructor(feed: MarketFeed, markets: Market[]) {
    this.feed = feed;
    this.markets = new Map(markets.map((m) => [m.id, m]));
  }

  /** The newest head, whichever clock made it. */
  get head(): number {
    return Math.max(this.feed.head, this.origin);
  }

  /** True when the newest head is a real Monad block rather than one the local clock made. */
  get onchain(): boolean {
    return this.feed.head > 0 && this.feed.head !== this.lastLocal;
  }

  private prices(wallet: string): WalletPrices {
    const p = this.wallets.get(wallet) ?? { marks: new Map<number, number>() };
    this.wallets.set(wallet, p);
    return p;
  }

  private scaled(marketId: number, price: number): number {
    const m = this.markets.get(marketId);
    if (!m) throw new Error(`no simulated market ${marketId}`);
    return Math.round(price * 10 ** m.config.price_decimals);
  }

  /** The market as one wallet sees it: the shared feed, with that wallet's own prices. */
  feedFor(wallet: string): Feed {
    const { feed } = this;
    const own = this.prices(wallet);
    return {
      get head() {
        return feed.head;
      },
      configs: feed.configs,
      fundingAt: (id, block) => feed.fundingAt(id, block),
      staleness: (now) => feed.staleness(now),
      mark: (id) => {
        const s = own.script;
        if (s?.marketId === id && feed.head >= s.start)
          return s.prices[Math.min(feed.head - s.start, s.prices.length - 1)];
        return own.marks.get(id) ?? feed.mark(id);
      },
    };
  }

  paper(wallet: string, accountId: number): PaperExchange {
    const view = this.feedFor(wallet);
    return new PaperExchange({
      wallet,
      accountId,
      balanceCns: SAMPLE_SPARE_CNS,
      positions: samplePositions(accountId).map((p) => ({ ...p, pid: ++this.lastPid })),
      markets: this.markets,
      collateralDecimals: 6,
      markOf: (id) => view.mark(id),
    });
  }

  /** Sets a market's mark in dollars, for one wallet or (without one) the shared feed. */
  setPrice(marketId: number, price: number, wallet?: string): void {
    const mrk = this.scaled(marketId, price);
    if (wallet !== undefined) {
      const p = this.prices(wallet);
      p.marks.set(marketId, mrk);
      if (p.script?.marketId === marketId) delete p.script;
      return;
    }
    this.feed.apply({
      mt: 9,
      d: { [marketId]: { at: { b: this.head }, orl: mrk, mrk, lst: mrk, bid: mrk, ask: mrk } },
    });
  }

  /** Plays one price per block for one wallet from the next block, like the landing's replay. */
  play(wallet: string, marketId: number, prices: number[]): void {
    const path = prices.map((p) => this.scaled(marketId, p));
    this.prices(wallet).script = { marketId, prices: path, start: this.head + 1 };
  }

  /** Back to the shared prices, with no script playing. */
  reset(wallet: string): void {
    const p = this.prices(wallet);
    p.marks.clear();
    delete p.script;
  }

  /** One local block after the newest head: the heartbeat that drives the engine's tick. */
  step(): number {
    const h = this.head + 1;
    this.lastLocal = h;
    this.feed.apply({ mt: 100, sn: h, h });
    return h;
  }

  /** A head from Monad's heartbeat. One older than the head shown only keeps the local clock out. */
  onMonadHead(h: number): void {
    this.monadAt = Date.now();
    if (h > this.feed.head) this.feed.apply({ mt: 100, sn: h, h });
  }

  /**
   * Runs the local clock. Following Monad, it waits up to 3 s for the first heartbeat and then
   * steps only while the heartbeat has been quiet for a second.
   */
  start(blockMs = 300, followMonad = false): void {
    if (followMonad) this.monadAt = Date.now() + 2_000;
    this.timer ??= setInterval(() => {
      if (Date.now() - this.monadAt >= 1_000) this.step();
    }, blockMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
