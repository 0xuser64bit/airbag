# AirbagLog

A public, append-only record of what Airbag did on Perpl, checked against Perpl's own state on
Monad (ADR 0009, [0016](../docs/adr/0016-airbaglog-reads-perpl.md)). It holds no funds and has
no power over positions.

- `liquidationPrice(perpId, accountId)`: any Perpl position's liquidation price, computed from
  Perpl's Exchange (deposit, funding, entry with its Q16 residue, maintenance on entry notional),
  in integers, rounded to a tick toward the mark. A public view anyone can call.
- `recordDeploy(accountId, perpId, perplTxHash, sizeBefore, liqBefore, reason)`: the engine's hot
  wallet (the writer) sends what it saw before a deploy; the contract reads the size and the
  liquidation price after from Perpl, and refuses a trim that didn't shrink the position or a
  margin add that changed its size. Emits `DeployRecorded`.
- `proveSave(deployId)`: anyone, once Perpl's mark is at or past the deploy's old liquidation
  price while the account still holds the position on the same side. Emits `SaveRecorded` and
  `SaveProven`.

Units are Perpl's own: sizes in lots (LNS), prices in the market's price units (PNS), the market
as Perpl's perpetual id. `reason` is 0 for a trim (close, then re-add), 1 for spare margin.

## Test

```bash
pnpm contracts:test                                             # Foundry's Docker image, pinned by digest
forge test                                                      # or a local Foundry
MONAD_FORK_RPC=https://rpc1.monad.xyz forge test --match-contract Fork -vv   # against Perpl mainnet
```

The fork test runs `liquidationPrice` on real open positions in five markets of Perpl's mainnet
Exchange and checks each against Perpl's own accounting: equity now (deposit, funding and Perpl's
unrealized PnL at its mark) moved to that price must be the maintenance margin, within a tick. It
is skipped without `MONAD_FORK_RPC`.

## Deploy

The owner deploys once per network, with a separate, low-value hot wallet as the writer. The
constructor takes the writer, Perpl's Exchange (testnet `0x1964C32f0bE608E7D29302AFF5E61268E72080cc`,
mainnet `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`) and the collateral's decimals (AUSD: 6):

```bash
forge create src/AirbagLog.sol:AirbagLog --broadcast \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key "$DEPLOYER_KEY" \
  --constructor-args "$WRITER_ADDRESS" 0x1964C32f0bE608E7D29302AFF5E61268E72080cc 6
```

Then set `AIRBAG_LOG_ADDRESS` and `AIRBAG_LOG_PRIVATE_KEY` (the writer's key) on a live engine,
and put the address and deploy transaction in the root README. Fund the writer with a little MON.
