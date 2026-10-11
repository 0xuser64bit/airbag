# Airbag

**Get trimmed, not liquidated.** Position protection for [Perpl](https://app.perpl.xyz) traders on
[Monad](https://monad.xyz).

Airbag checks covered positions every block. When a position crosses its configured risk line,
it sends a reduce-only close and adds the net released collateral back to move liquidation further
away. If spare margin alone can reach the target, it adds that margin instead. Fees, slippage,
price gaps and outages can still prevent protection.

[Open Airbag](https://airbag.user64bit.world) ·
[Historical replays](https://airbag.user64bit.world/backtest) ·
[Check a wallet](https://airbag.user64bit.world/wallet)

## Availability

The public app runs in **simulation**: paper accounts and scripted prices, following Monad
testnet's block clock with a local fallback. It needs no funds or wallet extension.
The engine has also completed live trims and collateral re-adds on Perpl testnet, recorded in
[AirbagLog](https://testnet.monadvision.com/address/0x52259e30d3687691F663033922472B43120276F7).
Mainnet trading is not released. [Verification and release status](docs/VERIFICATION.md) distinguishes
recorded evidence, replay assumptions and the remaining real-money release gates.

## Try the simulation

1. Open [Connect](https://airbag.user64bit.world/connect), select **Connect a test wallet**, and sign in.
2. Select **Use a test key**, review the settings preview and open the dashboard.
3. Play a BTC wick while paused to see the paper liquidation. Reset the account, resume Airbag
   and play it again to see the trim, collateral re-add and save report.

ETH demonstrates spare-margin protection; MON demonstrates a short. Prices are isolated per
wallet. [The user guide](docs/USER-GUIDE.md) explains settings, alerts and failure states.

## Local development

Use Node 24 and the pnpm version pinned in `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm dev:engine
# In another terminal:
pnpm dev:web
```

Open `http://localhost:3000/connect`. The engine uses `.env.example` simulation defaults and loads
optional overrides from the root `.env`. For an offline simulation, set `SIM_CLOCK=local` in the
environment or `.env`. Keep live keys and secrets out of the web app.

Web overrides belong in `apps/web/.env.local` or the process environment. Next.js does not load the
repository root `.env`; `NEXT_PUBLIC_*` values are fixed when the web app is built.

## Repository

| Path | Responsibility |
|---|---|
| `apps/engine` | Position guards, HTTP API, SQLite, encrypted key custody, alerts, simulation and replay |
| `apps/web` | Next.js app, position dashboard, receipts, wallet lookup and historical replay pages |
| `packages/risk` | Pure risk calculations and shared number formatting |
| `packages/perpl` | Exchange connections, onchain reads, safe unit conversion and order allowlist |
| `contracts` | AirbagLog contract and Foundry tests |
| `indexer` | Optional Envio indexer for AirbagLog and Perpl liquidations |
| `tools` | Protocol checks, reproducible replay datasets and testnet trading verification |
| `e2e` | Browser journeys and accessibility checks |
| `deploy/vm` | VM provisioning, release builds, service units and TLS routing |

## Validation

```bash
pnpm check
pnpm build
pnpm e2e
pnpm contracts:test
pnpm --filter @airbag/indexer codegen
pnpm --filter @airbag/indexer test
```

Contract commands use Docker; local Foundry also works from `contracts/`. Browser tests run against
isolated simulation servers. CI additionally scans secrets, audits dependencies and smoke-tests the
engine image. [CONTRIBUTING.md](CONTRIBUTING.md) covers the production browser profile and live-data checks.

## Documentation

| Guide | Audience |
|---|---|
| [User guide](docs/USER-GUIDE.md) | Setup, settings, alerts, receipts and troubleshooting |
| [Architecture](docs/ARCHITECTURE.md) | Components, execution lifecycle, invariants and design decisions |
| [HTTP API](docs/API.md) | Authentication, endpoints, response shapes and errors |
| [Risk model](docs/RISK-MODEL.md) | Formulas, fees, replay methodology and test vectors |
| [Perpl integration](docs/PERPL.md) | Protocol fields, network configuration and measured behavior |
| [Operations](docs/DEPLOY.md) | Deployment, testnet checks, monitoring, backup, restore and rollback |
| [Security](docs/SECURITY.md) | Threat model, key rotation and incident response |
| [Verification status](docs/VERIFICATION.md) | Dated evidence and release gates |
| [Web design](apps/web/DESIGN.md) | Visual and content conventions for contributors |

## Contributions and license

See [CONTRIBUTING.md](CONTRIBUTING.md). Development uses AI coding assistance; passing tests and
recorded testnet runs do not substitute for independent review. Licensed under [MIT](LICENSE).
