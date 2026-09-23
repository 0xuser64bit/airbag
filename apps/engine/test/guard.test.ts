import { MarketFeed } from '@airbag/perpl';
import { liquidationPrice } from '@airbag/risk';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Deploy, openStore, type Settings } from '../src/db.ts';
import { Engine } from '../src/engine.ts';
import { PaperExchange } from '../src/exchange.ts';
import { createLogger } from '../src/log.ts';
import {
  LANDING_PATH,
  SAMPLE_SPARE_CNS,
  SIM_CONTEXT,
  SimChain,
  samplePositions,
} from '../src/sim.ts';

const WALLET = '0x7a3f00000000000000000000000000000000c21e';
const BTC = 16;
const ETH = 32;

interface Options {
  settings?: Partial<Settings>;
  spareCns?: bigint;
  fillShare?: (lots: number, attempt: number) => number;
  markets?: number[];
  short?: boolean;
}

function harness(opts: Options = {}) {
  const store = openStore(':memory:');
  const deployed: Deploy[] = [];
  const saved: Deploy[] = [];
  const alerts: string[] = [];
  let engine: Engine | undefined;
  const feed = new MarketFeed({
    url: 'wss://unused',
    chainId: 10143,
    markets: SIM_CONTEXT.markets,
    staleBlocks: 3,
    onBlock: (h) => engine?.tick(h),
  });
  engine = new Engine({
    store,
    log: createLogger('error', {}, () => {}),
    markets: {
      byId: new Map(SIM_CONTEXT.markets.map((m) => [m.id, m])),
      covered: new Set(opts.markets ?? [BTC, ETH]),
      collateralDecimals: 6,
      userShare: 0.8,
    },
    feed,
    notify: {
      deployed: (d) => deployed.push(structuredClone(d)),
      saved: (d) => saved.push(structuredClone(d)),
      alert: (_w, text) => alerts.push(text),
    },
    slippageBps: 50,
    maxAttempts: 3,
    demoMove: 0.003,
    pollMs: 1,
    settleMs: 5,
  });
  const chain = new SimChain(feed, SIM_CONTEXT.markets);
  store.putSettings(WALLET, { ...DEFAULT_SETTINGS, armed: true, ...opts.settings });
  let attempt = 0;
  const positions = samplePositions(4127).map((p) => (opts.short ? { ...p, sd: 2 as const } : p));
  const paper = new PaperExchange({
    wallet: WALLET,
    accountId: 4127,
    balanceCns: opts.spareCns ?? SAMPLE_SPARE_CNS,
    positions,
    markets: new Map(SIM_CONTEXT.markets.map((m) => [m.id, m])),
    collateralDecimals: 6,
    markOf: (id) => feed.mark(id),
    ...(opts.fillShare
      ? {
          fillShare: (f: { s: number; t: number }) =>
            f.t === 6 ? 1 : (opts.fillShare?.(f.s, ++attempt) ?? 1),
        }
      : {}),
  });
  const guard = engine.add(WALLET, paper);
  chain.setPrice(BTC, 99_420);
  chain.setPrice(ETH, 3_060);
  /** Steps one block per price and lets the guard's async work settle between blocks. */
  const run = async (prices: number[], market = BTC) => {
    for (const p of prices) {
      chain.setPrice(market, p);
      chain.step();
      await flush();
    }
  };
  const blocks = async (n: number) => {
    for (let i = 0; i < n; i++) {
      chain.step();
      await flush();
    }
  };
  return { store, engine, feed, chain, paper, guard, deployed, saved, alerts, run, blocks };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 2));
};

const only = (store: ReturnType<typeof openStore>) => {
  const ds = store.deploys(WALLET);
  expect(ds).toHaveLength(1);
  return ds[0] as Deploy;
};

describe('the landing-page crash test, through the real engine', () => {
  it('fires at block 14, fills at 15, re-adds, re-arms at $92,150 and becomes a save', async () => {
    const h = harness();
    const start = h.chain.head;
    await h.run(LANDING_PATH);

    const d = only(h.store);
    const index = (block: number) => block - start - 1;
    expect(index(d.data.trigger.block)).toBe(14);
    expect(d.data.trigger.mark).toBe(97_000);
    expect(d.kind).toBe('trim');
    expect(d.phase).toBe('done');

    // Close 0.48906 BTC (the trim rounded up to a lot), worst price $96,515, then re-add.
    const [close, readd, ...rest] = h.paper.sent;
    expect(close).toMatchObject({ t: 3, s: 48_906, p: 965_150, fl: 4 });
    expect(readd).toMatchObject({ t: 6 });
    expect(rest).toHaveLength(0);
    const fillEntry = d.data.timeline.find((e) => e.text.startsWith('Filled'));
    expect(index(fillEntry?.block ?? 0)).toBe(15);
    expect(d.data.close?.fillPrice).toBe(97_000);
    expect(Math.round(d.data.close?.realizedPnl ?? 0)).toBe(-1_467);

    // The position after: liquidation ~$87,300, 10% from $97,000, line re-armed at ~$92,150.
    expect(d.data.after?.size).toBeCloseTo(0.51094, 5);
    expect(d.data.after?.liquidation).toBeGreaterThan(87_290);
    expect(d.data.after?.liquidation).toBeLessThan(87_310);
    expect(d.data.after?.distance).toBeGreaterThanOrEqual(0.0999);
    expect(Math.round(d.data.after?.line ?? 0)).toBeGreaterThanOrEqual(92_145);
    expect(Math.round(d.data.after?.line ?? 0)).toBeLessThanOrEqual(92_155);
    expect(d.data.before.liquidation).toBe(94_000);
    expect(d.data.counterfactual).toBeCloseTo(3_200, 6);

    // $94,000 arrives at index 21: the old liquidation price, with the position still open.
    expect(d.outcome).toBe('save');
    expect(index(d.data.save?.block ?? 0)).toBe(21);
    expect(h.saved).toHaveLength(1);
    expect(h.deployed).toHaveLength(1);
    // Back at $100,000: $8,533 kept in the position against the $3,200 a liquidation returns.
    expect(Math.round(h.guard.views.find((v) => v.marketId === BTC)?.equity ?? 0)).toBe(8_533);

    // The ETH position never came close to its line.
    expect(h.paper.positions.get(ETH)?.s).toBe(2_000);
  });

  it('only ever sends closes and collateral increases', async () => {
    const h = harness();
    await h.run(LANDING_PATH);
    expect(new Set(h.paper.sent.map((f) => f.t))).toEqual(new Set([3, 6]));
  });
});

describe('deploy paths', () => {
  it('adds spare margin instead of trimming when it alone reaches the target', async () => {
    const h = harness({ spareCns: 10_000_000_000n });
    await h.run([99_000, 98_000, 97_000, 97_000, 97_000]);
    const d = only(h.store);
    expect(d.kind).toBe('margin');
    expect(h.paper.sent.map((f) => f.t)).toEqual([6]);
    expect(d.data.spareAdded).toBeCloseTo(6_700, 0);
    expect(d.data.after?.liquidation).toBeCloseTo(87_300, -1);
    expect(h.paper.positions.get(BTC)?.s).toBe(100_000);
  });

  it('retries the rest of a partial fill next block', async () => {
    const h = harness({ fillShare: (_lots, attempt) => (attempt === 1 ? 0.5 : 1) });
    await h.run([98_000, 97_000, 97_000, 97_000, 97_000, 97_000, 97_000]);
    const d = only(h.store);
    expect(d.data.attempts).toBe(2);
    expect(h.paper.sent.map((f) => f.t)).toEqual([3, 6, 3, 6]);
    expect(d.data.after?.distance).toBeGreaterThanOrEqual(0.0999);
    expect(d.data.timeline.some((e) => e.text.startsWith('Only part of the trim filled'))).toBe(
      true,
    );
  });

  it('retries a close that gapped past its worst price, at the new mark', async () => {
    const h = harness();
    // Trigger at $97,000; the next block is $96,000, below the $96,515 limit.
    await h.run([98_000, 97_000, 96_000, 96_000, 96_000, 96_000, 96_000]);
    const d = only(h.store);
    expect(d.data.attempts).toBe(2);
    const closes = h.paper.sent.filter((f) => f.t === 3);
    expect(closes.map((f) => ('p' in f ? f.p : 0))).toEqual([965_150, 955_200]);
    expect(d.data.timeline.some((e) => e.text.startsWith("The close didn't fill"))).toBe(true);
    expect(d.phase).toBe('done');
  });

  it('stops after the attempt cap, alerts, and cools down', async () => {
    const h = harness({ fillShare: () => 0 });
    await h.run([98_000, 97_000, 97_000, 97_000, 97_000, 97_000, 97_000, 97_000, 97_000]);
    const d = only(h.store);
    expect(d.phase).toBe('failed');
    expect(d.data.attempts).toBe(3);
    expect(h.alerts.some((a) => a.includes("couldn't finish"))).toBe(true);
    // Cooling down: no new episode starts on the next blocks.
    await h.blocks(5);
    expect(h.store.deploys(WALLET)).toHaveLength(1);
  });

  it('mirrors for a short: CloseShort, line above the mark', async () => {
    const h = harness({ short: true });
    const line = h.guard.views.length; // views appear after the first block
    expect(line).toBe(0);
    await h.run([100_000, 102_000, 103_000, 103_000, 103_000]);
    const d = only(h.store);
    expect(d.side).toBe('short');
    expect(d.data.trigger.line).toBeCloseTo(103_000, 6);
    expect(h.paper.sent[0]).toMatchObject({ t: 4, p: 1_035_150 });
  });

  it('demo mode deploys after a 0.3% move', async () => {
    const h = harness({ settings: { demo: true } });
    await h.run([100_000, 99_800, 99_700, 99_700, 99_700]);
    const d = only(h.store);
    expect(d.data.trigger.line).toBeCloseTo(99_700, 6);
    expect(d.data.timeline[0]?.text).toContain('Demo mode');
  });
});

describe('what stops a deploy', () => {
  it('does nothing while paused', async () => {
    const h = harness({ settings: { armed: false } });
    await h.run([97_000, 96_000, 95_000]);
    expect(h.store.deploys(WALLET)).toHaveLength(0);
    expect(h.guard.status()).toBe('paused');
    expect(h.guard.views.find((v) => v.marketId === BTC)?.status).toBe('paused');
  });

  it('never acts on stale data', async () => {
    const h = harness();
    h.feed.monadHead = h.chain.head + 50;
    h.feed.monadHeadAt = Date.now() + 60_000;
    await h.run([97_000, 96_800]);
    expect(h.guard.status()).toBe('stale');
    expect(h.store.deploys(WALLET)).toHaveLength(0);
    h.feed.monadHead = 0;
    await h.run([96_800, 96_800, 96_800]);
    expect(h.store.deploys(WALLET)).toHaveLength(1);
  });

  it('does nothing while order forwarding is off, and says so', async () => {
    const h = harness();
    if (h.paper.account) h.paper.account.fw = false;
    await h.run([97_000, 96_000]);
    expect(h.guard.status()).toBe('forwarding-off');
    expect(h.store.deploys(WALLET)).toHaveLength(0);
  });

  it('leaves markets it does not cover alone', async () => {
    const h = harness({ markets: [ETH] });
    await h.run([97_000, 96_000, 95_000]);
    expect(h.store.deploys(WALLET)).toHaveLength(0);
    expect(h.guard.views.find((v) => v.marketId === BTC)?.status).toBe('not-covered');
  });
});

describe('after a deploy', () => {
  it('is a precaution if the position closes before the old liquidation price', async () => {
    const h = harness();
    await h.run([98_000, 97_000, 97_000, 97_000, 97_000]);
    expect(only(h.store).outcome).toBe('pending');
    h.paper.positions.delete(BTC);
    await h.blocks(1);
    expect(only(h.store).outcome).toBe('precaution');
    expect(h.saved).toHaveLength(0);
  });

  it('re-arms on the entry when the user adds to the position', async () => {
    const h = harness();
    await h.run([98_000, 97_000, 97_000, 97_000, 97_000]);
    expect(h.guard.views.find((v) => v.marketId === BTC)?.reference).toBe(97_000);
    const p = h.paper.positions.get(BTC);
    if (!p) throw new Error('missing');
    p.s += 10_000;
    await h.blocks(1);
    expect(h.guard.views.find((v) => v.marketId === BTC)?.reference).toBe(100_000);
  });
});

describe('restart in the middle of a deploy', () => {
  function interrupted(depositCns: string) {
    const h = harness();
    // State after the close filled at $97,000 but before the re-add landed.
    const p = h.paper.positions.get(BTC);
    if (!p || !h.paper.account) throw new Error('missing');
    p.s = 51_094;
    p.c = depositCns;
    h.paper.account.b = (420_000_000n + 3_423_421_000n).toString();
    const d: Deploy = {
      id: 'crash1',
      wallet: WALLET,
      accountId: 4127,
      marketId: BTC,
      symbol: 'BTC',
      side: 'long',
      kind: 'trim',
      phase: 'readding',
      outcome: 'pending',
      createdAt: 1,
      savedAt: null,
      closedAt: null,
      data: {
        trigger: { block: 1, at: 1, mark: 97_000, line: 97_000, reference: 100_000 },
        before: {
          size: 1,
          lots: 100_000,
          entry: 100_000,
          deposit: 10_000,
          funding: 0,
          maintenance: 0.04,
          liquidation: 94_000,
          distance: 0.0309,
          leverage: 13.86,
        },
        positionId: 1,
        target: 0.1,
        maxTrim: 0.5,
        spare: 420,
        plannedLiquidation: 87_300,
        capped: false,
        close: {
          lots: 48_906,
          limitPrice: 96_515,
          filledLots: 48_906,
          fillPrice: 97_000,
          realizedPnl: -1_467,
        },
        counterfactual: 3_200,
        spareAdded: 0,
        attempts: 1,
        attempt: { lots: 100_000, deposit: '10000000000', balance: '420000000' },
        timeline: [],
      },
    };
    h.store.insertDeploy(d);
    return h;
  }

  it('puts the released margin back if the re-add never landed', async () => {
    const h = interrupted('5109400000');
    await h.blocks(3);
    expect(h.paper.sent.map((f) => f.t)).toEqual([6]);
    const d = h.store.deploy('crash1');
    expect(d?.phase).toBe('done');
    expect(Number(h.paper.positions.get(BTC)?.c)).toBeGreaterThan(8_500_000_000);
    const p = h.paper.positions.get(BTC);
    if (!p) throw new Error('missing');
    expect(
      liquidationPrice({
        side: 'long',
        size: 0.51094,
        entry: 100_000,
        deposit: Number(p.c) / 1e6,
        funding: 0,
        maintenance: 0.04,
      }),
    ).toBeLessThan(87_400);
  });

  it('does not add it twice if it already landed', async () => {
    const h = interrupted('8532800000');
    await h.blocks(3);
    expect(h.paper.sent).toHaveLength(0);
    expect(h.store.deploy('crash1')?.phase).toBe('done');
  });
});
