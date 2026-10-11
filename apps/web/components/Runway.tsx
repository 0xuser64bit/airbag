'use client';

// The Runway: the tape laid flat, one per position. Price rises to the right. A red band runs
// from liquidation to the losing end, the hatched zone lies between liquidation and the Airbag
// line, a yellow bug marks the line, and a bone box reads the mark. Dashed ticks mark entry and,
// after a deploy, the old liquidation price. Labels are measured and kept apart, so they never
// print over each other however close the prices get.

import { fmt } from '@airbag/risk';
import { useLayoutEffect, useRef, useState } from 'react';
import s from './Runway.module.css';
import { domain } from './Tape.tsx';

export interface RunwayProps {
  liquidation: number;
  line?: number | undefined;
  mark: number;
  entry?: number | undefined;
  /** The pre-deploy liquidation price, shown as a dashed ghost. */
  ghost?: number | undefined;
  /** Warm the zone and ring the mark: the mark is near the line. */
  near?: boolean;
  /** `sm` draws only the track; its labels are the caller's. */
  size?: 'md' | 'sm';
}

/**
 * Track position in percent, on the tape's domain: liquidation, mark, entry and the ghost, with
 * room for the red band beyond liquidation. With the worked example that's $90,000–$101,000,
 * and moving the line doesn't rescale. An open position's liquidation is always on its losing
 * side of the mark, so the side needs no prop.
 */
function scale(points: number[], liquidation: number, mark: number) {
  const [lo, hi] = domain(points, liquidation < mark ? 'long' : 'short', liquidation);
  return (p: number) => Math.min(100, Math.max(0, ((p - lo) / (hi - lo)) * 100));
}

interface Label {
  id: string;
  text: string;
  x: number; // percent of the track
  pri: number; // higher survives crowding
  className?: string | undefined;
}

const GAP = 12;

/**
 * Lays labels in one or two rows without overlap: each sits centred on its tick, then a forward
 * and a backward sweep push neighbours apart and inside the track. What can't fit goes to the
 * second row; the lowest priority is dropped last.
 */
function placeLabels(labels: Label[], width: number, w: (id: string) => number) {
  const rows: Label[][] = [[], []];
  for (const l of [...labels].sort((a, b) => b.pri - a.pri)) {
    const row = rows.find((r) => sweep([...r, l], width, w) !== null);
    if (row) row.push(l);
  }
  const out = new Map<string, { left: number; row: number }>();
  rows.forEach((row, i) => {
    const lefts = sweep(row, width, w) ?? [];
    row.forEach((l, j) => {
      out.set(l.id, { left: lefts[j] ?? 0, row: i });
    });
  });
  return out;
}

function sweep(row: Label[], width: number, w: (id: string) => number): number[] | null {
  const order = row.map((l, i) => ({ l, i })).sort((a, b) => a.l.x - b.l.x);
  const lefts = order.map(({ l }) =>
    Math.min(Math.max(0, (l.x / 100) * width - w(l.id) / 2), width - w(l.id)),
  );
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1] as (typeof order)[number];
    lefts[k] = Math.max(lefts[k] as number, (lefts[k - 1] as number) + w(prev.l.id) + GAP);
  }
  for (let k = order.length - 1; k >= 0; k--) {
    const cur = order[k] as (typeof order)[number];
    const limit = k === order.length - 1 ? width : (lefts[k + 1] as number) - GAP;
    lefts[k] = Math.min(lefts[k] as number, limit - w(cur.l.id));
  }
  if (order.length && (lefts[0] as number) < -0.5) return null;
  const out: number[] = [];
  order.forEach(({ i }, k) => {
    out[i] = lefts[k] as number;
  });
  return out;
}

export function Runway({
  liquidation,
  line,
  mark,
  entry,
  ghost,
  near = false,
  size = 'md',
}: RunwayProps) {
  const track = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLSpanElement>());
  const [measure, setMeasure] = useState<{ width: number; w: Record<string, number> }>();

  const x = scale(
    [
      liquidation,
      mark,
      ...(entry === undefined ? [] : [entry]),
      ...(ghost === undefined ? [] : [ghost]),
    ],
    liquidation,
    mark,
  );
  const liq = x(liquidation);
  const danger =
    liquidation < mark ? { left: '0%', width: `${liq}%` } : { left: `${liq}%`, right: '0%' };
  const ln = line === undefined ? undefined : x(line);
  const mk = x(mark);
  const zone =
    ln === undefined ? undefined : { left: Math.min(liq, ln), width: Math.abs(ln - liq) };
  const summary = `Liquidation ${fmt.usd(liquidation)}${line === undefined ? '' : `, Airbag line ${fmt.usd(line)}`}, mark ${fmt.usd(mark)}${entry === undefined ? '' : `, entry ${fmt.usd(entry)}`}${ghost === undefined ? '' : `, liquidation was ${fmt.usd(ghost)}`}`;

  const labels: Label[] =
    size === 'sm'
      ? []
      : [
          { id: 'liq', text: `LIQ ${fmt.usd(liquidation)}`, x: liq, pri: 5, className: s.liqText },
          ...(ln !== undefined && line !== undefined
            ? [
                {
                  id: 'line',
                  text: `AIRBAG ${fmt.usd(line)}`,
                  x: ln,
                  pri: 4,
                  className: s.airbagText,
                },
              ]
            : []),
          { id: 'mark', text: `MARK ${fmt.usd(mark)}`, x: mk, pri: 3, className: s.markText },
          ...(ghost !== undefined
            ? [
                {
                  id: 'ghost',
                  text: `WAS ${fmt.usd(ghost)}`,
                  x: x(ghost),
                  pri: 2,
                  className: s.ghostText,
                },
              ]
            : []),
          ...(entry !== undefined
            ? [
                {
                  id: 'entry',
                  text: `ENTRY ${fmt.usd(entry)}`,
                  x: x(entry),
                  pri: 1,
                  className: s.faintText,
                },
              ]
            : []),
        ];

  // Measure the track and each label after every render; set state only when something moved.
  useLayoutEffect(() => {
    const width = track.current?.offsetWidth ?? 0;
    const w: Record<string, number> = {};
    for (const [id, el] of els.current) w[id] = el.offsetWidth;
    setMeasure((m) =>
      m && m.width === width && Object.keys(w).every((k) => m.w[k] === w[k]) ? m : { width, w },
    );
  });
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setMeasure((m) => (m ? { ...m, width: el.offsetWidth } : m)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placed =
    measure && measure.width > 0
      ? placeLabels(labels, measure.width, (id) => measure.w[id] ?? 0)
      : undefined;
  const twoRows = placed ? [...placed.values()].some((p) => p.row === 1) : false;

  return (
    <div className={`${s.runway} ${s[size]}`}>
      <div ref={track} className={s.track} role="img" aria-label={summary}>
        <div className={s.danger} style={danger} />
        {zone && (
          <div
            className={`${s.zone} ${near ? s.warm : ''}`}
            style={{ left: `${zone.left}%`, width: `${zone.width}%` }}
          />
        )}
        {ghost !== undefined && <div className={s.ghost} style={{ left: `${x(ghost)}%` }} />}
        {entry !== undefined && <div className={s.entry} style={{ left: `${x(entry)}%` }} />}
        <div className={`${s.tick} ${s.liqTick}`} style={{ left: `${liq}%` }} />
        {ln !== undefined && (
          <div className={`${s.tick} ${s.lineTick}`} style={{ left: `${ln}%` }} />
        )}
        <div className={`${s.dot} ${near ? s.ringed : ''}`} style={{ left: `${mk}%` }} />
      </div>
      {labels.length > 0 && (
        <div className={`${s.labels} ${twoRows ? s.twoRows : ''}`} aria-hidden="true">
          {labels.map((l) => {
            const p = placed?.get(l.id);
            return (
              <span
                key={l.id}
                ref={(el) => {
                  if (el) els.current.set(l.id, el);
                  else els.current.delete(l.id);
                }}
                className={`num ${s.label} ${l.className ?? ''}`}
                style={
                  p
                    ? { left: p.left, top: p.row ? 24 : 0 }
                    : placed
                      ? { visibility: 'hidden' }
                      : { left: `${l.x}%`, transform: 'translateX(-50%)' }
                }
              >
                {l.text}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
