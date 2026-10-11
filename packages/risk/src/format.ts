// Display formatting shared by the engine (timeline, push copy) and the web app, so a number
// reads the same everywhere. Sentence case, en-US grouping, a real minus sign.

const MINUS = '−';

/** $97,000 · $3,060 · $12.34 · $0.02631. Whole dollars from $100 up, as the design shows. */
export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  const body =
    digits === 4 && abs > 0
      ? abs.toPrecision(4)
      : abs.toLocaleString('en-US', {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });
  return `${v < 0 ? MINUS : ''}$${body}`;
}

/** Observed fee, with a distinct unknown state for interrupted/legacy receipts. */
export const fee = (v: number | null | undefined): string =>
  v == null ? 'unconfirmed' : v === 0 ? '$0' : usd(v);

/** 5.45% · 10.00% · −3.09%. */
export function pct(fraction: number | null | undefined, digits = 2): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—';
  const s = (Math.abs(fraction) * 100).toFixed(digits);
  return `${fraction < 0 && Number(s) !== 0 ? MINUS : ''}${s}%`;
}

/** 0.489 · 2.000 · 1,200: at most three places, fewer when the market's lot is coarser. */
export function size(v: number, sizeDecimals = 3): string {
  const digits = Math.min(3, sizeDecimals);
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 13.9x. */
export const lev = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) || v <= 0 ? '—' : `${v.toFixed(1)}x`;

/** #48,201,337. */
export const block = (n: number): string => `#${n.toLocaleString('en-US')}`;

/** 0x9c4e…a71b. */
export const short = (hex: string): string =>
  hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;

/** 14:02:11.3, in the viewer's time zone. */
export function clock(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
}

/** 0.3 s · 2.1 s · 40 s · 3 min · 2 h. */
export function duration(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5_400) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3_600)} h`;
}

/** Sep 23, or Sep 23, 2026 with the year. */
export const date = (ms: number, withYear = false): string =>
  new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
