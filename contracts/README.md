# AirbagLog

A public, append-only record of what Airbag did: one `DeployRecorded` per deploy and one
`SaveRecorded` per save (ADR 0009). It holds no funds and has no power over positions. Only the
engine's hot wallet (the writer) can append; the owner can rotate the writer.

Units are Perpl's own: sizes in lots (LNS), prices in the market's price units (PNS), the market
as Perpl's perpetual id. `reason` is 0 for a trim (close, then re-add), 1 for spare margin.

## Test

Foundry runs from its official Docker image, pinned by digest in the root `package.json`:

```bash
pnpm contracts:test
```

## Deploy

The owner deploys once per network, with a separate, low-value hot wallet as the writer:

```bash
docker run --rm -v "$PWD/contracts:/app" -w /app --user root --entrypoint forge ghcr.io/foundry-rs/foundry:stable \
  create src/AirbagLog.sol:AirbagLog --broadcast \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key "$DEPLOYER_KEY" \
  --constructor-args "$WRITER_ADDRESS"
```

Then set `AIRBAG_LOG_ADDRESS` and `AIRBAG_LOG_PRIVATE_KEY` (the writer's key) on the engine, and
put the address and deploy transaction in the root README. Fund the writer with a little MON.
