# Indexer

[Documentation](../docs/README.md) · [AirbagLog](../contracts/README.md) · [Operations](../docs/DEPLOY.md)

An [Envio HyperIndex](https://docs.envio.dev) project over Monad. See
[Architecture](../docs/ARCHITECTURE.md) for its role:

- **AirbagLog**: every deploy Airbag recorded (`Deploy`), marked `saved` when the old liquidation
  price was reached, plus running totals (`AirbagTotals`).
- **Perpl's `PositionLiquidated`** (ABI from `PerplFoundation/dex-sdk`, MIT): each liquidation
  (`Liquidation`) and a per-market, per-day tally (`DailyLiquidations`). The landing page shows
  "liquidated on Perpl in the last 30 days" from these, and only when an indexer URL is set.

## Test the handlers

Install the root workspace dependencies first. Handler tests need no Docker or HyperSync token,
but do require generated types. Tests hard-code chain `10143` and the default fixture addresses;
do not run them using mainnet or deployed-address overrides.

In a subshell, explicitly select the fixture defaults for both codegen and checks:

```bash
(
  export ENVIO_CHAIN_ID=10143
  export ENVIO_AIRBAG_LOG_ADDRESS=0x0000000000000000000000000000000000000000
  export ENVIO_PERPL_EXCHANGE=0x1964C32f0bE608E7D29302AFF5E61268E72080cc
  pnpm --filter @airbag/indexer codegen
  pnpm --filter @airbag/indexer exec tsc -p .
  pnpm --filter @airbag/indexer test
)
```

## Run an indexer

Local indexing needs Docker and `ENVIO_API_TOKEN`; unlike handler tests, it reads external data.

HyperSync needs a free API token from https://envio.dev/app/api-tokens in `ENVIO_API_TOKEN`.
Configuration comes from the environment:

| Variable | Default |
|---|---|
| `ENVIO_CHAIN_ID` | `10143` (Monad testnet); `143` for mainnet |
| `ENVIO_AIRBAG_LOG_ADDRESS` | the zero address (set it once AirbagLog is deployed) |
| `ENVIO_PERPL_EXCHANGE` | testnet exchange; mainnet is `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` |

Set the intended network, both contract addresses and token in the indexer's environment, then:

```bash
pnpm --filter @airbag/indexer codegen
pnpm --filter @airbag/indexer dev
```

Regenerate after changing `config.yaml`, `schema.graphql` or deployment overrides. The zero
AirbagLog address is a test default, not a deployed contract. Keep fixture checks separate from
the deployment environment.

Deploy on Envio Cloud (git-based) with the same variables, then set the web app's
`INDEXER_URL` to the GraphQL endpoint.
