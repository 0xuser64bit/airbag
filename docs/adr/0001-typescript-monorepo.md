# 0001. TypeScript monorepo on Node 24, pnpm workspaces, no build step

Date: 23 Sep 2026

## Context

One developer, three weeks, five deliverables: web app, engine, risk math, contract, indexer. The risk math has to run in both the engine and the browser (the live settings preview) and must be identical in both. Perpl's own guides use TypeScript, and PerplBot, the reference bot, is TypeScript.

## Decision

- **TypeScript everywhere**, strict mode, in a **pnpm workspace**: `apps/web`, `apps/engine`, `packages/risk`, `packages/perpl`, `contracts/` (Foundry), `indexer/` (Envio). Each directory is created in the milestone that needs it, not before.
- **Node 24 LTS** runs `.ts` files directly (native type stripping). Packages export their `src/*.ts`. The engine and scripts need no build step, and Next.js compiles the packages through `transpilePackages`. Only erasable syntax is allowed (`erasableSyntaxOnly`: no enums, no namespaces, no parameter properties).
- **Biome** for lint and format: one fast tool with no plugin tree.
- **Vitest** for tests, **fast-check** for property tests.
- **Stdlib before dependencies**: `node:crypto` for Ed25519, SHA-256 and AES-GCM, and Node's global `WebSocket` client.

## Consequences

- One `pnpm install`, one `pnpm test`. There's no dist/ to go stale.
- Type-only syntax rules must be followed (`import type`, no enums). `tsc --noEmit` in CI catches violations.
- Rust (dex-sdk) would give us Perpl's state cache for free, but splits the math across two languages and slows the web work. Rejected. We use dex-sdk as a reference and for its ABI.
