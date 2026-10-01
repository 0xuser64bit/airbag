import { afterEach, describe, expect, it } from 'vitest';
import { MarketFeed } from '../src/market.ts';
import type { Market } from '../src/types.ts';
import { fakeServer, flush } from './fake-ws.ts';

const btc = {
  id: 16,
  perpetual_id: 16,
  symbol: 'BTC',
  name: 'BTC Perp',
  order_ttl_blocks: 20,
  funding_interval_blocks: 8571,
  funding_interval_sec: 2580,
  order_max_market_slippage_bps: 1000,
  config: {
    price_decimals: 1,
    size_decimals: 5,
    initial_margin: 1500,
    maintenance_margin: 2500,
    funding_sum_scaling_exp: 0,
    is_open: true,
  },
  state: { at: { b: 90 }, orl: 994_000, mrk: 994_200, lst: 0, bid: 0, ask: 0 },
  funding: { at: { b: 200 }, feb: 200, rate: 40, sum: 134, div: 1 },
} satisfies Market;

const feed = (onBlock?: (h: number) => void) =>
  new MarketFeed({
    url: 'wss://perpl.test/ws/v1/market-data',
    chainId: 10143,
    markets: [btc],
    staleBlocks: 3,
    ...(onBlock ? { onBlock } : {}),
  });

describe('MarketFeed', () => {
  let open: MarketFeed | undefined;
  afterEach(async () => {
    await open?.close();
  });

  it('ticks on every new head and ignores old ones', () => {
    const heads: number[] = [];
    const f = feed((h) => heads.push(h));
    f.apply({ mt: 100, sn: 100, h: 100 });
    f.apply({ mt: 100, sn: 101, h: 101 });
    f.apply({ mt: 100, sn: 99, h: 99 });
    expect(heads).toEqual([100, 101]);
    expect(f.head).toBe(101);
  });

  it('keeps marks from context and market-state updates', () => {
    const f = feed();
    expect(f.mark(16)).toBe(994_200);
    f.apply({ mt: 9, d: { 16: { ...btc.state, mrk: 970_000, at: { b: 101 } } } });
    expect(f.mark(16)).toBe(970_000);
  });

  it('uses the funding event in force at a block, not one that applies later', () => {
    const f = feed();
    f.seedFunding({ 16: [{ at: { b: 100 }, feb: 100, rate: 40, sum: 100, div: 1 }] });
    expect(f.fundingAt(16, 150)?.sum).toBe(100);
    expect(f.fundingAt(16, 200)?.sum).toBe(134);
    // The same interval republished with its final timestamp replaces, not duplicates.
    f.apply({ mt: 10, d: { 16: { at: { b: 200, t: 5 }, feb: 200, rate: 40, sum: 134, div: 1 } } });
    expect(f.fundingAt(16, 250)?.at.t).toBe(5);
    expect(f.fundingAt(16, 50)).toBeUndefined();
  });

  it('applies market-config updates over the context config', () => {
    const f = feed();
    f.apply({ mt: 8, d: { 16: { maintenance_margin: 2000 } } });
    expect(f.configs.get(16)).toMatchObject({ maintenance_margin: 2000, price_decimals: 1 });
  });

  it('is stale with no data, when the feed goes silent, or when it trails Monad', () => {
    const f = feed();
    expect(f.staleness(0)).toMatchObject({ stale: true, reason: 'no-data' });
    f.apply({ mt: 100, h: 1_000 }, 10_000);
    expect(f.staleness(10_100).stale).toBe(false);
    expect(f.staleness(11_700)).toMatchObject({ stale: true, reason: 'feed-silent' });
    f.monadHead = 1_004;
    f.monadHeadAt = 10_050;
    expect(f.staleness(10_100)).toMatchObject({
      stale: true,
      reason: 'behind-chain',
      lagBlocks: 4,
    });
    f.monadHead = 1_003;
    expect(f.staleness(10_100)).toMatchObject({ stale: false, lagBlocks: 3 });
  });

  it('needs funding only for the markets it protects, so a new listing cannot stall them', () => {
    const listed = { ...btc, id: 99, funding: undefined as unknown as Market['funding'] };
    const make = (requireFundingFor: number[]) =>
      new MarketFeed({
        url: 'wss://perpl.test/ws/v1/market-data',
        chainId: 10143,
        markets: [btc, listed],
        staleBlocks: 3,
        requireFundingFor,
      });
    const covered = make([16]);
    covered.apply({ mt: 100, h: 1_000 }, 10_000);
    expect(covered.staleness(10_100).stale).toBe(false);
    const both = make([16, 99]);
    both.apply({ mt: 100, h: 1_000 }, 10_000);
    expect(both.staleness(10_100)).toMatchObject({ stale: true, reason: 'no-funding' });
  });

  it('subscribes to heartbeat, market-state, funding and market-config in one frame', async () => {
    const server = fakeServer();
    open = new MarketFeed({
      url: 'wss://perpl.test/ws/v1/market-data',
      chainId: 10143,
      markets: [btc],
      staleBlocks: 3,
      WebSocket: server.WebSocket,
    });
    open.start();
    await flush();
    expect(server.last.sent).toEqual([
      {
        mt: 5,
        subs: [
          { stream: 'heartbeat@10143', subscribe: true },
          { stream: 'market-state@10143', subscribe: true },
          { stream: 'funding@10143', subscribe: true },
          { stream: 'market-config@10143', subscribe: true },
        ],
      },
    ]);
    server.last.push({ mt: 100, sn: 7, h: 7 });
    expect(open.head).toBe(7);
  });

  it('can follow the heartbeat alone (the simulation clock)', async () => {
    const server = fakeServer();
    open = new MarketFeed({
      url: 'wss://perpl.test/ws/v1/market-data',
      chainId: 10143,
      markets: [],
      staleBlocks: 3,
      streams: ['heartbeat'],
      WebSocket: server.WebSocket,
    });
    open.start();
    await flush();
    expect(server.last.sent).toEqual([
      { mt: 5, subs: [{ stream: 'heartbeat@10143', subscribe: true }] },
    ]);
  });
});
