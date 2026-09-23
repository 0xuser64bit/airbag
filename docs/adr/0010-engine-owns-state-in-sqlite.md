# 0010. The engine owns all state, in SQLite

Date: 23 Sep 2026. Supersedes 0005. Amends 0004 (no Neon).

## Context

ADR 0005 put users, settings, encrypted keys and deploys in Postgres on Neon, read by both the
engine and the Vercel web tier. Building it showed three problems:

- The web tier never needs the table of encrypted API secrets, but with shared database access it
  would hold credentials that can read it. The engine is the only thing that should.
- The engine is one process by design (0003); nothing else writes. A networked database buys no
  concurrency, and costs a hosting account, a connection string in two places, and a local
  Postgres for every developer and CI run.
- The web app's server-side needs are small: the public save report and its share image.

## Decision

- The engine owns all state in one SQLite file, through `node:sqlite` (stdlib, no ORM). WAL
  mode, foreign keys on, a busy timeout. On Fly it lives on a volume (`/data`).
- Migrations are an append-only list of SQL strings tracked by `PRAGMA user_version`.
- Settings ranges, enums and the wallet format are `CHECK` constraints, so no code path can store
  a bad value.
- The web app reads everything through the engine's HTTP API. The save report page and its OG
  image call the public `/v1/saves/:id`.
- Deploy receipts store human units (float64) and Perpl's integers where they matter (lots, CNS
  strings). They are receipts; money movements are always computed from live Perpl state.

## Consequences

- One process holds the only path to the encrypted secrets, and the only master key.
- `pnpm install && pnpm dev:engine` runs with nothing else installed; tests use `:memory:`.
- One machine, one volume. Fly snapshots volumes daily; for more, add Litestream to S3. Horizontal
  scale means sharding accounts across engines (already the plan in 0003), each with its own file.
- If a second writer is ever needed, the data access is one module (`apps/engine/src/db.ts`) and
  the schema is plain SQL, so moving to Postgres is contained.
