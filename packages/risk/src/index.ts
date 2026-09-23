// Airbag risk math. Pure functions in human units (dollars, base units), no I/O.
// Formulas: docs/BRIEF.md section 4, which follows Perpl's liquidation docs
// (https://docs.perpl.xyz/exchange/liquidation) and dex-sdk's position.rs.

export type Side = 'long' | 'short';

/** An isolated-margin Perpl position, converted from scaled integers at the edge (ADR 0008). */
export interface Position {
  side: Side;
  /** n: size in base units. */
  size: number;
  /** E: effective entry price (including Perpl's Q16 residue). */
  entry: number;
  /** M: collateral deposited in the position. */
  deposit: number;
  /** F: premium PnL from funding; positive means received. */
  funding: number;
  /** r: maintenance margin fraction, e.g. 0.04 for BTC. */
  maintenance: number;
}

/** +1 for longs, −1 for shorts (Perpl's `s`). */
export const direction = (side: Side): 1 | -1 => (side === 'long' ? 1 : -1);

/** MMR = r · E · n. Perpl uses entry notional, not mark notional. */
export const maintenanceRequirement = (p: Position): number => p.maintenance * p.entry * p.size;

/** equity(P) = M + F + s · n · (P − E). */
export const equity = (p: Position, price: number): number =>
  p.deposit + p.funding + direction(p.side) * p.size * (price - p.entry);

/** P_liq = E − s · (M + F − MMR) / n: the mark price at which equity equals MMR. */
export const liquidationPrice = (p: Position): number =>
  p.entry - (direction(p.side) * (p.deposit + p.funding - maintenanceRequirement(p))) / p.size;

/** How far the mark can move against the position before liquidation, as a fraction of mark. */
export const distanceToLiquidation = (p: Position, mark: number): number =>
  (direction(p.side) * (mark - liquidationPrice(p))) / mark;
