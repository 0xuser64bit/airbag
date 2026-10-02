// Public save report; its share image is opengraph-image.tsx. Carries no wallet or account id:
// only what the deploy did and what it kept.

import { fmt } from '@airbag/risk';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { External } from '@/components/icons.tsx';
import { Brand, SimBanner } from '@/components/ui.tsx';
import { getSave } from '@/lib/save.ts';
import { BackToPositions } from './Back.tsx';
import { Share } from './Share.tsx';
import s from './save.module.css';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const save = await getSave(id).catch(() => null);
  if (!save) return { title: 'Save report' };
  const title = `${save.simulated ? 'Simulated save' : 'Saved'}: ${fmt.usd(save.kept)} on a ${save.symbol} ${save.side}`;
  return {
    title,
    description: `${save.simulated ? 'A simulation on a paper exchange. ' : ''}${save.symbol} hit the old liquidation price after Airbag ${save.kind === 'trim' ? 'trimmed' : 'added spare margin'}. Kept ${fmt.usd(save.kept)} versus a liquidation.`,
    openGraph: { title, type: 'article' },
    twitter: { card: 'summary_large_image', title },
  };
}

export default async function SavePage({ params }: Props) {
  const { id } = await params;
  const save = await getSave(id);
  if (!save) notFound();
  const max = Math.max(save.withAirbag, save.counterfactual, 1);
  // "Back at" only once the price has moved back past the old liquidation price.
  const m = save.measuredAt;
  const recovered =
    m !== null && (save.side === 'long' ? m > save.oldLiquidation : m < save.oldLiquidation);
  const verb = !recovered ? 'at' : save.side === 'long' ? 'back at' : 'back down at';
  const lev = save.nominalLeverage ? ` · ${Math.round(save.nominalLeverage)}x` : '';
  return (
    <>
      {save.simulated && <SimBanner />}
      <div className="hazard" aria-hidden="true" />
      <div className={s.page}>
        <header className={s.header}>
          <Brand size={24} text={15} />
          <span className="num faint">
            {fmt.date(save.date, true).toUpperCase()} · {save.symbol} {save.side.toUpperCase()}
            {lev.toUpperCase()}
          </span>
        </header>

        <main className={s.main}>
          <section className={s.hero}>
            <span className="ann" data-state="airbag">
              Saved
            </span>
            <p className={`big airbag redraw ${s.kept}`}>{fmt.usd(save.kept)}</p>
            <h1 className={`display ${s.claim}`}>kept versus a liquidation</h1>
            <p className={s.story}>
              {save.symbol} hit the old liquidation price,{' '}
              <span className="num">{fmt.usd(save.oldLiquidation)}</span>
              {save.hitAfterMs !== null
                ? `, ${fmt.duration(save.hitAfterMs)} after Airbag ${save.kind === 'trim' ? 'trimmed' : 'added margin'}`
                : ''}
              .
              {save.measuredAt !== null && (
                <>
                  {' '}
                  {save.closed ? 'When the position closed, ' : 'Now, '}
                  {save.symbol} {save.closed ? 'was' : 'is'} {verb}{' '}
                  <span className="num">{fmt.usd(save.measuredAt)}</span>.
                </>
              )}
            </p>
            <div className={s.actions}>
              <Share
                id={save.id}
                text={`${save.simulated ? 'Simulated: ' : ''}Airbag kept ${fmt.usd(save.kept)} on a ${save.symbol} ${save.side} versus a liquidation on Perpl.`}
              />
              {save.tx && !save.simulated && (
                <a
                  className="btn btn-secondary btn-lg"
                  href={`${save.explorerUrl}/tx/${save.tx}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Verify on MonadVision
                  <External />
                </a>
              )}
              <BackToPositions />
            </div>
          </section>

          <section className={s.instrument} aria-labelledby="paths">
            <h2 id="paths" className="title">
              Where each path ended
            </h2>
            <div className={`well ${s.gauges}`}>
              <Gauge
                label={`Liquidated at ${fmt.usd(save.oldLiquidation)}`}
                value={save.counterfactual}
                max={max}
                tone="liq"
              />
              <Gauge
                label={
                  save.kind === 'trim'
                    ? `Trimmed by Airbag at ${fmt.usd(save.fillPrice)}`
                    : 'Margin added by Airbag'
                }
                value={save.withAirbag}
                max={max}
                tone="airbag"
              />
            </div>
            <p className={s.note}>
              {save.measuredAt !== null
                ? `Both measured with ${save.symbol} at ${fmt.usd(save.measuredAt)}. `
                : ''}
              The liquidation figure is an estimate: 80% of what’s left at the old liquidation
              price.
            </p>
            <dl className="rows">
              {save.kind === 'trim' ? (
                <div>
                  <dt>Trimmed</dt>
                  <dd className="num">
                    {fmt.size(save.trimmed, save.sizeDecimals)} {save.symbol} at{' '}
                    {fmt.usd(save.fillPrice)}
                  </dd>
                </div>
              ) : (
                <div>
                  <dt>Spare margin added</dt>
                  <dd className="num">{fmt.usd(save.spareAdded)}</dd>
                </div>
              )}
              {save.lineToFillMs !== null && (
                <div>
                  <dt>Line to fill</dt>
                  <dd className="num">
                    {fmt.duration(save.lineToFillMs)} · {save.lineToFillBlocks} block
                    {save.lineToFillBlocks === 1 ? '' : 's'}
                  </dd>
                </div>
              )}
              <div>
                <dt>Fee</dt>
                <dd className="num">{fmt.fee(save.fee)}</dd>
              </div>
            </dl>
          </section>
        </main>

        <footer className={s.about}>
          <p className={`display ${s.tagline}`}>Get trimmed, not liquidated.</p>
          <p className="muted">
            Airbag checks Perpl positions every Monad block and trims just enough before the
            liquidation engine can close all of it.
          </p>
          <Link href="/" className="btn btn-secondary">
            See how it works
          </Link>
        </footer>
      </div>
    </>
  );
}

function Gauge({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'liq' | 'airbag';
}) {
  return (
    <div className={s.gauge}>
      <div className={s.gaugeHead}>
        <span>{label}</span>
        <span className={`num ${tone} ${s.gaugeValue}`}>{fmt.usd(value)}</span>
      </div>
      <div className={s.track}>
        <div
          className={s.fill}
          style={{ width: `${Math.max(2, (value / max) * 100)}%`, background: `var(--${tone})` }}
        />
      </div>
    </div>
  );
}
