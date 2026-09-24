// Small shared pieces that also render on the server (the landing and the save report).

import { fmt } from '@airbag/risk';
import Link from 'next/link';
import type { DeploySummary, TimelineEntry } from '@/lib/types.ts';
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
    <ol className={`timeline ${compact ? 'timeline-compact' : ''}`}>
      {entries.map((e) => (
        <li key={`${e.at}-${e.text}`}>
          <span className="num tl-block">{fmt.block(e.block)}</span>
          <span className={`num tl-time ${e.tone === 'airbag' ? 'tl-airbag' : ''}`}>
            {fmt.clock(e.at)}
          </span>
          <span className={`tl-text ${e.tone === 'liquidation' ? 'liq' : ''}`}>{e.text}</span>
          <span className="tl-tx">
            <TxLink tx={e.tx} explorerUrl={explorerUrl} simulated={simulated} />
          </span>
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
