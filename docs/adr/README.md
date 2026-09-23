# Architecture decision records

One file per decision. Status is Accepted unless marked otherwise. Supersede a record by adding a new one and linking it; don't rewrite history.

| # | Decision |
|---|---|
| [0001](0001-typescript-monorepo.md) | TypeScript monorepo on Node 24, pnpm workspaces, no build step |
| [0002](0002-deploy-is-close-then-readd.md) | A deploy is a reduce-only close, then re-adding the released margin |
| [0003](0003-engine-runtime.md) | Engine: one always-on Node process, order-type allowlist in three layers |
| [0004](0004-hosting.md) | Hosting: engine on Fly.io with static egress, web on Vercel, Postgres on Neon |
| [0005](0005-database.md) | Postgres with Drizzle ORM and SQL migrations |
| [0006](0006-api-key-custody.md) | API secret custody: AES-256-GCM envelope encryption in the engine only |
| [0007](0007-web-app.md) | Web: Next.js App Router, Tailwind tokens, wagmi/viem, SIWE, PWA push |
| [0008](0008-risk-math-numerics.md) | Risk math in float64, integer conversion at the Perpl edge with safe rounding |
| [0009](0009-onchain-log-and-indexer.md) | AirbagLog contract with Foundry, indexed by Envio HyperIndex |
