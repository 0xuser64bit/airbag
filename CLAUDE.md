# CLAUDE.md

Working notes for Claude Code on Airbag. Read `docs/BRIEF.md` (the source of truth), `docs/STATUS.md` (where we are) and `docs/RESEARCH.md` (verified Perpl facts) before changing anything.

## Commands

```bash
pnpm install
pnpm check        # lint + typecheck + test (what CI runs)
pnpm lint         # biome check
pnpm format       # biome check --write
pnpm typecheck    # tsc (noEmit), one root tsconfig
pnpm test         # vitest run
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

## Perpl gotchas (details and sources in docs/RESEARCH.md)

- **A reduce-only close doesn't move the liquidation price.** Perpl releases deposit pro-rata on a decrease. A deploy is a close, then `t:6` re-adding the released equity (ADR 0002).
- The engine may send only order types **3, 4, 6** and **5** (cancel of its own orders). Types, runtime assert and test enforce it.
- Orders need order forwarding on (`Account.fw`). Otherwise `mt:3` still says `code: 0` and the order fails on `mt:24` with `sr: 34`.
- `mt:3 code 0` means "accepted for forwarding", not filled. Reconcile from `mt:21/24/25/27`.
- Set a unique non-zero `sn` on every `mt:22` (it comes back as `cid`). Seed `rq` from `Account.lfr`.
- Market ids, decimals, margins and `order_ttl_blocks` differ per network: read `/api/v1/pub/context`. `maintenance_margin` is leverage in hundredths (2500 = 4%).
- The idle timeout (5 s mainnet, 10 s testnet) applies before sign-in too. Send `mt:29` immediately on open.
- 4 trading connections per wallet, shared with the user's browser tabs.
- **Side encodings differ.** The trading WS uses `sd` 1 = long, 2 = short; the contract's `PositionEnum` is 0 = long, 1 = short, and "no position" is `lotLNS == 0`. `packages/perpl/src/chain.ts` is the only place that reads the onchain one.
- Entry price carries a Q16 residue (`epr`). Premium PnL comes from funding sums (`efs` vs current `sum`, divided by `div · 10^price_decimals`).
