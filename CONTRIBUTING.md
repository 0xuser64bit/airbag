# Contributing

Read [Architecture](docs/ARCHITECTURE.md) before changing package boundaries,
[Risk model](docs/RISK-MODEL.md) before changing calculations, and
[Perpl integration](docs/PERPL.md) before changing exchange behavior. UI changes also follow
[apps/web/DESIGN.md](apps/web/DESIGN.md).

## Setup and checks

Node 24 and the pnpm version in `package.json` are required. Run commands from the repository root
unless a command explicitly changes directories.

```bash
pnpm install --frozen-lockfile
pnpm dev:engine
pnpm dev:web

pnpm check       # lint, engine/web/browser-test types, unit and property tests
pnpm format
pnpm build
pnpm e2e        # isolated simulation engine and web app, local Chrome
pnpm contracts:test
pnpm --filter @airbag/indexer codegen
pnpm --filter @airbag/indexer exec tsc -p .
pnpm --filter @airbag/indexer test
```

CI's browser profile uses the production web build and Playwright Chromium:

```bash
AIRBAG_E2E=1 NEXT_PUBLIC_ENGINE_URL=http://localhost:8877 \
  NEXT_PUBLIC_SITE_URL=http://localhost:3100 pnpm build
CI=1 pnpm e2e
```

`AIRBAG_E2E` writes a separate `.next-e2e` build. Install Chromium with
`pnpm exec playwright install chromium` if this profile needs it. Local browser tests use Chrome.
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

Use small, coherent commits with conventional prefixes. No co-author trailers. CI runs the full
checks listed above, dependency auditing, a full-history secret scan and an engine-image smoke test.
Before pushing, run `gitleaks git . --redact` (or the CI scanner). Public test-vector exceptions must
identify the published source. `.env` files, databases, private notes and tool caches stay untracked.

Report vulnerabilities privately to the maintainer; see [Security](docs/SECURITY.md).
