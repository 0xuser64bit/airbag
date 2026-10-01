# 0012. One exchange port, a paper exchange, and simulation mode

> **Amended by [0014](0014-simulation-on-monad-blocks.md):** simulation's blocks follow Monad
> testnet's real heartbeat, with the local clock as a fallback; prices are per wallet.

Date: 23 Sep 2026

## Context

The deploy logic (close, re-add, retry, re-arm, save) is the product, and it could not be run end
to end without a funded Perpl account and a key. The brief also asks for a simulation mode that
plays the landing page's price path through the same engine code (§5).

## Decision

- The guard trades through an `Exchange` port: the members of `TradingClient` it uses (state,
  account, positions, open orders, head, `submit`). `TradingClient` is the live adapter.
- `PaperExchange` is the other adapter. It enforces the same order-type allowlist and mimics what
  matters on Perpl: IOC closes fill at the mark within the limit on a later block, the deposit
  shrinks pro-rata, the closed part's equity settles to the free balance, `t:6` moves free balance
  into the position.
- `ENGINE_MODE=simulation` runs the real engine, guard, API and web app on paper accounts seeded
  with the design's sample positions, driven by `SimChain`: a block clock and scripted marks. The
  API adds simulation-only controls (play the landing wick, set a price, reset) that 404 in live
  mode. Every screen says it's a simulation; no transaction hashes are invented.

## Consequences

- The landing page's crash test runs through the real engine in a unit test: trigger at block 14,
  fill at 15, re-arm at ~$92,150, save at 21.
- CI exercises the whole product in a browser (Playwright) without secrets or funds.
- The paper exchange is a model. What it can't show (real book depth, forwarding latency, the
  `t:6` amount format, Perpl's order status sequence for IOC closes) is exactly what the M0 gate
  on testnet has to confirm.
