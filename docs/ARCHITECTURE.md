# Architecture

Airbag watches Perpl positions every Monad block and, when a position crosses its Airbag line, trims it with a reduce-only close and re-adds the released margin so the liquidation price moves away. Decisions behind each part are in `docs/adr/`.

## System

```mermaid
flowchart LR
  subgraph User["Trader's device"]
    B["Browser / PWA<br/>wallet (wagmi/viem)"]
  end

  subgraph Vercel
    W["apps/web<br/>Next.js App Router<br/>landing, onboarding, dashboard,<br/>save report + OG image"]
  end

  subgraph Fly["Fly.io · static egress IPv4"]
    E["apps/engine<br/>always-on Node 24<br/>per-block tick, allowlist,<br/>locks, reconciliation"]
    API["engine HTTP<br/>/health · key link · SIWE · SSE"]
    E --- API
  end

  DB[("Postgres (Neon)<br/>users, settings,<br/>encrypted keys, deploys, saves")]

  subgraph Perpl
    PR["REST /api/v1<br/>pub/context, history"]
    MD["WS market-data<br/>market-state, heartbeat,<br/>funding, market-config"]
    TR["WS trading<br/>snapshots, orders mt:22,<br/>updates mt:21/24/25/27"]
    FWD["order forwarder"]
  end

  subgraph Monad
    EX["Perpl Exchange contract"]
    LOG["AirbagLog contract"]
  end

  subgraph Envio
    IDX["indexer/ HyperIndex<br/>AirbagLog + PositionLiquidated"]
  end

  B -- "pages" --> W
  B -- "SIWE, key paste (TLS),<br/>settings, SSE" --> API
  W -- "server reads" --> DB
  API --> DB
  E -- "startup config" --> PR
  E -- "1 shared socket" --> MD
  E -- "1 socket per account<br/>(Ed25519 sign-in)" --> TR
  TR --> FWD --> EX
  E -- "recordDeploy / recordSave<br/>(hot wallet)" --> LOG
  IDX -- "HyperSync" --> EX
  IDX -- "HyperSync" --> LOG
  W -- "GraphQL" --> IDX
  E -- "Web Push (VAPID)" --> B
```

## Packages

| Path | What | Depends on |
|---|---|---|
| `packages/risk` | Pure risk math: equity, liquidation price, trigger line, trim sizing, spare-margin check, save classification. No I/O, no dependencies. Runs in the engine and in the browser. | nothing |
| `packages/perpl` | Typed Perpl client: context, frame types, Ed25519 signing (`node:crypto`), WS connections with heartbeat/`sn` tracking, scaled ↔ human conversion with safe rounding, **the order-type allowlist**. | `risk` (types only) |
| `apps/engine` | The always-on service (ADR 0003). | `risk`, `perpl`, DB schema |
| `apps/web` | Next.js site and app (ADR 0007). | `risk`, DB schema |
| `contracts/` | Foundry project, `AirbagLog` (ADR 0009). | — |
| `indexer/` | Envio HyperIndex project (ADR 0009). | contract ABIs |
| `spike/` | M0 scripts that exercise Perpl testnet end to end. Deleted or folded into the engine after M1. | `perpl`, `risk` |

Directories are created in the milestone that needs them.

## The engine's per-block loop

```mermaid
sequenceDiagram
  autonumber
  participant MD as Perpl market-data WS
  participant E as Engine
  participant TR as Perpl trading WS
  participant EX as Exchange (Monad)
  participant L as AirbagLog

  MD->>E: market-state (mark, at.b = block k)
  E->>E: stale guard: block k within STALE_BLOCKS of head?
  E->>E: for each armed position: equity(mark) ≤ Q ?
  Note over E: trigger at block k (per-position lock taken)
  alt spare balance alone reaches target
    E->>TR: mt:22 t:6 IncreasePositionCollateral (smallest sufficient amount)
  else trim
    E->>TR: mt:22 t:3/4 Close, IOC, worst price 0.5% from mark, sn, rq
    TR-->>E: mt:3 code 0 (accepted only)
    EX-->>TR: fill
    TR-->>E: mt:25 fill, mt:27 position (smaller, deposit pro-rata), mt:21 balance
    E->>TR: mt:22 t:6 re-add released equity (from balance delta)
    TR-->>E: mt:27 position (deposit restored), mt:21 balance
  end
  E->>E: re-arm: reference = fill price, new line, release lock
  E->>L: recordDeploy(...) (async, never blocks protection)
  E-->>E: push notification, SSE to dashboard
```

Partial fill: re-add what was released, recompute, retry next block with the remainder, up to a small cap, then alert.

## Invariants (enforced in code, tested)

1. The engine only sends order types **3, 4, 6** and **5** (cancel of its own orders). Enforced by type, by a runtime assert before `send`, and by a test (ADR 0003).
2. Never act on a price older than `STALE_BLOCKS` blocks.
3. One deploy in flight per position. `rq` strictly increasing per account.
4. Outcomes come from `mt: 21/24/25/27`, never from `mt: 3`.
5. The API secret is decrypted only in engine memory and never logged or returned (ADR 0006).

## Networks

Everything network-specific (URLs, chain id, exchange and collateral addresses, market ids, decimals, margins, `order_ttl_blocks`) comes from `GET /api/v1/pub/context` at startup. Env vars only pick the network and override URLs. See `.env.example`.
