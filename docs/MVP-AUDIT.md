# MVP audit and implementation backlog

> Historical record. The per-pass verification counts below are snapshots from each pass date;
> current counts live in [SUBMISSION.md](SUBMISSION.md) ("How it's built") and are asserted by
> `pnpm test`, `pnpm e2e` and `pnpm contracts:test`.

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
| `pnpm check` | Lint, typecheck, **178 tests in 18 files** pass (from 162 in 16). Every commit of this pass passes lint, typecheck and tests on its own. |
| Property test of the guard | 25 random scenarios in CI; **400 passed locally**: random adverse paths, partial and missed fills, refused adds, pause and resume, longs and shorts, every cap, fees on and off, three spare balances. Only same-side closes and adds leave, nothing while paused, size only shrinks, no deploy passes its cap, trims never spend spare. |
| `pnpm e2e` | 6 passed (Playwright + axe), local clock. |
| `pnpm build` | Production Next build passes. |
| Live engine on Perpl testnet, no key | Boots, `/ready` 200, one block behind Monad. A random key's trading sign-in is closed with 3401 and reported "rejected". |
| Real accounts | Lookups of seven real testnet wallets concurrently all succeed; the web's live connect page renders a market maker's eight real positions. |
| `pnpm --filter @airbag/spike check` | Airbag's side decoding, Q16 entry residue and decimals reproduce the contract's own `deltaPnlCNS` on 19 testnet positions in 8 markets and 37 mainnet positions in 10 markets, worst difference under $0.0001. Rerun with automatic account discovery: 45 testnet and 43 mainnet positions. Extended to the guard's own `toRiskPosition`, funding included: 45 testnet and 42 mainnet positions within $0.000001. |
| `getMarginFractions` | Maintenance is flat per market at any size tried (BTC 4%, ETH 5%), so the fixed-maintenance liquidation formula holds; it matches Perpl's current liquidation docs. |
| Simulation on Monad's clock | The full journey in a browser: trigger, fill one block later, re-add, save, on real testnet block numbers at the chain's cadence. |
| Liquidations | Testnet had none in its latest ~400,000 blocks. Mainnet had 160 in 3,000,000 blocks: in all 159 full ones Perpl liquidated only once the mark had reached the liquidation price Airbag computes for the position (median 0.03% past), and the trader received exactly 80% of the remaining equity, as save reports assume (`spike liquidations`). |
| Gitleaks | Full history, 104 commits, no leaks. |

### Still open

Unchanged launch gates: a funded testnet trim and re-add (now one runbook away), independent
review, a deployed engine's egress allow-list and alerts, real push delivery, and the optional
log and indexer. No contract was deployed and no order was sent to Perpl. The simulation demo was
then hosted on the owner's free VM at https://airbag.user64bit.world
([ADR 0015](adr/0015-free-shared-vm.md)), deployed with `deploy/vm/deploy.sh` and checked end to
end over HTTPS: a deploy and its save on live Monad testnet blocks, the save report and its share
image, and the other sites on the VM left as they were.

## Fourth pass: the product as a visitor meets it (2026-10-02)

Baseline `c0eea45`, clean tree, 178 tests passing. Method: run the simulation on Monad testnet's
clock with the web app and walk every page in Chrome at 390, 1000, 1440 and 1920 px, from the
landing through a deploy, a save and sharing it; act on the owner's list (the FAQ's width, one
layout for every page, a loader, a share button that does nothing); then read the engine wherever
a screen looked wrong.

### Findings and fixes

| Finding | Effect | Fix |
|---|---|---|
| "Share save card" called `navigator.share`, which desktop Chrome and Brave expose and then never resolve on macOS | The button looked dead: no sheet, no copied link, no error | `6f6353b`: a dialog with the card itself, Post on X, Copy link, Download PNG; phones also get their share sheet with the PNG |
| Each page had its own skeleton: connect a centred 720 px column, link-key and setup full-bleed with differently sized asides, settings and deploys left-aligned at three widths, the save report centred at 1120 px | The mark and every left edge moved between pages | `01ac385`: one 1280 px column for every page, padded in by `--inset`, and one main-plus-side-bay layout with the rule in the same place; `892072a`, `70bc251` for the deploy log and the FAQ |
| No loader; link-key drew the paste form for a moment to traders who had already linked a key | Blank or wrong states while the engine answered | `253b5cb`: the crash-test mark, its quadrants turning a quarter at a time, for every wait |
| "Play a wick on ETH" bottomed at $2,820, above ETH's Airbag line at $2,775; a second BTC wick stopped short of the re-armed line | Half the demo did nothing, with advice to reset that didn't help | `5e58931`: the engine shapes each wick to the position, through its own line to its own liquidation price and back |
| A save's value subtracted only its own deploy's spare margin | When a falling price drew a second spare-margin add to the same position, the first save counted the trader's own money as kept: the ETH demo's first report showed $1,377, not $1,080 | `d74ca7d`: every spare add on the position from that deploy on is subtracted; a guard test pins it |
| The settings preview's fee row was the literal "$0" | Understated live costs next to a plan that already netted them out | `25426ba`: the planned close's estimated taker fee |
| The share image's comma ran into "kept versus a liquidation"; the site had no share image; simulated saves weren't labelled in link previews | Unfinished-looking shares | `ff6fd1e`, `446cfaf`, `6f6353b` |
| The Simulation banner arrived after a browser fetch | Every onboarding and app page dropped 37 px after it painted | `3fa25c4`: the layouts read the engine's mode on the server |
| The wick controls sat below the fold; the landing never said the demo needs no wallet | A visitor couldn't find the one button that shows Airbag work | `d08ddb5`, `164f76f` |
| The landing never said why Airbag needs Monad | The hackathon's question went unanswered on the site | `8efcc70`: a section with a dated simulated deploy on Monad testnet's own blocks, each linked to MonadVision, and the measured 303 ms block time |
| On a phone the wick controls sat ~1,950 px down; a margin save's path read "Margin added by Airbag $1,320" when $105 went in | | `6bb8da9`, `491f823` |
| Smaller: every app page titled "Positions"; link-key's Back orphaned and its checkbox yellow; no way back from your own save report; push enabled on a server with no VAPID key | | `029d427`, `3d8e966`, `03696ef`, `23aa140` |

Also recorded: Perpl testnet's market-data socket sometimes closes every client at once with
`1008 ping timeout`, pinging or not (`1ddac76`, [PERPL.md](PERPL.md)); the feed's reconnect
handles it.

### Verification results

| Check | Result |
|---|---|
| `pnpm check` | Lint, typecheck, **181 tests in 18 files** pass (from 178): the wick's shape for longs, shorts and off-tick levels; ETH's spare-margin save and a re-armed BTC's second save over HTTP; the save value with a later spare add. |
| `pnpm e2e` | 6 passed (Playwright + axe), now also the share dialog (copy, download, the X intent, axe) and the site's share image. |
| `pnpm build` | Production Next build passes; onboarding and app pages prerender with the simulation label. |
| Browser | Every page at 390, 1000, 1440 and 1920 px: the mark and content edges line up across pages, no horizontal scroll. The share dialog in Chrome on desktop and as a touch phone. |

### Still open

Unchanged: a funded testnet trim and re-add, independent review, the deployed engine's egress
allow-list and alerts, and the optional log and indexer. Nothing was sent to Perpl.

After the pass, with the owner's go-ahead, it was pushed and deployed to the demo, and push alerts
were turned on there: VAPID keys generated on the VM, `65b8e1c` (the toggle acts on this browser,
at once) and `2e8e725` (a simulation's alerts say so). Checked on the live site in Chrome through
Google's push service: the trim and save alerts arrive about 1.5 s after the deploy, with no push
errors in the engine log. Not checked: delivery to phones, Firefox and Safari's push services.

## Fifth pass: evidence from the chain (2026-10-04)

Baseline `0e37b67`, clean tree, 181 tests passing. Method: read the whole product again and ask
what a skeptical judge or trader would need to believe it works without a funded live run. The
answer was evidence from Perpl's own chain data, a contract that checks Airbag instead of
trusting it, and a demo that shows the failure Airbag prevents as well as the save. Building the
evidence surfaced real bugs, fixed first.

### Findings and fixes

| Finding | Effect | Fix |
|---|---|---|
| If Perpl liquidated a position (or the trader closed it) while Airbag's close was in flight, the guard read the vanished lots as its own fill | A 'done' deploy with a whole-position close it never made; live code, found by the property test once the paper exchange could liquidate | `0428bc8`: only what Perpl reports the order filled is Airbag's; a position gone with nothing filled ends the deploy as failed |
| The paper exchange never liquidated anything | A paused position rode a wick far past its liquidation price and stayed open, so the demo could only show the happy path | `76f8d08`: it liquidates at the liquidation price before settling the block's orders, returning 80% of what's left; `2b467fb`, `05370f5`: the dashboard and a push alert say so |
| A line or liquidation price computed in float64 sits a hair off the price it prints as | A 500,000 MON short's line is $0.0366, but equity there computed as $4,700.000000000001 against a $4,700 trigger: at $0.0366 nothing fired; a property test finds it on generated positions | `f24eca8`: a billionth, relative, counts as reached |
| The sim reset cleared references for two hard-coded market ids; deploy summaries and push alerts wrote a whole-lot market's sizes with three decimals; a short's wick note said 'down' | Found adding a third market | `6baa30e` |
| AirbagLog stored whatever the hot wallet sent | Every onchain number was Airbag's word | `9c3a93d`, `d11a4a9`: it reads Perpl's Exchange for each deploy's after-state and lets anyone prove a save against Perpl's mark ([ADR 0016](adr/0016-airbaglog-reads-perpl.md)) |

### What was added

- **The backtest** (`5c29f7a`, `6c7e8ae`, `4eb781e`, `1d2cfa1`, `9b4a89a`): `apps/engine/src/replay.ts`
  runs a recorded mark path through the production engine on a paper exchange; `spike/backtest.ts`
  feeds it every full Perpl mainnet liquidation of 6,000,000 blocks with the marks Perpl published,
  plus a paused control that must liquidate where Perpl did. `/backtest` shows the result and a page
  per liquidation. Method and limits: [RISK-MODEL.md](RISK-MODEL.md#backtest-on-perpls-own-liquidations).
- **The live radar** (`37db792`, `6164025`): the landing reads every open Perpl mainnet position
  from the contract every few minutes and says how many are past the line where Airbag would
  already have trimmed them.
- **The demo's third path** (`6baa30e`): a MON short, Monad's own token, trimmed through a line
  above the mark; MON is covered by default.
- **The landing** (`7427cab`, `77bdb7c`) points at all of it, and 'Why Monad' says what the chain
  makes checkable.

### Verification results

| Check | Result |
|---|---|
| `pnpm check` | Lint, typecheck, **193 tests in 19 files** (from 181), every commit of the pass passing on its own |
| `pnpm e2e` | **8 passed** (from 6): now also the backtest pages and their share image, and the paused wick that liquidates and resets |
| `pnpm build` | Passes; 386 static pages, 369 of them one per replayed liquidation |
| Contracts | **14 passed** natively (Foundry 1.5.1; Docker Desktop wasn't answering). The fork test against Perpl's real mainnet Exchange: on 20 open positions in BTC, MON, ETH, SOL and ZEC, `liquidationPrice` puts equity at the maintenance margin by Perpl's own accounting, within a tick |
| Indexer | Codegen and **3 handler tests** pass; the contract still emits the events it indexes |
| Backtest, mainnet to block 110,298,004 | 369 of 372 full liquidations replayed: Airbag deployed first in all 369 (median 50 min ahead, 10th percentile 6 min); 363 still open at Perpl's liquidation, none liquidated in the day after; 6 single lots untrimmable within the 50% cap. $35,244 on the Airbag path at those blocks against the $19,629 the liquidations returned. The paused control liquidated all 369 at or before Perpl did, a median 3 blocks early |
| Live radar, 2026-10-04 04:17 UTC | 705 open positions on Perpl mainnet; 40, worth $215,046, past their Balanced line from entry; 136 within 5% of liquidation |

### Still open

Unchanged: a funded testnet trim and re-add, independent review, the deployed engine's egress
allow-list and alerts, real push delivery to phones. Nothing was sent to Perpl in this pass.
After it, with the owner's go-ahead and a deployer they funded, AirbagLog was deployed on
Monad testnet at `0x52259e30d3687691F663033922472B43120276F7`; its `liquidationPrice` agreed with the risk package
to the tick on 16 of 16 real testnet positions. The live engine writes to it once it trades.

## Sixth pass: the cost side and a real trim (2026-10-10)

- **The backtest's other side** (`spike/false-alarms.ts`): of 601,810 positions opened in the
  backtest's window, 557 crossed their line first and Perpl liquidated 137. The trims cost $860 on
  398 precautions (median −2.2% of margin) and kept $1,168 on 114 liquidations (median +20.3%).
- **Public RPC limits moved:** rpc1.monad.xyz now caps `eth_getLogs` at 100 blocks, which broke the
  documented rerun commands; they use rpc2 (`59f142d`).
- **Launch gate, partly met:** a real `t:3` close and `t:6` re-add on Perpl testnet with a Trade
  key ([DEPLOY.md](DEPLOY.md#first-real-trim-on-perpl-testnet-2026-10-10)). The close alone left
  liquidation unchanged and the re-add moved it, so ADR 0002 holds on a real fill. Then the
  engine's own live deploy: Trade-scope probe at link, a trigger on a real mark move, close and
  re-add, an AirbagLog record ([DEPLOY.md](DEPLOY.md#the-engines-first-live-deploy-2026-10-10)).
  It found that Perpl reports an executed `t:6` as failed with `sr: 32` (`516d1f4`) and that
  txids lack `0x` (`029e439`); the scope probe's refusal message hid Perpl's reason (`c15d432`).
  Still open: independent review, egress allow-list and alerts, mainnet.
