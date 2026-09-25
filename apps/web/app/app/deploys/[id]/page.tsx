'use client';

// One deploy: the display frozen at the moment it finished (the tape with the old line and the
// old liquidation left as ghosts, what changed beside it), then the block log.

import { fmt } from '@airbag/risk';
import Link from 'next/link';
import { use, useEffect } from 'react';
import { BlockLog } from '@/components/BlockLog.tsx';
import ds from '@/components/dashboard.module.css';
import { deployTitle } from '@/components/dashboard.tsx';
import { Back, External } from '@/components/icons.tsx';
import { OutcomeAnnunciator } from '@/components/instruments.tsx';
import { Tape } from '@/components/Tape.tsx';
import { TxLink } from '@/components/ui.tsx';
import { useApi } from '@/lib/api.ts';
import type { DeployDetail } from '@/lib/types.ts';
import s from '../deploys.module.css';

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
      <div className={s.detail}>
        <Link href="/app/deploys" className={`btn btn-ghost ${s.back}`}>
          <Back />
          Deploys
        </Link>
        <div className="notice" data-tone="alert" role="alert">
          <span>
            {error.status === 404 ? 'No deploy with that id on your account.' : error.message}
          </span>
        </div>
      </div>
    );
  }
  if (!d) {
    return (
      <div className={s.detail} aria-busy="true">
        <p className="muted" role="status">
          Loading the deploy
        </p>
      </div>
    );
  }

  const tx = d.data.close?.tx ?? d.data.margin?.tx;
  const after = d.data.after;
  const b = d.data.before;
  const t = d.data.timeline;
  const first = t[0];
  const last = t.at(-1);
  const closed = after?.liquidation === null;
  return (
    <article className={s.detail}>
      <div className={s.detailTop}>
        <Link href="/app/deploys" className={`btn btn-ghost ${s.back}`}>
          <Back />
          Deploys
        </Link>
        <OutcomeAnnunciator d={d} />
      </div>
      <header className={s.detailHead}>
        <h1 className={`display ${s.detailH1}`}>{deployTitle(d)}</h1>
        <p className={`num ${s.meta}`}>
          {fmt.date(d.createdAt)} · {fmt.clock(d.createdAt).slice(0, 8)}
          {first && last
            ? ` · blocks ${fmt.block(first.block)}–${last.block.toLocaleString('en-US')} · fee $0`
            : ''}
        </p>
        {after?.distance !== undefined && after.distance !== null && (
          <p className={s.lede}>
            Your {d.symbol} {d.side} was <span className="num">{fmt.pct(b.distance)}</span> from
            liquidation. Now it’s <span className="num">{fmt.pct(after.distance)}</span>.
            {d.kind === 'trim' ? ' The trim was fee-free.' : ''}
          </p>
        )}
      </header>

      <section
        className={`well ${ds.display} ${ds.deployed} ${closed ? ds.noTape : ''}`}
        aria-labelledby="changed"
      >
        <div className={`hazard ${ds.hazardEdge}`} aria-hidden="true" />
        {!closed && (
          <div className={ds.tapeCol}>
            <Tape
              side={d.side}
              liquidation={after?.liquidation ?? b.liquidation}
              line={after?.line ?? undefined}
              mark={d.data.trigger.mark}
              ghost={after ? b.liquidation : undefined}
              ghostLine={after?.line != null ? d.data.trigger.line : undefined}
              height={340}
            />
          </div>
        )}
        <div className={s.facts}>
          <h2 id="changed" className="title">
            Before and after
          </h2>
          <dl className="rows">
            <div>
              <dt>Liquidation</dt>
              <dd className="num">
                <span className="faint">{fmt.usd(b.liquidation)} →</span>{' '}
                {after ? (
                  after.liquidation === null ? (
                    'Closed'
                  ) : (
                    <span className="liq">{fmt.usd(after.liquidation)}</span>
                  )
                ) : (
                  <span className="faint">pending</span>
                )}
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
            {d.data.onchain && (
              <div>
                <dt>Airbag log</dt>
                <dd>
                  <TxLink
                    tx={d.data.onchain.tx}
                    explorerUrl={d.explorerUrl}
                    simulated={d.simulated}
                  />
                </dd>
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
        </div>
      </section>

      <section className={s.logSection} aria-labelledby="log">
        <h2 id="log" className="title">
          Block log
        </h2>
        <BlockLog entries={t} explorerUrl={d.explorerUrl} simulated={d.simulated} />
      </section>

      <div className={s.detailActions}>
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
