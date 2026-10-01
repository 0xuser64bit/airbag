'use client';

// Dashboard parts: the primary flight display for the closest position (and its deploy state),
// a runway per position, the per-block strip, and the side bay: mode, key, deploys.

import { equity, fmt, SENSITIVITY } from '@airbag/risk';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/api.ts';
import type {
  Dashboard,
  DeployDetail,
  DeploySummary,
  PositionView,
  Settings,
} from '@/lib/types.ts';
import { BlockLog } from './BlockLog.tsx';
import s from './dashboard.module.css';
import { Check, Cross, External } from './icons.tsx';
import { Annunciator, OutcomeAnnunciator, Readout, RowAnnunciator } from './instruments.tsx';
import { Runway } from './Runway.tsx';
import { Tape } from './Tape.tsx';
import { deploySentence } from './ui.tsx';

const sideWord = (side: 'long' | 'short') => (side === 'long' ? 'falling' : 'rising');
/** The share of the cushion used when Airbag deploys; demo mode deploys on a move instead. */
const trigger = (st: Settings) => (st.demo ? undefined : SENSITIVITY[st.sensitivity]);

function atLineSentence(p: PositionView, st: Settings): string {
  if (!p.covered)
    return `Airbag doesn’t cover ${p.symbol} yet. It’s shown so you can see its distance.`;
  if (!st.armed) return 'Airbag is paused, so nothing happens at the line.';
  const at = p.atLine;
  if (!at || p.line === undefined) return '';
  const target = `${st.targetPct}%`;
  const where = `If ${p.symbol} reaches ${fmt.usd(p.line)}, Airbag`;
  if (at.kind === 'margin')
    return `${where} adds ${fmt.usd(at.amount)} of your spare margin, so liquidation sits ${target} away.`;
  if (at.kind === 'none')
    return `${where} has nothing to do: liquidation is already ${target} away.`;
  const size = `${fmt.size((at.fraction ?? 0) * p.size, p.sizeDecimals)} ${p.symbol}`;
  if (at.capped) {
    const away = at.liquidation === null ? null : Math.abs(p.line - at.liquidation) / p.line;
    return `${where} trims ${size}, the most you allow. Liquidation ends up ${fmt.pct(away)} away.`;
  }
  return `${where} trims ${size}, so liquidation sits ${target} away after estimated trading fees.`;
}

/**
 * The primary flight display: one pane of glass holding the closest position's tape and, beside
 * it, the distance to liquidation, how much of the margin cushion is used against the share
 * where Airbag acts, and what it does there.
 */
export function FlightDisplay({ p, settings }: { p: PositionView; settings: Settings }) {
  const at = trigger(settings);
  const used = Math.max(0, p.cushionUsed ?? 0);
  return (
    <section className={s.pfd} aria-labelledby="closest">
      <header className={s.pfdHead}>
        <h2 id="closest" className="title">
          Closest to liquidation
        </h2>
        <p className={s.position}>
          <span className={s.symbol}>{p.symbol}</span> {p.side} ·{' '}
          <span className="num">
            {fmt.size(p.size, p.sizeDecimals)} {p.symbol}
          </span>{' '}
          · <span className="num">{Math.round(p.nominalLeverage)}x</span>
        </p>
        <RowAnnunciator status={p.status} />
      </header>
      <div className={`well ${s.display}`}>
        <div className={s.tapeCol}>
          <Tape
            side={p.side}
            liquidation={p.liquidation}
            line={p.line}
            mark={p.mark}
            entry={p.entry}
            near={isNear(p, settings)}
            height={400}
          />
        </div>
        <div className={s.readouts}>
          <div className={s.distance}>
            <span className="label">To liquidation</span>
            <span className={`big ${s.bigNum}`}>
              <Readout value={(p.distance * 100).toFixed(2)} />
              <span className={s.pctSign}>%</span>
            </span>
          </div>
          {p.cushionUsed !== undefined && <CushionGauge used={used} at={at} />}
          <p className={s.memo}>{atLineSentence(p, settings)}</p>
        </div>
      </div>
    </section>
  );
}

/** The mark is closing on the line: four fifths of the way there. */
const isNear = (p: PositionView, st: Settings) => {
  const at = trigger(st);
  return at !== undefined && Math.max(0, p.cushionUsed ?? 0) >= 0.8 * at;
};

/** Cushion used: 0 at the reference price, 100% at liquidation, Airbag's share marked. */
function CushionGauge({ used, at }: { used: number; at: number | undefined }) {
  const pct = (v: number) => `${Math.min(1, Math.max(0, v)) * 100}%`;
  return (
    <div className={s.gauge}>
      <div className={s.gaugeHead}>
        <span className="label">Cushion used</span>
        <span className="num">{fmt.pct(used, 1)}</span>
      </div>
      <div
        className={s.gaugeTrack}
        role="img"
        aria-label={`${fmt.pct(used, 1)} of the margin cushion used${at === undefined ? '' : `; Airbag deploys at ${fmt.pct(at, 0)}`}; liquidation at 100%`}
      >
        <div
          className={s.gaugeFill}
          style={{ transform: `scaleX(${Math.min(1, Math.max(0, used))})` }}
        />
        {at !== undefined && <div className={s.gaugeLine} style={{ left: pct(at) }} />}
        <div className={s.gaugeEnd} />
      </div>
      <div className={`num ${s.gaugeScale}`} aria-hidden="true">
        <span>0</span>
        {at !== undefined && (
          <span className={s.gaugeAt} style={{ left: pct(at) }}>
            Airbag {fmt.pct(at, 0)}
          </span>
        )}
        <span className={s.gaugeLiq}>Liq</span>
      </div>
    </div>
  );
}

/** Every open position as a runway: its red band, zone, bug and mark, with its distance. */
export function Positions({ data }: { data: Dashboard }) {
  const account = data.account;
  return (
    <section aria-labelledby="open-positions">
      <div className={s.sectionHead}>
        <h2 id="open-positions" className="title">
          Open positions
        </h2>
        {account && (
          <dl className={s.account}>
            <div>
              <dt className="label">Account value</dt>
              <dd className="num">{fmt.usd(account.value)}</dd>
            </div>
            <div>
              <dt className="label">Spare margin</dt>
              <dd className="num">{fmt.usd(account.spare)}</dd>
            </div>
          </dl>
        )}
      </div>
      {data.positions.length === 0 ? (
        <p className={`well ${s.empty}`}>
          No open positions. Airbag checks every block and arms on anything you open in a covered
          market.
        </p>
      ) : (
        <ul className={`well ${s.runways}`}>
          {data.positions.map((p) => (
            <li key={p.marketId} className={s.runwayRow}>
              <div className={s.runwayHead}>
                <h3 className={s.posName}>
                  <span className={s.symbol}>{p.symbol}</span> {p.side} ·{' '}
                  <span className="num">{Math.round(p.nominalLeverage)}x</span>
                </h3>
                <span className="num muted">
                  {fmt.size(p.size, p.sizeDecimals)} {p.symbol}
                </span>
                <RowAnnunciator status={p.status} />
                <p className={s.posDistance}>
                  <Readout className={`num ${s.posPct}`} value={fmt.pct(p.distance)} />
                  <span className="faint">to liquidation</span>
                </p>
              </div>
              <Runway
                liquidation={p.liquidation}
                line={p.line}
                mark={p.mark}
                entry={p.entry}
                near={isNear(p, data.settings)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Every Monad block the engine checked, newest at the right; the strip feeds left each block. */
export function BlockStrip({ tape }: { tape: Dashboard['tape'] }) {
  const missed = tape.filter((t) => !t.ok).length;
  const span = tape.length > 1 ? ((tape.at(-1)?.at ?? 0) - (tape[0]?.at ?? 0)) / 1000 : 0;
  const head = tape.at(-1)?.block ?? 0;
  const first = tape[0]?.block;
  return (
    <section aria-labelledby="tape-title">
      <div className={s.sectionHead}>
        <h2 id="tape-title" className="title">
          Every block, checked
        </h2>
        <p className="muted">
          Last {tape.length} Monad blocks
          {span > 0 ? ` · ${Math.round(span)} s` : ''} ·{' '}
          {missed === 0 ? 'no gaps' : `${missed} not checked (stale or missed)`}
        </p>
      </div>
      <div className={`well ${s.stripWell}`} aria-hidden="true">
        <div
          className={`${s.cells} ${head % 2 ? s.feedA : s.feedB}`}
          style={{ '--n': Math.max(1, tape.length) } as React.CSSProperties}
        >
          {tape.map((t, i) => (
            <span
              key={t.block}
              className={!t.ok ? s.miss : i === tape.length - 1 ? s.head : undefined}
            />
          ))}
        </div>
      </div>
      <div className={`num ${s.stripEnds}`} aria-hidden="true">
        <span>{first === undefined ? '' : fmt.block(first)}</span>
        <span>{fmt.block(head)}</span>
      </div>
    </section>
  );
}

/** A deploy's detail, refreshed when the stream reports a change and every second in flight. */
export function useDeploy(summary: DeploySummary | undefined): DeployDetail | undefined {
  const { data, reload } = useApi<DeployDetail>(summary ? `/v1/deploys/${summary.id}` : null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: phase and outcome are the triggers
  useEffect(() => {
    if (summary) reload();
  }, [summary?.phase, summary?.outcome, reload]);
  useEffect(() => {
    if (!summary || summary.phase === 'done' || summary.phase === 'failed') return;
    const t = setInterval(reload, 1_000);
    return () => clearInterval(t);
  }, [summary, reload]);
  return data?.id === summary?.id ? data : undefined;
}

export function deployTitle(d: DeployDetail): string {
  if (d.phase === 'closing' || d.phase === 'readding')
    return `Deploying on your ${d.symbol} ${d.side}`;
  if (d.kind === 'margin') return `Added ${fmt.usd(d.spareAdded)} of spare margin`;
  if (d.trimmed > 0)
    return `Trimmed ${fmt.size(d.trimmed, d.sizeDecimals)} ${d.symbol} at ${fmt.usd(d.fillPrice)}`;
  return 'The trim didn’t fill';
}

/**
 * The intervention: the flight display in its deploy state, shown while Airbag acts and for ten
 * minutes after. The bezel takes the hazard stripe; on the tape the envelope moves, with the old
 * liquidation and the old line left as dashed ghosts. The block log prints each step as it lands.
 */
export function InterventionDisplay({ d, p }: { d: DeployDetail; p: PositionView | undefined }) {
  const t = d.data.timeline;
  const first = t[0];
  const last = t.at(-1);
  const tx = d.data.close?.tx ?? d.data.margin?.tx;
  const b = d.data.before;
  const after = d.data.after;
  const moved = p !== undefined && Math.abs(p.liquidation - b.liquidation) > 1e-9;
  const was = d.data.trigger.line;
  const rearmed = p?.line !== undefined && Math.abs(p.line - was) > 1e-9;
  const distance = after ? after.distance : b.distance;
  return (
    <section className={`${s.pfd} redraw`} aria-labelledby="deploy-title">
      <header className={s.interHead}>
        <div className={s.interTitle}>
          <h2 id="deploy-title" className={`display ${s.interH}`}>
            {deployTitle(d)}
          </h2>
          <OutcomeAnnunciator d={d} />
        </div>
        {first && last && (
          <p className={`num ${s.interMeta}`}>
            {fmt.clock(first.at)} → {fmt.clock(last.at)} · blocks {fmt.block(first.block)}–
            {last.block.toLocaleString('en-US')} · fee{' '}
            {fmt.fee(d.kind === 'margin' ? 0 : d.data.close?.fee)}
          </p>
        )}
      </header>
      <div className={`well ${s.display} ${s.deployed} ${p ? '' : s.noTape}`}>
        <div className={`hazard ${s.hazardEdge}`} aria-hidden="true" />
        {p && (
          <div className={s.tapeCol}>
            <Tape
              side={p.side}
              liquidation={p.liquidation}
              line={p.line}
              mark={p.mark}
              ghost={moved ? b.liquidation : undefined}
              ghostLine={rearmed ? was : undefined}
              height={360}
            />
          </div>
        )}
        <div className={s.readouts}>
          <div className={s.distance}>
            <span className="label">To liquidation</span>
            <span className={`big ${s.bigNum}`}>
              {distance === null ? (
                'Closed'
              ) : (
                <>
                  <Readout value={(distance * 100).toFixed(2)} />
                  <span className={s.pctSign}>%</span>
                </>
              )}
            </span>
            <span className={`num ${s.was}`}>
              {after ? <>was {fmt.pct(b.distance)}</> : 'Deploying'}
            </span>
          </div>
          <dl className={s.changes}>
            <BeforeAfter
              k="Size"
              before={fmt.size(b.size, d.sizeDecimals)}
              after={after ? `${fmt.size(after.size, d.sizeDecimals)} ${d.symbol}` : undefined}
            />
            <BeforeAfter
              k="Leverage"
              before={fmt.lev(b.leverage)}
              after={after ? fmt.lev(after.leverage) : undefined}
            />
          </dl>
          <div className={s.interActions}>
            {d.outcome === 'save' && (
              // No prefetch: the kept amount moves with the price, so a fetch
              // now would plant a stale snapshot in the report's cache.
              <Link href={`/s/${d.id}`} prefetch={false} className="btn btn-primary btn-sm">
                See the save report
              </Link>
            )}
            <Link href={`/app/deploys/${d.id}`} className="btn btn-secondary btn-sm">
              Deploy details
            </Link>
            {tx && !d.simulated && (
              <a
                className="btn btn-ghost btn-sm"
                href={`${d.explorerUrl}/tx/${tx}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
                <External />
              </a>
            )}
          </div>
        </div>
      </div>
      <div className={s.logWrap}>
        <h3 className="title">Block log</h3>
        <BlockLog entries={t} explorerUrl={d.explorerUrl} simulated={d.simulated} />
      </div>
    </section>
  );
}

/** A value that changed: the old one faint, the new one lit. Pending until the fill lands. */
function BeforeAfter({
  k,
  before,
  after,
}: {
  k: string;
  before: string;
  after: string | undefined;
}) {
  return (
    <div>
      <dt className="label">{k}</dt>
      <dd className="num">
        <span className="faint">{before}</span>
        <span className={s.arrow} aria-hidden="true">
          →
        </span>
        <span className="visually-hidden"> to </span>
        {after === undefined ? <span className="faint">pending</span> : <span>{after}</span>}
      </dd>
    </div>
  );
}

/** "If BTC keeps falling": both paths priced at the old liquidation price. */
export function KeepsFalling({ d, p }: { d: DeployDetail; p: PositionView | undefined }) {
  if (!p) return null;
  const old = d.data.before.liquidation;
  const withAirbag = equity(p.position, old);
  return (
    <section className={s.section} aria-labelledby="keeps-falling">
      <h2 id="keeps-falling" className="title">
        If {d.symbol} keeps {sideWord(d.side)}
      </h2>
      <p className="muted">
        At your old liquidation price, <span className="num">{fmt.usd(old)}</span>:
      </p>
      <dl className={s.paths}>
        <div>
          <dt>Without Airbag</dt>
          <dd>
            <span className="big liq">{fmt.usd(d.data.counterfactual)}</span>
            <span className="faint">liquidated, position gone</span>
          </dd>
        </div>
        <div>
          <dt>With Airbag</dt>
          <dd>
            <span className="big airbag">{fmt.usd(withAirbag)}</span>
            <span className="faint">
              still open, {fmt.size(p.size, p.sizeDecimals)} {p.symbol}
            </span>
          </dd>
        </div>
      </dl>
      <p className={s.keepsNote}>
        Now liquidates at <span className="num">{fmt.usd(p.liquidation)}</span>.
        {p.line !== undefined && (
          <>
            {' '}
            If it gets close, Airbag deploys again at <span className="num">{fmt.usd(p.line)}</span>
            .
          </>
        )}{' '}
        The liquidation figure is an estimate: 80% of what’s left at that price.
      </p>
    </section>
  );
}

export function RecentDeploys({
  deploys,
  limit = 3,
}: {
  deploys: DeploySummary[];
  limit?: number;
}) {
  return (
    <section className={s.section} aria-labelledby="recent">
      <div className={s.sectionHead}>
        <h2 id="recent" className="title">
          Recent deploys
        </h2>
        {deploys.length > limit && (
          <Link href="/app/deploys" className={s.sideLink}>
            All deploys
          </Link>
        )}
      </div>
      {deploys.length === 0 ? (
        <p className={s.sideNote}>
          None yet. When Airbag acts, the fill and the transaction show up here.
        </p>
      ) : (
        <ul className={s.recent}>
          {deploys.slice(0, limit).map((d) => (
            <li key={d.id}>
              <Link href={`/app/deploys/${d.id}`} className={s.recentLink}>
                <span className={s.recentHead}>
                  <span className={s.recentTitle}>
                    {d.symbol} {d.side}{' '}
                    <span className="num faint">{relativeDay(d.createdAt)}</span>
                  </span>
                  <OutcomeAnnunciator d={d} />
                </span>
                <span className="muted">{deploySentence(d)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function relativeDay(ms: number): string {
  const age = Date.now() - ms;
  if (age < 60_000) return 'Just now';
  if (age < 3_600_000) return `${Math.round(age / 60_000)} min ago`;
  return fmt.date(ms);
}

export function AirbagSummary({
  settings,
  slippageBps = 50,
}: {
  settings: Settings;
  slippageBps?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const toggle = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api('/v1/settings', { method: 'PUT', body: { armed: !settings.armed } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const when = settings.demo
    ? 'Demo mode: after a 0.3% move'
    : {
        early: 'Early, when a third of the cushion is gone',
        balanced: 'Balanced, when half the cushion is gone',
        late: 'Late, when three quarters are gone',
      }[settings.sensitivity];
  return (
    <section className={s.section} aria-labelledby="your-airbag">
      <div className={s.sectionHead}>
        <h2 id="your-airbag" className="title">
          Your airbag
        </h2>
        <div className={s.sectionActions}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={toggle} disabled={busy}>
            {settings.armed ? 'Pause' : 'Resume'}
          </button>
          <Link href="/app/settings" className="btn btn-secondary btn-sm">
            Edit
          </Link>
        </div>
      </div>
      {error && (
        <p className="notice" data-tone="alert" role="alert">
          {error}
        </p>
      )}
      <dl className={s.summary}>
        <div>
          <dt>Deploys</dt>
          <dd>{when}</dd>
        </div>
        <div>
          <dt>Trims until</dt>
          <dd>Liquidation is {settings.targetPct}% away</dd>
        </div>
        <div>
          <dt>Most per deploy</dt>
          <dd>{settings.maxTrimPct}% of the position</dd>
        </div>
        <div>
          <dt>Spare margin</dt>
          <dd>{settings.useSpare ? 'First, when it’s enough' : 'Never used'}</dd>
        </div>
        <div>
          <dt>Worst fill</dt>
          <dd>{(slippageBps / 100).toString()}% from the mark</dd>
        </div>
      </dl>
    </section>
  );
}

export function KeyHealth({
  data,
  now,
  perplUrl,
}: {
  data: Dashboard;
  now: number;
  perplUrl: string | undefined;
}) {
  const key = data.key;
  if (!key) return null;
  const live = key.state === 'live';
  const ago = key.lastMessageAt ? Math.max(0, (now - key.lastMessageAt) / 1000) : undefined;
  const forwardingOff = data.account && !data.account.forwarding;
  const ok = live && !forwardingOff;
  return (
    <section className={s.section} aria-labelledby="perpl-key">
      <div className={s.sectionHead}>
        <h2 id="perpl-key" className="title">
          Perpl key <span className="num faint">…{key.keyHint}</span>
        </h2>
        <a
          href={`${perplUrl ?? 'https://app.perpl.xyz'}/apikeys`}
          target="_blank"
          rel="noreferrer"
          className={s.sideLink}
        >
          Revoke on Perpl
          <External size={13} />
        </a>
      </div>
      <ul className={s.checks}>
        <li>
          <Check />
          <span>
            Can’t withdraw or transfer
            <span className="faint">Enforced by Perpl</span>
          </span>
        </li>
        <li>
          <Check />
          <span>
            Reduce-only orders
            <span className="faint">Enforced by Airbag’s open-source engine</span>
          </span>
        </li>
        <li className={ok ? undefined : s.failing}>
          {ok ? <Check /> : <Cross />}
          <span>
            {forwardingOff
              ? 'One-Click Trading is off'
              : live
                ? 'Connected, healthy'
                : key.state === 'rejected'
                  ? 'Perpl refused this key'
                  : key.state === 'limited'
                    ? 'Too many Perpl connections'
                    : 'Connecting to Perpl'}
            <span className="faint">
              {forwardingOff ? (
                'Turn it on in Perpl’s settings'
              ) : key.state === 'rejected' ? (
                'Relink a working key'
              ) : ago !== undefined ? (
                <>
                  Last message <span className="num">{ago.toFixed(1)} s</span> ago · IP lock set by
                  you
                </>
              ) : (
                'IP lock set by you'
              )}
            </span>
          </span>
        </li>
      </ul>
      {key.state === 'rejected' && (
        <Link href="/link-key" className="btn btn-secondary btn-sm" style={{ alignSelf: 'start' }}>
          Relink key
        </Link>
      )}
    </section>
  );
}

const BANNERS: Partial<Record<Dashboard['status'], { lamp: string; text: string }>> = {
  'key-rejected': {
    lamp: 'Key rejected',
    text: 'Perpl refused Airbag’s key, so Airbag can’t act. Revoked, expired, or an IP allow-list that doesn’t include Airbag are the usual causes. Link a working key.',
  },
  'forwarding-off': {
    lamp: 'One-Click off',
    text: 'One-Click Trading is off on your Perpl account, so every order Airbag sent would fail. Turn it on in Perpl’s settings; Airbag picks it up on its own.',
  },
  'too-many-connections': {
    lamp: 'Connection limit',
    text: 'Your wallet has four Perpl connections open (browser tabs count), so Perpl refused Airbag’s. Close a Perpl tab; Airbag retries on its own.',
  },
  frozen: {
    lamp: 'Frozen',
    text: 'Your Perpl account is frozen. Airbag can’t act until Perpl unfreezes it.',
  },
  stale: {
    lamp: 'Holding',
    text: 'Market data is behind the chain, so Airbag is holding: it never acts on stale prices. It resumes when data catches up.',
  },
  connecting: {
    lamp: 'Connecting',
    text: 'Connecting to Perpl with your key. Airbag isn’t protecting you until this finishes.',
  },
};

/** What's wrong, in the words of the lamp that's lit, and what to do about it. */
export function StatusBanner({ data }: { data: Dashboard }) {
  const b = BANNERS[data.status];
  if (!b) return null;
  const blocking = data.status !== 'stale' && data.status !== 'connecting';
  return (
    <div className={`notice ${s.banner}`} data-tone={blocking ? 'alert' : undefined} role="alert">
      <Annunciator state={blocking ? 'alert' : 'on'} size="sm">
        {b.lamp}
      </Annunciator>
      <p>{b.text}</p>
      {data.status === 'key-rejected' && (
        <Link href="/link-key" className="btn btn-secondary btn-sm">
          Relink
        </Link>
      )}
    </div>
  );
}

export function PausedBanner() {
  const [busy, setBusy] = useState(false);
  return (
    <div className={`notice ${s.banner}`} role="status">
      <Annunciator state="off" size="sm">
        Paused
      </Annunciator>
      <p>Airbag is paused. It keeps checking, but won’t trim or add margin until you resume.</p>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api('/v1/settings', { method: 'PUT', body: { armed: true } }).finally(() =>
            setBusy(false),
          );
        }}
      >
        Resume
      </button>
    </div>
  );
}

/** Simulation only: drive the scripted chain from the dashboard. */
export function SimControls({ symbols }: { symbols: string[] }) {
  const [note, setNote] = useState<string | undefined>();
  const run = async (path: string, body: unknown, done: string) => {
    setNote(undefined);
    try {
      await api(path, { method: 'POST', body });
      setNote(done);
    } catch (err) {
      setNote((err as Error).message);
    }
  };
  return (
    <section className={s.section} aria-labelledby="sim-controls">
      <div className={s.sectionHead}>
        <h2 id="sim-controls" className="title">
          Simulation controls
        </h2>
        <Annunciator state="off" size="sm">
          Paper
        </Annunciator>
      </div>
      <p className="muted">
        Plays the landing page’s crash-test wick, one price per block, through the real engine on a
        paper exchange. Only your account’s prices move.
      </p>
      <div className={s.simButtons}>
        {symbols.map((sym) => (
          <button
            key={sym}
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => run('/v1/sim/wick', { symbol: sym }, `Playing a wick on ${sym}.`)}
          >
            Play a wick on {sym}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => run('/v1/sim/reset', {}, 'Account reset.')}
        >
          Reset account
        </button>
      </div>
      {note && (
        <p className="faint" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
