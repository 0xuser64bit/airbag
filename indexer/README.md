# Indexer

An [Envio HyperIndex](https://docs.envio.dev) project over Monad (ADR 0009):

- **AirbagLog**: every deploy Airbag recorded (`Deploy`), marked `saved` when the old liquidation
  price was reached, plus running totals (`AirbagTotals`).
- **Perpl's `PositionLiquidated`** (ABI from `PerplFoundation/dex-sdk`, MIT): each liquidation
  (`Liquidation`) and a per-market, per-day tally (`DailyLiquidations`). The landing page shows
  "liquidated on Perpl in the last 30 days" from these, and only when an indexer URL is set.

## Run

```bash
pnpm --filter @airbag/indexer codegen   # after changing config.yaml or schema.graphql
pnpm --filter @airbag/indexer test      # handlers on simulated events, no network
pnpm --filter @airbag/indexer dev       # local indexer: needs Docker and ENVIO_API_TOKEN
```

HyperSync needs a free API token from https://envio.dev/app/api-tokens in `ENVIO_API_TOKEN`.
Configuration comes from the environment:

| Variable | Default |
|---|---|
| `ENVIO_CHAIN_ID` | `10143` (Monad testnet); `143` for mainnet |
| `ENVIO_AIRBAG_LOG_ADDRESS` | the zero address (set it once AirbagLog is deployed) |
| `ENVIO_PERPL_EXCHANGE` | testnet exchange; mainnet is `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` |

Deploy on Envio Cloud (git-based) with the same variables, then set the web app's
`INDEXER_URL` to the GraphQL endpoint.
