'use client';

// A recorded mark path around one Perpl liquidation, with Airbag's line, the liquidation price,
// where the replay trimmed and where Perpl liquidated. Yellow is Airbag, red is liquidation, the
// trace itself is bone. A crosshair reads the mark at any point, by pointer or arrow keys.

import { fmt } from '@airbag/risk';
import { useEffect, useRef, useState } from 'react';
import { relative } from '@/lib/backtest.ts';
import s from './Trace.module.css';

/** The width the chart draws at before it has measured its well, and the most it uses. */
const WIDE = 720;
const PAD = { top: 24, right: 16, bottom: 30, left: 16 };

export interface TraceProps {
  symbol: string;
  /** [blocks from Perpl's liquidation, mark]. */
  path: [number, number][];
  line: number;
  liquidation: number;
  /** Liquidation after Airbag's last trim before Perpl liquidated the original. */
  after: number | null;
  /** Airbag's trims: [blocks from the liquidation, fill price]. */
  trims: [number, number][];
  /** Perpl's liquidation: the mark it happened at. */
  liquidatedMark: number;
}

export function Trace({
  symbol,
  path,
  line,
  liquidation,
  after,
  trims,
  liquidatedMark,
}: TraceProps) {
  const [hover, setHover] = useState<number | undefined>();
  // Draw at the well's own width, so the 10px labels stay 10px on a phone instead of scaling down.
  const [W, setW] = useState(WIDE);
  const well = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = well.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setW(Math.round(Math.min(WIDE, Math.max(300, e.contentRect.width))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 560 ? 260 : 300;
  const right = W - PAD.right;
  const first = path[0]?.[0] ?? 0;
  const last = path.at(-1)?.[0] ?? 1;
  const levels = [line, liquidation, liquidatedMark, ...path.map(([, p]) => p)];
  if (after !== null) levels.push(after);
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const room = (hi - lo) * 0.08 || hi * 0.01;
  const x = (b: number) =>
    PAD.left + ((b - first) / (last - first || 1)) * (W - PAD.left - PAD.right);
  const y = (p: number) =>
    PAD.top + ((hi + room - p) / (hi - lo + 2 * room)) * (H - PAD.top - PAD.bottom);
  const points = path.map(([b, p]) => `${x(b).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const firstTrim = trims[0]?.[0];
  const split = firstTrim === undefined ? right : x(firstTrim);
  // A level's label goes at whichever end the trace and the trims stay further from it.
  const marks = [...path, ...trims, [0, liquidatedMark] as [number, number]];
  const clear = (level: number, fromX: number, toX: number) =>
    Math.min(
      ...marks
        .filter(([b]) => x(b) >= fromX && x(b) <= toX)
        .map(([, p]) => Math.abs(y(p) - y(level))),
      Infinity,
    );
  const end = (level: number) => clear(level, W * 0.7, W) > clear(level, 0, W * 0.3);
  const flagX = (level: number) => (end(level) ? right - 4 : PAD.left + 4);
  const ticks = [first, 0, last].filter((b, i, xs) => xs.indexOf(b) === i);
  const at = hover === undefined ? undefined : path[hover];

  const nearest = (clientX: number, rect: DOMRect) => {
    const vx = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < path.length; i++)
      if (Math.abs(x(path[i]?.[0] ?? 0) - vx) < Math.abs(x(path[best]?.[0] ?? 0) - vx)) best = i;
    return best;
  };

  return (
    <div className={`well ${s.well}`} ref={well}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={s.chart}
        role="img"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys move the crosshair
        tabIndex={0}
        aria-label={`${symbol} mark from ${relative(first)} to ${relative(last)} around the liquidation. Airbag line ${fmt.price(line)}, liquidation ${fmt.price(liquidation)}${after === null ? '' : `, ${fmt.price(after)} after Airbag's trim`}. The block log below lists each step.`}
        onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setHover(undefined)}
        onBlur={() => setHover(undefined)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const step = e.key === 'ArrowLeft' ? -1 : 1;
          const start = hover ?? path.findIndex(([b]) => b >= 0);
          setHover(Math.min(path.length - 1, Math.max(0, start + step)));
        }}
      >
        <line className={s.zero} x1={x(0)} x2={x(0)} y1={PAD.top - 12} y2={H - PAD.bottom} />
        {/* Once Airbag trims, the old line and liquidation stay as dashed ghosts. */}
        <Level
          className={s.airbag}
          y={y(line)}
          from={PAD.left}
          to={split}
          max={right}
          ghost={s.airbagGhost}
        />
        <Level
          className={s.liq}
          y={y(liquidation)}
          from={PAD.left}
          to={split}
          max={right}
          ghost={s.liqGhost}
        />
        {after !== null && firstTrim !== undefined && (
          <line className={s.liq} x1={split} x2={right} y1={y(after)} y2={y(after)} />
        )}
        <polyline className={s.trace} points={points} />
        <Flag x={flagX(line)} y={y(line)} className={s.airbagText} end={end(line)}>
          AIRBAG {fmt.price(line)}
        </Flag>
        <Flag
          x={flagX(liquidation)}
          y={y(liquidation)}
          className={s.liqText}
          end={end(liquidation)}
        >
          LIQUIDATION {fmt.price(liquidation)}
        </Flag>
        {after !== null && firstTrim !== undefined && (
          // The new liquidation only exists right of the trim, so its label stays at that end.
          <Flag x={right - 4} y={y(after)} className={s.liqText} end>
            AFTER TRIM {fmt.price(after)}
          </Flag>
        )}
        {trims.map(([b, p]) => (
          <circle key={b} className={s.trim} cx={x(b)} cy={y(p)} r="5" />
        ))}
        <circle className={s.liqMark} cx={x(0)} cy={y(liquidatedMark)} r="5.5" />
        <text className={`${s.text} ${s.faintText}`} x={x(0)} y={PAD.top - 14} textAnchor="middle">
          PERPL LIQUIDATED
        </text>
        {ticks.map((b) => (
          <text
            key={b}
            className={`${s.text} ${s.faintText}`}
            x={x(b)}
            y={H - 10}
            textAnchor={b === first ? 'start' : b === last ? 'end' : 'middle'}
          >
            {relative(b)}
          </text>
        ))}
        {at && (
          <g className={s.cross}>
            <line x1={x(at[0])} x2={x(at[0])} y1={PAD.top} y2={H - PAD.bottom} />
            <circle cx={x(at[0])} cy={y(at[1])} r="4" />
          </g>
        )}
      </svg>
      <p className={`num ${s.readout}`} aria-live="polite">
        {at ? (
          <>
            <span className="faint">{relative(at[0])}</span> {symbol} {fmt.price(at[1])}
          </>
        ) : (
          <span className="faint">Point at the trace to read the mark.</span>
        )}
      </p>
    </div>
  );
}

/** A level: solid up to `to`, a dashed ghost from there to `max`. */
function Level(p: {
  className: string | undefined;
  ghost: string | undefined;
  y: number;
  from: number;
  to: number;
  max: number;
}) {
  return (
    <>
      <line className={p.className} x1={p.from} x2={p.to} y1={p.y} y2={p.y} />
      {p.to < p.max && <line className={p.ghost} x1={p.to} x2={p.max} y1={p.y} y2={p.y} />}
    </>
  );
}

/**
 * A level's label above its line, knocked out of the glass so the trace never runs through it.
 * Martian Mono at 10px with 0.6px tracking runs about 6.6px a character.
 */
function Flag(p: {
  x: number;
  y: number;
  className: string | undefined;
  end?: boolean;
  children: React.ReactNode;
}) {
  const text = Array.isArray(p.children) ? p.children.join('') : String(p.children);
  const w = text.length * 6.6 + 8;
  return (
    <g>
      <rect
        className={s.knockout}
        x={p.end ? p.x - w + 4 : p.x - 4}
        y={p.y - 17}
        width={w}
        height={14}
      />
      <text
        className={`${s.text} ${p.className}`}
        x={p.x}
        y={p.y - 6}
        textAnchor={p.end ? 'end' : 'start'}
      >
        {p.children}
      </text>
    </g>
  );
}
