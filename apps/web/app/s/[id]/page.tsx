// Public save report (design/MobileSave.dc.html; SaveCard.dc.html is its share image). Carries
// no wallet or account id: only what the deploy did and what it kept.

import { fmt } from '@airbag/risk';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { External } from '@/components/icons.tsx';
import { Brand, SimBanner } from '@/components/ui.tsx';
import { getSave } from '@/lib/save.ts';
import { Share } from './Share.tsx';
import s from './save.module.css';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const save = await getSave(id).catch(() => null);
  if (!save) return { title: 'Save report' };
  const title = `Saved ${fmt.usd(save.kept)} on a ${save.symbol} ${save.side}`;
  return {
    title,
    description: `${save.symbol} hit the old liquidation price after Airbag ${save.kind === 'trim' ? 'trimmed, fee-free' : 'added spare margin'}. Kept ${fmt.usd(save.kept)} versus a liquidation.`,
    openGraph: { title, type: 'article' },
    twitter: { card: 'summary_large_image', title },
  };
}

export default async function SavePage({ params }: Props) {
  const { id } = await params;
  const save = await getSave(id);
  if (!save) notFound();
  const max = Math.max(save.withAirbag, save.counterfactual, 1);
  const verb = save.side === 'long' ? 'back at' : 'back down at';
  return (
    <>
      {save.simulated && <SimBanner />}
      <div className={s.page}>
        <header className={s.header}>
          <Brand size={22} text={14} />
          <span className="num muted" style={{ fontSize: 11 }}>
            {fmt.date(save.date, true).toUpperCase()} · {save.symbol} {save.side.toUpperCase()}
          </span>
        </header>
        <main className={s.main}>
          <div className={s.hero}>
            <span className="pill pill-sm pill-solid" style={{ alignSelf: 'flex-start' }}>
              Saved
            </span>
            <span className={`big airbag ${s.kept}`}>{fmt.usd(save.kept)}</span>
            <span className="display" style={{ fontSize: 20, fontWeight: 700 }}>
              kept versus a liquidation
            </span>
            <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
              {save.symbol} hit the old liquidation price,{' '}
              <span className="num" style={{ color: 'var(--bone)' }}>
                {fmt.usd(save.oldLiquidation)}
              </span>
              {save.hitAfterMs !== null
                ? `, ${fmt.duration(save.hitAfterMs)} after Airbag ${save.kind === 'trim' ? 'trimmed' : 'added margin'}`
                : ''}
              .
              {save.measuredAt !== null && (
                <>
                  {' '}
                  {save.closed ? 'When the position closed, ' : 'Now, '}
                  {save.symbol} is {verb}{' '}
                  <span className="num" style={{ color: 'var(--bone)' }}>
                    {fmt.usd(save.measuredAt)}
                  </span>
                  .
                </>
              )}
            </p>
          </div>

          <div className={s.bars}>
            <Bar label="If liquidated" value={save.counterfactual} max={max} tone="liq" />
            <Bar label="With Airbag" value={save.withAirbag} max={max} tone="airbag" />
            <span className="faint" style={{ fontSize: 12 }}>
              {save.measuredAt !== null
                ? `Both measured with ${save.symbol} at ${fmt.usd(save.measuredAt)}. The liquidation figure is an estimate: 80% of what’s left at the old liquidation price.`
                : 'The liquidation figure is an estimate: 80% of what’s left at the old liquidation price.'}
            </span>
          </div>

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
              <dd className="num">$0</dd>
            </div>
          </dl>

          <div className={s.actions}>
            <Share title={`Airbag kept ${fmt.usd(save.kept)} on a ${save.symbol} ${save.side}`} />
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
          </div>
        </main>
      </div>
    </>
  );
}

function Bar({
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 14 }}>{label}</span>
        <span className={`num ${tone}`} style={{ fontSize: 15 }}>
          {fmt.usd(value)}
        </span>
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
