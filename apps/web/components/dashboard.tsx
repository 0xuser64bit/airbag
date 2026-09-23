'use client';

// Dashboard parts (design/Dashboard.dc.html, Deployed.dc.html, MobileHome.dc.html).

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
import s from './dashboard.module.css';
import { Check, Cross, External } from './icons.tsx';
import { Runway } from './Runway.tsx';
import { deploySentence, OutcomeBadge, Timeline } from './ui.tsx';

const sideWord = (side: 'long' | 'short') => (side === 'long' ? 'falling' : 'rising');
const f = (st: Settings) => (st.demo ? 0.5 : SENSITIVITY[st.sensitivity]);

/** "BTC long · 10x". */
export const label = (p: Pick<PositionView, 'symbol' | 'side' | 'nominalLeverage'>) =>
  `${p.symbol} ${p.side} · ${Math.round(p.nominalLeverage)}x`;

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
    return `${where} trims ${size}, the most you allow, fee-free. Liquidation ends up ${fmt.pct(away)} away.`;
  }
  return `${where} trims ${size}, fee-free, so liquidation sits ${target} away.`;
}

export function Closest({ p, settings }: { p: PositionView; settings: Settings }) {
  const near = (p.cushionUsed ?? 0) >= 0.8 * f(settings);
  return (
    <section className={`card ${s.hero}`} aria-labelledby="closest">
      <div className={s.heroTop}>
        <div className={s.heroLeft}>
          <span id="closest" className="eyebrow">
            Closest to liquidation
          </span>
          <span style={{ fontSize: 17, fontWeight: 500 }}>
            {p.symbol} {p.side} · {fmt.size(p.size, p.sizeDecimals)} {p.symbol} ·{' '}
            {Math.round(p.nominalLeverage)}x
          </span>
          <div className={s.bigRow}>
            <span className={`big ${s.bigNum}`}>
              {(p.distance * 100).toFixed(2)}
              <span className={s.bigPct}>%</span>
            </span>
            <span className="muted" style={{ fontSize: 17 }}>
              to liquidation
            </span>
          </div>
        </div>
        <dl className={s.stats}>
          <Stat k="Mark" v={fmt.usd(p.mark)} />
          <Stat k="Liquidation" v={fmt.usd(p.liquidation)} tone="liq" />
          {p.line !== undefined && <Stat k="Airbag line" v={fmt.usd(p.line)} tone="airbag" />}
          {p.cushionUsed !== undefined && (
            <Stat k="Cushion used" v={fmt.pct(Math.max(0, p.cushionUsed), 1)} />
          )}
        </dl>
      </div>
      <Runway
        side={p.side}
        liquidation={p.liquidation}
        line={p.line}
        mark={p.mark}
        entry={p.entry}
        near={near}
      />
      <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
        {atLineSentence(p, settings)}
      </p>
    </section>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'liq' | 'airbag' }) {
  return (
    <div>
      <dt className="eyebrow" style={{ letterSpacing: '0.08em' }}>
        {k}
      </dt>
      <dd className={`num ${tone ?? ''}`} style={{ marginTop: 6, fontSize: 18 }}>
        {v}
      </dd>
    </div>
  );
}

const ROW_STATUS: Record<PositionView['status'], { text: string; cls: string; dot: boolean }> = {
  armed: { text: 'Armed', cls: '', dot: true },
  're-armed': { text: 'Re-armed', cls: 'pill-airbag', dot: false },
  deploying: { text: 'Deploying', cls: 'pill-solid', dot: false },
  paused: { text: 'Paused', cls: 'pill-muted', dot: true },
  blocked: { text: 'Held', cls: 'pill-muted', dot: true },
  'not-covered': { text: 'Not covered', cls: 'pill-muted', dot: false },
};

export function RowPill({ status }: { status: PositionView['status'] }) {
  const r = ROW_STATUS[status];
  return (
    <span className={`pill pill-sm ${r.cls}`}>
      {r.dot && <span className="dot" aria-hidden="true" />}
      {r.text}
    </span>
  );
}

export function PositionsTable({ data }: { data: Dashboard }) {
  const account = data.account;
  return (
    <section className={`card ${s.positions}`} aria-labelledby="open-positions">
      <div className={s.positionsHead}>
        <h2 id="open-positions" style={{ fontSize: 16, fontWeight: 600 }}>
          Open positions
        </h2>
        {account && (
          <span className="muted" style={{ fontSize: 13 }}>
            Account value{' '}
            <span className="num" style={{ color: 'var(--bone)' }}>
              {fmt.usd(account.value)}
            </span>{' '}
            · Spare margin{' '}
            <span className="num" style={{ color: 'var(--bone)' }}>
              {fmt.usd(account.spare)}
            </span>
          </span>
        )}
      </div>
      {data.positions.length === 0 ? (
        <p className="muted" style={{ padding: '8px 32px 24px', fontSize: 15 }}>
          No open positions. Airbag checks every block and arms on anything you open in a covered
          market.
        </p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Size</th>
                <th scope="col">Entry</th>
                <th scope="col">Mark</th>
                <th scope="col">Liquidation</th>
                <th scope="col">Airbag line</th>
                <th scope="col">To liq</th>
                <th scope="col">Airbag</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map((p) => (
                <tr key={p.marketId}>
                  <th scope="row">
                    <span style={{ fontWeight: 600 }}>{p.symbol}</span>{' '}
                    <span className="muted">
                      {p.side} · {Math.round(p.nominalLeverage)}x
                    </span>
                  </th>
                  <td className="num">{fmt.size(p.size, p.sizeDecimals)}</td>
                  <td className="num">{fmt.usd(p.entry)}</td>
                  <td className="num">{fmt.usd(p.mark)}</td>
                  <td className="num">{fmt.usd(p.liquidation)}</td>
                  <td className="num airbag">{p.line === undefined ? '—' : fmt.usd(p.line)}</td>
                  <td className="num">{fmt.pct(p.distance)}</td>
                  <td>
                    <RowPill status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Phone layout of the other positions (design/MobileHome.dc.html). */
export function PositionCards({ positions }: { positions: PositionView[] }) {
  return (
    <div className={s.cards}>
      {positions.map((p) => (
        <section key={p.marketId} className={`card ${s.miniCard}`} aria-label={label(p)}>
          <div className={s.miniHead}>
            <span style={{ fontSize: 15 }}>
              <span style={{ fontWeight: 600 }}>{p.symbol}</span>{' '}
              <span className="muted">
                {p.side} · {Math.round(p.nominalLeverage)}x
              </span>
            </span>
            <span className="num" style={{ fontSize: 15 }}>
              {fmt.pct(p.distance)}
            </span>
          </div>
          <Runway side={p.side} liquidation={p.liquidation} line={p.line} mark={p.mark} size="sm" />
          <div className={`num muted ${s.miniLabels}`}>
            <span>Liq {fmt.usd(p.liquidation)}</span>
            {p.line !== undefined ? (
              <span className="airbag">Airbag {fmt.usd(p.line)}</span>
            ) : (
              <span>Not covered</span>
            )}
            <span>Mark {fmt.usd(p.mark)}</span>
          </div>
        </section>
      ))}
    </div>
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

export function DeployDetailCard({ d }: { d: DeployDetail }) {
  const t = d.data.timeline;
  const first = t[0];
  const last = t.at(-1);
  const tx = d.data.close?.tx ?? d.data.margin?.tx;
  const after = d.data.after;
  return (
    <section className={`card ${s.deploy}`} aria-labelledby="deploy-title">
      <div className="hazard" aria-hidden="true" />
      <div className={s.deployBody}>
        <div className={s.deployHead}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="eyebrow airbag">
              Airbag deployed · {d.symbol} {d.side}
            </span>
            <h1
              id="deploy-title"
              className="display"
              style={{ fontSize: 'clamp(24px, 2.4vw, 32px)', lineHeight: 1.1 }}
            >
              {deployTitle(d)}
            </h1>
            {first && last && (
              <span className="num muted" style={{ fontSize: 12 }}>
                {fmt.clock(first.at)} → {fmt.clock(last.at)} · blocks {fmt.block(first.block)}–
                {last.block % 1000} · fee $0
              </span>
            )}
          </div>
          {tx && !d.simulated && (
            <a
              className="btn btn-secondary"
              href={`${d.explorerUrl}/tx/${tx}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction
              <External />
            </a>
          )}
        </div>
        <dl className={s.beforeAfter}>
          <BeforeAfter
            k="Liquidation"
            before={fmt.usd(d.data.before.liquidation)}
            after={
              after ? (after.liquidation === null ? 'Closed' : fmt.usd(after.liquidation)) : '…'
            }
          />
          <BeforeAfter
            k="To liquidation"
            before={fmt.pct(d.data.before.distance)}
            after={after ? fmt.pct(after.distance) : '…'}
          />
          <BeforeAfter
            k="Size"
            before={fmt.size(d.data.before.size, d.sizeDecimals)}
            after={after ? `${fmt.size(after.size, d.sizeDecimals)} ${d.symbol}` : '…'}
          />
          <BeforeAfter
            k="Leverage"
            before={fmt.lev(d.data.before.leverage)}
            after={after ? fmt.lev(after.leverage) : '…'}
          />
        </dl>
        <Timeline entries={t} explorerUrl={d.explorerUrl} simulated={d.simulated} />
      </div>
    </section>
  );
}

function BeforeAfter({ k, before, after }: { k: string; before: string; after: string }) {
  return (
    <div>
      <dt className="eyebrow" style={{ letterSpacing: '0.08em' }}>
        {k}
      </dt>
      <dd className="num" style={{ fontSize: 16 }}>
        <span className="faint">{before}</span> <span className="faint">→</span> {after}
      </dd>
    </div>
  );
}

/** "If BTC keeps falling": the counterfactual at the old liquidation price. */
export function KeepsFalling({ d, p }: { d: DeployDetail; p: PositionView | undefined }) {
  if (!p) return null;
  const old = d.data.before.liquidation;
  const withAirbag = equity(p.position, old);
  return (
    <section className={`card ${s.side}`} aria-labelledby="keeps-falling">
      <h2 id="keeps-falling" style={{ fontSize: 16, fontWeight: 600 }}>
        If {d.symbol} keeps {sideWord(d.side)}
      </h2>
      <p className="muted" style={{ fontSize: 14 }}>
        At your old liquidation price,{' '}
        <span className="num" style={{ color: 'var(--bone)' }}>
          {fmt.usd(old)}
        </span>
        :
      </p>
      <div className={s.cf} style={{ borderColor: 'var(--liq-edge)' }}>
        <span className="muted">Without Airbag</span>
        <span className={s.cfValue}>
          <span className="big liq" style={{ fontSize: 22 }}>
            {fmt.usd(d.data.counterfactual)}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            liquidated, position gone
          </span>
        </span>
      </div>
      <div className={s.cf} style={{ borderColor: 'rgba(242,193,46,0.55)' }}>
        <span className="muted">With Airbag</span>
        <span className={s.cfValue}>
          <span className="big airbag" style={{ fontSize: 22 }}>
            {fmt.usd(withAirbag)}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            still open, {fmt.size(p.size, p.sizeDecimals)} {p.symbol}
          </span>
        </span>
      </div>
      <p className="faint" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Now liquidates at {fmt.usd(p.liquidation)}.
        {p.line !== undefined && ` If it gets close, Airbag deploys again at ${fmt.usd(p.line)}.`}{' '}
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
    <section className={`card ${s.side}`} aria-labelledby="recent">
      <h2 id="recent" style={{ fontSize: 16, fontWeight: 600 }}>
        Recent deploys
      </h2>
      {deploys.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>
          None yet. When Airbag acts, the fill and the transaction show up here.
        </p>
      ) : (
        <ul className={s.recent}>
          {deploys.slice(0, limit).map((d) => (
            <li key={d.id}>
              <Link href={`/app/deploys/${d.id}`} className={s.recentLink}>
                <span className={s.recentHead}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {d.symbol} {d.side}{' '}
                    <span className="num muted" style={{ fontSize: 12, fontWeight: 400 }}>
                      {relativeDay(d.createdAt)}
                    </span>
                  </span>
                  <OutcomeBadge d={d} />
                </span>
                <span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
                  {deploySentence(d)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {deploys.length > limit && (
        <Link href="/app/deploys" className="muted" style={{ fontSize: 13 }}>
          All deploys
        </Link>
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
    <section className={`card ${s.side}`} aria-labelledby="your-airbag" style={{ gap: 18 }}>
      <div className={s.sideHead}>
        <h2 id="your-airbag" style={{ fontSize: 16, fontWeight: 600 }}>
          Your airbag
        </h2>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={toggle} disabled={busy}>
            {settings.armed ? 'Pause' : 'Resume'}
          </button>
          <Link href="/app/settings" className="btn btn-secondary btn-sm">
            Edit
          </Link>
        </div>
      </div>
      {error && (
        <p className="liq" role="alert" style={{ fontSize: 13 }}>
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

export function KeyHealth({ data, now }: { data: Dashboard; now: number }) {
  const key = data.key;
  if (!key) return null;
  const live = key.state === 'live';
  const ago = key.lastMessageAt ? Math.max(0, (now - key.lastMessageAt) / 1000) : undefined;
  const forwardingOff = data.account && !data.account.forwarding;
  return (
    <section className={`card ${s.side}`} aria-labelledby="perpl-key">
      <div className={s.sideHead}>
        <h2 id="perpl-key" style={{ fontSize: 16, fontWeight: 600 }}>
          Perpl key{' '}
          <span className="num muted" style={{ fontSize: 12, fontWeight: 400 }}>
            …{key.keyHint}
          </span>
        </h2>
        <a
          href="https://app.perpl.xyz/apikeys"
          target="_blank"
          rel="noreferrer"
          className="muted"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          Revoke on Perpl
          <External size={13} />
        </a>
      </div>
      <ul className="check-list">
        <li>
          <Check color="#ECE9E0" />
          <span className={s.twoLine}>
            <span>Can’t withdraw or transfer</span>
            <span className="faint">Enforced by Perpl</span>
          </span>
        </li>
        <li>
          <Check color="#ECE9E0" />
          <span className={s.twoLine}>
            <span>Reduce-only orders</span>
            <span className="faint">Enforced by Airbag’s open-source engine</span>
          </span>
        </li>
        <li>
          {live && !forwardingOff ? <Check color="#ECE9E0" /> : <Cross color="#FF6A55" />}
          <span className={s.twoLine}>
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
            </span>
            <span className="num faint" style={{ fontSize: 11 }}>
              {forwardingOff
                ? 'Turn it on in Perpl’s settings'
                : key.state === 'rejected'
                  ? 'Relink a working key'
                  : ago !== undefined
                    ? `Last message ${ago.toFixed(1)} s ago · IP lock set by you`
                    : 'IP lock set by you'}
            </span>
          </span>
        </li>
      </ul>
      {key.state === 'rejected' && (
        <Link
          href="/link-key"
          className="btn btn-secondary btn-sm"
          style={{ alignSelf: 'flex-start' }}
        >
          Relink key
        </Link>
      )}
    </section>
  );
}

const BANNERS: Partial<Record<Dashboard['status'], string>> = {
  'key-rejected':
    'Perpl refused Airbag’s key, so Airbag can’t act. Revoked, expired, or an IP allow-list that doesn’t include Airbag are the usual causes. Link a working key.',
  'forwarding-off':
    'One-Click Trading is off on your Perpl account, so every order Airbag sent would fail. Turn it on in Perpl’s settings; Airbag picks it up on its own.',
  'too-many-connections':
    'Your wallet has four Perpl connections open (browser tabs count), so Perpl refused Airbag’s. Close a Perpl tab; Airbag retries on its own.',
  frozen: 'Your Perpl account is frozen. Airbag can’t act until Perpl unfreezes it.',
  stale:
    'Market data is behind the chain, so Airbag is holding: it never acts on stale prices. It resumes when data catches up.',
  connecting: 'Connecting to Perpl with your key. Airbag isn’t protecting you until this finishes.',
};

export function StatusBanner({ data }: { data: Dashboard }) {
  const text = BANNERS[data.status];
  if (!text) return null;
  const blocking = data.status !== 'stale' && data.status !== 'connecting';
  return (
    <div className={`notice ${blocking ? 'notice-liq' : ''}`} role="alert">
      {text}
      {data.status === 'key-rejected' && (
        <Link href="/link-key" style={{ whiteSpace: 'nowrap' }}>
          Relink
        </Link>
      )}
    </div>
  );
}

export function PausedBanner() {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="notice"
      role="status"
      style={{ justifyContent: 'space-between', alignItems: 'center' }}
    >
      <span>
        Airbag is paused. It keeps checking, but won’t trim or add margin until you resume.
      </span>
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
    <section
      className={`card ${s.side}`}
      aria-labelledby="sim-controls"
      style={{ borderStyle: 'dashed' }}
    >
      <h2 id="sim-controls" style={{ fontSize: 16, fontWeight: 600 }}>
        Simulation controls
      </h2>
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Plays the landing page’s crash-test wick, one price per block, through the real engine on a
        paper exchange.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
        <p className="faint" role="status" style={{ fontSize: 13 }}>
          {note}
        </p>
      )}
    </section>
  );
}
