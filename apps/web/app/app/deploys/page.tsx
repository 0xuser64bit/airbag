'use client';

// The deploy log, newest first, with a filter by outcome (the phone's Deploys tab; "All deploys"
// on desktop).

import { fmt } from '@airbag/risk';
import Link from 'next/link';
import { useState } from 'react';
import { Chevron } from '@/components/icons.tsx';
import { OutcomeAnnunciator } from '@/components/instruments.tsx';
import { deploySentence } from '@/components/ui.tsx';
import { useApi } from '@/lib/api.ts';
import type { DeploySummary } from '@/lib/types.ts';
import s from './deploys.module.css';

type Filter = 'all' | 'save' | 'precaution' | 'failed';

const outcome = (d: DeploySummary): Exclude<Filter, 'all'> | 'pending' =>
  d.outcome === 'save'
    ? 'save'
    : d.phase === 'failed'
      ? 'failed'
      : d.outcome === 'precaution'
        ? 'precaution'
        : 'pending';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'save', label: 'Saves' },
  { id: 'precaution', label: 'Precautions' },
  { id: 'failed', label: 'Didn’t fill' },
];

export default function DeploysPage() {
  const { data, error, loading, reload } = useApi<DeploySummary[]>('/v1/deploys');
  const [filter, setFilter] = useState<Filter>('all');
  const count = (f: Filter) =>
    data ? (f === 'all' ? data.length : data.filter((d) => outcome(d) === f).length) : 0;
  const rows = data?.filter((d) => filter === 'all' || outcome(d) === filter);

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={`display ${s.h1}`}>Deploys</h1>
        {data && data.length > 0 && (
          <p className="muted">
            <span className="num">{data.length}</span> deploy{data.length === 1 ? '' : 's'} ·{' '}
            <span className="num">{count('save')}</span> saved ·{' '}
            <span className="num">{count('precaution')}</span> precaution
            {count('precaution') === 1 ? '' : 's'}
          </p>
        )}
      </header>

      {data && data.length > 0 && (
        <fieldset className={s.filters}>
          <legend className="visually-hidden">Show deploys</legend>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`seg ${s.filter}`}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <span className="num faint">{count(f.id)}</span>
            </button>
          ))}
        </fieldset>
      )}

      {loading && !data && (
        <div className={s.log} aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading the deploy log
          </p>
          {[0, 1, 2].map((i) => (
            <div key={i} className={s.skeleton} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="notice" data-tone="alert" role="alert">
          <span>{error.message}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>
            Try again
          </button>
        </div>
      )}

      {data && data.length === 0 && (
        <div className={s.empty}>
          <h2 className="title">No deploys yet</h2>
          <p className="muted">
            When Airbag acts, each deploy is logged here: what it trimmed or added, the fill, the
            transaction, and whether the old liquidation price was hit later.
          </p>
        </div>
      )}

      {rows && rows.length === 0 && data && data.length > 0 && (
        <p className={`muted ${s.none}`}>None of your deploys match this filter.</p>
      )}

      {rows && rows.length > 0 && (
        <ol className={s.log}>
          {rows.map((d) => (
            <li key={d.id}>
              <Link href={`/app/deploys/${d.id}`} className={s.row}>
                <span className={`num ${s.when}`}>
                  <span>{fmt.date(d.createdAt)}</span>
                  <span className="faint">{fmt.clock(d.createdAt).slice(0, 8)}</span>
                </span>
                <span className={s.what}>
                  <span className={s.market}>
                    {d.symbol} {d.side}
                  </span>
                  <span className="muted">{deploySentence(d)}</span>
                </span>
                <OutcomeAnnunciator d={d} />
                <Chevron className={s.chev} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
