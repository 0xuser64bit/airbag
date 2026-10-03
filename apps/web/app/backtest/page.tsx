// The backtest: every Perpl mainnet liquidation, replayed through Airbag's engine on the marks
// Perpl published (spike/backtest.ts). Static: the results are a dated, rerunnable snapshot.

import { fmt } from '@airbag/risk';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Trace } from '@/components/Trace.tsx';
import { type BacktestRow, utc, warningSeconds } from '@/lib/backtest.ts';
import { SOURCE_URL } from '@/lib/config.ts';
import s from './backtest.module.css';
import { loadBacktest } from './data.ts';
import { Footer, Gauge, Header, Row, story, traceProps } from './parts.tsx';

export const metadata: Metadata = {
  title: 'Backtest: every Perpl liquidation, replayed',
  description:
    'Every position Perpl mainnet liquidated over three weeks, replayed through Airbag’s engine on the marks Perpl published: where Airbag would have trimmed, and what each trader would have held.',
};

/** Rows shown before the rest fold away. */
const SHOWN = 20;

const COMMAND =
  'PERPL_NETWORK=mainnet MONAD_RPC_URL=https://rpc1.monad.xyz \\\n  pnpm --filter @airbag/spike backtest';

export default function BacktestPage() {
  const bt = loadBacktest();
  const sum = bt.summary;
  const rows = [...bt.rows].reverse();
  const max = Math.max(sum.atLiquidation, sum.returned, sum.afterDay);
  const first = rows.at(-1);
  const last = rows[0];
  const featured = featuredRow(bt.rows);
  const range =
    first && last
      ? `${fmt.date(first.at)} – ${fmt.date(last.at, true)}`
      : fmt.date(Date.parse(bt.generatedAt), true);
  return (
    <div className={s.page}>
      <Header />
      <main>
        <section className={`bays ${s.hero}`} aria-labelledby="backtest-title">
          <div className={`bay-main ${s.heroMain}`}>
            <p className="label">
              Perpl {bt.network} · {range}
            </p>
            <h1 id="backtest-title" className={`display ${s.h1}`}>
              Every Perpl liquidation, replayed through Airbag.
            </h1>
            <p className={s.lede}>
              Perpl fully liquidated {sum.full} positions on {bt.network} in {Math.round(bt.days)}{' '}
              days. Each one is rebuilt from its own liquidation event on Monad, and the mark Perpl
              published, block by block, runs through Airbag’s engine at its default settings. The
              prices are the chain’s and the engine is the one the live service runs; how the trims
              would have filled is an assumption, stated below.
            </p>
            <div className={s.readout}>
              <span className={`big airbag ${s.readoutValue}`}>
                {sum.open}
                <span className={s.of}> of {sum.replayed}</span>
              </span>
              <p className={`display ${s.claim}`}>
                were still open when Perpl liquidated the original position.
              </p>
            </div>
            <div className={`well ${s.gauges}`}>
              <Gauge
                label="Returned by Perpl’s liquidations"
                value={sum.returned}
                max={max}
                tone="liq"
              />
              <Gauge
                label="Held on the Airbag path, at the same blocks"
                value={sum.atLiquidation}
                max={max}
                tone="airbag"
              />
              <Gauge
                label="On the Airbag path, a day later"
                value={sum.afterDay}
                max={max}
                tone="airbag"
              />
            </div>
            <p className={s.note}>
              The Airbag path is each position’s equity at the mark plus any margin a trim released.
              The liquidation figure is what Perpl actually paid back, read from its events.
            </p>
          </div>
          <aside className="bay-side" aria-labelledby="numbers">
            <h2 id="numbers" className={`title ${s.sideTitle}`}>
              What the replay found
            </h2>
            <dl className="rows">
              <Row k="Liquidations replayed" v={`${sum.replayed} of ${sum.full}`} />
              <Row k="Airbag deployed first" v={`${sum.actedBefore} of ${sum.replayed}`} />
              <Row
                k="Warning before Perpl liquidated"
                v={`median ${fmt.duration(sum.leadSeconds.p50 * 1000)}`}
              />
              <Row
                k="Shortest 10% of warnings"
                v={`under ${fmt.duration(sum.leadSeconds.p10 * 1000)}`}
              />
              <Row k="Liquidated in the day after" v={String(sum.liquidatedLater)} />
              <Row
                k="Ahead of the liquidation a day later"
                v={`${sum.aheadAfterDay} of ${sum.open}`}
              />
              <Row k="Too small to trim (one lot)" v={String(sum.untrimmed)} />
              <Row
                k="Paused replay matched Perpl"
                v={`${sum.control.liquidated} of ${sum.replayed}`}
              />
            </dl>
            <p className={`${s.note} ${s.sideNote}`}>
              The paused replay is the check on the method: with Airbag off, the engine’s paper
              exchange liquidated every position a median {sum.control.medianBlocksEarly} blocks
              before Perpl’s own liquidator did.
            </p>
          </aside>
        </section>

        {featured && (
          <section className={s.section} aria-labelledby="featured">
            <div className={s.sectionHead}>
              <h2 id="featured" className={`display ${s.h2}`}>
                One of them, block by block
              </h2>
              <Link href={`/backtest/${featured.id}`} className="btn btn-secondary btn-sm">
                See this liquidation
              </Link>
            </div>
            <p className={s.story}>{story(featured)}</p>
            <Trace {...traceProps(featured)} />
          </section>
        )}

        <section className={s.section} aria-labelledby="method">
          <h2 id="method" className={`display ${s.h2}`}>
            How it was run, and what it can’t show
          </h2>
          <div className={s.method}>
            <div>
              <h3>The position</h3>
              <p>
                Each full liquidation’s event gives back the position it closed: size, deposit,
                funding and the PnL realized at the fill, so the entry. Airbag’s liquidation price
                for it matches where Perpl liquidated: the paused replay agrees in every case.
              </p>
            </div>
            <div>
              <h3>Airbag’s settings</h3>
              <p>
                Balanced, armed at entry: the line is where half the margin cushion from entry is
                gone. Each deploy trims until liquidation is {bt.assumptions.targetPct}% away, at
                most {bt.assumptions.maxTrimPct}% of the position, then re-arms on what’s left. No
                spare margin, as the event doesn’t say what the account held.
              </p>
            </div>
            <div>
              <h3>The fills</h3>
              <p>
                Each close fills {bt.assumptions.delayBlocks} blocks after it is sent,{' '}
                {fmt.pct(bt.assumptions.fillSlippageBps / 10_000)} past the mark, against the
                trader, with Perpl’s taker fee. The book at the time can’t be read back, so whether
                it had that depth is the one thing assumed.
              </p>
            </div>
            <div>
              <h3>What it can’t show</h3>
              <p>
                The trader’s own trades and margin moves between the line and the liquidation, and
                whether they would have armed Airbag at all. {bt.summary.skipped.beforeData}{' '}
                liquidations crossed their line more than three days before the data starts and
                aren’t replayed. Airbag has not traded on Perpl yet: this is its engine on recorded
                prices, not live fills.
              </p>
            </div>
            <div>
              <h3>Run it yourself</h3>
              <p>
                From the repository, no key or funds needed. It reads Perpl’s liquidations and marks
                from a public Monad RPC and writes the file this page shows. Generated{' '}
                {fmt.date(Date.parse(bt.generatedAt), true)} at block {fmt.block(bt.head)}.
              </p>
              <code className={`well num ${s.command}`}>{COMMAND}</code>
            </div>
            <div>
              <h3>The code</h3>
              <p>
                The replay is{' '}
                <a href={`${SOURCE_URL}/blob/main/apps/engine/src/replay.ts`}>replay.ts</a>, the
                production guard on a paper exchange; the data and the control are{' '}
                <a href={`${SOURCE_URL}/blob/main/spike/backtest.ts`}>backtest.ts</a>.
              </p>
            </div>
          </div>
        </section>
        <section className={s.section} aria-labelledby="all">
          <div className={s.sectionHead}>
            <h2 id="all" className={`display ${s.h2}`}>
              All {rows.length}, newest first
            </h2>
            <span className="num faint">
              blocks {fmt.block(bt.fromBlock)}–{bt.head.toLocaleString('en-US')}
            </span>
          </div>
          <LiquidationTable rows={rows.slice(0, SHOWN)} />
          {rows.length > SHOWN && (
            <details className={s.more}>
              <summary className="btn btn-secondary btn-sm">
                Show the other {rows.length - SHOWN}
              </summary>
              <LiquidationTable rows={rows.slice(SHOWN)} head={false} />
            </details>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

/** Fixed column widths, so the folded rows line up with the ones above them. */
function LiquidationTable({ rows, head = true }: { rows: BacktestRow[]; head?: boolean }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead className={head ? undefined : 'visually-hidden'}>
          <tr>
            <th scope="col">Position</th>
            <th scope="col">Liquidated</th>
            <th scope="col">Warning</th>
            <th scope="col" className={s.money}>
              Perpl returned
            </th>
            <th scope="col" className={s.money}>
              Airbag path
            </th>
            <th scope="col" className={s.money}>
              A day later
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <LiquidationRow key={r.id} r={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiquidationRow({ r }: { r: BacktestRow }) {
  const warning = warningSeconds(r);
  const untrimmed = r.outcome === 'untrimmed' || r.outcome === 'liquidated';
  return (
    <tr>
      <th scope="row">
        <Link href={`/backtest/${r.id}`} prefetch={false}>
          {r.market} {r.side} · <span className="num">{Math.round(r.leverage)}x</span>
        </Link>
        <span className={`num ${s.sub}`}>
          {fmt.size(r.size, r.sizeDecimals)} {r.market}
        </span>
      </th>
      <td data-label="Liquidated" className="num">
        {utc(r.at)}
      </td>
      <td data-label="Warning" className="num">
        {warning === null ? '—' : fmt.duration(warning * 1000)}
      </td>
      <td data-label="Perpl returned" className={`num liq ${s.money}`}>
        {fmt.usd(r.returned)}
      </td>
      <td data-label="Airbag path" className={`num ${untrimmed ? 'liq' : 'airbag'} ${s.money}`}>
        {fmt.usd(r.atLiquidation)}
        {untrimmed && <span className={s.sub}>one lot, not trimmable</span>}
      </td>
      <td data-label="A day later" className={`num ${s.money}`}>
        {fmt.usd(r.end.value)}
        {r.end.liquidated && r.outcome === 'liquidated-later' && (
          <span className={s.sub}>liquidated at its new price</span>
        )}
      </td>
    </tr>
  );
}

/** The clearest example: the biggest gap between the two paths, on a position worth a look. */
function featuredRow(rows: BacktestRow[]): BacktestRow | undefined {
  return [...rows]
    .filter((r) => r.outcome === 'open')
    .sort((a, b) => b.atLiquidation - b.returned - (a.atLiquidation - a.returned))[0];
}
