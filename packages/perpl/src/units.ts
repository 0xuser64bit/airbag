// Scaled-integer <-> human conversion with the rounding direction chosen for safety (ADR 0008).

import { direction, type Side } from '@airbag/risk';

const Q16 = 65536;

export const scaled = (value: number, decimals: number): number => value / 10 ** decimals;

/** A CNS amount (string or bigint) in collateral units. Exact below 2^53 CNS ($9 billion). */
export const fromCns = (cns: string | bigint, decimals: number): number =>
  scaled(Number(cns), decimals);

/** Collateral units to CNS, rounded down: never move more than was asked for. */
export const toCnsFloor = (amount: number, decimals: number): bigint =>
  amount > 0 ? BigInt(Math.floor(amount * 10 ** decimals + 1e-6)) : 0n;

/**
 * Perpl stores entry prices rounded (ceil for longs, floor for shorts) plus a Q16 residue.
 * Mirrors dex-sdk `Position::effective_entry_price`.
 */
export function effectiveEntryPrice(
  side: Side,
  ep: number,
  residue: number,
  priceDecimals: number,
): number {
  if (residue === 0) return scaled(ep, priceDecimals);
  const base = side === 'long' && ep >= 1 ? ep - 1 : ep;
  return scaled(base + residue / Q16, priceDecimals);
}

/**
 * Lots to close for a trim fraction: rounded up, so we never trim less than the math needs,
 * and never more than the position. The 1e-9 absorbs float noise like 48905.000000000007.
 */
export function lotsToClose(positionLots: number, fraction: number): number {
  return Math.min(positionLots, Math.ceil(positionLots * fraction - 1e-9));
}

/**
 * Worst acceptable price for a close, from the scaled mark and a slippage in bps.
 * A long close sells, so its limit rounds down; a short close buys, so it rounds up.
 * Inputs are integers well under 2^53, so the division is exact enough to floor/ceil.
 */
export function worstClosePrice(side: Side, markScaled: number, slippageBps: number): number {
  const raw = (markScaled * (10_000 - direction(side) * slippageBps)) / 10_000;
  return side === 'long' ? Math.floor(raw) : Math.ceil(raw);
}
