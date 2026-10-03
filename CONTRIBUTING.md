# Contributing

Airbag is a small TypeScript monorepo with one hard rule that outranks most style opinions: **it
moves a trader's money.** Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing
structure, and [docs/PERPL.md](docs/PERPL.md) before touching the exchange layer.

## Commands

```bash
pnpm install

pnpm check        # lint + typecheck + unit and property tests; what CI runs
pnpm lint         # biome check
pnpm format       # biome check --write
pnpm typecheck    # tsc --noEmit: the workspace packages, the engine, apps/web, e2e
pnpm test         # vitest run (excludes indexer/ and e2e/)

pnpm dev:engine   # engine on :8787: .env.example's defaults (simulation), then your .env
pnpm dev:web      # web app on :3000

pnpm e2e          # Playwright + axe; starts the engine (simulation) and web if not running
pnpm contracts:test   # Foundry via its Docker image

pnpm --filter @airbag/indexer codegen && pnpm --filter @airbag/indexer test

pnpm --filter @airbag/spike check   # position math vs Perpl's contract on testnet, no key
PERPL_NETWORK=mainnet MONAD_RPC_URL=https://rpc1.monad.xyz pnpm --filter @airbag/spike liquidations
PERPL_NETWORK=mainnet MONAD_RPC_URL=https://rpc1.monad.xyz pnpm --filter @airbag/spike backtest   # rewrites apps/web/lib/backtest.json
```

Operator commands, on the machine that has the engine's environment:

```bash
node apps/engine/src/cli.ts check-keys --env-file-if-exists=.env
```

## Conventions

- **TypeScript strict, erasable syntax only.** No enums, no namespaces, no parameter properties
  (`erasableSyntaxOnly` in `tsconfig.json`, which also runs on the packages). Import local files
  with the `.ts` extension. Packages export `src/*.ts`; there is no build step
  ([ADR 0001](docs/adr/0001-typescript-monorepo.md)).
- **Stdlib first.** `node:crypto` for Ed25519, SHA-256 and AES-GCM; the global `WebSocket`;
  `node:http`; `node:sqlite`. Add a dependency only when the standard library genuinely can't.
- **`packages/risk` stays pure.** No I/O, no dependencies, human units in float64. All conversion to
  Perpl's scaled integers happens in `packages/perpl`, rounding always in the safe direction
  ([ADR 0008](docs/adr/0008-risk-math-numerics.md)). The engine and the browser must compute the
  same numbers from the same code, so the golden vectors in
  [docs/RISK-MODEL.md](docs/RISK-MODEL.md) are asserted in tests at the precision the design
  displays.
- **The engine is the only process with state or secrets**
  ([ADR 0010](docs/adr/0010-engine-owns-state-in-sqlite.md)). The web app talks to it over HTTP.
- **Anything that should work without a funded key is exercised in simulation mode**
  ([ADR 0012](docs/adr/0012-exchange-port-and-simulation.md)): unit tests on `PaperExchange`,
  end-to-end against `ENGINE_MODE=simulation`. Label anything simulated in the UI.
- **Logs are JSON lines.** Never log secrets, API keys, signatures or private keys.
- **Node does not strip types from `.ts` under `node_modules`**, so the production image must keep
  workspace packages under `packages/` (see `apps/engine/Dockerfile`).
- Next.js 16 ships its own documentation in `apps/web/node_modules/next/dist/docs/`. Read it before
  using an API; conventions changed.

## Working on a change

- **Tests first for risk math.** For everything else, a test that fails without your change.
- **Work in simulation mode.** It is the real engine on a paper exchange, and it is the only mode
  CI can run.
- **Never claim something is verified that isn't.** If a control is untested, the copy says so. This
  is a product where a trader is trusting it with a position.
- **Don't weaken an invariant to make a test pass.** The order-type allowlist, the stale-data guard,
  the per-position lock and the arithmetic in `packages/risk` are the product.

## Commits and secrets

- Small commits with conventional prefixes: `feat(risk):`, `fix(engine):`, `docs(adr):`, `ci:`.
  No co-author trailers.
- **Run `gitleaks git . --redact` before every push.** Public test vectors that look like keys
  (for example the RFC 8032 vector in `packages/perpl/test/auth.test.ts`) carry an inline
  `gitleaks:allow` with a comment saying what they are.
- No secrets, keys or private notes in the repository, ever. `.env` is gitignored; `.env.example` is
  the template.
- If a document in `docs/` turns out to be wrong, fix it in the same commit. Decisions that change
  the design get a new record in `docs/adr/`, linked from the one they supersede — records are not
  rewritten.

## Reporting a vulnerability

Privately to the maintainer, not in a public issue. [docs/SECURITY.md](docs/SECURITY.md) has the
threat model and the key-rotation procedures.
