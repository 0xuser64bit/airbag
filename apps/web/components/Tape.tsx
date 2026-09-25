'use client';

// The primary flight display's tape: a vertical price scale for one position. Price rises up the
// tape. A red band runs beyond liquidation, a hatched band lies between liquidation and the
// Airbag line, a yellow bug marks the line, and a bone readout box points at the mark. After a
// deploy the old liquidation price and the old line stay as dashed ghosts. Every part slides
// with damped instrument motion when a block, a setting or a deploy moves it.

import { fmt, type Side } from '@airbag/risk';
import { Readout } from './instruments.tsx';
import s from './Tape.module.css';

export interface TapeProps {
  side: Side;
  liquidation: number;
  line?: number | undefined;
  mark: number;
  entry?: number | undefined;
  /** The pre-deploy liquidation price, left on the tape as a dashed ghost. */
  ghost?: number | undefined;
  /** The line Airbag deployed at, left as a dashed ghost once it re-arms elsewhere. */
  ghostLine?: number | undefined;
  /** Where liquidation would sit after Airbag acts at the line (the settings preview). */
  projected?: number | null | undefined;
  /** The mark is near the line: the protection band warms. */
  near?: boolean;
  /** Tape height in px. */
  height?: number;
}

/**
 * Domain: every fixed landmark plus the mark, padded by a sixth of the span each side, and at
 * least two graduations beyond liquidation so the red band reads as a band. The line is left
 * out so moving it (a setting, a re-arm) slides the bug without rescaling the tape.
 */
export function domain(points: number[], side: Side, liquidation: number): [number, number] {
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const pad = (hi - lo) / 6 || Math.abs(hi) * 0.01 || 1;
  const room = 2 * niceStep(hi - lo + 2 * pad);
  return side === 'long'
    ? [Math.min(lo - pad, liquidation - room), hi + pad]
    : [lo - pad, Math.max(hi + pad, liquidation + room)];
}

/** A 1, 2, 2.5 or 5 × 10^k step giving about `count` labelled graduations. */
export function niceStep(span: number, count = 7): number {
  const raw = span / count;
  const k = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * k).find((step) => step >= raw) ?? 10 * k;
}

/** A graduation's price, with exactly as many decimals as the step needs. */
const tickLabel = (p: number, step: number) => {
  const decimals = (String(Number(step.toPrecision(3))).split('.')[1] ?? '').length;
  return p.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

/** Every multiple of `step` inside [lo, hi], built from integers so labels don't drift. */
const multiples = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let i = Math.ceil(lo / step); i <= Math.floor(hi / step); i++) out.push(i * step);
  return out;
};

interface Flag {
  id: string;
  y: number; // px from the top
  h: number;
  node: React.ReactNode;
  className?: string | undefined;
}

const GAP = 4;

/**
 * Keeps marker labels apart around the mark's readout box, which never moves: labels above the
 * box are pushed up, labels below pushed down, all kept inside the tape.
 */
export function stack(flags: Flag[], fixed: { y: number; h: number }, height: number) {
  const top = fixed.y - fixed.h / 2 - GAP;
  const bottom = fixed.y + fixed.h / 2 + GAP;
  const above = flags.filter((f) => f.y < fixed.y).sort((a, b) => b.y - a.y);
  const below = flags.filter((f) => f.y >= fixed.y).sort((a, b) => a.y - b.y);
  const out = new Map<string, number>();
  let limit = top;
  for (const f of above) {
    const t = Math.min(f.y - f.h / 2, limit - f.h);
    out.set(f.id, t);
    limit = t - GAP;
  }
  limit = bottom;
  for (const f of below) {
    const t = Math.max(f.y - f.h / 2, limit);
    out.set(f.id, t);
    limit = t + f.h + GAP;
  }
  // Anything pushed past an end slides back in, dragging its neighbours with it.
  const ends = [...out.entries()].sort((a, b) => a[1] - b[1]);
  let floor = height;
  for (let i = ends.length - 1; i >= 0; i--) {
    const [id, t] = ends[i] as [string, number];
    const h = flags.find((f) => f.id === id)?.h ?? 0;
    const clamped = Math.min(t, floor - h);
    out.set(id, clamped);
    floor = clamped - GAP;
  }
  let ceiling = 0;
  for (const [id] of [...out.entries()].sort((a, b) => a[1] - b[1])) {
    const h = flags.find((f) => f.id === id)?.h ?? 0;
    const t = Math.max(out.get(id) ?? 0, ceiling);
    out.set(id, t);
    ceiling = t + h + GAP;
  }
  return out;
}

export function Tape({
  side,
  liquidation,
  line,
  mark,
  entry,
  ghost,
  ghostLine,
  projected,
  near = false,
  height = 400,
}: TapeProps) {
  const [lo, hi] = domain(
    [
      liquidation,
      mark,
      ...(entry === undefined ? [] : [entry]),
      ...(ghost === undefined ? [] : [ghost]),
      ...(ghostLine === undefined ? [] : [ghostLine]),
      ...(projected == null ? [] : [projected]),
    ],
    side,
    liquidation,
  );
  const y = (p: number) => ((hi - p) / (hi - lo)) * height;
  const pct = (p: number) => `${((hi - p) / (hi - lo)) * 100}%`;
  const step = niceStep(hi - lo);
  const majors = multiples(lo, hi, step);
  const minorStep = step / 5;
  const minors =
    (minorStep / (hi - lo)) * height >= 6
      ? multiples(lo, hi, minorStep).filter(
          (p) => !majors.some((m) => Math.abs(m - p) < minorStep / 2),
        )
      : [];

  // The red band runs from liquidation to the losing end of the tape; the protection band from
  // liquidation to the line.
  const danger =
    side === 'long'
      ? { top: pct(liquidation), bottom: '0%' }
      : { top: '0%', bottom: `${100 - ((hi - liquidation) / (hi - lo)) * 100}%` };
  const band =
    line === undefined
      ? undefined
      : {
          top: pct(Math.max(line, liquidation)),
          height: `${(Math.abs(line - liquidation) / (hi - lo)) * 100}%`,
        };

  const flags: Flag[] = [
    {
      id: 'liq',
      y: y(liquidation),
      h: 18,
      className: s.liqFlag,
      node: <>LIQ {fmt.usd(liquidation)}</>,
    },
    ...(line === undefined
      ? []
      : [
          {
            id: 'line',
            y: y(line),
            h: 18,
            className: s.lineFlag,
            node: <>AIRBAG {fmt.usd(line)}</>,
          },
        ]),
    ...(entry === undefined
      ? []
      : [{ id: 'entry', y: y(entry), h: 18, className: s.faintFlag, node: <>ENTRY</> }]),
    ...(ghost === undefined
      ? []
      : [
          {
            id: 'ghost',
            y: y(ghost),
            h: 18,
            className: `${s.ghostFlag} ${s.liqFlag}`,
            node: <>WAS {fmt.usd(ghost)}</>,
          },
        ]),
    ...(ghostLine === undefined
      ? []
      : [
          {
            id: 'ghostLine',
            y: y(ghostLine),
            h: 18,
            className: `${s.ghostFlag} ${s.lineFlag}`,
            node: <>WAS {fmt.usd(ghostLine)}</>,
          },
        ]),
    ...(projected == null
      ? []
      : [
          {
            id: 'after',
            y: y(projected),
            h: 18,
            className: s.afterFlag,
            node: <>AFTER {fmt.usd(projected)}</>,
          },
        ]),
  ];
  const tops = stack(flags, { y: y(mark), h: 34 }, height);
  const summary = `Liquidation ${fmt.usd(liquidation)}${line === undefined ? '' : `, Airbag line ${fmt.usd(line)}`}, mark ${fmt.usd(mark)}${ghost === undefined ? '' : `, liquidation was ${fmt.usd(ghost)}`}${ghostLine === undefined ? '' : `, Airbag deployed at ${fmt.usd(ghostLine)}`}${projected == null ? '' : `, liquidation after Airbag acts ${fmt.usd(projected)}`}`;

  return (
    <div className={s.tape} style={{ height }} role="img" aria-label={summary}>
      <div className={s.scale} aria-hidden="true">
        {majors.map((p) => (
          <span key={`M${p}`} className={s.major} style={{ top: pct(p) }}>
            <span className="num">{tickLabel(p, step)}</span>
          </span>
        ))}
        {minors.map((p) => (
          <span key={`m${p}`} className={s.minor} style={{ top: pct(p) }} />
        ))}
      </div>
      <div className={s.bands} aria-hidden="true">
        <div className={s.danger} style={danger} />
        {band && <div className={`${s.band} ${near ? s.near : ''}`} style={band} />}
      </div>
      <div className={s.markers} aria-hidden="true">
        {ghost !== undefined && <div className={s.ghostLiq} style={{ top: pct(ghost) }} />}
        {ghostLine !== undefined && <div className={s.ghostBug} style={{ top: pct(ghostLine) }} />}
        {projected != null && <div className={s.afterLine} style={{ top: pct(projected) }} />}
        {entry !== undefined && <div className={s.entryLine} style={{ top: pct(entry) }} />}
        <div className={s.liqLine} style={{ top: pct(liquidation) }} />
        {line !== undefined && (
          <div className={s.bug} style={{ top: pct(line) }}>
            <span className={s.bugHead} />
          </div>
        )}
        {flags.map((f) => (
          <span
            key={f.id}
            className={`num ${s.flag} ${f.className ?? ''}`}
            style={{ top: tops.get(f.id) }}
          >
            {f.node}
          </span>
        ))}
        <div className={s.markBox} style={{ top: y(mark) - 17 }}>
          <span className={s.pointer} />
          <Readout className="num" value={fmt.usd(mark)} />
        </div>
      </div>
    </div>
  );
}
