# AirbagLog

A public, append-only record of what Airbag did on Perpl, checked against Perpl's own state on
Monad. See [Architecture](../docs/ARCHITECTURE.md). It holds no funds and has
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
(cd contracts && forge test)                                    # or a local Foundry
(cd contracts && MONAD_FORK_RPC=https://rpc1.monad.xyz forge test --match-contract Fork -vv)   # against Perpl mainnet
```

The fork test runs `liquidationPrice` on real open positions in five markets of Perpl's mainnet
Exchange and checks each against Perpl's own accounting: equity now (deposit, funding and Perpl's
unrealized PnL at its mark) moved to that price must be the maintenance margin, within a tick. It
is skipped without `MONAD_FORK_RPC`.

## Deploy

The owner deploys once per network, with a separate, low-value hot wallet as the writer. The
constructor takes the writer, Perpl's Exchange (testnet `0x1964C32f0bE608E7D29302AFF5E61268E72080cc`,
mainnet `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`) and the collateral's decimals (AUSD: 6).
Run the deployment command from `contracts/`:

```bash
forge create src/AirbagLog.sol:AirbagLog --broadcast \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key "$DEPLOYER_KEY" \
  --constructor-args "$WRITER_ADDRESS" 0x1964C32f0bE608E7D29302AFF5E61268E72080cc 6
```

## Deployments

| Network | Address | Deploy transaction | Owner | Writer |
|---|---|---|---|---|
| Monad testnet (10143), 2026-10-04 | [`0x52259e30d3687691F663033922472B43120276F7`](https://testnet.monadvision.com/address/0x52259e30d3687691F663033922472B43120276F7) | [`0x707007a1…1f56`](https://testnet.monadvision.com/tx/0x707007a11f7eff7d35b087726f9b42fead1d98d7e9c57c32f96fb2478a781f56) | `0x82802e5c…c3d7` | `0x216fbEdB…0097` |

The testnet deployment reads Perpl's testnet Exchange. Checked after deploying: its
`liquidationPrice` agreed with `@airbag/risk` to the tick on 16 of 16 open positions in BTC, ETH,
SOL and MON.

For a live testnet engine, set `AIRBAG_LOG_ADDRESS` and `AIRBAG_LOG_PRIVATE_KEY` (the writer's key) on a live engine,
and record deployment evidence in [Verification status](../docs/VERIFICATION.md). Fund the writer with a little MON.
After the real-money release gates are cleared, a mainnet web app can use `AIRBAG_LENS_ADDRESS` too: the wallet check then shows the contract's
own `liquidationPrice` beside each position. On a fork of mainnet with AirbagLog deployed, it
matched the risk package to the tick on all nine positions of a real account.
