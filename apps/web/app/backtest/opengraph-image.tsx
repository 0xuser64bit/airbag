// The backtest's share image: how many of Perpl's liquidations the replay kept open, and both
// paths' totals, from the committed results.

import { fmt } from '@airbag/risk';
import { ImageResponse } from 'next/og';
import { ogFonts } from '@/lib/save.ts';
import { loadBacktest } from './data.ts';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt =
  'Airbag’s backtest: every Perpl mainnet liquidation replayed through its engine, and how many it would have kept open.';

const C = {
  ground: '#11110F',
  well: '#0C0C0B',
  line: '#2B2A25',
  bone: '#ECE9E0',
  text2: '#A5A298',
  text3: '#86837A',
  unlit: '#1A1A17',
  airbag: '#F2C12E',
  liq: '#FF6A55',
};

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10.75" fill="none" stroke={C.airbag} strokeWidth="1.5" />
      <path d="M12 12 L12 3.5 A8.5 8.5 0 0 1 20.5 12 Z" fill={C.airbag} />
      <path d="M12 12 L12 20.5 A8.5 8.5 0 0 1 3.5 12 Z" fill={C.airbag} />
    </svg>
  );
}

export default async function Image() {
  const fonts = await ogFonts();
  const bt = loadBacktest();
  const sum = bt.summary;
  const mono = { fontFamily: 'Mono' };
  const display = { fontFamily: 'Archivo' };
  const max = Math.max(sum.returned, sum.atLiquidation);
  const first = bt.rows[0];
  const last = bt.rows.at(-1);
  const range = first && last ? `${fmt.date(first.at)} – ${fmt.date(last.at, true)}` : '';
  const bars = [
    { label: 'Returned by Perpl’s liquidations', value: sum.returned, color: C.liq },
    { label: 'Held on the Airbag path, same blocks', value: sum.atLiquidation, color: C.airbag },
  ];

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '52px 64px 44px',
        background: C.ground,
        color: C.bone,
        fontFamily: 'Instrument Sans',
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
          BACKTEST · PERPL {bt.network.toUpperCase()} · {range.toUpperCase()}
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 560 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
            <span style={{ ...mono, fontSize: 132, letterSpacing: '-0.04em', color: C.airbag }}>
              {sum.open}
            </span>
            <span style={{ ...mono, fontSize: 44, color: C.text2 }}>of {sum.replayed}</span>
          </div>
          <span
            style={{
              ...display,
              width: 540,
              fontSize: 34,
              fontWeight: 700,
              lineHeight: 1.12,
              letterSpacing: '-0.01em',
            }}
          >
            liquidated Perpl positions Airbag would have kept open, on the chain’s own prices.
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
            width: 470,
            padding: '24px 26px',
            background: C.well,
            border: `1px solid ${C.line}`,
            borderRadius: 8,
          }}
        >
          {bars.map((b) => (
            <div key={b.label} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18 }}>
                <span>{b.label}</span>
                <span style={{ ...mono, color: b.color }}>{fmt.usd(b.value)}</span>
              </div>
              <div style={{ display: 'flex', height: 12, background: C.unlit, borderRadius: 2 }}>
                <div
                  style={{
                    width: `${Math.max(2, (b.value / max) * 100)}%`,
                    height: 12,
                    background: b.color,
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>
          ))}
          <span style={{ fontSize: 15, lineHeight: 1.4, color: C.text2 }}>
            Airbag’s line was crossed first in all {sum.actedBefore}, a median{' '}
            {fmt.duration(sum.leadSeconds.p50 * 1000)} before Perpl liquidated.
          </span>
        </div>
      </div>

      <span style={{ ...mono, fontSize: 13, color: C.text3 }}>
        Each position rebuilt from its liquidation event, the marks Perpl published run through
        Airbag’s engine. Fills assumed: 0.25% past the mark. Not live trades.
      </span>
    </div>,
    { ...size, fonts },
  );
}
