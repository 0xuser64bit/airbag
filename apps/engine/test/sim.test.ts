import { MarketFeed } from '@airbag/perpl';
import { afterEach, expect, it, vi } from 'vitest';
import { LANDING_PATH, SIM_CONTEXT, SimChain, wickPath } from '../src/sim.ts';

const BTC = 16;

function chain() {
  const heads: number[] = [];
  const feed = new MarketFeed({
    url: 'wss://unused',
    chainId: 10143,
    markets: SIM_CONTEXT.markets,
    staleBlocks: 3,
    onBlock: (h) => heads.push(h),
  });
  return { sim: new SimChain(feed, SIM_CONTEXT.markets), heads };
}

afterEach(() => vi.useRealTimers());

it("plays a wallet's path one price per block from the next block, then holds the last", () => {
  const { sim } = chain();
  const mine = sim.feedFor('0xa');
  const theirs = sim.feedFor('0xb');
  sim.step();
  sim.play('0xa', BTC, [99_000, 98_000, 97_000]);
  expect(mine.mark(BTC)).toBe(994_200);
  sim.step();
  expect(mine.mark(BTC)).toBe(990_000);
  sim.step();
  expect(mine.mark(BTC)).toBe(980_000);
  sim.step();
  sim.step();
  expect(mine.mark(BTC)).toBe(970_000);
  expect(theirs.mark(BTC)).toBe(994_200);
  // A price set by hand replaces the path; a reset goes back to the shared price.
  sim.setPrice(BTC, 99_000, '0xa');
  expect(mine.mark(BTC)).toBe(990_000);
  sim.reset('0xa');
  expect(mine.mark(BTC)).toBe(994_200);
});

it('gives every new paper account its own position ids', () => {
  const { sim } = chain();
  const a = [...sim.paper('0xa', 1).positions.values()].map((p) => p.pid);
  const again = [...sim.paper('0xa', 1).positions.values()].map((p) => p.pid);
  expect(new Set([...a, ...again]).size).toBe(4);
});

it("follows Monad's heartbeat and fills in with the local clock only while it is quiet", () => {
  vi.useFakeTimers();
  const { sim, heads } = chain();
  sim.start(300, true);
  // It gives the first heartbeat up to 3 s before stepping in.
  vi.advanceTimersByTime(2_900);
  expect(heads).toEqual([]);
  sim.onMonadHead(67_000_000);
  vi.advanceTimersByTime(900);
  sim.onMonadHead(67_000_003);
  vi.advanceTimersByTime(900);
  expect(heads).toEqual([67_000_000, 67_000_003]);
  expect(sim.onchain).toBe(true);
  // A second without a heartbeat: the local clock continues from Monad's last head.
  vi.advanceTimersByTime(1_500);
  expect(heads.slice(2, 4)).toEqual([67_000_004, 67_000_005]);
  expect(sim.onchain).toBe(false);
  // Monad comes back ahead of the local clock and drives again.
  sim.onMonadHead(67_000_020);
  const n = heads.length;
  vi.advanceTimersByTime(600);
  expect(heads.slice(n - 1)).toEqual([67_000_020]);
  expect(sim.onchain).toBe(true);
  sim.stop();
});

it('runs on its own clock, 300 ms a block, when not following Monad', () => {
  vi.useFakeTimers();
  const { sim, heads } = chain();
  sim.start();
  vi.advanceTimersByTime(900);
  expect(heads).toEqual([1_000_001, 1_000_002, 1_000_003]);
  expect(sim.onchain).toBe(false);
  sim.stop();
});

it("shapes the landing's wick to a position: through its line, to its liquidation price, back", () => {
  // The BTC sample keeps the landing's numbers: the line held at index 14 and 15, the
  // liquidation price at 21, back to the entry.
  const btc = wickPath(
    { side: 'long', mark: 99_420, reference: 100_000, line: 97_000, liquidation: 94_000 },
    1,
  );
  expect(btc.prices).toHaveLength(LANDING_PATH.length);
  expect([btc.prices[14], btc.prices[15], btc.prices[21], btc.prices.at(-1)]).toEqual([
    97_000, 97_000, 94_000, 100_000,
  ]);
  expect(btc.prices.slice(0, 14).every((p) => p > 97_000)).toBe(true);
  expect(Math.min(...btc.prices)).toBe(94_000);
  // Levels off the tick round past themselves, so the trigger and the save can't be missed.
  const rearmed = wickPath(
    { side: 'long', mark: 100_000, reference: 97_000, line: 92_150.37, liquidation: 87_300.37 },
    1,
  );
  expect([rearmed.line, rearmed.low]).toEqual([92_150.3, 87_300.3]);
  expect(rearmed.prices.at(-1)).toBe(100_000);
  // A short mirrors it, upwards.
  const short = wickPath(
    { side: 'short', mark: 100, reference: 100, line: 103.333, liquidation: 106.666 },
    2,
  );
  expect([short.line, short.low, Math.max(...short.prices)]).toEqual([103.34, 106.67, 106.67]);
  expect(short.prices.slice(0, 14).every((p) => p < 103.34)).toBe(true);
});
