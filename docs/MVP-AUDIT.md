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

Completion and validation results will be recorded here after the second audit.
