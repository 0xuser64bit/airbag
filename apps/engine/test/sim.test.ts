import { MarketFeed } from '@airbag/perpl';
import { afterEach, expect, it, vi } from 'vitest';
import { SIM_CONTEXT, SimChain } from '../src/sim.ts';

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
