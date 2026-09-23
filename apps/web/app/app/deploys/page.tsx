'use client';

// Every deploy, newest first (the phone's Deploys tab; "All deploys" on desktop).

import Link from 'next/link';
import { relativeDay } from '@/components/dashboard.tsx';
import { deploySentence, OutcomeBadge } from '@/components/ui.tsx';
import { useApi } from '@/lib/api.ts';
import type { DeploySummary } from '@/lib/types.ts';

export default function DeploysPage() {
  const { data, error, loading } = useApi<DeploySummary[]>('/v1/deploys');
  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h1 className="display" style={{ fontSize: 28 }}>
        Deploys
      </h1>
      {loading && <p className="muted">Loading…</p>}
      {error && (
        <div className="notice notice-liq" role="alert">
          {error.message}
        </div>
      )}
      {data && data.length === 0 && (
        <p className="muted">
          None yet. When Airbag acts, each fill and transaction shows up here.
        </p>
      )}
      {data && data.length > 0 && (
        <ul className="card" style={{ padding: '4px 24px' }}>
          {data.map((d, i) => (
            <li key={d.id} style={{ borderTop: i ? '1px solid var(--line)' : 0 }}>
              <Link
                href={`/app/deploys/${d.id}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '16px 0',
                  textDecoration: 'none',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 500 }}>
                    {d.symbol} {d.side}{' '}
                    <span className="num muted" style={{ fontSize: 12, fontWeight: 400 }}>
                      {relativeDay(d.createdAt)}
                    </span>
                  </span>
                  <OutcomeBadge d={d} />
                </span>
                <span className="muted" style={{ fontSize: 14 }}>
                  {deploySentence(d)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
