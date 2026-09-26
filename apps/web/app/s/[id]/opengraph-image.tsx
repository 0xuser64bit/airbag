// The save card as a 1200×675 share image (design/SaveCard.dc.html).

import { fmt } from '@airbag/risk';
import { ImageResponse } from 'next/og';
import { getSave, ogFonts } from '@/lib/save.ts';

export const size = { width: 1200, height: 675 };
export const contentType = 'image/png';
export const alt = 'Airbag save report';

const C = {
  ground: '#11110F',
  raised: '#1F1F1B',
  line: '#2B2A25',
  bone: '#ECE9E0',
  text2: '#A5A298',
  airbag: '#F2C12E',
  liq: '#FF6A55',
};

/** The hazard stripe, drawn as SVG: satori has no repeating gradients. */
function Hazard({ height }: { height: number }) {
  const w = 1200;
  const step = 24;
  const bars = [];
  for (let x = -height; x < w + height; x += step) {
    bars.push(
      <polygon
        key={x}
        points={`${x},${height} ${x + height},0 ${x + height + step / 2},0 ${x + step / 2},${height}`}
        fill={C.airbag}
      />,
    );
  }
  return (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ display: 'flex' }}>
      <rect width={w} height={height} fill={C.ground} />
      {bars}
    </svg>
  );
}

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10.75" fill="none" stroke={C.airbag} strokeWidth="1.5" />
      <path d="M12 12 L12 3.5 A8.5 8.5 0 0 1 20.5 12 Z" fill={C.airbag} />
      <path d="M12 12 L12 20.5 A8.5 8.5 0 0 1 3.5 12 Z" fill={C.airbag} />
    </svg>
  );
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [save, fonts] = await Promise.all([getSave(id).catch(() => null), ogFonts()]);
  const mono = { fontFamily: 'Mono' };
  const display = { fontFamily: 'Archivo' };

  if (!save) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: C.ground,
          color: C.bone,
          fontSize: 40,
          ...display,
        }}
      >
        <Mark size={48} />
        AIRBAG
      </div>,
      { ...size, fonts },
    );
  }

  const max = Math.max(save.withAirbag, save.counterfactual, 1);
  const at = save.measuredAt === null ? '' : `, with ${save.symbol} at ${fmt.usd(save.measuredAt)}`;
  const lev = save.nominalLeverage ? ` · ${Math.round(save.nominalLeverage)}x` : '';
  const footer = [
    save.kind === 'trim'
      ? `${fmt.size(save.trimmed, save.sizeDecimals)} ${save.symbol} trimmed`
      : `${fmt.usd(save.spareAdded)} margin added`,
    `fee ${fmt.fee(save.fee)}`,
    save.lineToFillMs !== null ? `${fmt.duration(save.lineToFillMs)} after the line` : null,
    save.hitAfterMs !== null
      ? `old liquidation price hit ${fmt.duration(save.hitAfterMs)} later`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: C.ground,
        color: C.bone,
        fontFamily: 'Instrument Sans',
      }}
    >
      <div
        style={{
          flexGrow: 1,
          padding: '52px 64px 44px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Mark size={30} />
            <span style={{ ...display, fontSize: 19, fontWeight: 800, letterSpacing: '0.06em' }}>
              AIRBAG
            </span>
          </div>
          <span style={{ ...mono, fontSize: 13, letterSpacing: '0.08em', color: C.text2 }}>
            {`${save.simulated ? 'SIMULATED · ' : ''}SAVE REPORT · ${fmt.date(save.date, true).toUpperCase()}`}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 64,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ ...mono, fontSize: 13, letterSpacing: '0.1em', color: C.airbag }}>
              {`SAVED · ${save.symbol} ${save.side.toUpperCase()}${lev.toUpperCase()}`}
            </span>
            <span
              style={{
                ...mono,
                fontSize: 148,
                lineHeight: 0.9,
                letterSpacing: '-0.04em',
                color: C.airbag,
              }}
            >
              {fmt.usd(save.kept)}
            </span>
            <span style={{ ...display, fontSize: 28, fontWeight: 700 }}>
              kept versus a liquidation
            </span>
          </div>
          <div
            style={{
              width: 440,
              display: 'flex',
              flexDirection: 'column',
              gap: 22,
              paddingBottom: 8,
            }}
          >
            <span style={{ fontSize: 15, color: C.text2 }}>{`Where each version ended${at}`}</span>
            {[
              {
                label: `Liquidated at ${fmt.usd(save.oldLiquidation)}`,
                value: save.counterfactual,
                color: C.liq,
              },
              {
                label:
                  save.kind === 'trim'
                    ? `Trimmed by Airbag at ${fmt.usd(save.fillPrice)}`
                    : 'Margin added by Airbag',
                value: save.withAirbag,
                color: C.airbag,
              },
            ].map((b) => (
              <div key={b.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <span style={{ fontSize: 15 }}>{b.label}</span>
                  <span style={{ ...mono, fontSize: 18, color: b.color }}>{fmt.usd(b.value)}</span>
                </div>
                <div style={{ display: 'flex', height: 14, background: C.raised, borderRadius: 3 }}>
                  <div
                    style={{
                      width: `${Math.max(2, (b.value / max) * 100)}%`,
                      height: 14,
                      background: b.color,
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 22,
            borderTop: `1px solid ${C.line}`,
            ...mono,
            fontSize: 13,
            color: C.text2,
          }}
        >
          <span>{footer}</span>
          {save.tx && !save.simulated ? (
            <span style={{ color: C.bone }}>{`tx ${fmt.short(save.tx)}`}</span>
          ) : (
            <span />
          )}
        </div>
      </div>
      <Hazard height={12} />
    </div>,
    { ...size, fonts },
  );
}
