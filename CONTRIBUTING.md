# Contributing

[Project overview](README.md) · [Documentation](docs/README.md) · [Security](docs/SECURITY.md)

Read [Architecture](docs/ARCHITECTURE.md) before changing package boundaries,
[Risk model](docs/RISK-MODEL.md) before changing calculations, and
[Perpl integration](docs/PERPL.md) before changing exchange behavior. UI changes also follow
[apps/web/DESIGN.md](apps/web/DESIGN.md).

## Setup and checks

Use Node.js **24.21.0** (`.nvmrc`) and **pnpm 11.24.0** (`package.json`). Install pnpm with
`npm install --global pnpm@11.24.0`, or use `npx --yes pnpm@11.24.0` instead of `pnpm`.
Run commands from the repository root unless a command explicitly changes directories.

The simulation needs no real wallet, exchange credentials, Docker or environment file:

```bash
pnpm install --frozen-lockfile
pnpm dev:engine
```

In a **second terminal**, run `pnpm dev:web`, then open `http://localhost:3000/connect`.
The root engine command loads `.env.example` and then optional root `.env` overrides; Next.js
loads web overrides from `apps/web/.env.local`, not the root file. For a network-independent engine
clock use `SIM_CLOCK=local pnpm dev:engine`, without external alert providers.

Choose checks by what you change:

| Scope | Command | Additional prerequisite |
|---|---|---|
| Lint, engine/web/e2e types, unit/property tests | `pnpm check` | Node and pnpm only |
| Web production build | `pnpm build` | Network access for build-time font/data requests |
| Local browser journeys and axe checks | `pnpm e2e` | Installed Google Chrome; ports 3100 and 8877 available |
| Contract unit tests | `pnpm contracts:test` | Docker running; image download on first use |
| Contract tests without Docker | `(cd contracts && forge test)` | Local Foundry (`forge`) |
| Optional indexer | See [fixture checks](indexer/README.md#test-the-handlers) | Codegen before typecheck/tests; Docker is not needed for handler tests |
| Secret scan before publishing | `gitleaks git . --redact` | Installed Gitleaks, or use the scanner from CI |

Use `pnpm format` when a code-formatting change is needed; it writes files. Do not treat it as a
read-only check. Core checks and a build are the baseline before submitting a code change.

### Production browser profile

CI uses the production web build and Playwright Chromium:

```bash
pnpm exec playwright install chromium
AIRBAG_E2E=1 NEXT_PUBLIC_ENGINE_URL=http://localhost:8877 \
  NEXT_PUBLIC_SITE_URL=http://localhost:3100 pnpm build
CI=1 pnpm e2e
```

`AIRBAG_E2E` writes a separate `.next-e2e` build. Linux hosts may also need browser OS dependencies;
CI uses `pnpm exec playwright install --with-deps chromium`. Local browser tests use Chrome.
Custom test ports must match the URLs baked into the build. Tests refuse to reuse existing servers.

## Protocol and replay checks

These commands read public data. The replay commands replace the committed web datasets; review
both datasets and their window together before committing a refresh.

```bash
pnpm --filter @airbag/tools check
pnpm --filter @airbag/tools measure 60
PERPL_NETWORK=mainnet MONAD_RPC_URL=https://rpc2.monad.xyz pnpm --filter @airbag/tools liquidations
PERPL_NETWORK=mainnet MONAD_RPC_URL=https://rpc2.monad.xyz pnpm --filter @airbag/tools backtest
PERPL_NETWORK=mainnet MONAD_RPC_URL=https://rpc2.monad.xyz pnpm --filter @airbag/tools false-alarms
(cd contracts && MONAD_FORK_RPC=https://rpc1.monad.xyz forge test --match-contract Fork)
```

Funded testnet checks are in [Operations](docs/DEPLOY.md#testnet-verification).
`tools/deploy.ts` is dry-run by default and refuses mainnet. Never run its `--send` path without
authorized disposable testnet funds. Simulation is the default environment for development.

## Code conventions

- TypeScript is strict, with unused locals and parameters rejected. Engine and package code uses
  erasable syntax and explicit `.ts` local imports. Workspace packages export their source;
  Node 24 runs them without a compilation step.
- Prefer existing helpers and Node/platform APIs. The engine uses `node:http`, `node:sqlite` and
  `node:crypto`; it owns the only database and master key.
- Keep `packages/risk` pure. Calculations use human units; Perpl integer conversion and safe
  rounding belong in `packages/perpl`. Shared tests pin the browser and engine calculations.
- Never weaken the order allowlist, dispatch safety checks, position locks or persisted recovery
  state to satisfy a test. Preserve validation, error handling and environment binding.
- Add focused regression tests for changed behavior. Risk changes need golden and property tests;
  reversible wording and export changes use the existing checks.
- Keep logs structured and redact secrets. Never log keys, signatures or tokens.
- Use the installed Next.js docs in `apps/web/node_modules/next/dist/docs/` before changing framework
  behavior. Node does not strip types under `node_modules`; preserve the source layout in the engine image.

## Documentation and commits

Update the relevant current guide in the same commit as its behavior. Put durable design rationale
in Architecture; use Git history for superseded proposals and completed work logs. Historical replay
results need their original date and assumptions. Do not present simulation or a dated snapshot as a
live trading result.

The [documentation index](docs/README.md) is the navigation hub. Keep reference facts beside their
owning guide instead of creating duplicate setup pages or completed-work logs. Check relative links,
heading anchors and command names after moving content. Screenshot changes must preserve simulation
labels, include useful alt text and retain the evidence context in
[About the screenshots](docs/README.md#about-the-screenshots). Do not turn recorded validation dates
into fresh test claims without rerunning the relevant check.

Use small, coherent commits with conventional prefixes. No co-author trailers. CI runs the full
checks listed above, dependency auditing, a full-history secret scan and an engine-image smoke test.
Before pushing, run `gitleaks git . --redact` (or the CI scanner). Public test-vector exceptions must
identify the published source. `.env` files, databases, private notes and tool caches stay untracked.

Report vulnerabilities privately to the maintainer; see [Security](docs/SECURITY.md).
