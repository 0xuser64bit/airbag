/** Small helpers for verification summaries. */
export const percentile = (xs: number[], p: number): number => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? Number.NaN;
};

export const diffs = (xs: number[]): number[] => xs.slice(1).map((x, i) => x - (xs[i] ?? x));

export const round = (x: number, dp = 1): number => Math.round(x * 10 ** dp) / 10 ** dp;
