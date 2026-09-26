# Perpl integration reference

Everything here was read from Perpl's own docs or measured against live endpoints, with the source
named. It is the reference for `packages/perpl` and for anyone changing the engine's exchange
layer. **Read it before changing the protocol code**: most of it is not guessable from the types.

Endpoint measurements below are historical research, not a fresh execution proof. Re-check live
context and a funded disposable account before launch. The 2026-09-27 audit re-read the current
official API documentation and corrected fee handling; old zero-fee assumptions are obsolete.

Sources: Perpl `api-docs` (README, `authentication.md`, `websocket.md`, `rest-endpoints.md`,
`types.md`, `integrations.md`), [docs.perpl.xyz](https://docs.perpl.xyz) (margin, liquidation,
insurance and ADL, funding), `PerplFoundation/dex-sdk` (`state/position.rs`, bundled `Exchange.json`),
[docs.monad.xyz](https://docs.monad.xyz), [docs.envio.dev](https://docs.envio.dev).

## Networks

| | Mainnet | Testnet |
|---|---|---|
| REST | `https://app.perpl.xyz/api` | `https://testnet.perpl.xyz/api` |
| WS base | `wss://app.perpl.xyz` | `wss://testnet.perpl.xyz` |
| Chain id | 143 | 10143 |
| RPC | `https://rpc.monad.xyz` | `https://testnet-rpc.monad.xyz` |
| Exchange | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` |
| Collateral | AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` (6 dp) | AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` (6 dp) |
| Markets | BTC 1, MON 10, ETH 20, SOL 31, HYPE 40, ZEC 50, LIT 60, PUMP 90 | BTC 16, ETH 32, SOL 48, MON 64, ZEC 256, LIT 272, PUMP 320 |

The api-docs README's testnet collateral address is stale; the live context is correct. Read
everything network-specific from `GET /api/v1/pub/context` at startup anyway
(`packages/perpl/src/networks.ts` holds the defaults, `.env.example` the overrides) and apply
`market-config` updates as they arrive. **Never hard-code market ids, decimals, margins or
`order_ttl_blocks`.**

`config.maintenance_margin` is **leverage in hundredths** (2500 = 25x = 4%), not a percentage, so
`r = 100 / maintenance_margin`. Mainnet today: BTC 4%, ETH 5%, SOL 5%, MON 5%, HYPE 5%, ZEC 5.56%,
LIT 10%, PUMP 10%. Testnet differs (MON 20%, ZEC 10%).

## Three things a key needs

1. **An API key** — an Ed25519 keypair with scopes `1` read, `2` trade (implies read). Created in
   Perpl's UI at `/apikeys`, or enrolled programmatically with an EIP-712 wallet signature plus a
   proof of possession. **Withdrawals and transfers out are never possible through an API key,
   whatever the scope** — that is the basis of Airbag's whole safety model. Keys can carry an IP
   allow-list (up to 4 CIDRs) and an expiry; max 16 active keys per profile. Listing and revoking
   are UI-only.
2. **An exchange account** — onchain, `createAccount(uint256)`, read back with
   `getAccountByAddr(address)`.
3. **Order forwarding on** — `allowOrderForwarding(true)`, called from the account's own wallet,
   shown as "One-Click Trading" in Perpl's UI. It is **off** on new accounts. Without it every
   order is acknowledged with `code: 0` and then fails on `mt:24` with `sr: 34`. The only place its
   state is visible is `Account.fw` on the trading WS, so onboarding and key health must check it.

## The gotchas

These are the ones that have cost real time. Each is enforced or tested somewhere in the code.

- **A reduce-only close does not move the liquidation price.** Perpl releases the deposit pro-rata
  on a decrease (verified on 400 `PositionDecreased` events per network) and settles realized PnL
  to the account balance, so the trim alone changes nothing. A deploy must close and then re-add the
  released equity. See [RISK-MODEL.md](RISK-MODEL.md).
- **Side encodings differ.** The trading WS uses `sd` 1 = long, 2 = short. The contract's
  `PositionEnum`, returned by `getPositionV2`, is 0 = long, 1 = short, and "no position" is
  `lotLNS == 0`. Only `packages/perpl/src/chain.ts` reads the onchain encoding; conflating the two
  silently drops a position and can flip a short into a long.
- **`mt:3 code 0` means accepted for forwarding, not filled.** Reconcile from `mt:21` (account),
  `mt:24` (order update), `mt:25` (fills) and `mt:27` (positions).
- **Every `mt:22` needs a unique non-zero `sn`.** `mt:3` echoes it as `cid`; without it acks cannot
  be matched to orders.
- **Seed `rq` from `Account.lfr`:** `rq = max(local, lfr) + 1`, strictly increasing per account.
  `sr: 32` means retry once with a new `rq`.
- **Entry price carries a Q16 residue.** `Position.ep` is rounded (ceil for longs, floor for shorts)
  and `epr` holds the remainder. Effective long entry is `(ep − 1 + epr/65536) / 10^pd` when
  `epr > 0`. Without it the liquidation price is off by a few dollars.
- **Premium PnL comes from funding sums, not a field:**
  `premium = −s · (fundingSum_now − efs) · size / (div · 10^pd)` with
  `div = 10^funding_sum_scaling_exp`. Funding is realized on every size change. If the funding
  seed fails at boot, the live engine refuses to start. It also refuses to act until a funding
  event valid at the current head is known.
- **The idle timeout is 5 s on mainnet, 10 s on testnet, and applies before sign-in too.** Send
  `mt:29` immediately on open.
- **Four trading connections per wallet**, shared with the user's own browser tabs. The engine needs
  one; if the user has four Perpl tabs open, ours is refused. Surface it in key health.
- **There is no key-introspection endpoint.** Scope and IP allow-list cannot be read back. Scope is
  probed at link time with a high safe uint64 order id outside the open-order snapshot (a read key is
  refused with 403 at the gateway). The IP lock cannot be checked from here, so the UI says what was
  checked and asks the user to confirm the rest.
- **Closes have fees.** Current [API fee documentation](https://github.com/PerplFoundation/api-docs/blob/main/README.md#fees--fee-tiers)
  charges on size added and removed. Taker rates are micros, selected by `Account.ft`, with a base
  fallback. `Order.f` is the gross observed fee; never add builder fees a second time. Airbag
  does not request a builder fee. The risk model sizes trims after estimated taker fees and
  re-adds the net released collateral. The landing replay is explicitly a zero-fee simulation.

## Order frame (`mt:22`)

| Field | Meaning |
|---|---|
| `sn` | unique non-zero frame id, echoed as `cid` |
| `rq` | strictly increasing idempotency key, seeded from `Account.lfr` |
| `mkt`, `acc` | market and account |
| `t` | order type: 1 OpenLong, 2 OpenShort, **3 CloseLong, 4 CloseShort**, 5 Cancel, **6 IncreasePositionCollateral**, 7 Change |
| `p` | 0 = market |
| `s` | scaled size |
| `ms` | max slippage, bps |
| `fl` | 0 GTC, 1 PostOnly, 2 FOK, **4 IOC** |
| `lv` | leverage in hundredths |
| `lb` | last execution block: `head < lb ≤ head + order_ttl_blocks` (20 on every market today), or `0` for the server's maximum window |
| `a` | amount, for collateral orders |
| `bf` | optional builder fee |

A "market" order is a marketable limit IOC bounded by the slippage limit; it can fill partly or
not at all on a thin book. `Close*` orders are reduce-only and clamped to the position size by the
exchange, so they cannot flip a position, and `mnp` (max negative-PnL collateralization) never
applies to reducing fills. `order_max_market_slippage_bps` is 100 (1%) on mainnet and 1000 on testnet
BTC/ETH/SOL, so the default 0.5% worst price fits both.

Airbag's allowlist is only 3, 4, 6 and 5 ([ADR 0003](adr/0003-engine-runtime.md)). Closes are IOC,
so there is never a resting order to cancel; the single cancel is the link-time scope probe.

## Sockets, heartbeats and rate limits

**Trading WS** `…/ws/v1/trading`. Sign in with `mt:29` (chain id, api key, timestamp, nonce, and
an Ed25519 signature over `<chain_id>\ntrading-ws-signin\n<timestamp_ms>\n<nonce>`). Snapshots and
updates: WalletSnapshot `mt:19`, AccountUpdate `mt:21`, command status `mt:3`, OrdersSnapshot
`mt:23`, OrdersUpdate `mt:24`, FillsUpdate `mt:25`, PositionsSnapshot `mt:26`, PositionsUpdate
`mt:27`, heartbeat `mt:100` (`{sn, h}`, the head block).

`sn` must be strictly +1 from the WalletSnapshot's value; a gap means reconnect and resnapshot.
Ping `{mt:1, t:Date.now()}` every ~30 s. Limits: 60 req/min on testnet, 120 on mainnet, 4
connections per wallet. Exceeding the request rate closes the socket with code 1008 and silently
drops anything in flight.

**Market-data WS** `…/ws/v1/market-data`: 10 req/min, 16 subscriptions per connection, no pings.
Streams `heartbeat@<chain>` (every block), `market-state@<chain>`, `funding@<chain>`,
`market-config@<chain>`, `gas-stats@<chain>`, plus `order-book@<mkt>` and `trades@<mkt>`.

`MarketState.at.b` is the block at which that market last changed. It is **not** a freshness signal
on its own: the mark does not move every block.

## Measured cadence

`spike/measure.ts`, 60 s per network, plus `MarkUpdated` logs over 6,000 blocks (~30 min):

| | Testnet | Mainnet |
|---|---|---|
| Monad block time | 303 ms | 303 ms |
| Monad `newHeads` arrival p50 / p95 | 301 / 405 ms | 306 / 469 ms |
| Perpl `heartbeat` | every block, no `sn` gaps | every block, no `sn` gaps |
| `market-state` messages per block | 0.66 (largest skip 4 blocks) | 0.92 (largest skip 2) |
| `market-state` for block b after Monad's `newHeads` for b, p50 / p95 | 177 / 353 ms | 335 / 496 ms |
| Blocks behind head on arrival, p95 / max | 1 / 1 | 1 / 2 |
| BTC `MarkUpdated` in 30 min | 76 | 76 |
| Gap between mark updates p50 / p90 / max (blocks) | 1 / 167 / 169 | 1 / 168 / 169 |
| Mark step size p90 / max | 0.033% / 0.057% | 0.028% / 0.056% |

What follows from it:

- **The mark moves in small steps, roughly 0.03–0.06% or at most every ~169 blocks (~51 s)**, often
  in back-to-back pairs. Airbag checks every block, but the number it checks changes a few times a
  minute.
- **The stale guard must measure feed lag, not mark age.** An unchanged mark is legitimately ~169
  blocks old. Compare the latest heartbeat head (and Monad's head) with the newest block the market
  data has caught up to.
- Perpl's price feed runs about one block (200–350 ms) behind Monad's head: mark lands in block k,
  we see it around k+1, the close is forwarded around k+2.
- The liquidation split was confirmed onchain: `getLiquidationInfo(perpId)` returns
  80,000/10,000/10,000 per 100k on every market on both networks.

## Margin, funding and stops

- Isolated margin only. Each position carries its own margin; initial margin is dynamic and can rise
  for large positions or high volatility. Liquidation triggers on the **mark price**. Partial
  liquidations happen, and large ones can be bought by the PLP vault.
- Funding accrues every 8,571 blocks, which `funding_interval_sec` puts at **2,580 s (43 min)** at
  300 ms blocks (Perpl's docs say "about hourly" because they assume 0.42 s blocks). It settles
  virtually through a cumulative funding product sum, which is why premium PnL has to be in equity.
- Stops are **not native contract operations**, but the API has trigger orders (`tp`/`tpc`, including
  mark-price conditions) that Perpl's forwarder executes, and the UI offers SL/TP. A stop closes a
  fixed size at a fixed price; Airbag sizes each trim to a liquidation-distance target, re-adds the
  margin and re-arms. Parking a reduce-only Perpl trigger order just above liquidation as a backstop
  for when the engine is down is a reasonable future move and is not built.
- Builder codes (a later revenue path) are bound at key enrollment, are capped at 0.1%, and only
  apply to size that opens or increases a position. Trims earn nothing. Not implemented.

## Monad and Envio

- Mainnet runs 300 ms blocks with 2-slot finality. WS subscriptions: `newHeads`, `logs`, and the
  `monad*` variants that add `blockId` and `commitState` (`Proposed → Voted → Finalized → Verified`);
  blocks can be abandoned. Public endpoints: `wss://rpc.monad.xyz`, `wss://testnet-rpc.monad.xyz`
  (QuickNode, 50 rps), `wss://rpc-testnet.monadinfra.com` (20 rps). Use a provider plan in
  production. MonadVision and Monadscan are both official explorers.
- Envio HyperIndex supports Monad over HyperSync (`https://143.hypersync.xyz`,
  `https://10143.hypersync.xyz`). The Perpl exchange ABI is not verified on explorers, but
  `dex-sdk` (MIT) ships `crates/sdk/abi/dex/Exchange.json` including `PositionLiquidated`, so
  Perpl liquidations can be indexed. Airbag's own log is always indexable
  ([ADR 0009](adr/0009-onchain-log-and-indexer.md)).

## Open against a live account

`t:6` takes its amount in `a` as a string and the docs do not say whether that is a scaled CNS
integer or a decimal. Airbag sends the CNS integer string, as `spike/deploy.ts` does. This is
unverified until the testnet run in [DEPLOY.md](DEPLOY.md) executes.
