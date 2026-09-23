# Status

Updated every session. Newest first within each section.

**Milestone:** M1–M5 build (session 2, 23 Sep). The M0 gate is still waiting on the owner (checklist below); everything that doesn't need a funded key is being built and tested against a simulated exchange and Perpl's public data.

## Audit (23 Sep, session 2)

What the repo was at the start of session 2: docs, design, two packages (`risk`: liquidation price only; `perpl`: allowlist, sign-in, units) and three M0 spike scripts. 38 passing tests. No engine, web app, database, contract or indexer.

Findings that change the plan (details in the ADRs they produced):

| # | Finding | Decision |
|---|---|---|
| 1 | ADR 0004/0005 put the encrypted API secrets in a Neon database that the Vercel web tier can also read. The web tier never needs them. | The engine owns all state in SQLite (`node:sqlite`, stdlib). The web app talks only to the engine API. One less account (Neon), no ORM, secrets reachable from one process. ADR 0010. |
| 2 | Cookie sessions across `*.vercel.app` → `*.fly.dev` are third-party and blocked by Safari. | Bearer session tokens from SIWE, hashed at rest. ADR 0011. |
| 3 | Nothing could exercise a deploy end to end without a funded key. | An exchange port with two adapters: Perpl (live) and a paper exchange. Simulation mode and CI run the real engine code against the paper exchange. ADR 0012. |
| 4 | `socket.ts` crashes the process on a non-JSON frame and leaks a `closed` handler per `next()` call. Fine for a spike, not for an always-on engine. | Rewritten with a trading client (sign-in, snapshots, heartbeat `sn`, pings, token bucket, reconnect). |
| 5 | A Read-scoped key would link fine and fail at the first deploy. | Scope probe at link time: a cancel for an order id that isn't the account's (can't cancel anything; a Read key gets `403`). |
| 6 | The IP allow-list can't be read through any API. The design says "IP-locked" after verification. | The UI says what we checked and asks the user to confirm the IP lock. It never claims to have verified it. |
| 7 | The design's Email alert toggle has no provider behind it. | Removed until there is one. No fake controls. |
| 8 | Demo mode (0.3% triggers) on any account would let anyone with a stolen session make Airbag close a position on noise. | Demo thresholds are only allowed for wallets in `DEMO_WALLETS`. |
| 9 | A crash between the close and the re-add leaves the position trimmed with liquidation unchanged. | Deploy phase is persisted; on restart the engine finishes any half-done re-add. |
| 10 | Arming on a position that's already past its line trims it immediately. | The setup preview warns before arming. |

## Backlog

Ordered by dependency. Each item is one or a few commits, verified with `pnpm check` plus the item's own check.

| # | Area | Work | Verify |
|---|---|---|---|
| 1 | risk | Trigger line, cushion, planning (spare margin vs trim, cap), trim application, re-arm, counterfactual and save value. Every golden vector in brief §4, property tests. | Golden vectors, fast-check |
| 2 | perpl | Full frame types; robust socket; token bucket; trading client (sign-in, snapshots, `sn` gaps, pings, reconnect, order ack/outcome); market-data feed (heartbeat, marks, funding, stale guard); onchain reads (account lookup, positions, funding sum); scope probe. | Unit tests with fake sockets; live read-only run against testnet market data |
| 3 | engine | Config, JSON logger with redaction, SQLite with migrations, AES-256-GCM envelope encryption. | Unit tests |
| 4 | engine | Exchange port, paper exchange, the per-position protector (arm, trigger, plan, close, re-add, partial-fill retry, re-arm, save watch), crash resume. Simulation of the landing path: trigger at block 14, fill at 15. | Lifecycle tests on the paper exchange |
| 5 | engine | HTTP API: health, config, lookup, SIWE, sessions, key link, settings, state, stream, deploys, public saves, push subscriptions, simulation controls. CORS, body limits, rate limits. | API tests with a viem test account |
| 6 | engine | Web Push, AirbagLog writer (optional), main wiring, graceful shutdown. | Unit tests; engine boots against testnet public data |
| 7 | web | Next.js app, tokens, fonts, components; landing with the replay driven by `@airbag/risk`; connect + SIWE; link key; setup; dashboard with live stream and deploy card; deploys; settings; save report + OG image; PWA + push; phone layouts. | Build; browser runs against the engine in simulation mode |
| 8 | e2e | Playwright + axe: onboarding to a simulated deploy, save page, accessibility. In CI. | CI |
| 9 | onchain | `AirbagLog` (Foundry, tests) and the Envio indexer. | `forge test` (Docker), `envio codegen` |
| 10 | ops | Dockerfile, `fly.toml`, env docs, security runbook (key rotation). | `docker build` |
| 11 | docs | README (why Monad, run it, disclosure), architecture, ADRs 0010–0012, brief corrections. | Read-through |
| 12 | re-audit | Fresh pass over everything; fix what it finds. | All of the above |

## M0 gate

| Check | State | Result |
|---|---|---|
| Block time, market-state cadence, feed lag | Done | Monad 303 ms. Perpl heartbeat every block. `market-state` on 66–92% of blocks, ~1 block behind head. Mark moves in 0.03–0.06% steps, ≤ 169 blocks apart. (`docs/RESEARCH.md` §3a) |
| Liquidation split | Done | 80/10/10 onchain on every market (`getLiquidationInfo`) |
| Partial close keeps or releases margin | Done | Releases it pro-rata, so a deploy needs `t:6` (ADR 0002) |
| Fund wallet, create account, enable forwarding, create Trade key | **Owner** | — |
| Sign in to the trading WS, read positions | Ready: `spike/account.ts` | — |
| Liquidation price matches Perpl's UI to the dollar | Ready: `spike/account.ts` (WS-derived and chain-derived side by side) | — |
| `IncreasePositionCollateral` with a Trade key | Ready: `spike/deploy.ts add` | — |
| `CloseLong` IOC reduce, fill, re-add, liquidation moves | Ready: `spike/deploy.ts trim` | — |
| Detect → send → fill → re-add latency | Ready: `spike/deploy.ts` timeline | — |

### Owner checklist to unblock the gate

1. In your browser wallet, create a **new testnet-only account**. Don't use a wallet that holds real funds.
2. Get testnet MON for gas at https://faucet.monad.xyz.
3. Get testnet AUSD using testnet.perpl.xyz's test-funds flow. The testnet minimum to open an account is 100 AUSD; about 1,000 AUSD gives room for a few runs.
4. On https://testnet.perpl.xyz: deposit (this creates the exchange account), then turn on **One-Click Trading** in settings (order forwarding; without it every API order fails).
5. Open a small **BTC long at about 10x** (e.g. 0.01 BTC). Screenshot or note the **liquidation price Perpl shows**.
6. At https://testnet.perpl.xyz/apikeys, create a key with **Trade** scope. For the IP allow-list, add this laptop's public IP, or leave it empty for the spike.
7. Copy `.env.example` to `.env` in the repo root and put the key in `PERPL_API_KEY` and the secret (hex) in `PERPL_API_SECRET`. **Don't paste either into chat.** `.env` is gitignored.
8. Tell me it's done, with the liquidation price from step 5. I'll then run, in order: `account.ts`, `deploy.ts add --amount 1 --send`, `deploy.ts trim --fraction 0.3 --send`.

## Done

- 23 Sep: `spike/account.ts` and `spike/deploy.ts` (dry-run by default, testnet only, orders only through the allowlisted `sendOrder`).
- 23 Sep: `spike/measure.ts` run on both networks. Found the mark cadence and fixed the brief's stale-guard definition.
- 23 Sep: `packages/perpl` M0 subset: order allowlist (types, runtime assert, tests), Ed25519 sign-in via `node:crypto` (RFC 8032 test), entry residue, safe rounding, context types, socket helper.
- 23 Sep: `packages/risk` M0 subset: equity, liquidation price, distance; BTC/ETH golden vectors and property tests.
- 23 Sep: Repo setup: MIT license, README with AI disclosure, `.env.example`, CI (lint, typecheck, test, gitleaks, audit), private GitHub repo `0xuser64bit/airbag`.
- 23 Sep: ADRs 0001–0009, `docs/ARCHITECTURE.md`, `CLAUDE.md`.
- 23 Sep: Research on Perpl, Monad, Envio and hosting (`docs/RESEARCH.md`). Every "verify" item in the brief is checked.

## Blocked (needs the owner)

- The M0 gate checklist above.
- Hackathon dashboard: paste the Monad Metropolis rules and the exact Perpl ("Best use of Perpl's API", "Best Analytics / Risk Tool") and Envio bounty texts into `docs/HACKATHON.md`.
- Hosting: Fly.io (engine, static egress) and Vercel (web). Neon is no longer needed (ADR 0010). Ask Perpl on Discord to (a) whitelist our Origin for key enrollment, (b) say whether a key-info endpoint (scope and IP list) exists or is planned.
- Make the repo public before submission (it's private for now, by your choice). The rules want it public "throughout".

## Corrections to the brief

| Date | Section | Was | Now | Evidence |
|---|---|---|---|---|
| 23 Sep | 5 | Type 5 is for cancelling Airbag's own orders | Airbag's closes are IOC, so it never has one. Type 5 is used once, at link time, to probe a key's scope with a cancel of an order id the account doesn't have (a Read key gets 403). The own-order cancel builder is removed. | `packages/perpl/src/orders.ts`, `apps/engine/src/accounts.ts` |
| 23 Sep | 3, 5 | The mark price moves every block; `market-state` arrives every block; stale = data older than N blocks | Mark updates onchain every ~0.03–0.06% move or ≤ 169 blocks (~51 s). `market-state` is change-driven (66–92% of blocks). The stale guard measures feed lag against the head (heartbeat), not mark age. | `spike/measure.ts` runs and `MarkUpdated` logs, 30 min on mainnet BTC/ETH and testnet BTC |
| 23 Sep | 3, 4, 10 | A reduce-only trim moves the liquidation price (e.g. $94,000 → $87,300) | Perpl releases deposit pro-rata on a partial close, so the trim alone leaves liquidation where it was. A deploy is **close, then `IncreasePositionCollateral` of the released equity**. Golden vectors unchanged. `t:6` becomes a hard requirement, not an optional feature. | 400 `PositionDecreased` events per network, deposit ratio = size ratio (`docs/RESEARCH.md` §1) |
| 23 Sep | 3 | Auth needs a key plus an exchange account | Also needs `allowOrderForwarding(true)` ("One-Click Trading"). Off on new accounts. | api-docs README |
| 23 Sep | 3 | Maintenance margins; ZEC ~6.7% | Config value is leverage in hundredths. ZEC is 5.56% on mainnet; testnet MON 20%, ZEC 10%. LIT and PUMP markets added. | live `/pub/context` |
| 23 Sep | 3 | Funding "about hourly" | Every 8,571 blocks = 2,580 s (43 min) | live `/pub/context` |
| 23 Sep | 3 | Stops aren't native | The API has trigger orders (including mark-price conditions) and Perpl's UI has SL/TP | api-docs websocket.md, context feature flags |
| 23 Sep | 3 | Public Monad WS URLs unlisted | Listed: `wss://rpc.monad.xyz`, `wss://testnet-rpc.monad.xyz` | docs.monad.xyz |
| 23 Sep | 3 | Perpl ABI not public | `dex-sdk` (MIT) ships `Exchange.json` | dex-sdk repo |
| 23 Sep | 3 | Order frame fields | Added `sn` (ack correlation), `rq` seeding from `lfr`, `lb: 0` | api-docs websocket.md |

## Open questions

- **Key verification.** No API returns a key's scope or IP list. Scope is probed at link time (finding 5). For the IP lock, ask Perpl for a key-info endpoint, or probe from a second egress.
- **`t:6` amount format.** Scaled CNS integer string or decimal? Found out in M0. The engine sends the CNS integer string, as the spike does.
- **Design change.** The deploy timeline needs a row for the margin re-add, and "fill" latency now spans two orders. Built with the extra row; confirm with the owner.
- **Landing copy.** The hero replay says it "plays at real speed, one frame per 300 ms Monad block" while the price moves $100–600 per frame. Perpl's real mark moves in ~0.03–0.06% steps (~$25–50 on BTC). It's a scripted crash test, but "real speed" invites the question. Suggest "one frame per Monad block" or labelling it as a compressed wick. Owner's call.
- **Early warning.** The mark lags the oracle by design. The engine could also watch `orl` (oracle) and pre-compute the trim so it's ready when the mark crosses. Deferred: the per-block plan is cheap enough to compute on the trigger block.
