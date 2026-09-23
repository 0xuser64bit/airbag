# 0005. Postgres with Drizzle ORM and SQL migrations

Date: 23 Sep 2026

## Context

We store users, settings, encrypted keys, deploys, saves and push subscriptions. Both the engine and the web app read them. We need typed queries and reviewable migrations.

## Decision

- **Postgres** (Neon, see 0004).
- **Drizzle ORM** with `drizzle-kit` generating plain SQL migration files that get committed and reviewed. The schema lives in one small shared module that both apps import.
- Money and sizes are stored as integers in Perpl's scaled units (`numeric(78,0)`), never floats. Prices and sizes carry their market's decimals alongside.

## Consequences

- Drizzle is thin: queries read like SQL and there's no runtime query engine. Prisma was rejected for its generated client and heavier runtime.
- The DB is not in the per-block hot path. The engine writes on deploys, fills and settings changes only.
