// One guard per linked account. Every block it values each covered position at the mark,
// decides whether the Airbag line is crossed, and runs a deploy (brief §4, ADR 0002):
//   spare margin, when that alone reaches the target; otherwise
//   a reduce-only IOC close, then IncreasePositionCollateral of the released equity,
//   retrying the remainder of a partial fill next block, up to maxAttempts; then re-arm with
//   the fill price as the new reference. After a deploy it watches for the old liquidation
//   price: reached while the position is open, the deploy is a save; closed first, a
//   precaution.
//
// Invariants: one deploy in flight per position (the lock), nothing sent while data is stale,
// the key is unhealthy, forwarding is off or Airbag is paused; outcomes come from positions and
// balances, never from mt:3; every order goes through the allowlist.

import { randomBytes } from 'node:crypto';
import {
  type AllowedOrderFrame,
  closeOrder,
  fromCns,
  increaseCollateral,
  lotsToClose,
  type Market,
  type MarketFeed,
  type PerplPosition,
  scaled,
  symbolOf,
  toCnsFloor,
  toRiskPosition,
  worstClosePrice,
} from '@airbag/perpl';
import {
  airbagLine,
  counterfactualReturn,
  crossed,
  cushionUsed,
  direction,
  distanceToLiquidation,
  equity,
  fmt,
  type Line,
  leverage,
  liquidationPrice,
  type Plan,
  type Position,
  planDeploy,
  SENSITIVITY,
  saveValue,
  triggered,
} from '@airbag/risk';
import type { Deploy, Settings, Store, TimelineEntry } from './db.ts';
import type { Exchange } from './exchange.ts';
import type { Logger } from './log.ts';

export interface Markets {
  byId: ReadonlyMap<number, Market>;
  /** Market ids Airbag protects. */
  covered: ReadonlySet<number>;
  collateralDecimals: number;
  /** The trader's share at liquidation, from getLiquidationInfo (0.8). */
  userShare: number;
}

export type Feed = Pick<MarketFeed, 'head' | 'mark' | 'configs' | 'fundingAt' | 'staleness'>;

export interface Notifier {
  deployed(d: Deploy): void;
  saved(d: Deploy): void;
  alert(wallet: string, text: string): void;
}

export interface GuardDeps {
  store: Store;
  markets: Markets;
  feed: Feed;
  notify: Notifier;
  log: Logger;
  slippageBps: number;
  maxAttempts: number;
  demoMove: number;
  /** Polls for position and balance updates; tests pass a fast one. */
  pollMs?: number;
  settleMs?: number;
  staleBlocks?: number;
}

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
  side: 'long' | 'short';
  size: number;
  sizeDecimals: number;
  entry: number;
  mark: number;
  equity: number;
  /** Leverage at the mark. */
  leverage: number;
  /** Leverage the position was opened with, as Perpl shows it ("10x"). */
  nominalLeverage: number;
  liquidation: number;
  distance: number;
  covered: boolean;
  status: PositionStatus;
  /** The risk inputs, so the web app can preview settings with the same math. */
  position: Position;
  /** Present for covered positions. */
  line?: number;
  reference?: number;
  cushionUsed?: number;
  /** What happens at the line, planned with today's spare margin. */
  atLine?: {
    kind: Plan['kind'];
    fraction?: number;
    amount?: number;
    liquidation: number | null;
    capped?: boolean;
  };
}

export type GuardStatus =
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

interface Episode {
  deploy: Deploy;
  attempts: number;
  /** Lots when the episode started: the cap is a share of this. */
  startLots: number;
  /** Retry on or after this block. */
  retryAt: number;
  /** A close filled but its released margin didn't go back yet: retry that, not another trim. */
  readd?: { amount: bigint; fill: number };
}

const RECENT_MS = 10 * 60_000;
const newId = () => randomBytes(9).toString('base64url');
class DeferredDeploy extends Error {}

export class AccountGuard {
  readonly wallet: string;
  exchange: Exchange;
  settings: Settings;
  views: PositionView[] = [];
  private readonly deps: GuardDeps;
  private readonly episodes = new Map<number, Episode>();
  private readonly busy = new Set<number>();
  private readonly cooldownUntil = new Map<number, number>();
  private readonly lastDeployAt = new Map<number, number>();
  /** Finished deploys whose position is open: waiting to be a save, or a save still counting. */
  private readonly tracked = new Map<string, Deploy>();
  private readonly refs = new Map<
    number,
    { positionId: number; reference: number; lots: number }
  >();
  private recovering = false;
  private initialized = false;
  private stopped = false;
  private readonly recoveryPending = new Set<number>();

  constructor(wallet: string, exchange: Exchange, settings: Settings, deps: GuardDeps) {
    this.wallet = wallet;
    this.exchange = exchange;
    this.settings = settings;
    this.deps = deps;
    for (const d of deps.store.trackedDeploys()) if (d.wallet === wallet) this.tracked.set(d.id, d);
    for (const d of deps.store.unfinishedDeploys(wallet)) this.recoveryPending.add(d.marketId);
  }

  get cd(): number {
    return this.deps.markets.collateralDecimals;
  }

  /** Free balance, collateral units. */
  spare(): number {
    const a = this.exchange.account;
    return a ? fromCns(BigInt(a.b) - BigInt(a.lb), this.cd) : 0;
  }

  status(): GuardStatus {
    const ex = this.exchange;
    if (ex.state === 'rejected') return 'key-rejected';
    if (ex.state === 'limited') return 'too-many-connections';
    if (ex.state !== 'live' || !ex.account) return 'connecting';
    if (ex.account && !ex.account.fw) return 'forwarding-off';
    if (ex.account?.fr) return 'frozen';
    if (!this.settings.armed || this.stopped) return 'paused';
    const lag = this.deps.staleBlocks ?? 3;
    if (
      this.deps.feed.staleness().stale ||
      this.deps.feed.head - ex.head > lag ||
      Date.now() - ex.lastMessageAt > (lag + 1) * 400
    )
      return 'stale';
    if (this.hasPendingDeploy) return 'deploying';
    const now = Date.now();
    for (const at of this.lastDeployAt.values()) if (now - at < RECENT_MS) return 're-armed';
    return 'armed';
  }

  /** Independent of the display status: a paused/stale deploy still owns its key. */
  get hasPendingDeploy(): boolean {
    return this.episodes.size > 0 || this.busy.size > 0 || this.recoveryPending.size > 0;
  }

  stop(): void {
    this.stopped = true;
  }

  async drain(): Promise<void> {
    while (this.busy.size > 0 || this.recovering) await new Promise((r) => setTimeout(r, 10));
  }

  private canAct(): boolean {
    return ['armed', 're-armed', 'deploying'].includes(this.status());
  }

  /** Checked inside the builder, after the trading client's rate-limit wait. */
  private async submit(d: Deploy, build: (ids: { sn: number; rq: number }) => AllowedOrderFrame) {
    const expected = this.exchange.positions.get(d.marketId);
    const size = expected?.s;
    const deposit = expected?.c;
    const outcome = await this.exchange.submit((ids) => {
      const p = this.exchange.positions.get(d.marketId);
      const m = this.market(d.marketId);
      if (
        !this.canAct() ||
        !m?.config.is_open ||
        !p ||
        p.pid !== d.data.positionId ||
        this.exchange.account?.id !== d.accountId
      )
        throw new DeferredDeploy('Order held until protection is safe.');
      if (p.s !== size || p.c !== deposit || (p.sd === 1) !== (d.side === 'long'))
        throw new Error('Position changed while waiting to dispatch; check it on Perpl.');
      const frame = build(ids);
      frame.lb = this.exchange.head + (m.order_ttl_blocks || 20);
      d.data.pendingOrder = { rq: frame.rq, deadline: frame.lb };
      this.save(d);
      return frame;
    });
    if (outcome.result === 'lost')
      throw new DeferredDeploy(
        'Order outcome unknown; waiting for fresh snapshots and its execution deadline.',
      );
    delete d.data.pendingOrder;
    this.save(d);
    return outcome;
  }

  private market(id: number): Market | undefined {
    const m = this.deps.markets.byId.get(id);
    const config = this.deps.feed.configs.get(id);
    return m && config ? { ...m, config } : m;
  }

  private risk(p: PerplPosition, m: Market, head: number): Position {
    const funding = this.deps.feed.fundingAt(p.mkt, head);
    // No known funding event means no premium yet: the sum equals the position's entry sum.
    return toRiskPosition(p, m, this.cd, funding?.sum ?? p.efs, this.exchange.account?.ft ?? 0);
  }

  private markOf(m: Market): number | undefined {
    const raw = this.deps.feed.mark(m.id);
    return raw === undefined ? undefined : scaled(raw, m.config.price_decimals);
  }

  /** The reference price: entry when first armed or after the user added to the position. */
  private reference(p: PerplPosition, risk: Position): number {
    const saved = this.refs.get(p.mkt) ?? this.deps.store.reference(this.wallet, p.mkt);
    const deploying = this.episodes.has(p.mkt) || this.busy.has(p.mkt);
    if (saved && saved.positionId === p.pid && (p.s <= saved.lots || deploying)) {
      if (p.s !== saved.lots && !deploying) this.putRef(p.mkt, { ...saved, lots: p.s });
      else this.refs.set(p.mkt, saved);
      return saved.reference;
    }
    this.putRef(p.mkt, { positionId: p.pid, reference: risk.entry, lots: p.s });
    return risk.entry;
  }

  private putRef(mkt: number, ref: { positionId: number; reference: number; lots: number }) {
    this.refs.set(mkt, ref);
    this.deps.store.putReference(this.wallet, mkt, ref);
  }

  private line(risk: Position, reference: number): Line {
    if (this.settings.demo) {
      // Demo mode: deploy after a small adverse move from the reference.
      const price = reference * (1 - direction(risk.side) * this.deps.demoMove);
      const line = airbagLine(risk, reference, 0.5);
      return { ...line, triggerEquity: equity(risk, price), price };
    }
    return airbagLine(risk, reference, SENSITIVITY[this.settings.sensitivity]);
  }

  private policy() {
    return {
      target: this.settings.targetPct / 100,
      maxTrim: this.settings.maxTrimPct / 100,
      useSpare: this.settings.useSpare,
    };
  }

  /** The per-block check. Synchronous; deploys run in the background under the lock. */
  onBlock(head: number): void {
    if (this.stopped) return;
    if (!this.initialized && this.exchange.state === 'live') {
      for (const d of this.deps.store.unfinishedDeploys(this.wallet))
        this.recoveryPending.add(d.marketId);
      this.initialized = true;
    }
    if (this.recoveryPending.size > 0 && !this.recovering && this.canAct()) {
      this.recovering = true;
      void this.resume(head);
    }
    const status = this.status();
    const act = status === 'armed' || status === 're-armed' || status === 'deploying';
    const spare = this.spare();
    const views: PositionView[] = [];
    for (const p of this.exchange.positions.values()) {
      const m = this.market(p.mkt);
      if (!m) continue;
      const mark = this.markOf(m);
      if (mark === undefined) continue;
      const risk = this.risk(p, m, head);
      const liq = liquidationPrice(risk);
      const covered = this.deps.markets.covered.has(p.mkt);
      const view: PositionView = {
        marketId: p.mkt,
        positionId: p.pid,
        symbol: symbolOf(m),
        side: risk.side,
        size: risk.size,
        sizeDecimals: m.config.size_decimals,
        entry: risk.entry,
        mark,
        equity: equity(risk, mark),
        leverage: leverage(risk, mark),
        nominalLeverage: p.lv / 100,
        liquidation: liq,
        distance: distanceToLiquidation(risk, mark),
        covered,
        status: covered ? 'paused' : 'not-covered',
        position: risk,
      };
      views.push(view);
      if (!covered) continue;

      const reference = this.reference(p, risk);
      const line = this.line(risk, reference);
      const atLine = planDeploy(risk, line.price, spare, this.policy());
      view.line = line.price;
      view.reference = reference;
      view.cushionUsed = cushionUsed(risk, mark, line);
      view.atLine =
        atLine.kind === 'trim'
          ? {
              kind: 'trim',
              fraction: atLine.fraction,
              liquidation: atLine.liquidation,
              capped: atLine.capped,
            }
          : atLine.kind === 'margin'
            ? { kind: 'margin', amount: atLine.amount, liquidation: atLine.liquidation }
            : { kind: 'none', liquidation: atLine.liquidation };

      const episode = this.episodes.get(p.mkt);
      const recent = Date.now() - (this.lastDeployAt.get(p.mkt) ?? 0) < RECENT_MS;
      view.status = !this.settings.armed
        ? 'paused'
        : !act
          ? 'blocked'
          : episode || this.busy.has(p.mkt) || this.recoveryPending.has(p.mkt)
            ? 'deploying'
            : recent
              ? 're-armed'
              : 'armed';

      if (!act || this.busy.has(p.mkt)) continue;
      if (this.recoveryPending.has(p.mkt)) continue;
      if (episode) {
        if (head >= episode.retryAt) void this.attempt(p.mkt, head, mark);
      } else if (head >= (this.cooldownUntil.get(p.mkt) ?? 0) && triggered(risk, mark, line)) {
        this.start(p, m, risk, mark, line, reference, head, spare);
      }
    }
    this.views = views;
    this.watchSaves(head);
  }

  private start(
    p: PerplPosition,
    m: Market,
    risk: Position,
    mark: number,
    line: Line,
    reference: number,
    head: number,
    spare: number,
  ) {
    const now = Date.now();
    const policy = this.policy();
    const plan = planDeploy(risk, mark, spare, policy);
    const symbol = symbolOf(m);
    const cushion = this.settings.demo
      ? `Demo mode: it moved ${fmt.pct(this.deps.demoMove, 1)} against you.`
      : {
          early: 'A third of your cushion is gone.',
          balanced: 'Half your cushion is gone.',
          late: 'Three quarters of your cushion is gone.',
        }[this.settings.sensitivity];
    const deploy: Deploy = {
      id: newId(),
      wallet: this.wallet,
      accountId: this.exchange.account?.id ?? 0,
      marketId: p.mkt,
      symbol,
      side: risk.side,
      kind: plan.kind === 'margin' ? 'margin' : 'trim',
      phase: 'closing',
      outcome: 'pending',
      createdAt: now,
      savedAt: null,
      closedAt: null,
      data: {
        trigger: { block: head, at: now, mark, line: line.price, reference },
        before: {
          size: risk.size,
          lots: p.s,
          entry: risk.entry,
          deposit: risk.deposit,
          funding: risk.funding,
          maintenance: risk.maintenance,
          liquidation: liquidationPrice(risk),
          distance: distanceToLiquidation(risk, mark),
          leverage: leverage(risk, mark),
          nominal: p.lv / 100,
        },
        positionId: p.pid,
        target: policy.target,
        maxTrim: policy.maxTrim,
        useSpare: policy.useSpare,
        spare,
        plannedLiquidation: plan.liquidation,
        capped: plan.kind === 'trim' && plan.capped,
        counterfactual: counterfactualReturn(risk, this.deps.markets.userShare),
        spareAdded: 0,
        attempts: 0,
        timeline: [{ block: head, at: now, text: `Mark hit ${fmt.usd(mark)}. ${cushion}` }],
      },
    };
    if (plan.kind === 'margin') {
      this.entry(
        deploy,
        head,
        `Spare margin (${fmt.usd(spare)}) reaches ${fmt.pct(policy.target, 0)} on its own. Adding ${fmt.usd(plan.amount)}.`,
      );
    } else if (plan.kind === 'trim' && policy.useSpare && spare > 0) {
      this.entry(
        deploy,
        head,
        `Spare margin (${fmt.usd(spare)}) can't reach ${fmt.pct(policy.target, 0)}. Trimming instead.`,
      );
    }
    this.deps.store.insertDeploy(deploy);
    this.deps.log.info('deploy.start', {
      id: deploy.id,
      wallet: this.wallet,
      market: symbol,
      head,
      mark,
      plan: plan.kind,
    });
    this.episodes.set(p.mkt, { deploy, attempts: 0, startLots: p.s, retryAt: head });
    void this.attempt(p.mkt, head, mark);
  }

  private entry(d: Deploy, block: number, text: string, extra: Partial<TimelineEntry> = {}) {
    d.data.timeline.push({ block, at: Date.now(), text, ...extra });
  }

  private save(d: Deploy) {
    this.deps.store.updateDeploy(d);
  }

  /** One attempt of an episode: spare margin, or close then re-add. Holds the market's lock. */
  private async attempt(mkt: number, head: number, mark: number): Promise<void> {
    const episode = this.episodes.get(mkt);
    if (!episode || this.busy.has(mkt)) return;
    this.busy.add(mkt);
    const d = episode.deploy;
    try {
      episode.attempts += 1;
      d.data.attempts = episode.attempts;
      const p = this.exchange.positions.get(mkt);
      const m = this.market(mkt);
      if (!p || !m || p.pid !== d.data.positionId) {
        this.entry(d, head, 'The position closed before Airbag acted.');
        return this.finish(mkt, d, head, 'failed');
      }
      if (episode.readd) {
        const { amount, fill } = episode.readd;
        if (!(await this.readd(mkt, d, m, amount, fill))) {
          return this.retryOrStop(mkt, episode, 'Will retry the re-add next block.', fill);
        }
        delete episode.readd;
        delete d.data.readd;
        if ((this.after(mkt, m, fill)?.distance ?? 1) < d.data.target - 1e-6)
          return this.retryOrStop(mkt, episode, 'Trimming the rest next block.', fill);
        return this.finish(mkt, d, this.exchange.head, 'done', fill);
      }
      // A recovered spare-margin deploy must never turn into an unplanned close.
      if (d.kind === 'margin' && d.data.marginAttempt)
        return await this.addSpare(
          mkt,
          episode,
          m,
          fromCns(d.data.marginAttempt.amount, this.cd),
          mark,
        );
      const risk = this.risk(p, m, head);
      const spare = this.spare();
      const policy = {
        target: d.data.target,
        maxTrim: d.data.maxTrim,
        useSpare: d.data.useSpare ?? this.settings.useSpare,
      };
      // The cap is a share of the position when the episode began.
      const budget = Math.max(
        0,
        (episode.startLots * policy.maxTrim - (episode.startLots - p.s)) / p.s,
      );
      const plan = planDeploy(risk, mark, episode.attempts === 1 ? spare : 0, {
        ...policy,
        maxTrim: Math.min(1, budget),
        useSpare: policy.useSpare && episode.attempts === 1,
      });
      if (plan.kind === 'none' || (plan.kind === 'trim' && plan.fraction <= 0)) {
        return this.finish(mkt, d, head, 'done', mark);
      }
      if (plan.kind === 'margin') return await this.addSpare(mkt, episode, m, plan.amount, mark);
      await this.trim(mkt, episode, m, p, risk, plan.fraction, plan.capped, head, mark);
    } catch (err) {
      if (err instanceof DeferredDeploy || d.data.pendingOrder) {
        this.entry(d, head, err instanceof Error ? err.message : 'Waiting to reconcile the order.');
        this.save(d);
        this.episodes.delete(mkt);
        this.recoveryPending.add(mkt);
        return;
      }
      this.deps.log.error('deploy.error', { id: d.id, err });
      this.entry(d, head, 'Airbag hit an error and stopped this deploy. You have been alerted.');
      this.finish(mkt, d, head, 'failed');
    } finally {
      this.busy.delete(mkt);
    }
  }

  private async addSpare(mkt: number, episode: Episode, m: Market, amount: number, mark: number) {
    const d = episode.deploy;
    const cns = toCnsFloor(Math.min(amount, this.spare()), this.cd);
    const acc = this.exchange.account?.id ?? 0;
    const before = BigInt(this.exchange.positions.get(mkt)?.c ?? '0');
    d.data.marginAttempt = { deposit: before.toString(), amount: cns.toString() };
    this.save(d);
    const outcome = await this.submit(d, (ids) =>
      increaseCollateral({ ...ids, mkt, acc, lb: 0, amountCns: cns }),
    );
    await this.until(() => BigInt(this.exchange.positions.get(mkt)?.c ?? '0') > before);
    const added = fromCns(BigInt(this.exchange.positions.get(mkt)?.c ?? '0') - before, this.cd);
    if (added <= 0) {
      const why = `${outcome.result}${outcome.order ? `, reason ${outcome.order.sr}` : ''}`;
      // Refused or failed outright, so nothing moved: trim next block rather than leave the
      // position past its line through a failure cooldown. An add Perpl reports executed but
      // the position doesn't show is an inconsistency to check, not something to trim over.
      if (outcome.result === 'failed' || outcome.result === 'rejected') {
        delete d.data.marginAttempt;
        d.kind = 'trim';
        return this.retryOrStop(
          mkt,
          episode,
          `Adding spare margin failed (${why}). Trimming instead next block.`,
        );
      }
      this.entry(d, this.exchange.head, `Adding spare margin failed (${why}).`);
      return this.finish(mkt, d, this.exchange.head, 'failed');
    }
    d.data.spareAdded += added;
    d.data.margin = { amount: added, reason: 'spare', ...txOf(outcome) };
    const after = this.after(mkt, m, mark);
    this.entry(
      d,
      this.exchange.head,
      `Added ${fmt.usd(added)} of spare margin. Liquidation now ${fmt.usd(after?.liquidation)}.`,
      { tone: 'airbag', ...txOf(outcome) },
    );
    this.finish(mkt, d, this.exchange.head, 'done', mark);
  }

  private async trim(
    mkt: number,
    episode: Episode,
    m: Market,
    p: PerplPosition,
    risk: Position,
    fraction: number,
    capped: boolean,
    head: number,
    mark: number,
  ) {
    const d = episode.deploy;
    const sd = m.config.size_decimals;
    const pd = m.config.price_decimals;
    // Round the trim up to whole lots (never less than the math needs), but never past the cap.
    const budget =
      Math.floor(episode.startLots * d.data.maxTrim + 1e-9) - (episode.startLots - p.s);
    const lots = Math.min(
      budget,
      capped ? Math.floor(p.s * fraction + 1e-9) : lotsToClose(p.s, fraction),
    );
    if (lots <= 0) return this.finish(mkt, d, head, 'done', mark);
    const markScaled = this.deps.feed.mark(mkt) ?? Math.round(mark * 10 ** pd);
    const limit = worstClosePrice(risk.side, markScaled, this.deps.slippageBps);
    const account = this.exchange.account;
    if (!account) throw new Error('no account');
    const lotsBefore = p.s;
    const depositBefore = BigInt(p.c);
    const balanceBefore = BigInt(account.b);
    d.phase = 'closing';
    d.data.attempt = {
      lots: lotsBefore,
      deposit: depositBefore.toString(),
      balance: balanceBefore.toString(),
      filledBefore: d.data.close?.filledLots ?? 0,
    };
    const sentAt = Date.now();
    this.entry(
      d,
      head,
      `Sent a reduce-only close for ${fmt.size(scaled(lots, sd), sd)} ${d.symbol}, worst price ${fmt.usd(scaled(limit, pd))}.`,
    );
    this.save(d);

    const outcome = await this.submit(d, (ids) =>
      closeOrder({
        ...ids,
        mkt,
        acc: account.id,
        lb: this.exchange.head + (m.order_ttl_blocks || 20),
        side: risk.side,
        lots,
        limitPrice: limit,
        leverage: p.lv,
      }),
    );
    const mayHaveFilled = ['filled', 'partial', 'lost'].includes(outcome.result);
    if (mayHaveFilled)
      await this.until(() => (this.exchange.positions.get(mkt)?.s ?? 0) < lotsBefore);
    const lotsAfter = this.exchange.positions.get(mkt)?.s ?? 0;
    const current = this.exchange.positions.get(mkt);
    if (current && current.pid !== d.data.positionId) {
      this.entry(
        d,
        this.exchange.head,
        'The position changed while the close was in flight. Check it on Perpl.',
      );
      return this.finish(mkt, d, this.exchange.head, 'failed');
    }
    const filled = lotsBefore - lotsAfter;
    const filledAt = Date.now();

    if (filled <= 0) {
      const why =
        outcome.result === 'rejected'
          ? `Perpl refused it: ${outcome.error ?? outcome.code}`
          : outcome.result === 'failed'
            ? `it failed (reason ${outcome.order?.sr ?? '?'})`
            : `no fill within ${fmt.pct(this.deps.slippageBps / 10_000, 1)} of the mark`;
      return this.retryOrStop(mkt, episode, `The close didn't fill: ${why}.`);
    }

    const fill = outcome.order?.fp ? scaled(outcome.order.fp, pd) : mark;
    const share = filled / lotsBefore;
    const realized = direction(risk.side) * share * risk.size * (fill - risk.entry);
    const fee = outcome.order?.f === undefined ? undefined : fromCns(outcome.order.f, this.cd);
    const priorFee = d.data.close ? d.data.close.fee : 0;
    d.data.close = {
      lots: (d.data.close?.lots ?? 0) + lots,
      limitPrice: scaled(limit, pd),
      filledLots: (d.data.close?.filledLots ?? 0) + filled,
      fillPrice: fill,
      realizedPnl: (d.data.close?.realizedPnl ?? 0) + realized,
      fee: fee === undefined || priorFee === undefined ? undefined : priorFee + fee,
      ...txOf(outcome),
    };
    const partial = filled < lots;
    this.entry(
      d,
      this.exchange.head,
      `${partial ? `Filled ${fmt.size(scaled(filled, sd), sd)} of ${fmt.size(scaled(lots, sd), sd)} ${d.symbol}` : 'Filled'} at ${fmt.usd(fill)}. Realized ${fmt.usd(realized)}. Fee ${fmt.fee(fee)}.`,
      { tone: 'airbag', ...txOf(outcome) },
    );

    if (lotsAfter === 0) {
      this.entry(
        d,
        this.exchange.head,
        'The whole position is closed. The released margin stays in your balance.',
      );
      return this.finish(mkt, d, this.exchange.head, 'done', fill);
    }

    // Re-add what the close released (ADR 0002), from the balance change, capped by the model.
    d.phase = 'readding';
    this.save(d);
    await this.until(() => BigInt(this.exchange.account?.b ?? '0') !== balanceBefore);
    const observed = BigInt(this.exchange.account?.b ?? '0') - balanceBefore;
    const expected = toCnsFloor(
      share * equity(risk, fill) - (fee ?? share * risk.size * fill * (risk.closeFeeRate ?? 0)),
      this.cd,
    );
    const free = BigInt(this.exchange.account?.b ?? '0') - BigInt(this.exchange.account?.lb ?? '0');
    let readd = observed > 0n ? observed : expected;
    if (readd > (expected * 105n) / 100n) readd = (expected * 105n) / 100n;
    if (readd > free) readd = free;
    let readdAt = filledAt;
    if (readd > 0n) {
      episode.readd = { amount: readd, fill };
      d.data.readd = {
        deposit: this.exchange.positions.get(mkt)?.c ?? '0',
        amount: readd.toString(),
        fill,
      };
      this.save(d);
      const ok = await this.readd(mkt, d, m, readd, fill);
      readdAt = Date.now();
      if (!ok) {
        episode.readd = { amount: readd, fill };
        this.deps.notify.alert(
          this.wallet,
          `Airbag trimmed your ${d.symbol} ${d.side} but couldn't add the released margin back yet. It's retrying.`,
        );
        return this.retryOrStop(mkt, episode, 'Will retry the re-add next block.', fill);
      }
      delete episode.readd;
      delete d.data.readd;
    }
    d.data.latency = {
      detectToSendMs: sentAt - d.data.trigger.at,
      sendToFillMs: filledAt - sentAt,
      fillToReaddMs: readdAt - filledAt,
      blocks: this.exchange.head - d.data.trigger.block,
    };

    const after = this.after(mkt, m, fill);
    if (partial && (after?.distance ?? 1) < d.data.target - 1e-6) {
      return this.retryOrStop(
        mkt,
        episode,
        'Only part of the trim filled. Trimming the rest next block.',
        fill,
      );
    }
    this.finish(mkt, d, this.exchange.head, 'done', fill);
  }

  /** IncreasePositionCollateral with margin a close released. False if the deposit didn't grow. */
  private async readd(mkt: number, d: Deploy, m: Market, amount: bigint, fill: number) {
    const recorded = d.data.readd;
    if (recorded)
      amount =
        BigInt(recorded.deposit) +
        BigInt(recorded.amount) -
        BigInt(this.exchange.positions.get(mkt)?.c ?? '0');
    if (amount <= 0n) return true;
    const a = this.exchange.account;
    const free = BigInt(a?.b ?? '0') - BigInt(a?.lb ?? '0');
    const cns = amount < free ? amount : free;
    if (cns <= 0n) {
      this.entry(d, this.exchange.head, "There's no free balance to put back yet.");
      return false;
    }
    const before = BigInt(this.exchange.positions.get(mkt)?.c ?? '0');
    const re = await this.submit(d, (ids) =>
      increaseCollateral({ ...ids, mkt, acc: a?.id ?? 0, lb: 0, amountCns: cns }),
    );
    await this.until(() => BigInt(this.exchange.positions.get(mkt)?.c ?? '0') > before);
    const added = fromCns(BigInt(this.exchange.positions.get(mkt)?.c ?? '0') - before, this.cd);
    if (added <= 0) {
      this.entry(
        d,
        this.exchange.head,
        `Putting back the released margin failed (${re.result}). Liquidation hasn't moved.`,
      );
      return false;
    }
    d.data.margin = {
      amount: (d.data.margin?.amount ?? 0) + added,
      reason: 'readd',
      ...txOf(re),
    };
    const after = this.after(mkt, m, fill);
    this.entry(
      d,
      this.exchange.head,
      `Put back ${fmt.usd(added)} of released margin. Liquidation now ${fmt.usd(after?.liquidation)}.`,
      { tone: 'airbag', ...txOf(re) },
    );
    return added >= fromCns(amount, this.cd) - 1e-6;
  }

  /** The position after a deploy, measured at `price`. */
  private after(mkt: number, m: Market, price: number) {
    const p = this.exchange.positions.get(mkt);
    if (!p) return undefined;
    const risk = this.risk(p, m, this.exchange.head);
    return {
      risk,
      liquidation: liquidationPrice(risk),
      distance: distanceToLiquidation(risk, price),
      leverage: leverage(risk, price),
    };
  }

  private retryOrStop(mkt: number, episode: Episode, text: string, fill?: number) {
    const d = episode.deploy;
    if (episode.attempts < this.deps.maxAttempts && this.exchange.positions.has(mkt)) {
      this.entry(d, this.exchange.head, text);
      episode.retryAt = this.exchange.head + 1;
      // 'readding' lets a restart finish the re-add from the persisted pre-close state.
      d.phase = episode.readd ? 'readding' : 'closing';
      this.save(d);
      return;
    }
    this.entry(
      d,
      this.exchange.head,
      `${text.replace(/ ?(Trying again|Trimming the rest|Trimming instead|Will retry)[^.]*\./, '')} Stopped after ${episode.attempts} attempts.`.trim(),
    );
    const anyFill = (d.data.close?.filledLots ?? 0) > 0 || d.data.spareAdded > 0;
    if (anyFill && !episode.readd)
      this.deps.notify.alert(
        this.wallet,
        `Airbag reached its attempt limit before the ${d.symbol} target. Check the position on Perpl.`,
      );
    if (episode.readd)
      d.data.error = 'The released margin could not be re-added. Check the position on Perpl.';
    this.finish(mkt, d, this.exchange.head, anyFill && !episode.readd ? 'done' : 'failed', fill);
  }

  private finish(
    mkt: number,
    d: Deploy,
    head: number,
    phase: 'done' | 'failed',
    reference?: number,
  ) {
    const m = this.market(mkt);
    const p = this.exchange.positions.get(mkt);
    d.phase = phase;
    this.episodes.delete(mkt);
    this.recoveryPending.delete(mkt);
    if (phase === 'done' && !d.data.close?.filledLots && !d.data.spareAdded) {
      d.outcome = 'precaution';
      d.closedAt = Date.now();
    }
    if (phase === 'failed') {
      this.deps.notify.alert(
        this.wallet,
        `Airbag couldn't finish protecting your ${d.symbol}. Check the position and released margin on Perpl.`,
      );
      // Don't hammer a failing path: wait ~30 s before a new episode can start.
      this.cooldownUntil.set(mkt, head + 100);
      if (!d.data.close?.filledLots && !d.data.spareAdded) d.outcome = 'precaution';
    }
    if (m && p && reference !== undefined) {
      this.putRef(mkt, { positionId: p.pid, reference, lots: p.s });
      const after = this.after(mkt, m, reference);
      if (after) {
        const line = this.line(after.risk, reference);
        d.data.after = {
          size: after.risk.size,
          liquidation: after.liquidation,
          distance: after.distance,
          leverage: after.leverage,
          line: line.price,
        };
        if (phase === 'done') {
          this.entry(
            d,
            head,
            `Re-armed at ${fmt.usd(line.price)} on ${fmt.size(after.risk.size, m.config.size_decimals)} ${d.symbol}.`,
          );
        }
      }
    } else if (!p) {
      d.data.after = { size: 0, liquidation: null, distance: null, leverage: null, line: null };
    }
    this.save(d);
    this.lastDeployAt.set(mkt, Date.now());
    this.deps.log.info('deploy.finish', {
      id: d.id,
      phase,
      attempts: d.data.attempts,
      latency: d.data.latency,
    });
    if (phase === 'done' && d.outcome === 'pending') {
      if (p) this.tracked.set(d.id, d);
      else this.classify(d, 'precaution');
      this.deps.notify.deployed(d);
    }
  }

  /**
   * Save or precaution for finished deploys (brief §4). The value kept stays live while the
   * position is open and freezes when it closes; it's persisted every ~30 s meanwhile.
   */
  private watchSaves(head: number) {
    if (
      this.exchange.state !== 'live' ||
      this.deps.feed.staleness().stale ||
      this.deps.feed.head - this.exchange.head > (this.deps.staleBlocks ?? 3)
    )
      return;
    for (const d of this.tracked.values()) {
      const p = this.exchange.positions.get(d.marketId);
      if (!p || p.pid !== d.data.positionId) {
        if (d.outcome === 'pending') this.classify(d, 'precaution');
        else this.close(d);
        continue;
      }
      const m = this.market(d.marketId);
      const mark = m && this.markOf(m);
      if (!m || mark === undefined) continue;
      const risk = this.risk(p, m, head);
      d.data.kept = saveValue(equity(risk, mark), this.spareSince(d), d.data.counterfactual);
      d.data.keptMark = mark;
      if (d.outcome === 'pending' && crossed(d.side, mark, d.data.before.liquidation)) {
        d.data.save = { block: head, at: Date.now(), mark };
        this.entry(
          d,
          head,
          `${d.symbol} hit your old liquidation price, ${fmt.usd(d.data.before.liquidation)}.`,
          { tone: 'airbag' },
        );
        this.classify(d, 'save');
      } else if (head % 100 === 0) {
        this.save(d);
      }
    }
  }

  /**
   * Spare margin Airbag has put into this deploy's position from this deploy on, later deploys
   * included: the trader's own money moved in, so not part of what any of them kept.
   */
  private spareSince(d: Deploy): number {
    const open = new Map(this.tracked);
    for (const e of this.episodes.values()) open.set(e.deploy.id, e.deploy);
    let sum = 0;
    for (const x of open.values()) {
      if (
        x.marketId === d.marketId &&
        x.data.positionId === d.data.positionId &&
        x.createdAt >= d.createdAt
      )
        sum += x.data.spareAdded;
    }
    return sum;
  }

  private classify(d: Deploy, outcome: 'save' | 'precaution') {
    d.outcome = outcome;
    if (outcome === 'save') d.savedAt = Date.now();
    else return this.close(d);
    this.save(d);
    this.deps.log.info('deploy.outcome', { id: d.id, outcome, kept: d.data.kept });
    this.deps.notify.saved(d);
  }

  /** The position is gone: freeze the deploy. */
  private close(d: Deploy) {
    d.closedAt = Date.now();
    this.tracked.delete(d.id);
    this.save(d);
    this.deps.log.info('deploy.closed', { id: d.id, outcome: d.outcome, kept: d.data.kept });
  }

  /**
   * Finishes deploys a restart interrupted. If the close filled but its released margin never
   * went back, put it back now, unless the deposit shows it already did.
   */
  private async resume(head: number) {
    try {
      for (const d of this.deps.store.unfinishedDeploys(this.wallet)) {
        const mkt = d.marketId;
        if (this.episodes.has(mkt) || this.busy.has(mkt)) continue;
        // A socket loss does not cancel an order. Wait out its onchain execution window.
        if (d.data.pendingOrder && head <= d.data.pendingOrder.deadline + 2) continue;
        if (!this.canAct()) break;
        const m = this.market(mkt);
        const p = this.exchange.positions.get(mkt);
        this.busy.add(mkt);
        const episode: Episode = {
          deploy: d,
          attempts: d.data.attempts,
          startLots: d.data.before.lots,
          retryAt: head + 1,
        };
        try {
          delete d.data.pendingOrder;
          if (
            !m ||
            !p ||
            p.pid !== d.data.positionId ||
            this.exchange.account?.id !== d.accountId
          ) {
            this.entry(
              d,
              head,
              'Airbag restarted mid-deploy; the position changed, so it stopped here.',
            );
            this.finish(mkt, d, head, 'failed');
            continue;
          }
          if (d.kind === 'margin') {
            const at = d.data.marginAttempt;
            const added = at ? BigInt(p.c) - BigInt(at.deposit) : 0n;
            if (added > 0n) {
              d.data.spareAdded += fromCns(added, this.cd);
              d.data.margin = { amount: d.data.spareAdded, reason: 'spare' };
              this.entry(
                d,
                head,
                'Airbag reconciled the spare margin add from the position snapshot.',
              );
              this.finish(mkt, d, head, 'done', d.data.trigger.mark);
            } else if (episode.attempts < this.deps.maxAttempts) {
              this.episodes.set(mkt, episode);
              this.recoveryPending.delete(mkt);
            } else this.finish(mkt, d, head, 'failed');
            continue;
          }
          const at = d.data.attempt;
          const filled = at ? at.lots - p.s : 0;
          if (!at || filled <= 0) {
            if (episode.attempts < this.deps.maxAttempts) {
              this.episodes.set(mkt, episode);
              this.recoveryPending.delete(mkt);
            } else this.finish(mkt, d, head, 'failed');
            continue;
          }
          const before: Position = {
            ...this.risk(p, m, head),
            size: scaled(at.lots, m.config.size_decimals),
            deposit: fromCns(at.deposit, this.cd),
          };
          const fill = d.data.readd?.fill ?? d.data.close?.fillPrice ?? d.data.trigger.mark;
          const proRata = (BigInt(at.deposit) * BigInt(p.s)) / BigInt(at.lots);
          const expected = toCnsFloor(
            (filled / at.lots) *
              (equity(before, fill) - before.size * fill * (before.closeFeeRate ?? 0)),
            this.cd,
          );
          // New records carry an exact target; legacy records use the pre-close deposit.
          d.data.readd ??= { deposit: proRata.toString(), amount: expected.toString(), fill };
          const target = BigInt(d.data.readd.deposit) + BigInt(d.data.readd.amount);
          const remaining = target - BigInt(p.c);
          if (!d.data.close) {
            d.data.close = {
              lots: filled,
              filledLots: filled,
              limitPrice: fill,
              fillPrice: fill,
              realizedPnl:
                direction(d.side) * scaled(filled, m.config.size_decimals) * (fill - before.entry),
            };
            this.entry(
              d,
              head,
              'Recovered a close from the position snapshot; its fill price is an estimate.',
            );
          }
          if (at.filledBefore !== undefined) {
            if (at.filledBefore + filled > d.data.close.filledLots) delete d.data.close.fee;
            d.data.close.filledLots = Math.max(d.data.close.filledLots, at.filledBefore + filled);
          }
          d.phase = 'readding';
          this.save(d);
          if (remaining > 0n) {
            episode.readd = { amount: remaining, fill };
            if (episode.attempts >= this.deps.maxAttempts) {
              this.retryOrStop(mkt, episode, 'Could not finish the recovered re-add.', fill);
              continue;
            }
            episode.attempts += 1;
            d.data.attempts = episode.attempts;
            this.episodes.set(mkt, episode);
            if (!(await this.readd(mkt, d, m, remaining, fill))) {
              this.retryOrStop(mkt, episode, 'Will retry the re-add next block.', fill);
              this.recoveryPending.delete(mkt);
              continue;
            }
            this.entry(
              d,
              this.exchange.head,
              'Airbag restarted mid-deploy and restored the released margin.',
            );
          } else
            this.entry(
              d,
              head,
              'Airbag restarted mid-deploy; the released margin was already back.',
            );
          delete d.data.readd;
          delete episode.readd;
          const after = this.after(mkt, m, fill);
          if (
            (after?.distance ?? 1) < d.data.target - 1e-6 &&
            episode.attempts < this.deps.maxAttempts
          ) {
            this.episodes.set(mkt, episode);
            d.phase = 'closing';
            this.recoveryPending.delete(mkt);
            this.save(d);
          } else this.finish(mkt, d, this.exchange.head, 'done', fill);
        } catch (err) {
          this.episodes.delete(mkt);
          this.recoveryPending.add(mkt);
          this.deps.log.warn('deploy.resume.deferred', { id: d.id, err });
          this.save(d);
        } finally {
          this.busy.delete(mkt);
        }
      }
    } finally {
      this.recovering = false;
    }
  }

  /** Waits until `pred` holds or `ms` passes: positions and balances land a frame or two later. */
  private async until(pred: () => boolean, ms = this.deps.settleMs ?? 5_000): Promise<boolean> {
    const step = this.deps.pollMs ?? 50;
    for (let waited = 0; waited <= ms; waited += step) {
      if (pred()) return true;
      if (this.stopped) return false;
      await new Promise((r) => setTimeout(r, step));
    }
    return pred();
  }

  /** The live copy of a deploy this guard is still tracking, if any. */
  live(id: string): Deploy | undefined {
    return this.tracked.get(id);
  }
}

const txOf = (o: { order?: { at?: { txid?: string } } }): { tx?: string } =>
  o.order?.at?.txid ? { tx: o.order.at.txid } : {};
