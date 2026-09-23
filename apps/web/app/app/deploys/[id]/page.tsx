'use client';

// One deploy (design/MobileDeploy.dc.html, which is also the reference for wider screens).

import { fmt } from '@airbag/risk';
import Link from 'next/link';
import { use, useEffect } from 'react';
import { deployTitle } from '@/components/dashboard.tsx';
import { Back, External } from '@/components/icons.tsx';
import { OutcomeBadge, Timeline } from '@/components/ui.tsx';
import { useApi } from '@/lib/api.ts';
import type { DeployDetail } from '@/lib/types.ts';

export default function DeployPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d, error, reload } = useApi<DeployDetail>(`/v1/deploys/${encodeURIComponent(id)}`);
  useEffect(() => {
    if (!d || d.phase === 'done' || d.phase === 'failed') return;
    const t = setInterval(reload, 1_000);
    return () => clearInterval(t);
  }, [d, reload]);

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
        <p>{error.status === 404 ? 'No deploy with that id on your account.' : error.message}</p>
        <Link href="/app/deploys">All deploys</Link>
      </div>
    );
  }
  if (!d) return <p className="muted">Loading…</p>;

  const tx = d.data.close?.tx ?? d.data.margin?.tx;
  const after = d.data.after;
  const b = d.data.before;
  return (
    <article style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
      >
        <Link href="/app/deploys" className="btn btn-ghost" style={{ paddingLeft: 4 }}>
          <Back />
          Deploys
        </Link>
        <OutcomeBadge d={d} />
      </div>
      <div className="hazard" aria-hidden="true" style={{ height: 6, borderRadius: 2 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="eyebrow airbag">
          Deployed · {fmt.date(d.createdAt)} {fmt.clock(d.createdAt).slice(0, 8)}
        </span>
        <h1 className="display" style={{ fontSize: 26, lineHeight: 1.15 }}>
          {deployTitle(d)}
        </h1>
        {after?.distance !== undefined && after.distance !== null && (
          <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
            Your {d.symbol} {d.side} was{' '}
            <span className="num" style={{ color: 'var(--bone)' }}>
              {fmt.pct(b.distance)}
            </span>{' '}
            from liquidation. Now it’s{' '}
            <span className="num" style={{ color: 'var(--bone)' }}>
              {fmt.pct(after.distance)}
            </span>
            .{d.kind === 'trim' ? ' The trim was fee-free.' : ''}
          </p>
        )}
      </div>

      <dl className="rows">
        <div>
          <dt>Liquidation</dt>
          <dd className="num">
            <span className="faint">{fmt.usd(b.liquidation)} →</span>{' '}
            {after ? (after.liquidation === null ? 'Closed' : fmt.usd(after.liquidation)) : '…'}
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd className="num">
            <span className="faint">{fmt.size(b.size, d.sizeDecimals)} →</span>{' '}
            {after ? `${fmt.size(after.size, d.sizeDecimals)} ${d.symbol}` : '…'}
          </dd>
        </div>
        <div>
          <dt>Leverage</dt>
          <dd className="num">
            <span className="faint">{fmt.lev(b.leverage)} →</span>{' '}
            {after ? fmt.lev(after.leverage) : '…'}
          </dd>
        </div>
        {d.data.close && (
          <div>
            <dt>Realized on the trim</dt>
            <dd className="num">{fmt.usd(d.data.close.realizedPnl)}</dd>
          </div>
        )}
        {d.data.spareAdded > 0 && (
          <div>
            <dt>Spare margin added</dt>
            <dd className="num">{fmt.usd(d.data.spareAdded)}</dd>
          </div>
        )}
        {d.data.latency && (
          <div>
            <dt>Line to re-armed</dt>
            <dd className="num">
              {fmt.duration(
                d.data.latency.detectToSendMs +
                  d.data.latency.sendToFillMs +
                  d.data.latency.fillToReaddMs,
              )}{' '}
              · {d.data.latency.blocks} blocks
            </dd>
          </div>
        )}
      </dl>

      <Timeline
        entries={d.data.timeline}
        explorerUrl={d.explorerUrl}
        simulated={d.simulated}
        compact
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {d.outcome === 'save' && (
          <Link href={`/s/${d.id}`} className="btn btn-primary btn-lg">
            See the save report
          </Link>
        )}
        {tx && !d.simulated && (
          <a
            className="btn btn-secondary btn-lg"
            href={`${d.explorerUrl}/tx/${tx}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
            <External />
          </a>
        )}
      </div>
    </article>
  );
}
