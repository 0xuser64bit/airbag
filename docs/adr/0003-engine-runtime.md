# 0003. Engine: one always-on Node process, order-type allowlist in three layers

Date: 23 Sep 2026

## Context

The engine must evaluate every linked position every Monad block (~300 ms), act within a block, and never send anything that could open, increase or flip a position. Serverless can't hold websockets or react per block.

## Decision

- **One long-running Node 24 process** (`apps/engine`). One shared market-data WS (`market-state@<chain>`, `heartbeat@<chain>`, `funding@<chain>`, `market-config@<chain>`) and one trading WS per linked account (Perpl caps trading connections at 4 per wallet). Built on Node's global `WebSocket`; frames are read into a queue before processing so slow handlers can't trigger `1013` back-pressure closes.
- **Per-block tick** driven by `MarketState.at.b`. Positions whose price is older than `STALE_BLOCKS` (default 3) are not acted on and are flagged stale.
- **State in memory, facts in Postgres.** Positions come from Perpl's snapshots and updates, and are rebuilt on reconnect. Deploys, fills and saves are persisted.
- **Order-type allowlist, three layers:**
  1. *Types.* The only order-building functions produce `OrderRequest<AllowedOrderType>`, where `AllowedOrderType = 3 | 4 | 5 | 6`. There is no constructor for 1, 2 or 7.
  2. *Runtime.* `assertAllowed(frame)` runs immediately before `socket.send` and throws (and alerts) on any other `t`. A cancel (`t:5`) must reference an order id the engine itself placed.
  3. *Test.* A test enumerates every exported builder and asserts none can emit a disallowed type, and that `assertAllowed` rejects 0, 1, 2, 7 and unknown values.
- **Per-position lock**, strictly increasing `rq` seeded from `Account.lfr`, unique `sn` per frame. Outcomes are reconciled only from `mt: 24/25/27` and account updates, never from `mt: 3`.
- **Token bucket per connection** sized from the network's published limits, with pings counted.
- **Logs:** JSON lines to stdout from a small logger module (no dependency). Structured, no secrets: a redaction list covers `secret`, `api_key`, `signature` and `privateKey`. **Metrics:** detect → send → fill → re-add in blocks and ms per deploy. `/health` reports WS state, last block seen and lag.
- **Simulation mode** feeds a scripted mark-price path through the same tick function. **Demo mode** is a per-account flag with aggressive thresholds, off by default and labelled in the UI.
- **HTTP:** a small `node:http` server for `/health`, the key-link endpoint and SSE to the web app. A framework comes in only if routing grows past a handful of endpoints.

## Consequences

- A single process is a single point of failure. The landing page says so already ("If … Airbag's servers are down, nothing gets trimmed"). A resting Perpl trigger order as a backstop is logged as a later idea in RESEARCH.md.
- Horizontal scale later means sharding accounts across processes, each with its own egress IP on the key's allow-list (max 4 CIDRs per key).
