// The site's share image: the tagline beside the landing's crash test, drawn from the same path
// and the same @airbag/risk numbers as the replay (lib/crash.ts). Save reports have their own.

import { equity, fmt } from '@airbag/risk';
import { ImageResponse } from 'next/og';
import { FILL_AT, LIQ_AT, PATH, returned, trim, trimmed } from '@/lib/crash.ts';
import { ogFonts } from '@/lib/save.ts';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt =
  'Airbag: get trimmed, not liquidated. A BTC long through one wick, liquidated without Airbag, still open with it.';

const C = {
  ground: '#11110F',
  well: '#0C0C0B',
  line: '#2B2A25',
  lineStrong: '#3A3932',
  bone: '#ECE9E0',
  text2: '#A5A298',
  text3: '#86837A',
  airbag: '#F2C12E',
  liq: '#FF6A55',
};

// The chart: 480 × 250, the wick's 41 frames across, $100,800 to $93,000 down.
const W = 480;
const H = 250;
const x = (i: number) => 20 + (i * (W - 40)) / (PATH.length - 1);
const y = (p: number) => 24 + ((100_800 - p) / 7_800) * (H - 48);

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
  const mono = { fontFamily: 'Mono' };
  const display = { fontFamily: 'Archivo' };
  const trace = PATH.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const levels = [
    { p: 100_000, label: `ENTRY ${fmt.usd(100_000)}`, color: C.text3, dash: true },
    { p: 97_000, label: `AIRBAG ${fmt.usd(97_000)}`, color: C.airbag, dash: false },
    { p: 94_000, label: `LIQUIDATION ${fmt.usd(94_000)}`, color: C.liq, dash: false },
  ];
  const lanes = [
    { label: 'WITHOUT AIRBAG', value: returned, color: C.liq, note: 'liquidated at $94,000' },
    {
      label: 'WITH AIRBAG',
      value: equity(trimmed, 100_000),
      color: C.airbag,
      note: `still open, ${fmt.size(1 - trim)} BTC`,
    },
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
          LIQUIDATION PROTECTION · PERPL ON MONAD
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 560 }}>
          <div
            style={{
              ...display,
              display: 'flex',
              flexDirection: 'column',
              fontSize: 64,
              fontWeight: 800,
              lineHeight: 0.98,
              letterSpacing: '-0.015em',
            }}
          >
            <span>Get trimmed,</span>
            <span>not liquidated.</span>
          </div>
          <span style={{ width: 500, fontSize: 22, lineHeight: 1.45, color: C.text2 }}>
            Airbag checks your Perpl positions every Monad block and trims before the liquidation
            engine can close all of it.
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: W }}>
          <div
            style={{
              position: 'relative',
              display: 'flex',
              width: W,
              height: H,
              background: C.well,
              border: `1px solid ${C.line}`,
              borderRadius: 8,
            }}
          >
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'flex' }}>
              {levels.map((l) => (
                <line
                  key={l.p}
                  x1="20"
                  x2={W - 20}
                  y1={y(l.p)}
                  y2={y(l.p)}
                  stroke={l.dash ? C.lineStrong : l.color}
                  strokeWidth={l.dash ? 1.5 : 2}
                  strokeDasharray={l.dash ? '4 6' : undefined}
                />
              ))}
              <polyline
                points={trace}
                fill="none"
                stroke={C.bone}
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <circle
                cx={x(FILL_AT)}
                cy={y(97_000)}
                r="7"
                fill={C.airbag}
                stroke={C.well}
                strokeWidth="3"
              />
              <circle
                cx={x(LIQ_AT)}
                cy={y(94_000)}
                r="7"
                fill={C.well}
                stroke={C.liq}
                strokeWidth="3"
              />
            </svg>
            {levels.map((l) => (
              <span
                key={l.label}
                style={{
                  ...mono,
                  position: 'absolute',
                  left: 22,
                  top: y(l.p) - 22,
                  fontSize: 12,
                  letterSpacing: '0.06em',
                  color: l.color,
                }}
              >
                {l.label}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            {lanes.map((l) => (
              <div
                key={l.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  width: (W - 14) / 2,
                  padding: '12px 16px',
                  background: C.well,
                  border: `1px solid ${C.line}`,
                  borderRadius: 8,
                }}
              >
                <span style={{ ...mono, fontSize: 11, letterSpacing: '0.1em', color: C.text2 }}>
                  {l.label}
                </span>
                <span style={{ ...mono, fontSize: 34, letterSpacing: '-0.03em', color: l.color }}>
                  {fmt.usd(l.value)}
                </span>
                <span style={{ fontSize: 14, color: C.text2 }}>{l.note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <span style={{ ...mono, fontSize: 13, color: C.text3 }}>
        Zero-fee example: 1 BTC long at 10x through one wick, back at $100,000. Live trading fees
        apply.
      </span>
    </div>,
    { ...size, fonts },
  );
}
