# 0002. A deploy is a reduce-only close, then re-adding the released margin

Date: 23 Sep 2026

## Context

The brief's trim math assumes that after a reduce-only close the position keeps its whole deposit, so the smaller position has a far-away liquidation price ($94,000 → $87,300 in the golden vectors).

Onchain data says otherwise. Perpl shrinks the deposit pro-rata on a decrease and settles realized PnL to the account balance. That held within 1 CNS of rounding in 400 `PositionDecreased` events per network (`docs/RESEARCH.md` §1). With deposit `s·M` on size `s·n`, the liquidation price doesn't move.

## Decision

A deploy is two orders:

1. `CloseLong`/`CloseShort`, IOC, worst price 0.5% from mark, sized by the risk math: the smallest trim fraction whose resulting liquidation price is at least `d` from the trigger, capped at `maxTrim`.
2. As soon as the fill is reconciled, `IncreasePositionCollateral` for the equity the close released: `(1 − s)·equity(P_fill)`. The amount is taken from the account balance change in the fill's account update, not recomputed, so rounding and realized funding are exact.

The risk package keeps the brief's model (position equity at the fill price is `Q` on the smaller size). All golden vectors hold for the two-step deploy.

The spare-margin branch is unchanged: if the user's pre-existing free balance alone reaches the target, send only step 2 with the smallest sufficient amount.

## Consequences

- `IncreasePositionCollateral` with a Trade-scoped key is on the critical path. M0 must prove it works. If it doesn't, the product becomes "trim to reduce the loss at liquidation" and the design numbers change. That would be a no-go conversation with the owner.
- A deploy spans at least two blocks: close fills in block k, re-add lands in k+1 or later. The design's timeline gets a row for the re-add, and "line to safe" latency is measured to the re-add, not the fill.
- Between the two orders the released equity sits in the free balance. If the user's own orders consume it first, re-add what's left and alert.
- Two requests per deploy against a 60/min (testnet) budget. Fine.

## Alternatives considered

- **Trim only.** Keeps liquidation at the old price on a smaller position. At $94,000 the user gets 0.8·s·MMR back plus the realized equity of the trimmed part ($5,058 vs $3,200 in the golden case), but the position is closed. That isn't what the product promises.
- **Add margin only** (no trim). Needs the user to have spare balance, and feeds a position that's still in danger. The brief rejects it except when spare margin alone is enough.
