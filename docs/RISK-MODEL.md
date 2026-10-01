# Risk model

The heart of the product: the arithmetic that decides where the Airbag line sits, when to act and
how much to trim. It lives in `packages/risk` as pure functions in human units, with no I/O and no
dependencies, so the engine and the browser compute the same numbers from the same code
([ADR 0008](adr/0008-risk-math-numerics.md)).

Formulas follow [Perpl's liquidation docs](https://docs.perpl.xyz/exchange/liquidation) and
`PerplFoundation/dex-sdk`'s `state/position.rs`. They are checked against the chain: Airbag's
unrealized PnL matches `getPositionV2` on real testnet and mainnet positions, and in 159 real
mainnet liquidations Perpl never liquidated before the mark reached the liquidation price this
model computes ([PERPL.md](PERPL.md#checked-against-testnet-on-2026-10-01-without-a-key)).

The old assumption that closes are free is obsolete. As checked on 2026-09-27,
[Perpl's API documentation](https://github.com/PerplFoundation/api-docs/blob/main/README.md#fees--fee-tiers)
charges trading fees on size removed as well as added. Airbag reads the taker rate from
`taker_fees[Account.ft]`, falling back to `taker_fee`, in micros. Missing live fee schedules
are refused. Orders request no builder fee. Observed gross `Order.f` is recorded; an
interrupted or legacy receipt with no attributable fee says unconfirmed.

## Definitions

Long side; shorts mirror it through `s = direction(side)` (+1 long, −1 short).

```
n        = position size (base units)
E        = effective entry price, including Perpl's Q16 residue (see PERPL.md)
M        = position deposit (collateral), after realized PnL from earlier trims
r        = maintenance margin fraction for the market (BTC 0.04)
m        = r · E            maintenance per unit, from entry notional
MMR      = m · n            maintenance requirement
F        = accrued funding as premium PnL (positive = received)
equity(P)= M + F + s · n · (P − E)
liqPrice = E − s · (M + F − MMR) / n
```

`C_MMR = P_entry · L / MMF`, so maintenance is charged on entry notional, not mark notional. The
liquidation split Perpl applies on liquidation is 80% trader / 10% insurance fund / 10% protocol;
the engine reads `getLiquidationInfo` for the first covered market and falls back to 0.8 if that
read fails. This shared default is an estimate; differing per-market distributions need separate
reads before expanding coverage or interpreting save values as exact proceeds.

## Cushion and the Airbag line

- **Cushion** = equity above the maintenance requirement.
- **Reference cushion** `C0` is measured at a reference price: the **entry price** when a position
  is first armed, and the **fill price** after each deploy (re-arm). `C0 = equity(P_ref) − MMR`.
- **Sensitivity** `f`, the share of the cushion Airbag may let go before acting:
  Early `1/3`, Balanced `1/2` (default), Late `3/4`.
- **Deploy** when `equity(mark) ≤ MMR + (1 − f) · C0`. Equivalently, with
  `Q = MMR + (1 − f) · C0` the equity at the trigger, the trigger price for a long is
  `T = E − (M + F − Q) / n`.

## The deploy

A deploy is **two orders**, not one ([ADR 0002](adr/0002-deploy-is-close-then-readd.md)):

1. **Spare margin first, only if it is enough.** With the account's unallocated balance `S`, if
   adding `S` alone puts the liquidation price at least `d` away from `T`, send
   `IncreasePositionCollateral` (`t:6`) for the smallest amount that does it. Otherwise add nothing
   and keep the balance. If Perpl refuses or fails that add, nothing moved, so the next block
   trims instead of waiting out a failure cooldown with the position past its line.
2. **Trim the smallest amount** that puts liquidation at least `d` (default 10%) from the trigger.
   For a long with remaining fraction `s`:
   ```
   k = current taker fee fraction
   A = n · T · k             fee for closing the entire original size
   L'(s) = T + m − (Q − (1−s)·A) / (s · n)
   target L' ≤ T · (1 − d)  ⇒  s ≤ (Q−A) / (n · (m + T·d) − A)
   trim fraction = 1 − s, capped at maxTrim (default 50%)
   ```
   Shorts use the opposite direction with the same fee-adjusted bound on `s`.
3. Send `CloseLong`/`CloseShort` (`t:3`/`t:4`), `fl:4` (IOC), with a worst price 0.5% from mark
   (configurable), and a valid `lb`.
4. **Re-add the released equity.** Perpl shrinks the deposit pro-rata on a decrease, so the close
   alone leaves the liquidation price exactly where it was. As soon as the fill lands, send
   `IncreasePositionCollateral` for the collateral the close released, net of realized PnL
   and closing fees, read from the balance change and capped by the net model estimate. The
   position then carries `Q` minus the closing fee on the smaller size. Entry fees reported on
   a live snapshot are historical charges, not another deduction from its current deposit.
5. On a partial fill, re-add what was released, recompute and retry on the next block, up to
   `MAX_DEPLOY_ATTEMPTS`, within the episode's cap, then alert.
6. **Re-arm** on the smaller position with the fill price as the new reference.

The `t:6` re-add is not an optimisation. Without it a trim moves nothing, which is why it is on the
critical path and why the product has not shipped before it is proven against a funded testnet
account.

## Save vs precaution

- A deploy is a **Save** if, after it, the mark reaches the **pre-deploy liquidation price** while
  the trimmed position is still open. Otherwise it is a **Precaution**. Never call a precaution a
  save.
- The counterfactual liquidation return is an estimate: `0.8 × equity` at the old liquidation
  price, about `0.8 × MMR`. The UI labels it as an estimate. The 80% itself is what Perpl paid in
  each of 159 mainnet liquidations checked on 2026-10-01 (`pnpm --filter @airbag/spike
  liquidations`); the estimate is the fill: a liquidation executes on the book near, not exactly
  at, the liquidation price.
- Save value = the current value of the Airbag path − the counterfactual return. Live while the
  position is open, frozen when it closes. The share card snapshots it.

## Golden vectors

From the approved design, and asserted by `packages/risk/test` at the precision the design
displays. These are **zero-fee simulation vectors**, preserved to exercise the original design;
they are not live cost estimates. Fee-bearing long/short, property and engine checks cover the
current fee model separately. With a 345-micro taker rate, the same BTC trigger needs a slightly
larger trim and the observed fee is deducted from released collateral.

BTC long, `n = 1.000`, `E = 100,000`, `M = 10,000`, `r = 4%`, `F = 0`, spare margin `S = 420`:

| Quantity | Value |
|---|---|
| Liquidation price | $94,000 |
| `C0` | $6,000 |
| Trigger, Early / Balanced / Late | $98,000 / **$97,000** / $95,500 |
| At mark $99,420: distance to liquidation | 5.45% |
| At mark $99,420: line below mark / cushion used | 2.43% / 9.7% |
| Balanced, `d = 10%`: spare $420 would give liq | $93,580 (3.53%) → **not used** |
| Balanced trim | **0.489 BTC** (48.9%), remaining 0.511 |
| New liquidation | **$87,300** (10.00% from $97,000) |
| Worst fill price (0.5%) | $96,515 |
| Realized PnL on the trim | −$1,467 |
| Leverage at trigger, before → after | 13.9x → 7.1x |
| Re-arm line (Balanced, reference = $97,000) | **$92,150** |
| Early trim / new liq | 0.420 BTC / $88,200 |
| Late with 50% cap | capped: 0.500 BTC, liq $88,500 (7.33%) |
| If mark later hits $94,000: without Airbag | liquidated, $3,200 returned (80% of $4,000 residual) |
| If mark later hits $94,000: with Airbag | open, equity $5,467 |
| Back at $100,000: without / with | $3,200 / **$8,533** → "kept $5,333" |

ETH long, `n = 2`, `E = 3,000`, `M = 1,200`, `r = 5%`: liquidation $2,550, Balanced line $2,775,
distance 16.67% at $3,060 and 15.34% at $3,012.

These vectors also drive the UI: the landing replay and the settings preview run the real package,
so no number on screen is hand-typed.

## Numerics

`packages/risk` works in float64 in human units. Everything Perpl-scaled is converted at the edge
in `packages/perpl`, with the rounding direction chosen for safety
([ADR 0008](adr/0008-risk-math-numerics.md)):

| Value | Rounding |
|---|---|
| trim size | **up** to the lot size, then clamped to the position size and `maxTrim` |
| worst close price | **away from** the mark (a long's close limit rounds down) |
| collateral re-add | exact integer from the account's balance change |
| trigger comparison | in the risk package, on the same float values the UI shows |

Property tests assert the invariants the model has to hold: trims never increase size, never flip
side, always meet the target unless capped, `L'` is monotonic in `s`, and long/short symmetry.
