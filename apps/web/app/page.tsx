// Landing page (design/Main.dc.html). Copy is the design's; the worked example's numbers are
// computed with @airbag/risk so the page and the engine can't disagree.

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
import { Brand } from '@/components/ui.tsx';
import { SOURCE_URL } from '@/lib/config.ts';
import { liquidationsLast30Days } from '@/lib/stats.ts';
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
};

const SAFETY = [
  [
    'It can’t withdraw or transfer your funds.',
    'Perpl API keys can never withdraw or transfer out, whatever their scope.',
    'ENFORCED BY PERPL',
  ],
  [
    'It only works from Airbag’s servers.',
    'The key carries an IP allow-list. Requests from anywhere else are refused.',
    'ENFORCED BY PERPL',
  ],
  [
    'It only shrinks positions.',
    'Every order it sends is reduce-only. It never opens, adds to or flips a position. The engine is open source, so you can check.',
    'ENFORCED BY AIRBAG’S ENGINE',
  ],
  [
    'Every trim is public.',
    'Each deploy is a Monad transaction you can look up on MonadVision.',
    'VERIFIABLE ONCHAIN',
  ],
  [
    'You can cut it off in one click.',
    'Revoke the key on Perpl’s API keys page and Airbag stops.',
    'ENFORCED BY PERPL',
  ],
] as const;

const FAQ = [
  [
    'Why trim instead of adding margin?',
    'It does both. If your spare margin is enough to push liquidation back to your target, Airbag adds it. If it isn’t, Airbag keeps your spare margin and trims, so you don’t feed a position that’s still in danger.',
  ],
  [
    'Will it close my whole position?',
    'Only if you let it. You set the most it can trim in one deploy, 50% by default. Each deploy trims the smallest amount that reaches your target.',
  ],
  [
    'Does it cost anything?',
    'Airbag is free during the beta. The trims themselves are free too: closing or reducing a position on Perpl carries no trading fee.',
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
  const liquidated = await liquidationsLast30Days();
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
          <div className={s.heroHead}>
            <span className="eyebrow" style={{ fontSize: 12 }}>
              Liquidation protection for Perpl · on Monad
            </span>
            <h1 className={`display ${s.h1}`}>
              Get trimmed,
              <br />
              not liquidated.
            </h1>
          </div>
          <div className={s.heroGrid}>
            <div className={s.heroCopy}>
              <p className={s.lede}>
                Airbag checks your Perpl positions every block. When a wick eats half your margin
                cushion, it trims just enough of the position, fee-free, before the liquidation
                engine can close all of it.
              </p>
              <div className={s.ctas}>
                <Link href="/connect" className="btn btn-primary btn-lg">
                  Protect my positions
                </Link>
                <a href="#safety" className="btn btn-secondary btn-lg">
                  Read the safety model
                </a>
              </div>
              <ul className={s.promises}>
                {[
                  'Your key can’t withdraw. Perpl blocks it.',
                  'Trims are fee-free. Closing on Perpl costs nothing.',
                  'Open source, and free during the beta.',
                ].map((t) => (
                  <li key={t}>
                    <Check color="#F2C12E" size={16} />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <CrashTest />
          </div>
        </section>

        <section id="math" className={s.section}>
          <div className={s.sectionHead}>
            <span className="eyebrow" style={{ fontSize: 12 }}>
              Why it works
            </span>
            <h2 className={`display ${s.h2}`}>
              A liquidation costs a fifth of what’s left. Closing it yourself costs nothing.
            </h2>
            {liquidated !== null && (
              <p className="muted" style={{ fontSize: 17 }}>
                <span className="num" style={{ color: 'var(--liq)' }}>
                  {liquidated.toLocaleString('en-US')}
                </span>{' '}
                Perpl position{liquidated === 1 ? ' was' : 's were'} liquidated in the last 30 days.{' '}
                <span className="faint" style={{ fontSize: 13 }}>
                  Counted onchain by Airbag’s Envio indexer.
                </span>
              </p>
            )}
          </div>
          <div className={s.two}>
            <div className={`card ${s.compare}`} style={{ borderColor: 'var(--liq-edge)' }}>
              <span className="eyebrow liq" style={{ fontSize: 12 }}>
                When Perpl liquidates you
              </span>
              <ul className={s.dashList} style={{ '--dash': 'var(--liq)' } as React.CSSProperties}>
                <li>It closes the whole position on the order book.</li>
                <li>
                  The margin left is split: 80% back to you, 10% to the insurance fund, 10% to the
                  protocol.
                </li>
                <li>Then you’re flat, even if the price comes straight back.</li>
              </ul>
            </div>
            <div className={`card ${s.compare}`} style={{ borderColor: 'rgba(242,193,46,0.45)' }}>
              <span className="eyebrow airbag" style={{ fontSize: 12 }}>
                When you close it yourself
              </span>
              <ul
                className={s.dashList}
                style={{ '--dash': 'var(--airbag)' } as React.CSSProperties}
              >
                <li>Closing or reducing a position is fee-free on Perpl.</li>
                <li>You choose how much goes, and keep the rest of the position.</li>
                <li>Airbag does it for you, in the block after your line is crossed.</li>
              </ul>
            </div>
          </div>

          <div className={s.wick}>
            <h3 style={{ fontSize: 20, fontWeight: 600 }}>The same wick, twice</h3>
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
                      Trims {ex.trim} BTC, fee $0. Liquidation moves to {ex.newLiq}.
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
            <p className="faint" style={{ maxWidth: 900, fontSize: 14, lineHeight: 1.6 }}>
              1 BTC long from $100,000 at 10x with $10,000 margin. Perpl’s BTC maintenance margin is
              4%, so liquidation sits at {ex.liq}. The trim realizes a {ex.realized} loss. The
              liquidation would have realized {ex.liqLoss}.
            </p>
          </div>
        </section>

        <section id="how" className={s.section}>
          <div className={s.sectionHead}>
            <span className="eyebrow" style={{ fontSize: 12 }}>
              How it works
            </span>
            <h2 className={`display ${s.h2}`}>Set it once. It checks every block after that.</h2>
          </div>
          <div className={s.three}>
            <div className={`card ${s.step}`}>
              <span className="num airbag" style={{ fontSize: 13 }}>
                01
              </span>
              <h3>Link a key that can’t withdraw</h3>
              <p className="muted">
                Create a Trade key on Perpl, lock it to Airbag’s servers, paste it in. Perpl blocks
                withdrawals for every API key, whatever its scope.
              </p>
              <div className={s.tags}>
                <span>TRADE SCOPE</span>
                <span>IP-LOCKED</span>
                <span>NO WITHDRAWALS</span>
              </div>
            </div>
            <div className={`card ${s.step}`}>
              <span className="num airbag" style={{ fontSize: 13 }}>
                02
              </span>
              <h3>Set your airbag</h3>
              <p className="muted">
                Balanced deploys when half your margin cushion is gone and trims until liquidation
                is 10% away. Make it earlier, later or gentler.
              </p>
              <div className={s.miniRunway} aria-hidden="true">
                <div className={s.miniTrack} />
                <div className={s.miniZone} />
                <div className={s.miniTick} style={{ left: '12.5%', background: 'var(--liq)' }} />
                <div className={s.miniTick} style={{ left: '50%', background: 'var(--airbag)' }} />
                <div className={s.miniDot} />
                <span style={{ left: '12.5%', color: 'var(--liq)', transform: 'translateX(-30%)' }}>
                  LIQ
                </span>
                <span style={{ left: '50%', color: 'var(--airbag)' }}>AIRBAG</span>
                <span style={{ left: '80%' }}>YOU</span>
              </div>
            </div>
            <div className={`card ${s.step}`}>
              <span className="num airbag" style={{ fontSize: 13 }}>
                03
              </span>
              <h3>Trade like normal</h3>
              <p className="muted">
                Keep trading on Perpl. Airbag runs on its own servers, so no tab needs to stay open.
                When it deploys, you get the fill and the transaction.
              </p>
              <div className={s.toast}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <Mark size={14} stroke={2} />
                  Airbag trimmed your BTC long
                </span>
                <span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
                  {ex.trim} BTC at $97,000. Liquidation now {ex.newLiq}. Fee $0.
                </span>
              </div>
            </div>
          </div>
        </section>

        <section id="safety" className={s.section}>
          <div className={s.sectionHead}>
            <span className="eyebrow" style={{ fontSize: 12 }}>
              Safety model
            </span>
            <h2 className={`display ${s.h2}`}>It can trim. It can’t take.</h2>
            <p className="muted" style={{ maxWidth: 720, fontSize: 18, lineHeight: 1.55 }}>
              Airbag holds one key, and that key is built to do very little. Here’s what it can’t
              do, and who stops it.
            </p>
          </div>
          <div className={s.safety}>
            {SAFETY.map(([title, body, who]) => (
              <div key={title} className={s.safetyRow}>
                <div>
                  <span style={{ fontSize: 19, fontWeight: 500 }}>{title}</span>
                  <span className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
                    {body}
                  </span>
                </div>
                <span className={`num ${s.enforcer}`}>{who}</span>
              </div>
            ))}
          </div>
          <div className={s.cant}>
            <span className="eyebrow" style={{ fontSize: 12 }}>
              What it can’t promise
            </span>
            <div className={s.three} style={{ gap: 32 }}>
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

        <section id="faq" className={s.section}>
          <h2 className="display" style={{ fontSize: 36, lineHeight: 1.1 }}>
            Questions traders ask
          </h2>
          <div className={s.faq}>
            {FAQ.map(([q, a]) => (
              <div key={q}>
                <h3>{q}</h3>
                <p className="muted">{a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={s.final}>
          <Mark size={56} />
          <h2
            className="display"
            style={{ fontSize: 'clamp(36px, 6vw, 64px)', fontWeight: 800, lineHeight: 1 }}
          >
            Arm it before the next wick.
          </h2>
          <Link
            href="/connect"
            className="btn btn-primary btn-lg"
            style={{ minHeight: 56, fontSize: 17 }}
          >
            Protect my positions
          </Link>
          <span className="num muted" style={{ fontSize: 12, letterSpacing: '0.06em' }}>
            FREE DURING BETA · OPEN SOURCE · BTC AND ETH AT LAUNCH
          </span>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={s.footLeft}>
          <span className="wordmark" style={{ fontSize: 14 }}>
            AIRBAG
          </span>
          <p className="faint" style={{ maxWidth: 640, fontSize: 13, lineHeight: 1.55 }}>
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
