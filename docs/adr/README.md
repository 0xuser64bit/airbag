# Architecture decision records

One file per decision. Status is Accepted unless marked otherwise. Supersede a record by adding a new one and linking it; don't rewrite history.

| # | Decision |
|---|---|
| [0001](0001-typescript-monorepo.md) | TypeScript monorepo on Node 24, pnpm workspaces, no build step |
| [0002](0002-deploy-is-close-then-readd.md) | A deploy is a reduce-only close, then re-adding the released margin |
| [0003](0003-engine-runtime.md) | Engine: one always-on Node process, order-type allowlist in three layers |
| [0004](0004-hosting.md) | Hosting: engine on Fly.io with static egress, web on Vercel (Neon later dropped by 0010) |
| [0005](0005-database.md) | ~~Postgres with Drizzle ORM and SQL migrations~~ (superseded by 0010) |
| [0006](0006-api-key-custody.md) | API secret custody: AES-256-GCM envelope encryption in the engine only |
| [0007](0007-web-app.md) | Web: Next.js App Router, Tailwind tokens, wagmi/viem, SIWE, PWA push (amended by 0011, 0013) |
| [0008](0008-risk-math-numerics.md) | Risk math in float64, integer conversion at the Perpl edge with safe rounding |
| [0009](0009-onchain-log-and-indexer.md) | AirbagLog contract with Foundry, indexed by Envio HyperIndex |
| [0010](0010-engine-owns-state-in-sqlite.md) | The engine owns all state, in SQLite |
| [0011](0011-bearer-sessions.md) | Sessions are bearer tokens from Sign-In with Ethereum |
| [0012](0012-exchange-port-and-simulation.md) | One exchange port, a paper exchange, and simulation mode |
| [0013](0013-web-css-and-viem.md) | Web: CSS custom properties and viem, no Tailwind or wagmi |
| [0014](0014-simulation-on-monad-blocks.md) | Simulation runs on Monad's real block clock (amends 0012) |
