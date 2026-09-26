# Airbag

**Get trimmed, not liquidated.** Liquidation protection for [Perpl](https://perpl.xyz) traders on
[Monad](https://monad.xyz).

Airbag checks your Perpl positions every Monad block. When a price move uses up a set share of a
position's margin cushion, it trims just enough of the position with a fee-free, reduce-only order
and puts the released margin back in, so Perpl's liquidation engine never has to close the whole
thing. It acts through a Perpl API key that cannot withdraw.

## Why it works

- When Perpl liquidates a position it closes all of it, and the margin left is split 80% to the
  trader, 10% to the insurance fund, 10% to the protocol.
- Closing or reducing a position on Perpl is fee-free.
- So an early partial close costs nothing in fees and keeps the trader in the trade. A liquidation
  costs a fifth of what's left and ends the position.

Perpl shrinks a position's deposit pro-rata when it's reduced, so a close on its own leaves the
liquidation price where it was. A deploy is therefore two orders: the reduce-only close, then
`IncreasePositionCollateral` with the margin the close released
([ADR 0002](docs/adr/0002-deploy-is-close-then-readd.md)). The worked example: a 1 BTC long from
$100,000 at 10x trims 0.489 BTC at $97,000, liquidation moves from $94,000 to $87,300, and if BTC
then wicks to $94,000 and back, the trader holds $8,533 instead of the $3,200 a liquidation returns.
Every number in that example is a golden test vector in
[docs/RISK-MODEL.md](docs/RISK-MODEL.md).

## Why Monad

- **Per-block checks are worth doing at 300 ms blocks.** A line crossed in block *k* is acted on
  around *k + 1*, while the price is still near the line rather than near liquidation.
- **Perpl is a fully onchain order book**, so a trim is a real fill with a Monad transaction anyone
  can look up, and a closing trade carries no fee.
- **An onchain log.** Every deploy and save can be written to the `AirbagLog` contract and indexed
  by Envio, so Airbag's record is public and checkable, not a database row.

## Status

The product runs end to end against a simulated exchange, in CI and in a browser. It has **not yet
traded on Perpl**: the testnet verification run needs a funded testnet account and a Trade key (see
[docs/DEPLOY.md](docs/DEPLOY.md)). Nothing is deployed, and no contract is deployed yet.

## What's here

| Path | What |
|---|---|
| `packages/risk` | The risk math, pure and dependency-free: liquidation price, the Airbag line, deploy planning, the save value. Golden vectors plus property tests. |
| `packages/perpl` | Perpl client: trading and market-data sockets, Ed25519 sign-in, onchain reads, safe unit conversion, and the order-type allowlist (only closes, margin adds, and a harmless scope-probe cancel). |
| `apps/engine` | The always-on engine: one guard per account, per-block checks, deploys, re-arming and saves; the HTTP API (SIWE, key linking, settings, live stream); SQLite; Web Push; the AirbagLog writer; simulation mode. |
| `apps/web` | The site and app (Next.js): landing page with the crash-test replay, onboarding, dashboard, deploy receipts, public save reports with a share image; installable for push alerts. |
| `contracts/` | `AirbagLog`, a public append-only log of deploys and saves (Foundry). |
| `indexer/` | Envio HyperIndex over AirbagLog and Perpl's liquidations. |
| `e2e/` | Playwright journeys with axe accessibility checks. |
| `spike/` | Scripts for the one-off testnet verification run. |
| `design/` | The approved design, as reference artboards. |

## Run it

Node 24 and pnpm 11. Docker is only needed for the contract tests.

```bash
pnpm install
pnpm dev:engine    # the engine in simulation mode on :8787
pnpm dev:web       # the app on :3000
```

Open http://localhost:3000/connect. In simulation, "Connect a test wallet" is a throwaway key held
by the page, so the whole flow can be clicked through without a browser extension; an injected
wallet such as Rabby or MetaMask works too. Sign in, use "Use a test key", arm, and press "Play a
wick on BTC" on the dashboard: the engine trims, re-adds, re-arms and records a save, and the save
report has a share card. Everything is labelled as simulated. The simulated prices are shared by
every account on the engine, and "Reset account" puts them back to the start.

Configuration is `.env` (copy `.env.example`); nothing is needed for simulation. To point the engine
at Perpl testnet, set `ENGINE_MODE=live`, a `MASTER_KEY` and `PERPL_NETWORK=testnet`, then link a
Trade key from the app whose IP allow-list includes the engine's egress IPs.

## Test

```bash
pnpm check                                          # lint, typecheck, unit and property tests
pnpm e2e                                            # Playwright + axe against the engine in simulation
pnpm contracts:test                                 # Foundry, via Docker
pnpm --filter @airbag/indexer codegen && pnpm --filter @airbag/indexer test
```

CI runs all of these, plus gitleaks over the full history, `pnpm audit`, and a build and smoke test
of the engine image.

## Documentation

| Document | What it answers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system fits together, the per-block loop, the invariants, the known limits |
| [docs/RISK-MODEL.md](docs/RISK-MODEL.md) | The arithmetic, the deploy algorithm, the golden test vectors |
| [docs/PERPL.md](docs/PERPL.md) | Verified Perpl, Monad and Envio protocol facts, and the gotchas that have cost time |
| [docs/SECURITY.md](docs/SECURITY.md) | The threat model, the controls, master-key rotation and a leak |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Testnet verification, then the engine on Fly and the web app on Vercel |
| [docs/adr/](docs/adr/) | Why each major decision went the way it did |
| [apps/web/DESIGN.md](apps/web/DESIGN.md) | The web app's design system and content contract |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Commands, conventions, and what not to weaken |

## AI disclosure

This project is built with AI coding tools, as the hackathon rules allow. What was made by whom:

| Part | Written by | Reviewed by the owner |
|---|---|---|
| Product definition and approved design ([design/](design/)) | Owner (Arth). _Owner: say here which tools, if any, helped._ | n/a |
| Research, ADRs, and the documentation in `docs/`, [apps/web/DESIGN.md](apps/web/DESIGN.md) | Claude Code (Anthropic, Claude Opus 5.5) | Pending |
| All code, tests and CI in this repository | Claude Code (Anthropic, Claude Opus 5.5) | Pending |

Commits carry no co-author trailer, at the owner's request, so the table above is the disclosure of
record. It is updated as the owner reviews each part.

## License

[MIT](LICENSE)
