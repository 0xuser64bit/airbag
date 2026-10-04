import { MarketFeed } from '@airbag/perpl';
import { liquidationPrice } from '@airbag/risk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Deploy, openStore, type Settings } from '../src/db.ts';
import { Engine } from '../src/engine.ts';
import { PaperExchange } from '../src/exchange.ts';
import { createLogger } from '../src/log.ts';
import { deployMessage, liquidationMessage } from '../src/notify.ts';
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
const MON = 64;

interface Options {
  settings?: Partial<Settings>;
  spareCns?: bigint;
  fillShare?: (lots: number, attempt: number) => number;
  /** The first n margin adds fail. */
  failAdds?: number;
  markets?: number[];
  short?: boolean;
  feeMicros?: number;
  fillSlippageBps?: number;
}

function harness(opts: Options = {}) {
  const store = openStore(':memory:');
  const deployed: Deploy[] = [];
  const saved: Deploy[] = [];
  const alerts: string[] = [];
  const liquidated: unknown[] = [];
  let engine: Engine | undefined;
  const marketDefinitions = SIM_CONTEXT.markets.map((m) => ({
    ...m,
    config: { ...m.config, taker_fee: opts.feeMicros ?? 0 },
  }));
  const feed = new MarketFeed({
    url: 'wss://unused',
    chainId: 10143,
    markets: marketDefinitions,
    staleBlocks: 3,
    onBlock: (h) => engine?.tick(h),
  });
  engine = new Engine({
    store,
    log: createLogger('error', {}, () => {}),
    markets: {
      byId: new Map(marketDefinitions.map((m) => [m.id, m])),
      covered: new Set(opts.markets ?? [BTC, ETH]),
      collateralDecimals: 6,
      userShare: 0.8,
    },
    feed,
    notify: {
      deployed: (d) => deployed.push(structuredClone(d)),
      saved: (d) => saved.push(structuredClone(d)),
      alert: (_w, text) => alerts.push(text),
      liquidated: (_w, l) => liquidated.push(l),
    },
    slippageBps: 50,
    maxAttempts: 3,
    demoMove: 0.003,
    pollMs: 1,
    settleMs: 5,
  });
  const chain = new SimChain(feed, marketDefinitions);
  store.putSettings(WALLET, { ...DEFAULT_SETTINGS, armed: true, ...opts.settings });
  let attempt = 0;
  let adds = 0;
  const positions = samplePositions(4127).map((p) => (opts.short ? { ...p, sd: 2 as const } : p));
  const paper = new PaperExchange({
    wallet: WALLET,
    accountId: 4127,
    balanceCns: opts.spareCns ?? SAMPLE_SPARE_CNS,
    positions,
    markets: new Map(marketDefinitions.map((m) => [m.id, m])),
    collateralDecimals: 6,
    markOf: (id) => feed.mark(id),
    ...(opts.fillSlippageBps ? { fillSlippageBps: opts.fillSlippageBps } : {}),
    ...(opts.fillShare || opts.failAdds
      ? {
          fillShare: (f: { s: number; t: number }) =>
            f.t === 6
              ? ++adds <= (opts.failAdds ?? 0)
                ? 0
                : 1
              : (opts.fillShare?.(f.s, ++attempt) ?? 1),
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
  return {
    store,
    engine,
    feed,
    chain,
    paper,
    guard,
    deployed,
    saved,
    alerts,
    liquidated,
    run,
    blocks,
  };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  // Let the 5 ms snapshot-settlement timeout finish before advancing another block.
  await new Promise((r) => setTimeout(r, 10));
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
    expect(h.paper.liquidations).toEqual([]);
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
  it('plans and settles a fee-bearing trim without spending the original spare balance', async () => {
    const h = harness({ feeMicros: 345 });
    await h.run(Array(8).fill(97_000));
    const d = only(h.store);
    expect(d.data.close?.filledLots).toBeGreaterThan(48_906);
    expect(d.data.close?.fee).toBeGreaterThan(16);
    expect(d.data.after?.distance).toBeGreaterThanOrEqual(0.0999);
    expect(h.paper.account?.b).toBe(SAMPLE_SPARE_CNS.toString());
    expect(d.data.timeline.some((e) => e.text.includes('Fee $16'))).toBe(true);
    expect(deployMessage(d).body).toMatch(/Fee \$16\.\d\d\.$/);
  });
  it('trims a short on a whole-lot market and says it in whole units', async () => {
    // The sample MON short's line is $0.0366, above its $0.03366 mark; $420 of spare can't
    // reach the target, so Airbag buys some back.
    const h = harness({ markets: [MON] });
    await h.run(Array(8).fill(0.0366), MON);
    const d = only(h.store);
    expect(d).toMatchObject({ side: 'short', kind: 'trim', phase: 'done' });
    expect(h.paper.sent[0]).toMatchObject({ t: 4 });
    expect(deployMessage(d).body).toMatch(/^Airbag trimmed 50,670 MON at \$0\.0366/);
  });

  it("counts a later deploy's spare margin as the trader's money in an earlier save", async () => {
    // ETH's line is $2,775; $105 of spare puts liquidation 10% under it. The fall continues
    // past the line re-armed at $2,636, so $297 more goes in, then $2,550 (the first deploy's
    // old liquidation price) arrives and the first deploy is a save.
    const h = harness({ markets: [ETH] });
    const path = [3_000, 2_900, 2_800, 2_775, 2_775, 2_700, 2_640, 2_610, 2_610, 2_580, 2_550];
    await h.run([...path, 2_800, 3_060, 3_060], ETH);
    const [first, second] = h.store.deploys(WALLET).sort((a, b) => a.createdAt - b.createdAt);
    expect(first).toMatchObject({ kind: 'margin', outcome: 'save' });
    expect(first?.data.spareAdded).toBeCloseTo(105, 6);
    expect(second).toMatchObject({ kind: 'margin' });
    expect(second?.data.spareAdded).toBeCloseTo(297, 6);
    // At $3,060 the position holds $1,722, and $402 of that is the trader's own spare margin
    // moved in, not something Airbag kept: $1,722 − $402 − the $240 a liquidation returns.
    expect(h.guard.live(first?.id ?? '')?.data.kept).toBeCloseTo(1_080, 0);
  });

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

  it('trims next block when a spare margin add is refused, instead of cooling down', async () => {
    const h = harness({ spareCns: 10_000_000_000n, failAdds: 1 });
    await h.run(Array(8).fill(97_000));
    const d = only(h.store);
    expect(h.paper.sent.map((f) => f.t)).toEqual([6, 3, 6]);
    expect(d).toMatchObject({ kind: 'trim', phase: 'done' });
    expect(d.data.after?.distance).toBeGreaterThanOrEqual(0.0999);
    expect(d.data.timeline.some((e) => e.text.includes('Trimming instead next block'))).toBe(true);
  });

  it('fills a thin book past the mark, inside the worst price', async () => {
    const h = harness({ fillSlippageBps: 10 });
    await h.run([98_000, 97_000, 97_000, 97_000]);
    const d = only(h.store);
    // 0.1% under the $97,000 mark, above the $96,515 limit.
    expect(d.data.close?.fillPrice).toBe(96_903);
    expect(d.phase).toBe('done');
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

  it('retries a failed re-add as a re-add, never as another trim', async () => {
    const h = harness({ failAdds: 1 });
    await h.run([98_000, 97_000, 97_000, 97_000, 97_000, 97_000]);
    await h.blocks(6);
    const d = only(h.store);
    expect(h.paper.sent.map((f) => f.t)).toEqual([3, 6, 6]);
    expect(d.data.close?.filledLots).toBe(48_906);
    expect(d.data.after?.liquidation).toBeCloseTo(87_300, -2);
    expect(d.phase).toBe('done');
    expect(h.alerts).toHaveLength(1);
  });

  it('continues a partial trim after its failed re-add succeeds', async () => {
    const h = harness({ fillShare: (_lots, attempt) => (attempt === 1 ? 0.5 : 1), failAdds: 1 });
    await h.run(Array(20).fill(97_000));
    expect(h.paper.sent.map((f) => f.t)).toEqual([3, 6, 6, 3, 6]);
    expect(only(h.store).data.after?.distance).toBeGreaterThanOrEqual(0.0999);
  });

  it('retries a lost spare-margin order without switching to a trim', async () => {
    const h = harness({ spareCns: 10_000_000_000n });
    const submit = h.paper.submit.bind(h.paper);
    h.paper.submit = async () => ({ result: 'lost', rq: 0 });
    await h.run([97_000]);
    expect(only(h.store).kind).toBe('margin');
    h.paper.submit = submit;
    await h.blocks(6);
    expect(h.paper.sent.map((f) => f.t)).toEqual([6]);
    expect(only(h.store).phase).toBe('done');
    expect(h.paper.positions.get(BTC)?.s).toBe(100_000);
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

  it('never counts a position that closed another way mid-trim as its own fill', async () => {
    const h = harness();
    await h.run([98_000, 97_000]);
    // The close is in flight when Perpl liquidates the position, or the trader closes it.
    h.paper.positions.delete(BTC);
    await h.blocks(3);
    const d = only(h.store);
    expect(d.phase).toBe('failed');
    expect(d.outcome).toBe('precaution');
    expect(d.data.close).toBeUndefined();
    expect(d.data.timeline.map((e) => e.text)).toContain(
      'The position closed on Perpl before the trim filled.',
    );
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

  it('lets Perpl liquidate a paused position at its liquidation price', async () => {
    const h = harness({ settings: { armed: false } });
    await h.run([97_000, 95_000, 94_000]);
    expect(h.paper.positions.has(BTC)).toBe(false);
    // 80% of the $4,000 left at $94,000 goes back to the balance, beside the $420 spare.
    expect(h.paper.liquidations).toEqual([
      expect.objectContaining({ marketId: BTC, side: 'long', price: 94_000, returned: 3_200 }),
    ]);
    expect(h.paper.spare()).toBeCloseTo(3_620, 6);
    expect(h.store.deploys(WALLET)).toHaveLength(0);
    // Told once, not on every block after.
    await h.blocks(3);
    expect(h.liquidated).toEqual([{ symbol: 'BTC', side: 'long', price: 94_000, returned: 3_200 }]);
    expect(liquidationMessage(h.liquidated[0] as never, false)).toMatchObject({
      title: 'Your BTC long was liquidated',
      body: 'At $94,000. $3,200, 80% of what was left, came back to your balance. Airbag was paused. Reset the account, resume and play the wick again.',
    });
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
  function interrupted(depositCns: string, opts: Options = {}) {
    const h = harness(opts);
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
    const h = interrupted('8532821000');
    await h.blocks(3);
    expect(h.paper.sent).toHaveLength(0);
    expect(h.store.deploy('crash1')?.phase).toBe('done');
  });

  it('holds recovery while paused, stale, frozen or forwarding is off', async () => {
    for (const blocked of ['paused', 'stale', 'frozen', 'forwarding'] as const) {
      const h = interrupted('5109400000');
      if (!h.paper.account) throw new Error('missing account');
      if (blocked === 'paused') h.guard.settings.armed = false;
      if (blocked === 'stale') {
        h.feed.monadHead = h.chain.head + 100;
        h.feed.monadHeadAt = Date.now() + 60_000;
      }
      if (blocked === 'frozen') h.paper.account.fr = true;
      if (blocked === 'forwarding') h.paper.account.fw = false;
      await h.blocks(3);
      expect(h.paper.sent).toHaveLength(0);
      expect(h.guard.hasPendingDeploy).toBe(true);
      h.guard.settings.armed = true;
      h.feed.monadHead = 0;
      h.paper.account.fr = false;
      h.paper.account.fw = true;
      await h.blocks(3);
      expect(h.store.deploy('crash1')?.phase).toBe('done');
      expect(h.paper.sent.map((f) => f.t)).toEqual([6]);
    }
  });

  it('keeps a rejected recovery pending, then reports failure after the retry limit', async () => {
    const h = interrupted('5109400000', { failAdds: 10 });
    await h.blocks(10);
    expect(h.store.deploy('crash1')?.phase).toBe('failed');
    expect(h.store.deploy('crash1')?.data.error).toMatch(/could not be re-added/);
    expect(h.deployed).toHaveLength(0);
    expect(h.paper.sent.every((f) => f.t === 6)).toBe(true);
  });

  it('waits for a lost order deadline and does not double-add a late execution', async () => {
    const h = interrupted('5109400000');
    const d = h.store.deploy('crash1');
    if (!d) throw new Error('missing deploy');
    d.data.pendingOrder = { rq: 42, deadline: h.chain.head + 5 };
    h.store.updateDeploy(d);
    await h.blocks(5);
    expect(h.paper.sent).toHaveLength(0);
    const p = h.paper.positions.get(BTC);
    if (!p) throw new Error('missing position');
    p.c = '8532821000'; // Original order finally executes before its deadline.
    await h.blocks(5);
    expect(h.paper.sent).toHaveLength(0);
    expect(h.store.deploy('crash1')?.phase).toBe('done');
  });

  it('does not send a recovered re-add once the attempt budget is exhausted', async () => {
    const h = interrupted('5109400000');
    const d = h.store.deploy('crash1');
    if (!d) throw new Error('missing deploy');
    d.data.attempts = 3;
    h.store.updateDeploy(d);
    await h.blocks(3);
    expect(h.paper.sent).toHaveLength(0);
    expect(h.store.deploy('crash1')?.phase).toBe('failed');
    expect(h.alerts).toHaveLength(1);
  });
});

it('does not send the re-add after a pause between the close and margin add', async () => {
  const h = harness();
  await h.run([97_000]);
  expect(h.paper.sent.map((f) => f.t)).toEqual([3]);
  h.guard.settings.armed = false;
  await h.blocks(3); // The close already sent can fill; no new order may leave.
  expect(h.paper.sent.map((f) => f.t)).toEqual([3]);
  expect(h.guard.hasPendingDeploy).toBe(true);
  h.guard.settings.armed = true;
  await h.blocks(4);
  expect(h.paper.sent.map((f) => f.t)).toEqual([3, 6]);
  expect(only(h.store).phase).toBe('done');
});

it('refuses a plan if the position changes during the request-budget wait', async () => {
  const h = harness();
  const submit = h.paper.submit.bind(h.paper);
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.paper.submit = async (build) => {
    await wait;
    return submit(build);
  };
  await h.run([97_000]);
  const p = h.paper.positions.get(BTC);
  if (!p) throw new Error('missing position');
  p.s -= 100;
  release();
  await flush();
  expect(h.paper.sent).toHaveLength(0);
  expect(only(h.store).phase).toBe('failed');
  expect(h.alerts).toHaveLength(1);
});

it('never rounds a capped trim beyond the lot budget, even for a three-lot position', async () => {
  const h = harness({ settings: { maxTrimPct: 25, useSpare: false } });
  const p = h.paper.positions.get(BTC);
  if (!p) throw new Error('missing position');
  p.s = 3;
  p.c = '300000';
  await h.run([97_000, 97_000, 97_000]);
  expect(h.paper.sent).toHaveLength(0);
  expect(h.deployed).toHaveLength(0);
  expect(h.saved).toHaveLength(0);
});

it('shutdown leaves a pending order recoverable and cannot send a continuation', async () => {
  const h = harness();
  await h.run([97_000]);
  h.engine.stop();
  await h.engine.drain();
  expect(h.paper.sent.map((f) => f.t)).toEqual([3]);
  expect(only(h.store).phase).toBe('closing');
  expect(only(h.store).data.pendingOrder).toBeDefined();
  h.store.close();
});

describe('the deploy state machine on random markets', () => {
  const setArmed = (h: ReturnType<typeof harness>, armed: boolean) => {
    h.store.putSettings(WALLET, { ...h.store.settings(WALLET), armed });
    h.engine.reloadSettings(WALLET);
  };

  // Random adverse paths (never past bankruptcy), partial and missed fills, refused margin
  // adds, a pause, either side, every cap, fees on or off, and no, some or plenty of spare.
  it('only reduces, keeps to its cap, holds while paused and never spends spare by trimming', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          prices: fc.array(fc.integer({ min: 91_000, max: 100_500 }), {
            minLength: 8,
            maxLength: 24,
          }),
          fills: fc.array(fc.constantFrom(0, 0.3, 1, 1), { minLength: 6, maxLength: 6 }),
          failAdds: fc.integer({ min: 0, max: 2 }),
          pauseAt: fc.integer({ min: 0, max: 40 }),
          resumeAfter: fc.integer({ min: 1, max: 5 }),
          spareCns: fc.constantFrom(0n, SAMPLE_SPARE_CNS, 10_000_000_000n),
          short: fc.boolean(),
          maxTrimPct: fc.constantFrom(25 as const, 50 as const, 75 as const, 100 as const),
          feeMicros: fc.constantFrom(0, 345),
        }),
        async (c) => {
          const h = harness({
            short: c.short,
            spareCns: c.spareCns,
            failAdds: c.failAdds,
            feeMicros: c.feeMicros,
            settings: { maxTrimPct: c.maxTrimPct },
            fillShare: (_lots, attempt) => c.fills[(attempt - 1) % c.fills.length] ?? 1,
          });
          const sentWhilePaused: number[] = [];
          const push = h.paper.sent.push.bind(h.paper.sent);
          h.paper.sent.push = (...frames) => {
            if (!h.guard.settings.armed) sentWhilePaused.push(...frames.map((f) => f.t));
            return push(...frames);
          };
          const sizes = [h.paper.positions.get(BTC)?.s ?? 0];
          for (const [i, p] of c.prices.entries()) {
            if (i === c.pauseAt) setArmed(h, false);
            if (i === c.pauseAt + c.resumeAfter) setArmed(h, true);
            await h.run([c.short ? 200_000 - p : p]);
            sizes.push(h.paper.positions.get(BTC)?.s ?? 0);
          }
          await h.blocks(4);
          sizes.push(h.paper.positions.get(BTC)?.s ?? 0);

          // Only reduce-only closes for the position's own side, and collateral adds.
          for (const f of h.paper.sent) expect([c.short ? 4 : 3, 6]).toContain(f.t);
          // Nothing leaves while the trader has Airbag paused.
          expect(sentWhilePaused).toEqual([]);
          // The position only ever shrinks.
          for (let i = 1; i < sizes.length; i++)
            expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1] ?? 0);
          const deploys = h.store.deploys(WALLET);
          // No deploy trims more than its cap of the size it started from.
          for (const d of deploys)
            expect(d.data.close?.filledLots ?? 0).toBeLessThanOrEqual(
              Math.floor(d.data.before.lots * d.data.maxTrim + 1e-9),
            );
          // Trims only put back what they released: spare goes only through a planned add.
          const spareAdded = deploys.reduce((sum, d) => sum + d.data.spareAdded, 0);
          expect(h.paper.spare()).toBeGreaterThanOrEqual(
            Number(c.spareCns) / 1e6 - spareAdded - 1e-6,
          );
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);
});
