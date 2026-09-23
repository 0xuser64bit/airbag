// Small shared pieces from design/System.dc.html.

import { fmt } from '@airbag/risk';
import Link from 'next/link';
import type { DeploySummary, GuardStatus, TimelineEntry } from '@/lib/types.ts';
import { Mark } from './icons.tsx';

export function Brand({
  href = '/',
  size = 24,
  text = 16,
}: {
  href?: string;
  size?: number;
  text?: number;
}) {
  return (
    <Link
      href={href}
      aria-label="Airbag home"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        textDecoration: 'none',
        color: 'var(--bone)',
      }}
    >
      <Mark size={size} />
      <span className="wordmark" style={{ fontSize: text }}>
        AIRBAG
      </span>
    </Link>
  );
}

const STATUS: Record<
  GuardStatus,
  { text: string; kind: 'armed' | 'solid' | 'airbag' | 'muted' | 'liq' }
> = {
  armed: { text: 'Armed', kind: 'armed' },
  're-armed': { text: 'Deployed · re-armed', kind: 'airbag' },
  deploying: { text: 'Deploying', kind: 'solid' },
  paused: { text: 'Paused', kind: 'muted' },
  'key-rejected': { text: 'Key rejected · relink', kind: 'liq' },
  'forwarding-off': { text: 'One-Click Trading off', kind: 'liq' },
  'too-many-connections': { text: 'Perpl connection limit', kind: 'liq' },
  frozen: { text: 'Account frozen', kind: 'liq' },
  connecting: { text: 'Connecting to Perpl', kind: 'muted' },
  stale: { text: 'Data stale · holding', kind: 'muted' },
  unlinked: { text: 'No key linked', kind: 'muted' },
};

export function StatusPill({ status, small = false }: { status: GuardStatus; small?: boolean }) {
  const s = STATUS[status];
  const cls =
    s.kind === 'solid'
      ? 'pill-solid'
      : s.kind === 'airbag'
        ? 'pill-airbag'
        : s.kind === 'liq'
          ? 'pill-liq'
          : s.kind === 'muted'
            ? 'pill-muted'
            : '';
  return (
    <span className={`pill ${small ? 'pill-sm' : ''} ${cls}`} role="status">
      {(s.kind === 'armed' || s.kind === 'muted') && <span className="dot" aria-hidden="true" />}
      {s.text}
    </span>
  );
}

export function OutcomeBadge({ d }: { d: Pick<DeploySummary, 'phase' | 'outcome'> }) {
  if (d.outcome === 'save') {
    return (
      <span className="pill pill-xs pill-solid" style={{ fontWeight: 600 }}>
        Saved
      </span>
    );
  }
  if (d.phase === 'failed')
    return <span className="pill pill-xs pill-muted">Didn&apos;t fill</span>;
  if (d.outcome === 'precaution')
    return <span className="pill pill-xs pill-muted">Precaution</span>;
  if (d.phase !== 'done') return <span className="pill pill-xs pill-solid">Deploying</span>;
  return <span className="pill pill-xs pill-airbag">Deployed</span>;
}

/** One line of what a deploy did, for lists. */
export function deploySentence(d: DeploySummary, sizeDecimals = 3): string {
  const what =
    d.kind === 'margin'
      ? `Added ${fmt.usd(d.spareAdded)} of spare margin.`
      : d.trimmed > 0
        ? `Trimmed ${fmt.size(d.trimmed, sizeDecimals)} ${d.symbol}.`
        : 'The close didn’t fill.';
  if (d.outcome === 'save') {
    const after = d.saveAfterMs === null ? '' : ` ${fmt.duration(d.saveAfterMs)} later`;
    return `${what} The old liquidation price was hit${after}.`;
  }
  if (d.outcome === 'precaution') return `${what} The old liquidation price was never hit.`;
  if (d.phase === 'done')
    return `${what} If ${fmt.usd(d.liquidationBefore)} is hit, this becomes a save.`;
  return what;
}

export function BlockTape({ tape }: { tape: { block: number; ok: boolean; at: number }[] }) {
  const missed = tape.filter((t) => !t.ok).length;
  const span = tape.length > 1 ? ((tape.at(-1)?.at ?? 0) - (tape[0]?.at ?? 0)) / 1000 : 0;
  return (
    <section
      className="card"
      aria-labelledby="tape-title"
      style={{
        padding: '20px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 32,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 id="tape-title" style={{ fontSize: 16, fontWeight: 600 }}>
          Every block, checked
        </h2>
        <span className="muted" style={{ fontSize: 13 }}>
          Last {tape.length} Monad blocks
          {span > 0 ? ` · ${Math.round(span)} s` : ''} ·{' '}
          {missed === 0 ? 'no gaps' : `${missed} not checked (stale or missed)`}
        </span>
      </div>
      <div
        aria-hidden="true"
        style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}
      >
        {tape.map((t, i) => (
          <span
            key={t.block}
            title={`${fmt.block(t.block)}${t.ok ? '' : ' · not checked'}`}
            style={{
              width: 6,
              height: 20,
              borderRadius: 2,
              background: !t.ok
                ? 'transparent'
                : i === tape.length - 1
                  ? 'var(--bone)'
                  : 'var(--line-strong)',
              border: t.ok ? 'none' : '1px solid var(--line-strong)',
            }}
          />
        ))}
      </div>
    </section>
  );
}

export function TxLink({
  tx,
  explorerUrl,
  simulated,
}: {
  tx?: string | undefined;
  explorerUrl: string;
  simulated: boolean;
}) {
  if (!tx) return <span />;
  if (simulated)
    return (
      <span className="num faint" style={{ fontSize: 12 }}>
        simulated
      </span>
    );
  return (
    <a
      className="num"
      href={`${explorerUrl}/tx/${tx}`}
      target="_blank"
      rel="noreferrer"
      style={{ fontSize: 12, color: 'var(--airbag)', textDecoration: 'none' }}
    >
      {fmt.short(tx)}
    </a>
  );
}

export function Timeline({
  entries,
  explorerUrl,
  simulated,
  compact = false,
}: {
  entries: TimelineEntry[];
  explorerUrl: string;
  simulated: boolean;
  compact?: boolean;
}) {
  return (
    <ol
      className="timeline"
      style={{ display: 'flex', flexDirection: 'column', gap: compact ? 12 : 10 }}
    >
      {entries.map((e) => (
        <li
          key={`${e.at}-${e.text}`}
          style={{
            display: 'grid',
            gridTemplateColumns: compact ? '76px minmax(0, 1fr)' : '120px 96px minmax(0, 1fr) auto',
            gap: compact ? 12 : 16,
            alignItems: 'baseline',
          }}
        >
          {!compact && (
            <span className="num muted" style={{ fontSize: 12 }}>
              {fmt.block(e.block)}
            </span>
          )}
          <span
            className="num"
            style={{
              fontSize: compact ? 11 : 12,
              color: e.tone === 'airbag' && compact ? 'var(--airbag)' : 'var(--text-2)',
            }}
          >
            {fmt.clock(e.at)}
          </span>
          <span
            style={{
              fontSize: compact ? 13 : 14,
              lineHeight: 1.45,
              color: e.tone === 'liquidation' ? 'var(--liq)' : undefined,
            }}
          >
            {e.text}
          </span>
          {!compact && <TxLink tx={e.tx} explorerUrl={explorerUrl} simulated={simulated} />}
        </li>
      ))}
    </ol>
  );
}

export function SimBanner() {
  return (
    <div className="sim-banner" role="note">
      <strong>Simulation.</strong> A paper exchange and scripted prices. Nothing here is sent to
      Perpl.
    </div>
  );
}
