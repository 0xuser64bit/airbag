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
