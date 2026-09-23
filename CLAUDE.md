# CLAUDE.md

Working notes for Claude Code on Airbag. Read `docs/BRIEF.md` (the source of truth), `docs/STATUS.md` (where we are) and `docs/RESEARCH.md` (verified Perpl facts) before changing anything.

## Commands

```bash
pnpm install
pnpm check        # lint + typecheck + test (what CI runs)
pnpm lint         # biome check
pnpm format       # biome check --write
pnpm typecheck    # tsc (noEmit): root (packages, engine), apps/web, e2e
pnpm test         # vitest run (excludes indexer/ and e2e/)
pnpm dev:engine   # engine on :8787, simulation mode unless ENGINE_MODE=live
pnpm dev:web      # web app on :3000
pnpm e2e          # Playwright + axe; starts the engine (simulation) and web unless running
pnpm contracts:test                    # Foundry via its Docker image (pinned by digest)
pnpm --filter @airbag/indexer codegen  # then: pnpm --filter @airbag/indexer test
node apps/engine/src/cli.ts check-keys # master-key versions of stored keys
gitleaks git . --redact   # secret scan, same as CI
```

Spike scripts (M0): `node --env-file-if-exists=.env spike/<name>.ts` (Node 24 runs TS directly).

## Local shell (this machine only)

The shell uses nvm with default `v24.21.0`. Plain `node`, `npm`, `npx` and `curl` work, no PATH bypass needed.

## Conventions

- TypeScript strict, erasable syntax only (no enums, namespaces or parameter properties). Import local files with the `.ts` extension. Packages export `src/*.ts`; no build step (ADR 0001).
- Stdlib first: `node:crypto` (Ed25519, AES-GCM, SHA-256), global `WebSocket`, `node:http`.
- `packages/risk` stays pure: no I/O, no dependencies, human units (float64). Scaled-integer conversion and rounding happen in `packages/perpl`, always in the safe direction (ADR 0008).
- Tests first for risk math. Golden vectors compare at the design's display precision.
- Logs are JSON lines. Never log secrets, API keys, signatures or private keys.
- Run `gitleaks git . --redact` before every push. Public test vectors that look like keys get an inline `// gitleaks:allow` with a comment saying what they are.
- Commits: small, conventional prefixes (`feat(risk):`, `docs(adr):`, `ci:`). No co-author trailer (owner decision, 23 Sep). The history is judged.
- If the brief is wrong, fix `docs/BRIEF.md` in the same commit and add a row to the corrections table in `docs/STATUS.md`.
- Update `docs/STATUS.md` every session.
- The engine is the only process with state or secrets (ADR 0010); the web app talks to it over HTTP only.
- Anything that should work without a funded key gets exercised in simulation mode (ADR 0012): unit tests on `PaperExchange`, e2e against `ENGINE_MODE=simulation`. Label anything simulated in the UI.
- Next.js 16 ships its own docs in `apps/web/node_modules/next/dist/docs/`; read them before using an API, conventions changed.
- Node won't strip types from `.ts` under `node_modules`: images must keep workspace packages in `packages/` (see `apps/engine/Dockerfile`).

## Perpl gotchas (details and sources in docs/RESEARCH.md)

- **A reduce-only close doesn't move the liquidation price.** Perpl releases deposit pro-rata on a decrease. A deploy is a close, then `t:6` re-adding the released equity (ADR 0002).
- The engine may send only order types **3, 4, 6** and **5** (only the link-time scope probe, aimed at an order id the account doesn't have). Types, runtime assert and test enforce it.
- Orders need order forwarding on (`Account.fw`). Otherwise `mt:3` still says `code: 0` and the order fails on `mt:24` with `sr: 34`.
- `mt:3 code 0` means "accepted for forwarding", not filled. Reconcile from `mt:21/24/25/27`.
- Set a unique non-zero `sn` on every `mt:22` (it comes back as `cid`). Seed `rq` from `Account.lfr`.
- Market ids, decimals, margins and `order_ttl_blocks` differ per network: read `/api/v1/pub/context`. `maintenance_margin` is leverage in hundredths (2500 = 4%).
- The idle timeout (5 s mainnet, 10 s testnet) applies before sign-in too. Send `mt:29` immediately on open.
- 4 trading connections per wallet, shared with the user's browser tabs.
- **Side encodings differ.** The trading WS uses `sd` 1 = long, 2 = short; the contract's `PositionEnum` is 0 = long, 1 = short, and "no position" is `lotLNS == 0`. `packages/perpl/src/chain.ts` is the only place that reads the onchain one.
- Entry price carries a Q16 residue (`epr`). Premium PnL comes from funding sums (`efs` vs current `sum`, divided by `div · 10^price_decimals`).
