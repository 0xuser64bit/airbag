// Small shared pieces that also render on the server (the landing and the save report).

import { fmt } from '@airbag/risk';
import Link from 'next/link';
import type { DeploySummary } from '@/lib/types.ts';
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
      data-brand=""
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
export function deploySentence(d: DeploySummary): string {
  const what =
    d.kind === 'margin'
      ? `Added ${fmt.usd(d.spareAdded)} of spare margin.`
      : d.trimmed > 0
        ? `Trimmed ${fmt.size(d.trimmed, d.sizeDecimals)} ${d.symbol}.`
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
  if (!tx) return null;
  if (simulated) return <span className="num faint">simulated</span>;
  // A malformed txid must never become a link: render it as text instead of navigating
  // the trader somewhere unexpected.
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) {
    return (
      <span className="num faint" title={tx}>
        {fmt.short(tx)}
      </span>
    );
  }
  return (
    <a
      className="num txlink"
      href={`${explorerUrl}/tx/${tx}`}
      target="_blank"
      rel="noreferrer"
      title={tx}
    >
      {fmt.short(tx)}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
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
