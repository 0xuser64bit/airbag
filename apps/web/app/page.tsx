// Landing page. Copy is the approved design's; the worked example's numbers are computed with
// @airbag/risk so the page and the engine can't disagree.

import {
  applyTrim,
  counterfactualReturn,
  equity,
  fmt,
  liquidationPrice,
  type Position,
  planDeploy,
} from '@airbag/risk';
import Link from 'next/link';
import { CrashTest } from '@/components/CrashTest.tsx';
import { Check, Mark } from '@/components/icons.tsx';
import { Annunciator } from '@/components/instruments.tsx';
import { Runway } from '@/components/Runway.tsx';
import { Brand } from '@/components/ui.tsx';
import { SOURCE_URL } from '@/lib/config.ts';
import { isSimulation, liquidationsLast30Days } from '@/lib/stats.ts';
import s from './page.module.css';

const btc: Position = {
  side: 'long',
  size: 1,
  entry: 100_000,
  deposit: 10_000,
  funding: 0,
  maintenance: 0.04,
};
const plan = planDeploy(btc, 97_000, 0, { target: 0.1, maxTrim: 0.5, useSpare: false });
const fraction = plan.kind === 'trim' ? plan.fraction : 0;
const trim = applyTrim(btc, fraction, 97_000);
const returned = counterfactualReturn(btc);
const ex = {
  liq: fmt.usd(liquidationPrice(btc)),
  atLine: fmt.usd(equity(btc, 97_000)),
  trim: fmt.size(fraction),
  keep: fmt.size(1 - fraction),
  newLiq: fmt.usd(plan.liquidation),
  returned: fmt.usd(returned),
  at94: fmt.usd(equity(trim.position, 94_000)),
  back: fmt.usd(equity(trim.position, 100_000)),
  realized: fmt.usd(-trim.realizedPnl),
  liqLoss: fmt.usd(btc.deposit - returned),
  // If the move keeps going to the new liquidation price, the smaller position goes too.
  returnedLater: fmt.usd(counterfactualReturn(trim.position)),
};

const SAFETY = [
  [
    'It can’t withdraw or transfer your funds.',
    'Perpl API keys can never withdraw or transfer out, whatever their scope.',
    'Enforced by Perpl',
  ],
  [
    'It only works from Airbag’s servers.',
    'The key carries an IP allow-list. Requests from anywhere else are refused.',
    'Enforced by Perpl',
  ],
  [
    'It only shrinks positions.',
    'Closes are reduce-only. Airbag can add your own margin, but never opens, grows or flips a position. The engine is open source, so you can check.',
    'Enforced by Airbag’s engine',
  ],
  [
    'Every trim is public.',
    'Each deploy is a Monad transaction you can look up on MonadVision.',
    'Verifiable onchain',
  ],
  [
    'You can cut it off in one click.',
    'Revoke the key on Perpl’s API keys page and Airbag stops.',
    'Enforced by Perpl',
  ],
] as const;

const FAQ = [
  [
    'Why trim instead of adding margin?',
    'It does both. If your spare margin is enough to push liquidation back to your target, Airbag adds it. If it isn’t, Airbag keeps your spare margin and trims, so you don’t feed a position that’s still in danger.',
  ],
  [
    'What if the price keeps going?',
    `Then the smaller position can be liquidated too, at its new liquidation price. Because the released margin went back in, that returns less than the first liquidation would have: in the example above, ${ex.returnedLater} at ${ex.newLiq} instead of ${ex.returned} at ${ex.liq}. Airbag pays off when a wick turns before the new line.`,
  ],
  [
    'Will it close my whole position?',
    'Only if you let it. You set the most it can trim in one deploy, 50% by default. Each deploy trims the smallest amount that reaches your target.',
  ],
  [
    'Does it cost anything?',
    'Airbag charges no service fee during the beta. Perpl trading fees apply to trims; the engine estimates your current taker rate and receipts show the observed fee.',
  ],
  [
    'Do I need to keep a tab open?',
    'No. Airbag runs on its own servers around the clock. The app is for setup, alerts and receipts.',
  ],
  [
    'What happens after a deploy?',
    'It re-arms on the smaller position with a new line and sends you the fill and the transaction. If your old liquidation price is hit later, you get a save report.',
  ],
  ['Which markets does it cover?', 'BTC and ETH at launch, then the rest of Perpl’s markets.'],
] as const;

export const revalidate = 3_600;

export default async function Landing() {
  const [liquidated, demo] = await Promise.all([liquidationsLast30Days(), isSimulation()]);
  return (
    <div className={s.page}>
      <nav aria-label="Main" className={s.nav}>
        <Brand size={26} text={17} />
        <div className={s.navRight}>
          <div className={s.navLinks}>
            <a href="#how">How it works</a>
            <a href="#safety">Safety</a>
            <a href="#faq">FAQ</a>
          </div>
          <Link href="/connect" className="btn btn-primary">
            Protect my positions
          </Link>
        </div>
      </nav>

      <main>
        <section className={s.hero}>
          <h1 className={`display ${s.h1}`}>
            Get trimmed,
            <br />
            not liquidated.
          </h1>
          <div className={s.heroGrid}>
            <div className={s.heroCopy}>
              <p className={s.lede}>
                Airbag checks your Perpl positions every Monad block. When a wick eats half your
                margin cushion, it trims the position to move liquidation further away before the
                liquidation engine can close all of it.
              </p>
              <div className={s.ctas}>
                <Link href="/connect" className="btn btn-primary btn-lg">
                  Protect my positions
                </Link>
                <a href="#safety" className="btn btn-secondary btn-lg">
                  Read the safety model
                </a>
              </div>
              {demo && (
                <p className={s.demo}>
                  <Annunciator state="on" size="sm">
                    Simulation
                  </Annunciator>
                  <span>
                    Try it with no wallet or funds: connect a test wallet, arm Airbag and play a
                    wick. A paper exchange, on Monad testnet’s real blocks.
                  </span>
                </p>
              )}
              <ul className={s.promises}>
                {[
                  'Your key can’t withdraw. Perpl blocks it.',
                  'Trim estimates include Perpl trading fees.',
                  'Open source, and free during the beta.',
                ].map((t) => (
                  <li key={t}>
                    <Check size={16} />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <CrashTest />
          </div>
        </section>

        <section id="math" className={s.section} aria-labelledby="math-title">
          <div className={s.sectionHead}>
            <h2 id="math-title" className={`display ${s.h2}`}>
              A liquidation shares its proceeds. A trim pays trading fees and keeps the rest open.
            </h2>
            {liquidated !== null ? (
              <p className={s.stat}>
                <span className="num liq">{liquidated.toLocaleString('en-US')}</span> Perpl position
                {liquidated === 1 ? ' was' : 's were'} liquidated in the last 30 days.{' '}
                <span className="faint">Counted onchain by Airbag’s Envio indexer.</span>
              </p>
            ) : (
              // A dated check anyone can rerun (spike/liquidations.ts), not a live count.
              <p className={s.stat}>
                <span className="num liq">159</span> Perpl mainnet liquidations, checked against
                Airbag’s math: none came before the liquidation price it computes, and each returned
                80% of what was left.{' '}
                <a
                  className="faint"
                  href={`${SOURCE_URL}/blob/main/docs/PERPL.md#checked-against-testnet-on-2026-10-01-without-a-key`}
                >
                  Checked onchain, Oct 1, 2026.
                </a>
              </p>
            )}
          </div>
          <div className={s.paths}>
            <div className={s.path} data-tone="liq">
              <div className={s.pathHead}>
                <h3>When Perpl liquidates you</h3>
                <Annunciator state="liq" size="sm">
                  Whole position
                </Annunciator>
              </div>
              <ul className={s.dashList}>
                <li>It closes the whole position on the order book.</li>
                <li>
                  The margin left is split: 80% back to you, 10% to the insurance fund, 10% to the
                  protocol.
                </li>
                <li>Then you’re flat, even if the price comes straight back.</li>
              </ul>
            </div>
            <div className={s.path} data-tone="airbag">
              <div className={s.pathHead}>
                <h3>When you close it yourself</h3>
                <Annunciator state="airbag-line" size="sm">
                  Trading fees apply
                </Annunciator>
              </div>
              <ul className={s.dashList}>
                <li>Perpl charges trading fees on the amount you close.</li>
                <li>You choose how much goes, and keep the rest of the position.</li>
                <li>Airbag does it for you, in the block after your line is crossed.</li>
              </ul>
            </div>
          </div>

          <div className={s.wick}>
            <h3 className={s.h3}>The same wick, twice</h3>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">BTC price</th>
                    <th scope="col">Without Airbag</th>
                    <th scope="col" className="airbag">
                      With Airbag
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">
                      <span className="num">$97,000</span>
                      <span className={s.rowNote}>Half the cushion is gone</span>
                    </th>
                    <td data-label="Without Airbag">Open, {ex.atLine} equity</td>
                    <td data-label="With Airbag">
                      Zero-fee example: trims {ex.trim} BTC. Liquidation moves to {ex.newLiq}.
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <span className="num">{ex.liq}</span>
                      <span className={s.rowNote}>The old liquidation price</span>
                    </th>
                    <td className="liq" data-label="Without Airbag">
                      Liquidated. {ex.returned} returned.
                    </td>
                    <td data-label="With Airbag">Still open, {ex.at94} equity</td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <span className="num">$100,000</span>
                      <span className={s.rowNote}>The wick is over</span>
                    </th>
                    <td data-label="Without Airbag">
                      <span className={`big liq ${s.cellBig}`}>{ex.returned}</span>
                      <span className={s.rowNote}>No position</span>
                    </td>
                    <td data-label="With Airbag">
                      <span className={`big airbag ${s.cellBig}`}>{ex.back}</span>
                      <span className={s.rowNote}>Still holding {ex.keep} BTC</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className={s.footnote}>
              1 BTC long from $100,000 at 10x with $10,000 margin. Perpl’s BTC maintenance margin is
              4%, so liquidation sits at {ex.liq}. The trim realizes a {ex.realized} loss. The
              liquidation would have realized {ex.liqLoss}.
            </p>
          </div>
        </section>

        <section id="how" className={s.section} aria-labelledby="how-title">
          <div className={s.sectionHead}>
            <h2 id="how-title" className={`display ${s.h2}`}>
              Set it once. It checks every block after that.
            </h2>
          </div>
          <ol className={s.steps}>
            <li className={s.step}>
              <span className={`num ${s.stepNo}`}>01</span>
              <div className={s.stepText}>
                <h3>Link a key that can’t withdraw</h3>
                <p>
                  Create a Trade key on Perpl, lock it to Airbag’s servers, paste it in. Perpl
                  blocks withdrawals for every API key, whatever its scope.
                </p>
              </div>
              <div className={s.stepArt} aria-hidden="true">
                <Annunciator state="on">Trade scope</Annunciator>
                <Annunciator state="on">IP-locked</Annunciator>
                <Annunciator state="off">No withdrawals</Annunciator>
              </div>
            </li>
            <li className={s.step}>
              <span className={`num ${s.stepNo}`}>02</span>
              <div className={s.stepText}>
                <h3>Set your airbag</h3>
                <p>
                  Balanced deploys when half your margin cushion is gone and trims until liquidation
                  is 10% away. Make it earlier, later or gentler.
                </p>
              </div>
              <div className={`well ${s.stepArt} ${s.stepTrack}`}>
                <Runway liquidation={94_000} line={97_000} mark={99_420} />
              </div>
            </li>
            <li className={s.step}>
              <span className={`num ${s.stepNo}`}>03</span>
              <div className={s.stepText}>
                <h3>Trade like normal</h3>
                <p>
                  Keep trading on Perpl. Airbag runs on its own servers, so no tab needs to stay
                  open. When it deploys, you get the fill and the transaction.
                </p>
              </div>
              <div className={`${s.stepArt} ${s.toast}`} aria-hidden="true">
                <span className={s.toastHead}>
                  <Mark size={16} />
                  Airbag trimmed your BTC long
                </span>
                <span className="muted">
                  Zero-fee simulation: {ex.trim} BTC at $97,000. Liquidation now {ex.newLiq}.
                </span>
              </div>
            </li>
          </ol>
        </section>

        <section id="safety" className={s.section} aria-labelledby="safety-title">
          <div className={s.sectionHead}>
            <h2 id="safety-title" className={`display ${s.h2}`}>
              It can trim. It can’t take.
            </h2>
            <p className={s.sectionLede}>
              Airbag holds one key, and that key is built to do very little. Here’s what it can’t
              do, and who stops it.
            </p>
          </div>
          <div className={s.safety}>
            {SAFETY.map(([title, body, who]) => (
              <div key={title} className={s.safetyRow}>
                <div>
                  <h3>{title}</h3>
                  <p className="muted">{body}</p>
                </div>
                <Annunciator state="on">{who}</Annunciator>
              </div>
            ))}
          </div>
          <div className={s.cant}>
            <h3 className={s.h3}>What it can’t promise</h3>
            <div className={s.cantGrid}>
              <p>
                A price that gaps through your line and your liquidation price inside one block can
                still liquidate you. Airbag acts on the next block.
              </p>
              <p>
                Trims fill on the order book with a worst-price limit. On a thin book a trim can
                fill partly, and Airbag tries again next block.
              </p>
              <p>
                If Monad, Perpl or Airbag’s servers are down, nothing gets trimmed. Airbag lowers
                liquidation risk. It doesn’t remove it.
              </p>
            </div>
          </div>
        </section>

        <section id="faq" className={s.section} aria-labelledby="faq-title">
          <div className={s.sectionHead}>
            <h2 id="faq-title" className={`display ${s.h2}`}>
              Questions traders ask
            </h2>
          </div>
          <div className={s.faq}>
            {FAQ.map(([q, a], i) => (
              <details key={q} className={s.qa} open={i === 0}>
                <summary>
                  <h3>{q}</h3>
                  <span className={s.qaSign} aria-hidden="true" />
                </summary>
                <p className="muted">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={s.final} aria-labelledby="final-title">
          <Mark size={56} />
          <h2 id="final-title" className={`display ${s.finalTitle}`}>
            Arm it before the next wick.
          </h2>
          <Link href="/connect" className={`btn btn-primary btn-lg ${s.finalCta}`}>
            Protect my positions
          </Link>
          <span className={`num ${s.finalNote}`}>
            Free during beta · Open source · BTC and ETH at launch
          </span>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={s.footLeft}>
          <span className="wordmark">AIRBAG</span>
          <p>
            Independent software for Perpl traders on Monad. Perpetuals are risky: Airbag lowers the
            chance of a liquidation, it doesn’t remove it.
          </p>
        </div>
        <div className={s.footLinks}>
          <a href={SOURCE_URL}>Source code</a>
          <a href="https://app.perpl.xyz">Perpl</a>
          <a href="https://monad.xyz">Monad</a>
        </div>
      </footer>
    </div>
  );
}
