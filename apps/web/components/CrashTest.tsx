'use client';

// The landing page's crash test (design/Main.dc.html): the same BTC long run twice through one
// wick, one frame per Monad block. Every number comes from @airbag/risk, the code the engine
// runs; the engine's own test plays this exact path and fires at frame 14, fills at 15.

import {
  applyTrim,
  counterfactualReturn,
  equity,
  fmt,
  type Position,
  planDeploy,
} from '@airbag/risk';
import { useCallback, useEffect, useRef, useState } from 'react';
import s from './CrashTest.module.css';
import { Replay } from './icons.tsx';

const PATH = [
  100000, 99900, 99960, 99700, 99420, 99500, 99100, 98800, 98900, 98400, 98100, 98200, 97700, 97300,
  97000, 97000, 96400, 95900, 95300, 94800, 94400, 94000, 94500, 95200, 95900, 96600, 97200, 97700,
  98200, 98600, 98900, 99200, 99100, 99400, 99600, 99500, 99800, 99900, 100000, 100000, 100000,
];
const LAST = PATH.length - 1;
const LINE_AT = 14;
const FILL_AT = 15;
const LIQ_AT = 21;
const BACK_AT = 38;
/** Illustrative block numbers: this is a scripted crash test, not a real market. */
const FIRST_BLOCK = 48_201_323;

const btc: Position = {
  side: 'long',
  size: 1,
  entry: 100_000,
  deposit: 10_000,
  funding: 0,
  maintenance: 0.04,
};
const plan = planDeploy(btc, 97_000, 0, { target: 0.1, maxTrim: 0.5, useSpare: false });
const trim = plan.kind === 'trim' ? plan.fraction : 0;
const trimmed = applyTrim(btc, trim, 97_000).position;
const returned = counterfactualReturn(btc);

const x = (i: number) => 16 + i * 13.2;
const y = (p: number) => 16 + ((100_800 - p) / 7_800) * 208;

const EVENTS = [
  { at: LINE_AT, text: `Airbag line hit at ${fmt.usd(97_000)}`, tone: 'var(--airbag)' },
  {
    at: FILL_AT,
    text: `Trimmed ${fmt.size(trim)} BTC, fee $0. Liquidation now ${fmt.usd(plan.liquidation)}`,
    tone: 'var(--airbag)',
  },
  {
    at: LIQ_AT,
    text: `Without Airbag: liquidated, ${fmt.usd(returned)} returned`,
    tone: 'var(--liq)',
  },
  { at: BACK_AT, text: `BTC back at ${fmt.usd(100_000)}`, tone: 'var(--bone)' },
];

export function CrashTest() {
  const [t, setT] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const play = useCallback(() => {
    clearInterval(timer.current);
    setT(0);
    timer.current = setInterval(() => {
      if (document.hidden) return;
      setT((cur) => (cur >= 50 ? 0 : cur + 1));
    }, 300);
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) setT(LAST);
    else play();
    return () => clearInterval(timer.current);
  }, [play]);

  const frame = Math.min(t, LAST);
  const p = PATH[frame] ?? 100_000;
  const liquidated = frame >= LIQ_AT;
  const isTrimmed = frame >= FILL_AT;
  const withoutEq = liquidated ? returned : equity(btc, p);
  const withEq = equity(isTrimmed ? trimmed : btc, p);
  const pts = PATH.slice(0, frame + 1)
    .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');
  const withStatus =
    frame < LINE_AT
      ? `Armed, line at ${fmt.usd(97_000)}`
      : frame === LINE_AT
        ? 'Line hit, deploying'
        : `Trimmed ${fmt.size(trim)} BTC, fee $0, still open`;

  return (
    <div id="crash" className={`card ${s.crash}`}>
      <div className={s.head}>
        <div className={s.title}>
          <span className="eyebrow">Crash test · BTC long · 10x</span>
          <span style={{ fontSize: 15, fontWeight: 500 }}>Same position, same wick, run twice</span>
        </div>
        <div className={s.controls}>
          <div className={s.ticker} aria-hidden="true">
            <span className="num" style={{ fontSize: 13 }}>
              BTC {fmt.usd(p)}
            </span>
            <span className="num muted" style={{ fontSize: 11 }}>
              Block {fmt.block(FIRST_BLOCK + frame)}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ minHeight: 40 }}
            onClick={play}
          >
            <Replay />
            Replay
          </button>
        </div>
      </div>

      <svg
        viewBox="0 0 560 240"
        role="img"
        aria-label="BTC falls from $100,000 to $94,000 and recovers. Airbag trims at $97,000; without it the position is liquidated at $94,000."
        className={s.chart}
      >
        <line
          x1="16"
          y1="37.33"
          x2="544"
          y2="37.33"
          stroke="#3A3932"
          strokeWidth="1"
          strokeDasharray="3 5"
        />
        <text x="16" y="29" fill="#86837A" fontSize="10" className={s.svgText}>
          ENTRY $100,000
        </text>
        <line x1="16" y1="117.33" x2="544" y2="117.33" stroke="#F2C12E" strokeWidth="1.5" />
        <text x="16" y="109" fill="#F2C12E" fontSize="10" className={s.svgText}>
          AIRBAG $97,000
        </text>
        <line x1="16" y1="197.33" x2="544" y2="197.33" stroke="#FF6A55" strokeWidth="1.5" />
        <text x="16" y="189" fill="#FF6A55" fontSize="10" className={s.svgText}>
          LIQUIDATION $94,000
        </text>
        <polyline
          points={pts}
          fill="none"
          stroke="#ECE9E0"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle
          cx={x(FILL_AT)}
          cy={y(97_000)}
          r={isTrimmed ? 6 : 0}
          fill="#F2C12E"
          stroke="#181815"
          strokeWidth="3"
        />
        <circle
          cx={x(LIQ_AT)}
          cy={y(94_000)}
          r={liquidated ? 6 : 0}
          fill="#181815"
          stroke="#FF6A55"
          strokeWidth="2.5"
        />
        <circle cx={x(frame)} cy={y(p)} r="4.5" fill="#ECE9E0" />
      </svg>

      <div className={s.lanes}>
        <div className={s.lane} style={{ borderColor: liquidated ? 'var(--liq)' : 'var(--line)' }}>
          <span className="eyebrow">Without Airbag</span>
          <span
            className="big"
            style={{
              fontSize: 34,
              lineHeight: 1.1,
              color: liquidated ? 'var(--liq)' : 'var(--bone)',
            }}
          >
            {fmt.usd(withoutEq)}
          </span>
          <span className="muted" style={{ fontSize: 14 }}>
            {liquidated ? `Liquidated at ${fmt.usd(94_000)}` : 'Open, 1.000 BTC'}
          </span>
        </div>
        <div
          className={s.lane}
          style={{ borderColor: isTrimmed ? 'var(--airbag)' : 'var(--line)' }}
        >
          <span className="eyebrow">With Airbag</span>
          <span
            className="big"
            style={{
              fontSize: 34,
              lineHeight: 1.1,
              color: isTrimmed ? 'var(--airbag)' : 'var(--bone)',
            }}
          >
            {fmt.usd(withEq)}
          </span>
          <span className="muted" style={{ fontSize: 14 }}>
            {withStatus}
          </span>
        </div>
      </div>

      <ol className={s.events}>
        {EVENTS.map((e) => {
          const on = frame >= e.at;
          return (
            <li key={e.at}>
              <span
                className="num"
                style={{ fontSize: 12, color: on ? 'var(--text-2)' : 'var(--text-3)' }}
              >
                {on ? fmt.block(FIRST_BLOCK + e.at) : '#48,201,···'}
              </span>
              <span style={{ fontSize: 14, color: on ? e.tone : 'var(--text-3)' }}>
                {on ? e.text : 'Waiting'}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="faint" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Plays at real speed, one frame per 300 ms Monad block. Liquidation terms are Perpl&apos;s:
        4% BTC maintenance margin, 80% of the remaining margin returned.
      </p>
    </div>
  );
}
