// One Perpl liquidation, replayed through Airbag's engine: the recorded mark around it, each step
// the replay took, and both paths' values. Every page is built from the committed backtest.

import { fmt } from '@airbag/risk';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { External } from '@/components/icons.tsx';
import { Trace } from '@/components/Trace.tsx';
import { type BacktestRow, explorerFor, relative, utc } from '@/lib/backtest.ts';
import s from '../backtest.module.css';
import { loadBacktest } from '../data.ts';
import { Footer, Gauge, Header, Row, story, traceProps } from '../parts.tsx';

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return loadBacktest().rows.map((r) => ({ id: r.id }));
}

const find = (id: string) => loadBacktest().rows.find((r) => r.id === id);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = find((await params).id);
  if (!r) return { title: 'Backtest' };
  return {
    title: `${r.market} ${r.side} liquidated ${fmt.date(r.at, true)}: replayed through Airbag`,
    description: story(r),
  };
}

export default async function LiquidationPage({ params }: Props) {
  const r = find((await params).id);
  if (!r) notFound();
  const { chainId, network } = loadBacktest();
  const explorer = explorerFor(chainId);
  const max = Math.max(r.returned, r.atLiquidation, r.end.value);
  return (
    <div className={s.page}>
      <Header />
      <main className={`bays ${s.detail}`}>
        <div className="bay-main">
          <p className="label">
            Perpl {network} · liquidated {utc(r.at)} · {fmt.block(r.block)}
          </p>
          <h1 className={`display ${s.h1} ${s.detailTitle}`}>
            {r.market} {r.side} · {Math.round(r.leverage)}x
          </h1>
          <p className={`${s.story} ${s.detailStory}`}>{story(r)}</p>
          <div className={s.chartBlock}>
            <h2 className="title">The mark around it</h2>
            <Trace {...traceProps(r)} />
          </div>
          <section className={s.log} aria-labelledby="steps">
            <h2 id="steps" className={`title ${s.logTitle}`}>
              Block log
            </h2>
            <ol>
              {steps(r).map((e) => (
                <li key={`${e.block}-${e.text}`} data-tone={e.tone}>
                  <span className="num">{fmt.block(e.block)}</span>
                  <span className="num">{relative(e.block - r.block)}</span>
                  <span>{e.text}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="bay-side" aria-labelledby="paths">
          <h2 id="paths" className={`title ${s.sideTitle}`}>
            Where each path ended
          </h2>
          <div className={`well ${s.gauges}`}>
            <Gauge label="Perpl’s liquidation returned" value={r.returned} max={max} tone="liq" />
            <Gauge
              label="Airbag path, at that block"
              value={r.atLiquidation}
              max={max}
              tone={r.outcome === 'untrimmed' || r.outcome === 'liquidated' ? 'liq' : 'airbag'}
            />
            <Gauge
              label="Airbag path, a day later"
              value={r.end.value}
              max={max}
              tone={r.end.liquidated ? 'liq' : 'airbag'}
            />
          </div>
          <p className={`${s.note} ${s.sideNote}`}>
            The Airbag path is the position’s equity at the mark plus any margin a trim released.
          </p>
          <dl className={`rows ${s.sideRows}`}>
            <Row k="Size" v={`${fmt.size(r.size, r.sizeDecimals)} ${r.market}`} />
            <Row k="Entry" v={fmt.price(r.entry)} />
            <Row k="Airbag line" v={fmt.price(r.line)} />
            <Row k="Liquidation price" v={fmt.price(r.liquidation)} />
            <Row k="Perpl’s liquidation filled at" v={fmt.price(r.liquidatedAt)} />
            <Row
              k="Paused replay liquidated"
              v={
                r.control
                  ? r.control.block === r.block
                    ? 'in the same block'
                    : `${r.block - r.control.block} block${r.block - r.control.block === 1 ? '' : 's'} earlier`
                  : 'no'
              }
            />
            <Row k="Perpl account" v={`#${r.accountId}`} />
          </dl>
          <div className={s.actions}>
            <a
              className="btn btn-secondary btn-sm"
              href={`${explorer}/tx/${r.tx}`}
              target="_blank"
              rel="noreferrer"
            >
              The liquidation on MonadVision
              <External size={13} />
            </a>
            <Link href="/backtest" className="btn btn-ghost btn-sm">
              All liquidations
            </Link>
          </div>
        </aside>
      </main>
      <Footer />
    </div>
  );
}

interface Step {
  block: number;
  text: string;
  tone?: 'airbag' | 'liq';
}

/** The replay's steps and Perpl's liquidation, in block order. */
function steps(r: BacktestRow): Step[] {
  const out: Step[] = [];
  if (r.trigger)
    out.push({
      block: r.trigger.block,
      text: `Mark crossed the Airbag line, at ${fmt.price(r.trigger.mark)}.`,
    });
  for (const d of r.deploys) {
    if (d.trimmed > 0 && d.fill !== null)
      out.push({
        block: d.filled ?? d.block,
        tone: 'airbag',
        text: `Airbag trimmed ${fmt.pct(d.trimmed, 1)} at ${fmt.price(d.fill)}, fee ${fmt.fee(d.fee)}, and put the released margin back. Liquidation now ${fmt.price(d.liquidationAfter)}.`,
      });
    else if (d.block !== r.trigger?.block)
      out.push({
        block: d.block,
        text: 'Line crossed again; the position is one lot, too small to trim.',
      });
  }
  out.push({
    block: r.block,
    tone: 'liq',
    text: `Perpl liquidated the original at a mark of ${fmt.price(r.markAtLiquidation)}. It filled at ${fmt.price(r.liquidatedAt)} and returned ${fmt.usd(r.returned)}.`,
  });
  if (r.end.liquidated && r.end.liquidated.block > r.block)
    out.push({
      block: r.end.liquidated.block,
      tone: 'liq',
      text: `The trimmed position was liquidated too, at ${fmt.price(r.end.liquidated.price)}, returning ${fmt.usd(r.end.value)}.`,
    });
  else if (!r.end.liquidated)
    out.push({
      block: r.end.block,
      text: `A day later the trimmed position was still open, worth ${fmt.usd(r.end.value)}.`,
    });
  return out.sort((a, b) => a.block - b.block);
}
