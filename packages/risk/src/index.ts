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

/** Notional at `price` over equity at `price`. */
export const leverage = (p: Position, price: number): number => (p.size * price) / equity(p, price);

/** True once `mark` is at or past `level` in the direction that hurts the position. */
export const crossed = (side: Side, mark: number, level: number): boolean =>
  direction(side) * (mark - level) <= 0;

// ---- The Airbag line ----------------------------------------------------------------------

/** Sensitivity f: the share of the cushion that may be used before Airbag deploys. */
export const SENSITIVITY = { early: 1 / 3, balanced: 1 / 2, late: 3 / 4 } as const;
export type Sensitivity = keyof typeof SENSITIVITY;

export interface Line {
  /** C0 = equity(P_ref) − MMR: the cushion at the reference price. */
  cushion: number;
  /** Q = MMR + (1 − f) · C0: deploy when equity falls to this. */
  triggerEquity: number;
  /** T: the mark price at which equity equals Q. */
  price: number;
}

/**
 * The Airbag line for a position armed at `reference` (the entry price when first armed, the
 * fill price after each deploy) with sensitivity `f`.
 */
export function airbagLine(p: Position, reference: number, f: number): Line {
  const mmr = maintenanceRequirement(p);
  const cushion = equity(p, reference) - mmr;
  const triggerEquity = mmr + (1 - f) * cushion;
  const price = p.entry - (direction(p.side) * (p.deposit + p.funding - triggerEquity)) / p.size;
  return { cushion, triggerEquity, price };
}

/** Deploy when equity(mark) ≤ Q. Comparing equity keeps funding changes exact. */
export const triggered = (p: Position, mark: number, line: Line): boolean =>
  equity(p, mark) <= line.triggerEquity;

/** Share of the reference cushion used up at `mark` (0 at the reference, f at the line). */
export const cushionUsed = (p: Position, mark: number, line: Line): number =>
  line.cushion > 0 ? 1 - (equity(p, mark) - maintenanceRequirement(p)) / line.cushion : 1;

// ---- Planning a deploy --------------------------------------------------------------------

export interface Policy {
  /** d: the distance from the price that liquidation must end up at, e.g. 0.1. */
  target: number;
  /** Most of the position one deploy may trim, e.g. 0.5. */
  maxTrim: number;
  /** Add the account's spare margin instead of trimming, when it alone reaches the target. */
  useSpare: boolean;
}

export type Plan =
  | { kind: 'none'; liquidation: number }
  | { kind: 'margin'; amount: number; liquidation: number }
  | {
      kind: 'trim';
      /** Share of the current size to close. */
      fraction: number;
      /** True when maxTrim stopped the trim short of the target. */
      capped: boolean;
      /** Liquidation after the close and the re-add; null when the whole position closes. */
      liquidation: number | null;
    };

/** The liquidation price a deploy at `price` aims for: d away from the price. */
export const targetLiquidation = (side: Side, price: number, d: number): number =>
  price * (1 - direction(side) * d);

/** Collateral that must be added for liquidation to reach `target`. */
export const marginNeeded = (p: Position, target: number): number =>
  direction(p.side) * p.size * (p.entry - target) -
  (p.deposit + p.funding - maintenanceRequirement(p));

/**
 * Liquidation after keeping `remaining` of the position at `price` and re-adding the equity the
 * close released: L'(s) = P + σ·m − σ·eq(P)/(s·n), with σ the direction and m = r·E
 * (brief §4, step 2).
 */
export function liquidationAfterTrim(p: Position, price: number, remaining: number): number {
  const d = direction(p.side);
  return price + d * p.maintenance * p.entry - (d * equity(p, price)) / (remaining * p.size);
}

/**
 * What Airbag does at `price`: nothing if liquidation is already `target` away; add spare
 * margin if that alone gets there (the smallest amount that does); otherwise trim the smallest
 * share that does, capped at maxTrim. From L'(s) ≤ target: s ≤ eq(P) / (n·(m + P·d)).
 */
export function planDeploy(p: Position, price: number, spare: number, policy: Policy): Plan {
  const need = marginNeeded(p, targetLiquidation(p.side, price, policy.target));
  if (need <= 0) return { kind: 'none', liquidation: liquidationPrice(p) };
  if (policy.useSpare && need <= spare) {
    return { kind: 'margin', amount: need, liquidation: liquidationPrice(applyMargin(p, need)) };
  }
  const keep = equity(p, price) / (p.size * (p.maintenance * p.entry + price * policy.target));
  const wanted = Math.min(1, 1 - Math.max(0, keep));
  const fraction = Math.min(wanted, policy.maxTrim);
  return {
    kind: 'trim',
    fraction,
    capped: wanted > policy.maxTrim,
    liquidation: fraction < 1 ? liquidationAfterTrim(p, price, 1 - fraction) : null,
  };
}

// ---- Applying a deploy --------------------------------------------------------------------

/** The position after adding `amount` of collateral (IncreasePositionCollateral). */
export const applyMargin = (p: Position, amount: number): Position => ({
  ...p,
  deposit: p.deposit + amount,
});

/**
 * The position after closing `fraction` of it at `fill` and re-adding the released equity
 * (ADR 0002). Perpl shrinks deposit and funding pro-rata and settles the closed part's equity,
 * (1 − s)·equity(fill), to the balance; Airbag puts it back into the position.
 */
export function applyTrim(
  p: Position,
  fraction: number,
  fill: number,
): { position: Position; realizedPnl: number; released: number } {
  const keep = 1 - fraction;
  const released = fraction * equity(p, fill);
  return {
    position: {
      ...p,
      size: keep * p.size,
      deposit: keep * p.deposit + released,
      funding: keep * p.funding,
    },
    realizedPnl: direction(p.side) * fraction * p.size * (fill - p.entry),
    released,
  };
}

// ---- Save or precaution -------------------------------------------------------------------

/**
 * What a liquidation at the pre-deploy liquidation price would have returned: the user's share
 * (80% on Perpl, read from getLiquidationInfo) of the equity left there, which is the MMR.
 * An estimate: a real liquidation fills on the book.
 */
export const counterfactualReturn = (before: Position, userShare = 0.8): number =>
  userShare * maintenanceRequirement(before);

/** Money kept versus a liquidation. Spare margin Airbag added was the user's already. */
export const saveValue = (equityNow: number, spareAdded: number, counterfactual: number): number =>
  equityNow - spareAdded - counterfactual;
