'use client';

// The landing page's crash test: the same BTC long run twice through one scripted wick, one
// frame per Monad block. Every number comes from @airbag/risk, the code the engine runs, by way
// of lib/crash.ts.

import { equity, fmt } from '@airbag/risk';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BACK_AT,
  btc,
  FILL_AT,
  LINE_AT,
  LIQ_AT,
  PATH,
  plan,
  returned,
  trim,
  trimmed,
} from '@/lib/crash.ts';
import s from './CrashTest.module.css';
import { Replay } from './icons.tsx';
import { Annunciator, Readout } from './instruments.tsx';

const LAST = PATH.length - 1;
/** Illustrative block numbers: this is a scripted crash test, not a real market. */
const FIRST_BLOCK = 48_201_323;

const x = (i: number) => 16 + i * 13.2;
const y = (p: number) => 16 + ((100_800 - p) / 7_800) * 208;

const EVENTS = [
  { at: LINE_AT, text: `Airbag line hit at ${fmt.usd(97_000)}`, tone: 'airbag' },
  {
    at: FILL_AT,
    text: `Trimmed ${fmt.size(trim)} BTC, fee $0. Liquidation now ${fmt.usd(plan.liquidation)}`,
    tone: 'airbag',
  },
  { at: LIQ_AT, text: `Without Airbag: liquidated, ${fmt.usd(returned)} returned`, tone: 'liq' },
  { at: BACK_AT, text: `BTC back at ${fmt.usd(100_000)}`, tone: undefined },
] as const;

export function CrashTest() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const play = useCallback(() => {
    clearInterval(timer.current);
    setT(0);
    setPlaying(true);
    timer.current = setInterval(() => {
      if (document.hidden) return;
      setT((cur) => (cur >= 50 ? 0 : cur + 1));
    }, 300);
  }, []);

  const pause = useCallback(() => {
    clearInterval(timer.current);
    timer.current = undefined;
    setPlaying(false);
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setT(LAST);
      setPlaying(false);
    } else play();
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
  const summary =
    frame < LINE_AT
      ? `Armed. BTC ${fmt.usd(p)}.`
      : frame === LINE_AT
        ? `Airbag line hit at ${fmt.usd(97_000)}. Deploying.`
        : frame < LIQ_AT
          ? `Trimmed ${fmt.size(trim)} BTC. BTC ${fmt.usd(p)}.`
          : frame < BACK_AT
            ? `Without Airbag liquidated at ${fmt.usd(94_000)}. With Airbag still open at ${fmt.usd(withEq)}.`
            : `Wick over. BTC back at ${fmt.usd(100_000)}. With Airbag ${fmt.usd(withEq)}.`;

  return (
    <figure id="crash" className={s.crash} aria-labelledby="crash-title">
      <div className={s.head}>
        <div className={s.titles}>
          <h2 id="crash-title" className={s.title}>
            Crash test · BTC long · 10x
          </h2>
          <p className="muted">Zero-fee simulation · same position, same wick, run twice</p>
        </div>
        <div className={s.controls}>
          <div className={s.ticker} aria-hidden="true">
            <span className="num">
              <span className="faint">BTC </span>
              <Readout value={fmt.usd(p)} />
            </span>
            <span className="num faint">Block {fmt.block(FIRST_BLOCK + frame)}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={playing ? pause : play}
            aria-pressed={playing}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={play}>
            <Replay />
            Replay
          </button>
        </div>
      </div>
      <p className="visually-hidden" role="status">
        {summary}
      </p>

      <div className={`well ${s.chartWell}`}>
        <svg
          viewBox="0 0 560 240"
          role="img"
          aria-label="BTC falls from $100,000 to $94,000 and recovers. Airbag trims at $97,000; without it the position is liquidated at $94,000."
          className={s.chart}
        >
          <line className={s.entry} x1="16" y1="37.33" x2="544" y2="37.33" />
          <text className={`${s.svgText} ${s.faintText}`} x="16" y="29">
            ENTRY $100,000
          </text>
          <line className={s.lineAirbag} x1="16" y1="117.33" x2="544" y2="117.33" />
          <text className={`${s.svgText} ${s.airbagText}`} x="16" y="109">
            AIRBAG $97,000
          </text>
          <line className={s.lineLiq} x1="16" y1="197.33" x2="544" y2="197.33" />
          <text className={`${s.svgText} ${s.liqText}`} x="16" y="189">
            LIQUIDATION $94,000
          </text>
          <polyline className={s.trace} points={pts} />
          <circle className={s.fillMark} cx={x(FILL_AT)} cy={y(97_000)} r={isTrimmed ? 6 : 0} />
          <circle className={s.liqMark} cx={x(LIQ_AT)} cy={y(94_000)} r={liquidated ? 6 : 0} />
          <circle className={s.now} cx={x(frame)} cy={y(p)} r="4.5" />
        </svg>
      </div>

      <div className={s.lanes}>
        <div className={s.lane} data-state={liquidated ? 'liq' : undefined}>
          <div className={s.laneHead}>
            <span className="label">Without Airbag</span>
            <Annunciator state={liquidated ? 'liq' : 'on'} size="sm">
              {liquidated ? 'Liquidated' : 'Open'}
            </Annunciator>
          </div>
          <span className={`big ${s.laneValue} ${liquidated ? 'liq' : ''}`}>
            {fmt.usd(withoutEq)}
          </span>
          <span className="muted">
            {liquidated ? `Liquidated at ${fmt.usd(94_000)}` : 'Open, 1.000 BTC'}
          </span>
        </div>
        <div className={s.lane} data-state={isTrimmed ? 'airbag' : undefined}>
          <div className={s.laneHead}>
            <span className="label">With Airbag</span>
            <Annunciator
              state={frame < LINE_AT ? 'on' : frame === LINE_AT ? 'airbag' : 'airbag-line'}
              size="sm"
            >
              {frame < LINE_AT ? 'Armed' : frame === LINE_AT ? 'Deploying' : 'Trimmed'}
            </Annunciator>
          </div>
          <span className={`big ${s.laneValue} ${isTrimmed ? 'airbag' : ''}`}>
            {fmt.usd(withEq)}
          </span>
          <span className="muted">
            {frame < LINE_AT
              ? `Armed, line at ${fmt.usd(97_000)}`
              : frame === LINE_AT
                ? 'Line hit, deploying'
                : `Trimmed ${fmt.size(trim)} BTC, fee $0, still open`}
          </span>
        </div>
      </div>

      <ol className={s.events}>
        {EVENTS.map((e) => {
          const on = frame >= e.at;
          return (
            <li key={e.at} data-tone={on ? e.tone : 'off'}>
              <span className="num">{on ? fmt.block(FIRST_BLOCK + e.at) : '#48,201,···'}</span>
              <span>{on ? e.text : 'Waiting'}</span>
            </li>
          );
        })}
      </ol>
      <figcaption className={s.caption}>
        A scripted zero-fee example, compressed: one frame per Monad block. Live trading fees apply.
        Liquidation terms are Perpl’s: 4% BTC maintenance margin, 80% of the remaining margin
        returned.
      </figcaption>
    </figure>
  );
}
