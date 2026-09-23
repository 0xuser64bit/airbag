// The signature component (design/System.dc.html): a price track with the liquidation price
// (red), the Airbag line (yellow), the hatched zone between them, the mark (bone dot) and
// optional dashed ticks for entry or the old liquidation price after a deploy.

import { fmt, type Side } from '@airbag/risk';
import s from './Runway.module.css';

export interface RunwayProps {
  side: Side;
  liquidation: number;
  line?: number | undefined;
  mark: number;
  entry?: number | undefined;
  /** The pre-deploy liquidation price, shown as a dashed ghost. */
  ghost?: number | undefined;
  /** Warm the zone and ring the mark: the mark is near the line. */
  near?: boolean;
  size?: 'lg' | 'md' | 'sm';
  /** Label for the mark. The phone design drops "MARK". */
  markLabel?: string;
}

/**
 * Track domain: liquidation, mark and entry, padded by a sixth of their span each side. With
 * the design's BTC numbers that's exactly $93,000–$101,000, so the ticks land where the design
 * puts them, and moving the line (changing sensitivity) doesn't rescale the track.
 */
function scale(points: number[]) {
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const pad = (hi - lo) / 6 || Math.abs(hi) * 0.01 || 1;
  return (p: number) => Math.min(100, Math.max(0, ((p - lo + pad) / (hi - lo + 2 * pad)) * 100));
}

/** Keeps a label inside the track: centred, or anchored to the edge it's near. */
const anchor = (pct: number) => (pct < 12 ? s.start : pct > 88 ? s.end : s.center);

export function Runway({
  side,
  liquidation,
  line,
  mark,
  entry,
  ghost,
  near = false,
  size = 'lg',
  markLabel = 'MARK',
}: RunwayProps) {
  const x = scale([
    liquidation,
    mark,
    ...(entry === undefined ? [] : [entry]),
    ...(ghost === undefined ? [] : [ghost]),
  ]);
  const liq = x(liquidation);
  const ln = line === undefined ? undefined : x(line);
  const mk = x(mark);
  const zone =
    ln === undefined ? undefined : { left: Math.min(liq, ln), width: Math.abs(ln - liq) };
  // When the liquidation and line labels would collide, push them apart.
  const tight = ln !== undefined && Math.abs(ln - liq) < 22;
  const liqLeft = side === 'long' ? liq <= (ln ?? liq) : liq > (ln ?? liq);
  const label = `Liquidation ${fmt.usd(liquidation)}${line === undefined ? '' : `, Airbag line ${fmt.usd(line)}`}, mark ${fmt.usd(mark)}${ghost === undefined ? '' : `, was ${fmt.usd(ghost)}`}`;

  return (
    <div className={`${s.runway} ${s[size]}`} role="img" aria-label={label}>
      <div className={`${s.label} ${s.top} ${anchor(mk)}`} style={{ left: `${mk}%` }}>
        {markLabel ? `${markLabel} ` : ''}
        {fmt.usd(mark)}
      </div>
      {ghost !== undefined && (
        <div
          className={`${s.label} ${s.top} ${s.faintText} ${anchor(x(ghost))}`}
          style={{ left: `${x(ghost)}%` }}
        >
          WAS {fmt.usd(ghost)}
        </div>
      )}
      <div className={s.track} />
      {zone && (
        <div
          className={`${s.zone} ${near ? s.warm : ''}`}
          style={{ left: `${zone.left}%`, width: `${zone.width}%` }}
        />
      )}
      {ghost !== undefined && <div className={s.ghost} style={{ left: `${x(ghost)}%` }} />}
      {entry !== undefined && <div className={s.entry} style={{ left: `${x(entry)}%` }} />}
      <div className={`${s.tick} ${s.liqTick}`} style={{ left: `${liq}%` }} />
      {ln !== undefined && <div className={`${s.tick} ${s.lineTick}`} style={{ left: `${ln}%` }} />}
      <div className={`${s.dot} ${near ? s.ringed : ''}`} style={{ left: `${mk}%` }} />
      {size !== 'sm' && (
        <>
          <div
            className={`${s.label} ${s.bottom} ${s.liqText} ${tight ? (liqLeft ? s.end : s.start) : anchor(liq)}`}
            style={{ left: `${liq}%` }}
          >
            LIQ {fmt.usd(liquidation)}
          </div>
          {ln !== undefined && line !== undefined && (
            <div
              className={`${s.label} ${s.bottom} ${s.airbagText} ${tight ? (liqLeft ? s.start : s.end) : anchor(ln)}`}
              style={{ left: `${ln}%` }}
            >
              AIRBAG {fmt.usd(line)}
            </div>
          )}
          {entry !== undefined &&
            Math.abs(x(entry) - (ln ?? -100)) > 18 &&
            Math.abs(x(entry) - mk) > 4 && (
              <div
                className={`${s.label} ${s.bottom} ${s.faintText} ${anchor(x(entry))}`}
                style={{ left: `${x(entry)}%` }}
              >
                ENTRY {fmt.usd(entry)}
              </div>
            )}
        </>
      )}
    </div>
  );
}
