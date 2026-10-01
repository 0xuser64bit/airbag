# MVP audit and implementation backlog

Audit date: 2026-09-27. Baseline: `46d3a4b`, clean working tree, Node 24.21.0,
pnpm 11.24.0. Baseline lint/typecheck passed; 135 tests in 13 files passed.

## Product and repository assessment

Airbag is an isolated-margin position guard, not a trading platform. Its useful journey is
wallet lookup → SIWE → verified Trade key → choose risk policy → arm → reduce-only close →
re-add released equity → persist a receipt → monitor the old liquidation price. The existing
simulation deliberately exercises this same journey; it is labelled and should stay available.
It is not evidence of live trading correctness.

History shows a coherent progression from protocol research and risk vectors through clients,
engine/API, web, log/indexer, deployment, then multiple reliability and UI passes. The last
documentation consolidation removed earlier execution notes. This audit traces the code rather
than treating those earlier passes as proof. Architecture, key custody, order allowlist, pure
risk package, single-process SQLite, and the approved instrument UI are appropriate for this
stage. A rewrite, extra database, auth framework, or wallet SDK would add risk without resolving
the observed faults.

The main weaknesses are async safety and honest operational state, not missing screens:

- Recovery runs before the paused/stale/forwarding checks and can claim a rejected re-add succeeded.
- Order continuations retain assumptions across waits; user changes and lost snapshots can invalidate them.
- Retry caps, pending recovery and key lifecycle use display status instead of independent locks.
- A nonce is consumed after asynchronous signature recovery, allowing simultaneous replay.
- Push endpoints accept arbitrary HTTPS hosts, causing server-side requests to attacker-chosen destinations.
- Streams only publish on blocks, so a silent market feed leaves an apparently armed dashboard.
- Onchain receipt handling does not check reverts; repeated save events inflate indexer totals.
- Mode/network state is not bound to the SQLite file; simulation and live can share credentials/receipts.
- Health always returns HTTP 200, so infrastructure sees a dead feed as healthy.
- Browser storage fallback can resurrect an expired or cross-tab-cleared session.

No backend is mocked in live mode. Optional onchain logging, indexer statistics and VAPID alerts
are real implementations but externally unverified. No service is deployed. Existing desktop,
phone and axe coverage is useful but narrow. Core golden/property tests pass; they do not cover
restart rejection, pause between orders, simultaneous nonce use or key replacement races.

## Ordered backlog

| Priority / unit | Change and reason | Dependencies / affected areas | Expected result / verification |
|---|---|---|---|
| P0 — Sign-in and outbound trust boundaries | Consume nonces before awaiting signatures; validate required SIWE fields/dates; validate push provider URLs and encryption keys. | `auth.ts`, `api.ts`, `notify.ts`; existing viem and crypto | One session per nonce; no arbitrary push destinations; focused adversarial tests, full check. |
| P0 — Safe order and restart lifecycle | Gate every order at dispatch, independently track pending work, defer recovery while unsafe, persist and reconcile recovery truthfully, enforce episode policy/cap. | `guard.ts`, `trading.ts`, `db.ts`, tests | Pause/stale/key/position changes cannot launch a continuation; failed recovery stays pending; restart and cap tests. |
| P0 — Key ownership and concurrency | Serialize link/unlink per wallet; recheck deploy locks after verification; refuse unproved Trade scope; close unused clients. | Guard lock from previous unit; `accounts.ts`, API | Existing guard cannot be stranded; concurrent links cannot overwrite one another; link race tests. |
| P1 — Environment and service lifecycle | Bind SQLite mode/network; validate config; make health/readiness distinct; stop guards before closing resources. | Store migration, `config.ts`, `app.ts`, `main.ts`, deploy docs | Cross-environment reuse refused; shutdown cannot submit late orders; migration/reopen and HTTP tests. |
| P1 — Live dashboard and browser state | Publish staleness without blocks; bound SSE buffering; detect a hung stream; handle storage expiration and cross-tab sign-out; expose config-load failures. | HTTP/engine lifecycle; web libraries and existing UI | UI stops claiming live protection when updates stop; runtime and regression checks. |
| P1 — Public record integrity | Check transaction receipts and events; make repeated saves idempotent in contract/indexer. | `onchain.ts`, Solidity, handler/tests | Reverts never become logged success; one save per deploy; contract/indexer tests. |
| P0 — Protocol fee drift, found in second audit | Replace the obsolete free-close assumption with current taker-tier estimates, net released collateral and observed fees; correct public claims. | Risk/perpl/engine/web, RISK-MODEL and PERPL references | Fee-bearing long/short and generated vectors reach the target; an engine deploy preserves original spare balance; unknown costs stay unconfirmed. |
| P2 — Operational handoff and final audit | Correct stale docs/claims, backup/recovery steps, reproducible commands, record actual results and remaining launch gates. | All implementation units | Full check/build/e2e, contracts/indexer, dependency/secret audit, image smoke if available; honest final report. |

## Deliberate boundaries

- No mainnet trading, deployment or real-key creation as part of this audit. Live testnet needs
  an owner-provided funded disposable account and Trade key. Independent financial/security
  review remains a launch gate.
- Keep the single-machine MVP. HA, per-user queues, large-scale fanout and a durable onchain
  outbox are deferred until usage and deployment needs justify them. Protection cannot operate
  while its machine or upstreams are unavailable.
- Preserve the existing visual identity; fix failure behavior and accessibility rather than
  replace a developed product surface for novelty.

## Implementation and second audit

All repository hardening units above are complete. External launch gates below remain open.
The second pass revisited protocol documentation, dispatch continuations, restart phases,
browser state, deployment readiness, backup behavior and product claims. It found additional
issues and produced these corrections:

- A lost spare-margin add could be replanned as a trim. Recovery now preserves the action.
- A successful retried re-add could end a partly filled deploy prematurely. The target is checked
  again and the remaining trim retries within the original cap and attempt budget.
- Interrupted later partial fills could undercount cumulative lots. New pre-close state records
  the prior filled count. Recovery restores it; unattributable fees remain unconfirmed.
- Recovery could send another add after the retry budget was already exhausted. It now stops and
  alerts instead. Failed paths use one common terminal alert; incomplete partial protection also
  alerts even if some work succeeded.
- A same-position size/collateral change during the request-budget wait could invalidate a plan.
  Dispatch checks those captured values and side before sending; a change stops the deploy for
  inspection. Position identity checks still apply between every continuation.
- Concurrent token-bucket callers could all wake and spend the same token. The native promise
  queue serializes waits, and shutdown aborts them. Socket startup also has a bounded timeout.
- The scope probe used a low missing order id that a concurrent first order could take. It now
  selects a high safe uint64 id outside the snapshot. Official types accept uint64 ids, but actual
  gateway acceptance of the probe must still be verified on the disposable account.
- Current official Perpl docs charge trading fees on closes. Trim planning now includes the
  taker schedule and account fee tier; settlement deducts the observed gross fee from the net
  release. No builder fee is requested. Legacy and lost receipts do not invent a zero fee.
- Root/product copy, simulated examples, cost receipts and operational docs now describe actual
  behavior. The original zero-fee golden vectors are labelled historical simulation examples.
- Operator commands refuse a missing source file instead of silently creating an empty database.
  Backup uses SQLite's online backup API rather than copying a live WAL-mode file.

The original package boundaries, native HTTP/SQLite approach, encrypted key custody and instrument
UI remain. They fit a single-machine MVP. No framework, queue service, database service, auth SDK,
wallet SDK or speculative feature was added. No dependency version or lockfile was changed.
No production secrets, real accounts, deployments, external messages or mainnet orders were created.

## Meaningful commits

All are on `codex/mvp-hardening`, starting from `46d3a4b`. Each implementation milestone ran
relevant checks before commit; extra second-pass corrections are separate coherent units.

| Commit | Purpose |
|---|---|
| `032fe24` | Record the initial audit and prioritized backlog. |
| `4d3c177` | Atomic SIWE nonce use and validated push destinations/keys. |
| `723b90c` | Gate all guard dispatches and reconcile interrupted deploys safely. |
| `044aa66` | Serialize key changes and refuse unproved Trade scope. |
| `80c6a3e` | Environment binding, consistent SQLite backups, readiness and shutdown. |
| `9c81dee` | Confirm log receipts and count saved deploys once. |
| `e9382a1` | Bound socket startup and serialize cancellable request waits. |
| `f54d94c` | Preserve recovered actions and cap recovery attempts. |
| `782950d` | Browser session/stream recovery and isolated production journeys. |
| `c33b7c5` | Current closing fees, net collateral and honest cost receipts/copy. |
| `01663b8` | Reject position changes during delayed dispatch. |
| `130c2d1` | Clarify remaining simulation claims and ignore unrelated storage events. |

The final operations/handoff commit contains this completed report, missing-database refusal,
expanded migration/backup preservation checks and updated README/security/deployment docs.

## Verification results

Performed locally on Node 24.21.0 / pnpm 11.24.0. These are actual results, not CI claims.

| Check | Result / limits |
|---|---|
| Baseline `pnpm check` | Lint/typecheck passed; 135 tests in 13 files. Baseline production build passed. |
| `pnpm install --frozen-lockfile` | Passed across all seven workspace projects; unchanged lockfile. Production-only install also passed inside Docker. |
| Final `pnpm check` | Biome lint, engine/web/e2e TypeScript checks, **162 tests in 16 files passed**. Includes golden/property, adversarial auth/push, key races, recovery/caps, fee paths, storage and readiness. |
| `pnpm build` | Next production build passed, including static/dynamic routes and share-image compilation. |
| Production browser profile | `AIRBAG_E2E=1 NEXT_PUBLIC_ENGINE_URL=http://localhost:8877 NEXT_PUBLIC_SITE_URL=http://localhost:31300 pnpm build`, then `CI=1 E2E_WEB_PORT=31300 pnpm e2e`: **6 passed** using bundled Chromium. Local Chrome/dev profile also passed. |
| Browser behavior | Real SIWE signatures from disposable test wallets, key linking, settings preview, arm, trim/re-add/re-arm/save, receipt/detail/public report, PNG OG image, phone pause/settings, stream interruption/reconnect, cross-tab logout and config retry passed. Axe serious/critical WCAG checks and overflow checks passed on tested views. Uncaught browser page errors fail the suite; none occurred. Not a full screen-reader/keyboard audit. |
| Visual inspection | Desktop 1440×900 and phone 375×812 screenshots inspected at baseline and confirmation. Current typography/layout preserved; no horizontal overflow. Full-page captures include the fixed phone navigation at the captured viewport. |
| Impeccable detector | Ran once. Returned existing imported-CSS font/radius advisories and a false font warning on the font-extraction regex in `save.ts`; no CSS redesign made to satisfy those heuristics. This is not a clean detector result. Visual inspection and axe are the stronger evidence for this scoped work. |
| `pnpm contracts:test` | Foundry via pinned Docker image: **9 passed**, including one save per deploy, writer/owner access and rotation, valid reasons, sequential records and no funds. No deployed-contract verification. |
| Indexer | Envio codegen, TypeScript and **3 handler tests passed**, including duplicate save events, per-market totals and liquidation aggregates. No real HyperSync/Cloud ingestion run. |
| SQLite migration/recovery | Schema-1 disk fixture migrated to schema 2; settings, deploys and links preserved through WAL-aware backup/reopen; mismatched mode/chain and future schema rejected. No user database migration was run. |
| Engine image | Final production Docker image built; simulation `/ready` returned 200 with `ok:true`; Docker health became healthy; config endpoint/startup logs checked; SIGTERM exited 0 without OOM or runtime errors. Test container removed. |
| Operator backup smoke | Running image produced an online backup. Native SQLite `integrity_check` returned `ok`, schema version 2 and `simulation:10143` binding. Missing-source backup intentionally exited 1, and neither source nor backup was created. |
| `pnpm audit --audit-level high` | Passed threshold; **one low** vulnerability remains (esbuild GHSA-g7r4-m6w7-qqqr). No high/critical findings. See accepted risks. |
| Gitleaks | Full Git history/all refs with redaction passed; no leaks found. Rechecked after implementation commits. This does not inspect private host secret stores. |

Failures were fixed rather than hidden: the default browser port was occupied by an existing user
server, so tests gained explicit port overrides and refuse reuse; storage fallback placement
broke hard navigations and was corrected before committing; retry test timing advanced blocks
before its 5 ms settlement timeout and now waits long enough; strict viem receipt-fixture typing
and the zero-fee formatting assertion were corrected. Initial immediate Docker curls ran before
startup and received an empty reply; readiness and Docker health subsequently passed. Expected
negative tests intentionally reject invalid inputs. Next/Playwright only reported the harness's
`NO_COLOR`/`FORCE_COLOR` environment warning. It is not an application runtime error.

## Remaining backlog and launch gates

| Priority | Work / reason | Dependency and affected area | Required proof |
|---|---|---|---|
| Launch gate | Funded disposable testnet execution, including the high-id Trade-scope probe and fee-bearing close/re-add. Simulation cannot prove exchange semantics. | Owner testnet wallet/funds/key; `spike`, perpl and guard | Perpl UI/chain/WS liquidation agree; actual fill/fee/balance/deposit reconcile; no unintended order. |
| Launch gate | Independent review of trading recovery, numerics, auth and key custody. AI tests are not an independent safety review. | Reviewer with protocol expertise | Adversarial review and disposable-position chaos tests before any funded live beta. |
| Launch gate | Egress allow-list, revocation/expiry, connection limits, forwarding-off, live feed failure and host alerts. | Deployed testnet engine with static egress | Refused keys cannot act; stale/paused recovery holds; `/ready` alerts reach the operator. |
| Launch gate | Real VAPID push delivery and browser permissions; backup/master-key restore drill. | HTTPS installation, push keys/device, host secret store | Tested notification and revoke/unsubscribe, offline delivery expectations, database and key recovery after host loss. |
| Optional feature gate | Log writer gas, confirmed events, retries after errors, real indexer ingestion. | Deployed testnet contract/writer, Envio token | Onchain rows match receipts; actual events indexed once; failed writes observed and handled. |
| Deferred | Durable onchain outbox; current queue is in memory and failed records are not automatically backfilled. | Only needed when public recording is operationally promised | Crash/restart/revert replay without missing or duplicate records. |
| Deferred | More robust attribution under simultaneous user trades/manual collateral changes; per-market liquidation shares. | Live protocol evidence; guard/chain and save model | Correct reconciliation despite concurrent mutations; truthful per-market estimates. Until then, public save values remain counterfactual estimates. |
| Deferred | HA, distributed coordination and large-scale stream fanout. | Usage beyond a single-machine beta | Load/failover evidence. Adding another engine now would risk duplicate trading against one account. |
| Accepted low risk | esbuild advisory affects Windows esbuild dev-server file serving, which this app does not invoke. It is transitive tooling, not the production engine. Avoid a forced minor-version override outside dependents' ranges solely to make audit green. | Upstream Vite/Vitest/tsx/Envio compatible update | Upgrade and rerun install/build/test/codegen when compatible versions resolve it. [Advisory](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr). |

Additional limits: price gaps or thin books can still liquidate positions; service-wide readiness
does not mean every linked key is healthy; logout ends the web session rather than stopping an
armed server-side guard; localStorage bearer tokens and Next inline-script allowances remain;
rate-limit maps, private SSE connections and full-state fanout need production load observation.
Optional contract records are writer-attested and the log's counters are not independent proof
of financial savings. Counterfactual returns approximate a fill at the old liquidation price and
currently share a first-market liquidation split with a 0.8 fallback. Public reports can lag 30 s.

## Manual checklist

1. On desktop and phone, complete onboarding with a real wallet; reject signing, switch wallets,
   deny storage/permissions and retry an unreachable engine. Confirm simulation/live labelling.
2. Link a disposable real Trade key with both egress addresses. Try a Read key, wrong wallet,
   expired/revoked key and exhausted connection budget. Verify no unproved key is stored.
3. Match entry, funding, liquidation, fee tier, spare balance and preview with Perpl. Test BTC and
   ETH longs/shorts, capped trims and spare-only protection. Fee changes must be reflected.
4. Execute a small testnet trim and verify order types, IOC limit, actual fee, net re-add,
   transaction, receipt and new liquidation. Test partial/no-fill and retry exhaustion.
5. Pause between orders, disable forwarding, freeze/revoke the key, interrupt each socket and
   restart after sending a close/add. No new dispatch while unsafe; no duplicate collateral add.
   Repeat with concurrent manual trades/collateral moves and investigate every ambiguous result.
6. Change settings during a deploy, attempt link/unlink while paused recovery is pending, and
   verify the existing episode retains its policy/key. Re-arm once safe; check terminal alerts.
7. Install the HTTPS PWA; deny/allow notifications; observe actual deploy/save/failure pushes on
   target phones, revoke permission and unsubscribe. Test keyboard, focus, zoom and screen readers.
8. Take an online backup, rotate/check master keys, restore on a stopped disposable host with a
   clean target path, and confirm sessions/settings/links/receipts/pending orders survive.
9. If using public logs, check reverted/missing events, writer rotation, gas depletion, queue loss
   and duplicate indexer events on deployed testnet. Confirm public estimates and share cards.

## Final assessment

**Demo-ready; live MVP release blocked.** The implementation is materially stronger and its
simulated core journey is verified end to end with persistent storage and native operational
checks. It is not production-ready and cannot honestly be called a verified live protection MVP:
no funded Perpl testnet trade has been executed, no independent review or host recovery drill has
occurred, and real push/log/indexer paths remain external. No mainnet activity or deployment was
attempted. Existing local servers were preserved; isolated browser servers and the owned smoke
container were stopped. The detailed launch gates above define the next work without pretending
that a passing build proves financial safety.

## Third pass: live checks and demo readiness (2026-10-01)

Baseline `6bef263`, clean tree, Node 24.21.0, pnpm 11.24.0, 162 tests passing. Method: run the
live engine and the web app against Perpl testnet and Monad testnet without a key, drive the
simulated journey in a real browser, re-read Perpl's current API docs and the `dex-sdk` ABI, and
review the guard for gaps that tests had not reached. Everything that needs a funded account or a
Trade key is still a launch gate.

### Findings and fixes

| Finding | Effect | Fix |
|---|---|---|
| A wallet lookup read one position per market in parallel; Monad's public testnet RPC refuses bursts above 15 requests/s | Three of five back-to-back lookups of real testnet accounts failed with "Couldn't read this wallet" | `f8b1a85`: reads batch into one Multicall3 `eth_call` |
| The live stale guard needed a funding event for every open market, covered or not | A newly listed Perpl market (no funding until its first interval, up to 43 min) would have held BTC/ETH protection for everyone | `8ec27a9`: only covered markets |
| Trade scope was proven only by an `mt:24` for a cancel of an order that doesn't exist, matched by `rq`, within 8 s | That shape was never observed live; a different one would refuse every real key at onboarding | `e119e4f`: admission (`mt:3` code 0) is the proof, as Perpl documents a 403 for Read keys |
| A refused or failed spare-margin add ended the deploy as failed with a 100-block cooldown | About 30 s past the line with no protection, at the worst moment | `b346dcb`: the episode continues next block as a trim |
| Trim push alerts said "Fee $0." and the public save report hard-coded "$0" | Public and phone copy understated live costs | `3c622cd`, `13165af`: the observed fee, or "unconfirmed" |
| Simulation shared one set of prices and one script across all accounts | On a public demo one visitor's wick moved everyone's BTC, a second wick stranded the first mid-path, a reset moved prices under other deploys | `f2db44d`: prices are per wallet; blocks stay shared |
| Paper accounts reused position ids 1 and 2 | After a reset or restart, earlier deploys re-attached to the fresh position: save values changed and a precaution became a "save" | `cf4f698`: ids are never reused |
| Simulation counted blocks from 1,000,000 on a local timer | Its block strip and deploy logs showed numbers nobody could look up | `9a3a532`: follows Monad testnet's heartbeat (Perpl's public stream, heartbeat only), local fallback while quiet ([ADR 0014](adr/0014-simulation-on-monad-blocks.md)) |
| Per-IP limits sized for live applied to simulation | A demo audience on one venue Wi-Fi would mostly be refused | `e8bc07f`: ten times looser in simulation, which calls nothing upstream |
| `pnpm dev:engine` set `ENGINE_MODE` inline, which `.env` can't override; `data/` was not ignored | Live settings in `.env` were silently ignored; the local database (sealed keys, sessions) was one `git add -A` from a commit | `6f7a4cd`, `5d6b854` |
| A replayed wick after a deploy stops short of the re-armed line and nothing fires | Correct, but looks broken in a demo | `cd39838`: the controls say why |

Also added: a keyless contract check (`666ba94`), `/health` reporting the simulation's clock
(`b6c351b`), a property test of the deploy state machine (`5cc7cbf`), a public demo config and
a demo-day runbook (`144ef71`), and documentation of what is verified (`fee893a`, `3cd7ffc`).

### Verification results

| Check | Result |
|---|---|
| `pnpm check` | Lint, typecheck, **176 tests in 18 files** pass. Every commit of this pass passes lint, typecheck and tests on its own. |
| Property test of the guard | 25 random scenarios in CI; **400 passed locally**: random adverse paths, partial and missed fills, refused adds, pause and resume, longs and shorts, every cap, fees on and off, three spare balances. Only same-side closes and adds leave, nothing while paused, size only shrinks, no deploy passes its cap, trims never spend spare. |
| `pnpm e2e` | 6 passed (Playwright + axe), local clock. |
| `pnpm build` | Production Next build passes. |
| Live engine on Perpl testnet, no key | Boots, `/ready` 200, one block behind Monad. A random key's trading sign-in is closed with 3401 and reported "rejected". |
| Real accounts | Lookups of seven real testnet wallets concurrently all succeed; the web's live connect page renders a market maker's eight real positions. |
| `pnpm --filter @airbag/spike check` | Airbag's side decoding, Q16 entry residue and decimals reproduce the contract's own `deltaPnlCNS` on 19 testnet positions in 8 markets and 37 mainnet positions in 10 markets, worst difference under $0.0001. |
| `getMarginFractions` | Maintenance is flat per market at any size tried (BTC 4%, ETH 5%), so the fixed-maintenance liquidation formula holds; it matches Perpl's current liquidation docs. |
| Simulation on Monad's clock | The full journey in a browser: trigger, fill one block later, re-add, save, on real testnet block numbers at the chain's cadence. |
| Testnet liquidation events | A scan of the most recent ~300,000+ testnet blocks found no `PositionLiquidated` event to compare liquidation prices against; HyperSync needs a token. Still open. |
| Gitleaks | Full history, 104 commits, no leaks. |

### Still open

Unchanged launch gates: a funded testnet trim and re-add (now one runbook away), independent
review, a deployed engine's egress allow-list and alerts, real push delivery, and the optional
log and indexer. Nothing was hosted, no contract was deployed and no order was sent to Perpl.
