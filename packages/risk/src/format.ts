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

/** A price level: whole dollars from $100, then enough places for small-priced markets. */
export const price = usd;

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
