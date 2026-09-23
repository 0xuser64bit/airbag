# 0008. Risk math in float64, integer conversion at the Perpl edge with safe rounding

Date: 23 Sep 2026

## Context

Perpl works in scaled integers (prices with 1–6 decimals, sizes with 0–5, collateral with 6). The risk math is a handful of divisions on values up to ~1e7 dollars. The golden vectors are specified to display precision.

## Decision

- `packages/risk` works in plain `number` (float64) in human units: dollars, base units. It has no dependencies and no I/O. The relative error (~1e-16) is far below one tick on any market.
- **All conversions to order parameters happen in `packages/perpl`, with the rounding direction chosen for safety:**
  - trim size: round **up** to the lot size (never trim less than needed), then clamp to position size and `maxTrim`;
  - worst price: round **away from** the mark (a long's close limit rounds down);
  - collateral re-add: exact integer from the account's balance change;
  - trigger comparisons: made in the risk package on the same float values the UI shows.
- Values read from Perpl are converted once, at the edge, with the market's decimals from `/pub/context`.

## Consequences

- Readable math and fast property tests. If a market ever needs more than 15 significant digits, move that one conversion to bigint. The risk package API doesn't change.
