# 0016. AirbagLog checks its records against Perpl's own state

Date: 4 Oct 2026. Amends [0009](0009-onchain-log-and-indexer.md) (a writer-attested log).

## Context

0009's AirbagLog stored whatever the engine's hot wallet sent: the size and liquidation price
before and after a deploy, and a save with the block it claimed the old liquidation price was hit.
Anyone reading it had to trust Airbag's server for every number. Perpl's Exchange is a contract on
the same chain, and its state is readable from another contract in the same transaction:
`getPositionV2` (deposit, entry with its Q16 residue, lots, Perpl's own unrealized and funding PnL,
the mark and whether it is valid), `getMarginFractions` (maintenance) and `getPerpetualInfoV2`
(price and lot decimals). Nothing is deployed yet, so the contract can change without a migration.

## Decision

- **`liquidationPrice(perpId, accountId)`**, a public view: the liquidation price of any Perpl
  position computed from Perpl's state, in integers, with the same arithmetic as
  `packages/risk` (maintenance on entry notional, funding as cushion, the entry residue), rounded
  to a whole tick toward the mark.
- **`recordDeploy`** takes only what the engine saw before the deploy (size, liquidation price,
  the Perpl fill's transaction) and reads the after-state from Perpl when it runs: the size, and
  the liquidation price from `liquidationPrice`. It refuses a trim that left the size where it was
  and a margin add that changed it. Still writer-only.
- **`proveSave(deployId)`** replaces the writer's `recordSave`: anyone can call it, and it passes
  only if Perpl's mark in that block is valid and at or past the deploy's old liquidation price,
  and the account still holds a position in that market on the same side. It emits the old
  `SaveRecorded` (so the indexer is unchanged) and `SaveProven` with the mark, the lots still
  open and who proved it.
- The constructor takes the Exchange address and the collateral token's decimals.

## Consequences

- The after-state and the save are the chain's word, not Airbag's. Two things stay attested: the
  liquidation price before (the pre-deploy state is gone once the trim lands), and that the
  position open at the save is the one trimmed, not one closed and reopened on the same side in
  between; Perpl's position struct carries no id to tell them apart.
- A save is proven only while the mark sits past the old liquidation price. The engine sends the
  proof when it sees the crossing; gas estimation simulates it first, so a mark that already moved
  back costs nothing and the save stays in Airbag's own records, unproven onchain.
- Each record and proof makes three views into Perpl's Exchange. Cheap on Monad.
- Checked against Perpl's real Exchange on a fork of Monad mainnet
  (`contracts/test/AirbagLogFork.t.sol`): for 20 open positions in BTC, MON, ETH, SOL and ZEC, the
  computed liquidation price is where Perpl's own accounting (deposit, funding and its unrealized
  PnL at its mark) puts equity at the maintenance margin, within a tick.
