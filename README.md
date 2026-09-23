# Airbag

**Get trimmed, not liquidated.** Liquidation protection for [Perpl](https://perpl.xyz) traders on [Monad](https://monad.xyz).

Airbag checks your Perpl positions every Monad block. When a price move uses up a set share of a position's margin cushion, it trims just enough of the position with a fee-free, reduce-only order and puts the released margin back into the position, so Perpl's liquidation engine never has to close the whole thing. It acts through a Perpl API key that can't withdraw.

> **Status (23 Sep 2026).** The product is built end to end and runs against a simulated exchange, in CI and in a browser. It has **not yet traded on Perpl**: the testnet go/no-go run needs a funded account and a Trade key from the owner ([docs/STATUS.md](docs/STATUS.md)). Nothing is deployed yet.

## Why it works

- When Perpl liquidates a position it closes all of it, and the margin left is split 80% to the trader, 10% to the insurance fund, 10% to the protocol.
- Closing or reducing a position on Perpl is fee-free.
- So an early partial close costs nothing in fees and keeps the trader in the trade. A liquidation costs a fifth of what's left and ends the position.

Perpl shrinks a position's deposit pro-rata when it's reduced, so a close alone leaves the liquidation price where it was. A deploy is two orders: the reduce-only close, then `IncreasePositionCollateral` with the margin the close released ([ADR 0002](docs/adr/0002-deploy-is-close-then-readd.md)). The worked example: a 1 BTC long from $100,000 at 10x trims 0.489 BTC at $97,000, liquidation moves from $94,000 to $87,300, and if BTC then wicks to $94,000 and back, the trader holds $8,533 instead of the $3,200 a liquidation returns.

## Why Monad

- **Per-block checks are worth doing at 300 ms blocks.** A line crossed in block *k* is acted on around *k + 1*, while the price is still near the line rather than near liquidation.
- **Perpl is a fully onchain order book**, so a trim is a real fill with a Monad transaction anyone can look up, and a closing trade carries no fee.
- **An onchain log.** Every deploy and save can be written to the `AirbagLog` contract and indexed by Envio, so Airbag's record is public and checkable, not a database row.

## What's here

| Path | What |
|---|---|
| `packages/risk` | The risk math, pure and dependency-free: liquidation price, the Airbag line, deploy planning, the save value. Every golden vector from the brief, plus property tests. |
| `packages/perpl` | Perpl client: trading and market-data sockets, Ed25519 sign-in, onchain reads, safe unit conversion, and the order-type allowlist (only closes, margin adds and its own cancels). |
| `apps/engine` | The always-on engine: one guard per account, per-block checks, deploys, re-arming, saves; the HTTP API (SIWE, key linking, settings, live stream); SQLite; Web Push; the AirbagLog writer; simulation mode. |
| `apps/web` | The site and app (Next.js): landing page with the crash-test replay, onboarding, dashboard, deploy receipts, public save reports with a share image; installable for push alerts. |
| `contracts/` | `AirbagLog`, a public append-only log of deploys and saves (Foundry). |
| `indexer/` | Envio HyperIndex over AirbagLog and Perpl's liquidations. |
| `e2e/` | Playwright journeys with accessibility checks. |
| `docs/` | Brief, research, architecture, ADRs, security, deploy runbook, status. |
| `design/` | The approved design (reference HTML). |

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Security model: [docs/SECURITY.md](docs/SECURITY.md).

## Run it

Requires Node 24 and pnpm 11. Docker only for the contract tests.

```bash
pnpm install
pnpm dev:engine    # the engine in simulation mode on :8787
pnpm dev:web       # the app on :3000
```

Open http://localhost:3000. With an injected wallet (Rabby, MetaMask), connect, sign in, use "Use a test key", arm, and press "Play a wick on BTC" on the dashboard: the engine trims, re-adds, re-arms and records a save, and the save report has a share card. Everything is labelled as simulated.

To run against Perpl testnet, set `ENGINE_MODE=live` and a `MASTER_KEY` (see `.env.example`), and link a Trade key whose allow-list includes your IP.

## Test

```bash
pnpm check            # lint, typecheck (engine, web, e2e), unit and property tests
pnpm e2e              # Playwright + axe against the engine in simulation mode
pnpm contracts:test   # Foundry, via Docker
pnpm --filter @airbag/indexer codegen && pnpm --filter @airbag/indexer test
```

CI runs all of these, plus gitleaks over the full history, `pnpm audit`, and a build and smoke test of the engine image.

## Deploy

[docs/DEPLOY.md](docs/DEPLOY.md): the engine on Fly.io with a static egress IP, the web app on Vercel, and optionally AirbagLog and the indexer.

## Contracts and transactions

_None deployed yet._ `AirbagLog`'s address and deploy transaction, and the transactions of the first real testnet deploy, go here once the owner has funded the M0 gate.

## AI disclosure

This project is built with AI coding tools, as the hackathon rules allow. What was made by whom:

| Part | Written by | Reviewed by the owner |
|---|---|---|
| Product brief (`docs/BRIEF.md`, original version) and approved design (`design/`) | Owner (Arth). _Owner: say here which tools, if any, helped._ | n/a |
| Corrections to the brief, research notes, ADRs, architecture, security and deploy docs | Claude Code (Anthropic, Claude Opus 5.5) | Pending |
| All code, tests and CI in this repository | Claude Code (Anthropic, Claude Opus 5.5) | Pending |

Commits before 23 Sep session 2 carry a `Co-Authored-By: Claude` trailer; later ones don't, at the owner's request, and the table above is the disclosure of record. It is updated as the owner reviews each part.

## License

[MIT](LICENSE)
