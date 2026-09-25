# Status

Updated every session. Newest first within each section.

**Milestone:** M1–M5 built and re-audited (session 2, 23 Sep). The product runs end to end against a simulated exchange, in CI and in a browser. **It has not traded on Perpl yet:** the M0 gate is waiting on the owner (checklist below). Nothing is deployed. The web app's redesign (session 3) is on branch `redesign/instrument`, not merged.

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

## Re-audit (23 Sep, session 2, after the build)

A fresh pass over the finished code, money path first. Each row is one commit.

| # | Finding | Fix |
|---|---|---|
| 1 | Margin adds are sent with `lb: 0`, which the trading client never expired. A lost final status held the deploy lock for that position forever. | Every pending order gets a deadline (60 blocks for `lb: 0`). |
| 2 | A socket that stays open but stops delivering never reconnected: the feed stayed stale (safe, but protection stopped until a restart) and orders stayed pending. | All three sockets close after 10 s of silence and reconnect. |
| 3 | A failed re-add was retried as a new trim of the already-trimmed position, while the released margin sat in the balance. | The episode remembers the pending re-add and retries only that; the deploy stays `readding` so a restart can finish it too. |
| 4 | `DELETE /v1/push` removed any wallet's subscription by endpoint. A malformed path escape was a 500. | Scoped to the session's wallet; 400. |
| 5 | SIGTERM with a dashboard open always hit the 10 s force-exit: `server.close()` waits for event streams that never end. | `stop()` ends open connections; the API test leaves a stream open to prove it. |
| 6 | Save alerts and save-report metadata said "trimmed" for margin-only deploys. | Copy follows the deploy kind. |
| 7 | The page that takes an API secret had no CSP and could be framed. | CSP (connect only to self and the engine, no framing, no third-party scripts) plus nosniff, referrer and permissions headers. |
| 8 | An unused own-order cancel builder widened the type-5 surface. Airbag's closes are IOC and never rest. | Removed; brief corrected. |
| 9 | Unlinking or replacing a key mid-deploy swapped the exchange under the running deploy. | 409 until the deploy finishes. |
| 10 | A non-numeric `MASTER_KEY_VERSION` loaded a key under `NaN`. | Rejected at boot. |
| 11 | With the engine unreachable the app said "Connecting" forever, and the reconnect banner claimed "the engine keeps running either way", which the browser can't know. | Says it can't reach the engine; the claim is gone. |
| 12 | "Key verified · Trade scope" was shown even when Perpl never answered the scope probe. | The engine reports whether the probe proved Trade scope; the page says when it couldn't. |

## Backlog

Ordered by dependency. Each item is one or a few commits, verified with `pnpm check` plus the item's own check. All twelve are done; what they couldn't verify is under "Not verified".

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

- 26 Sep, session 5: CI e2e green again. The onboarding journey failed only on the production build (dev never caches): the dashboard's "See the save report" link prefetched the report at the wick's $94,000 trough, and the 30 s fetch cache served that snapshot after the dashboard had recovered to $100,000, so the page showed Saved $2,267 instead of $5,333 (the engine was live and correct throughout). Both save links now use `prefetch={false}`: the kept amount moves with the price, so an early fetch plants a stale snapshot. Found on the way: (a) a retry (or any second run on the same engine) starts at $100,000, not the fresh-engine $99,420, so the 5.45% assert failed at connect — the journey now resets the sim to baseline after linking (a signed-in wallet counts as connected) and `/v1/sim/reset` drops the 15 s lookup cache, whose stale entry would otherwise hide the baseline; a fresh guard's empty pre-first-tick views fall back to the sample positions in `simLookup` instead of reporting none. (b) axe graded the key button mid-transition (120 ms unlit→yellow flip, sampled at 1.31:1), so the connect check waits for the enabled button plus one transition before running. Checks: `pnpm check` (135 tests); the full Playwright suite 3× in a row against `next start`, back to back on the same engine.

- 26 Sep, session 4: the connect step is centred on the page (it was a 720 px column against the left edge). In simulation the wallet list offers "Connect a test wallet", a throwaway key held by the page (loaded only when used), so the whole flow can be clicked through in any browser without an extension. Found on the way: with no wallet at all, wallet discovery never answered, so the page said "Looking for wallets" forever and the "No browser wallet found" advice was unreachable. Checks: `pnpm check` (135 tests); 5 Playwright journeys (new: the test wallet signs in with no extension); the whole flow clicked through with the test wallet at 1440 and 375 px. The journeys assume a fresh engine's prices (BTC at $99,420): after a manual wick on a shared dev engine, press "Reset account" first.
- 24–25 Sep, session 3: web app redesign on branch `redesign/instrument` (commits `5ab5541` … `52a6aac`, then this docs commit), not merged. The owner kept the original identity (palette, three fonts, mark, yellow = Airbag, red = liquidation) after a paper-stock redesign was built and rejected (`redesign/zine`, unmerged), and chose "envelope protection": every screen is one instrument panel. The page is the panel face cut by rules; instruments are dark glass (a vertical tape for the closest position, a runway per position, the block strip); annunciator lamps replace pills, and the strip carries protection, mode, key and feed at every width; a deploy is the flight display's hazard state, with the old line and liquidation left on the tape as ghosts; motion is damped and reduced motion switches it off. An independent finish review sent the first build back (the instruments sat in the old card grid), asked for three fixes on the rebuild, then passed them. Found on the way: the favicon never shipped (Next drops `app/icon.svg` once metadata sets `icons`); the save report said "back at" a price that hadn't recovered. The landing replay is captioned as a compressed wick (the open question is closed). Checks: 135 tests; 4 Playwright journeys with axe on 9 screens; the production build walked at 1440, 1024 and 390 px with no page errors. Design system: `apps/web/DESIGN.md`.
- 23 Sep, session 2: backlog items 1–12 (commits `60c7f28` … `a7d2cc4`). Engine, web app, e2e, AirbagLog, indexer, engine image, docs (ADRs 0010–0013, architecture, security, deploy runbook, README), then the re-audit above. 135 unit/property/API tests, 4 Playwright journeys with axe on 9 screens, 8 Foundry tests, 3 indexer handler tests. The engine booted live against Perpl testnet public data, and live wallet lookups matched a real testnet account by hand.
- 23 Sep: CI green again. `contracts` ran Foundry as uid 1000 against a checkout owned by the runner, so `forge` couldn't create `out/`; it now runs with `--user root` (CI, `pnpm contracts:*`, deploy README). `audit` failed on 5 highs via `envio@3.12.1` (express 4.19.2, ws 8.20.1); pinned via `pnpm-workspace.yaml` overrides to express 4.22.3, body-parser 1.20.8, ws 8.21.3. One low left (esbuild dev-server on Windows, dev-only). Also added the missing `setup-node` step to the `audit` job.
- 23 Sep: `spike/account.ts` and `spike/deploy.ts` (dry-run by default, testnet only, orders only through the allowlisted `sendOrder`).
- 23 Sep: `spike/measure.ts` run on both networks. Found the mark cadence and fixed the brief's stale-guard definition.
- 23 Sep: `packages/perpl` M0 subset: order allowlist (types, runtime assert, tests), Ed25519 sign-in via `node:crypto` (RFC 8032 test), entry residue, safe rounding, context types, socket helper.
- 23 Sep: `packages/risk` M0 subset: equity, liquidation price, distance; BTC/ETH golden vectors and property tests.
- 23 Sep: Repo setup: MIT license, README with AI disclosure, `.env.example`, CI (lint, typecheck, test, gitleaks, audit), private GitHub repo `0xuser64bit/airbag`.
- 23 Sep: ADRs 0001–0009, `docs/ARCHITECTURE.md`, `CLAUDE.md`.
- 23 Sep: Research on Perpl, Monad, Envio and hosting (`docs/RESEARCH.md`). Every "verify" item in the brief is checked.

## Blocked (needs the owner)

- The M0 gate checklist above. Until it runs, the live trading path (sign-in with a real key, `t:6` amount format, fill and deposit reconciliation, latency) is tested only against a fake socket and the paper exchange.
- Accounts and secrets for deployment (`docs/DEPLOY.md`): Fly.io (engine + static egress IP), Vercel (web), VAPID keys (push is off without them), a funded deployer and a low-value writer wallet for AirbagLog, `ENVIO_API_TOKEN` for the indexer.
- AI disclosure table in the README: say which tools, if any, helped with the brief and design, and review the parts marked "Pending".
- Hackathon dashboard: paste the Monad Metropolis rules and the exact Perpl ("Best use of Perpl's API", "Best Analytics / Risk Tool") and Envio bounty texts into `docs/HACKATHON.md`.
- Hosting: Fly.io (engine, static egress) and Vercel (web). Neon is no longer needed (ADR 0010). Ask Perpl on Discord to (a) whitelist our Origin for key enrollment, (b) say whether a key-info endpoint (scope and IP list) exists or is planned.
- Make the repo public before submission (it's private for now, by your choice). The rules want it public "throughout".

## Corrections to the brief

| Date | Section | Was | Now | Evidence |
|---|---|---|---|---|
| 25 Sep | 8 | Instruments in 12 px panels (cards), a positions table, annunciators "dark when off, bone when on" | One continuous panel: no cards, the page is the panel face cut by 1 px rules; a runway per position; lamps are tiles with a lit face; selection is bone, never yellow; the strip keeps protection, mode, key and feed at every width | Independent finish review (rebuild, fix, pass); commits `a52e5a2`, `52a6aac` |
| 24 Sep | 1, 6, 8 | The `/design` layouts are built as drawn: a grid of rounded cards, pills for status | Same identity (palette, fonts, mark, yellow/red meaning, hazard stripe), rebuilt as an instrument panel: tapes with a red band and yellow bug, annunciators for status, glass wells instead of cards, instrument motion. A paper-stock redesign was built first and rejected by the owner (branch `redesign/zine`, unmerged). | Owner's choice, 24 Sep (`apps/web/PRODUCT.md`, `apps/web/.impeccable/surfaces/app.md`) |
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

## Not verified

- The redesign's motion (bugs and bands sliding, lamps boxing for ten seconds, digits rolling) runs without errors with motion on, but every review capture is a reduced-motion still. No capture shows the short Deploying state or the inverted-bone alert lamps (key rejected, connection limit, One-Click off).
- Anything against a funded Perpl account (M0 gate). Push delivery to a real browser (no VAPID keys). The indexer against real chain data (token). Any deployment. An independent review of key handling.

## Known limits (accepted for now)

- The public save report caches the engine's reading for 30 s, and Next serves the old copy while it refreshes (`apps/web/lib/save.ts`); production also prefetches the report from the dashboard at the moment of the save. So "Now, BTC is at …" can lag the market. The figures always match the price the page states.
- Dev server only: React logs "Failed to execute 'measure' on 'Performance': 'SavePage' cannot have a negative time stamp" on client navigation to a save report, and Next's issue badge shows it. The production build doesn't.
- One engine process on one machine: if it's down, nothing is protected. Add an external uptime check on `/health` when deployed.
- The scope probe cancels the smallest order id the account doesn't have. On an account that has never had an order, a first order placed in the same second could get that id and be cancelled. Harmless to positions; rare.
- If the funding seed from Perpl's REST API fails at boot, premium PnL counts as zero until the next funding event, which can put the liquidation price off by the accrued premium. It's logged as `funding.seed.error`.
- Pausing mid-deploy leaves the retry pending until re-armed; settings changed mid-deploy apply from the next attempt.
- The dashboard stream sends the whole state every block to every open tab. Fine for tens of users, not thousands.
- The session token lives in `localStorage`. CSP limits where a script could send it, but Next's inline scripts need `'unsafe-inline'`.

## Open questions

- **Key verification.** No API returns a key's scope or IP list. Scope is probed at link time (finding 5). For the IP lock, ask Perpl for a key-info endpoint, or probe from a second egress.
- **`t:6` amount format.** Scaled CNS integer string or decimal? Found out in M0. The engine sends the CNS integer string, as the spike does.
- **Design change.** The deploy timeline needs a row for the margin re-add, and "fill" latency now spans two orders. Built with the extra row; confirm with the owner.
- **Early warning.** The mark lags the oracle by design. The engine could also watch `orl` (oracle) and pre-compute the trim so it's ready when the mark crosses. Deferred: the per-block plan is cheap enough to compute on the trigger block.
