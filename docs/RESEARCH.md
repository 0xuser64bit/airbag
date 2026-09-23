# Research notes

Checked 23 Sep 2026 against live sources. Each item says what the brief claimed, what I found, and where. Anything still open is an M0 task in `docs/STATUS.md`.

Sources read in full: Perpl `api-docs` (README, authentication, websocket, types, integrations, rest-endpoints), docs.perpl.xyz (margin, liquidation, insurance and ADL, funding), `PerplFoundation/dex-sdk` (position state, exchange event handling, bundled ABI), PerplBot (README, SDK layout), Monad docs (current facts, testnet network info), Envio supported-networks table, Fly.io egress IP docs. Live data: `GET /api/v1/pub/context` on both networks, and `PositionDecreased` logs read over RPC.

## 1. The finding that changes the design

**A reduce-only close on Perpl does not move the liquidation price by itself.**

When a position is decreased, Perpl shrinks the position's deposit pro-rata to its size and settles the realized PnL against the account balance. I read `PositionDecreased(startDepositCNS, endDepositCNS, startLotLNS, endLotLNS, …)` events from the exchange contract:

| Network | Samples | Decreases over 20% | Max deviation of `endDeposit` from `startDeposit × endLot / startLot` |
|---|---|---|---|
| Testnet | 400 | 1 | < 1 CNS (rounding) |
| Mainnet | 400 | 122 | < 1 CNS (rounding) |

With deposit `s·M` on size `s·n`, the long liquidation price is `E − (sM + sF − m·s·n)/(s·n) = E − (M + F − m·n)/n`, which is unchanged. The released collateral (net of the realized loss) lands in the account's free balance.

The brief's math (liquidation $94,000 → $87,300) assumes the position keeps its whole deposit after the trim. That holds only if Airbag **re-adds the released equity to the position** with `IncreasePositionCollateral` (`t: 6`) right after the close fills. Released equity is `(1 − s) · equity(P_fill)`. Adding it back leaves the position's equity at the fill price unchanged (`Q`), so every golden vector in the brief still holds for the two-step deploy:

1. `CloseLong`/`CloseShort` IOC for `(1 − s)·n` (fee-free).
2. `IncreasePositionCollateral` for the released equity, read from the account update rather than computed.

Consequences:
- `t: 6` with a Trade-scoped key is no longer a nice-to-have for the spare-margin feature. **Without it, the product premise fails.** M0 must prove it.
- A deploy is two orders, usually in consecutive blocks. The design's timeline ("Filled at $97,000 … Re-armed at $92,150") gets one more row for the margin re-add.
- Rate budget per deploy doubles (still far under 60/min).

Brief section 4 is updated to say this.

## 2. Items marked "verify" in the brief

| # | Brief claim | Finding | Source |
|---|---|---|---|
| 1 | Maintenance per unit `m = r · E` (entry notional) | **Confirmed.** `C_MMR = P_entry · L / MMF`. The SDK computes `entry_price × size / maintenance_margin`. | docs.perpl.xyz/exchange/liquidation; dex-sdk `state/position.rs` |
| 2 | `F` sign: positive = received | **Confirmed.** `C_Funding` is the position's premium PnL; the SDK's `liquidation_price` is `E + s·(MMR − deposit − premium_pnl)/size`. Positive funding rate means longs pay. | dex-sdk `state/position.rs` (`apply_funding_payment`) |
| 3 | Testnet collateral `0xa9012a…22dC` vs api-docs README | **Brief is right.** Live context: AUSD `0xa9012a055bd4e0edff8ce09f960291c09d5322dc`, 6 dp. The api-docs README's `0xdf5b71…` is stale. Read it from context at runtime anyway. | `GET testnet.perpl.xyz/api/v1/pub/context` |
| 4 | Market IDs | **Correct but incomplete.** Both networks now also list LIT and PUMP. Mainnet: BTC 1, MON 10, ETH 20, SOL 31, HYPE 40, ZEC 50, LIT 60, PUMP 90. Testnet: BTC 16, ETH 32, SOL 48, MON 64, ZEC 256, LIT 272, PUMP 320. | live context |
| 5 | Maintenance margins | `config.maintenance_margin` is **leverage in hundredths** (2500 → 25x → 4%), not a percentage. Mainnet today: BTC 4%, ETH 5%, SOL 5%, MON 5%, HYPE 5%, **ZEC 5.56% (1800)**, LIT 10%, PUMP 10%. The docs' ZEC "~6.7%" is out of date. **Testnet differs:** MON 20%, ZEC 10%. | live context |
| 6 | Funding every 8,571 blocks, "about hourly" | 8,571 blocks is Perpl's grid, but `funding_interval_sec` is **2,580 s (43 min)** at 300 ms blocks. The docs' "hourly" assumes 0.42 s blocks. | live context; docs.perpl.xyz/exchange/funding |
| 7 | Monad public WS URLs aren't listed | **They are now:** `wss://rpc.monad.xyz`, `wss://testnet-rpc.monad.xyz`, `wss://rpc-testnet.monadinfra.com` (20 rps). QuickNode public testnet is 50 rps. | docs.monad.xyz/ai/current-facts, /developer-essentials/testnet |
| 8 | 300 ms mainnet blocks | **Confirmed by Monad:** mean 302 ms in Sep 2026, finality 2 slots (600 ms). Testnet measured in M0. | docs.monad.xyz/ai/current-facts |
| 9 | Perpl ABI isn't public | **It is.** `dex-sdk` (MIT) ships `crates/sdk/abi/dex/Exchange.json` with `PositionLiquidated`, `PositionDecreased`, `IncreasePositionCollateral`, `getPosition(V2)`, `getLiquidationInfo`. Envio can index Perpl liquidations for the real landing-page stat. | dex-sdk repo |
| 10 | Envio supports Monad | **Confirmed.** HyperSync endpoints `https://143.hypersync.xyz` and `https://10143.hypersync.xyz`. | docs.envio.dev supported networks |
| 11 | Hackathon rules | **Not verifiable by me.** Needs the owner to read the dashboard. | — |
| 12 | Explorers | Both MonadVision and Monadscan are official. Perpl's context lists Monadscan. The design copy says MonadVision, so we link there and keep the base URL in config. | Monad docs; live context |

## 3. Other things the brief doesn't say

**Order forwarding must be on.** Trading through the API needs three separate things: an API key, an onchain exchange account, and `allowOrderForwarding(true)` called from the account's wallet ("One-Click Trading" in Perpl's UI). New accounts start with it **off**. Without it, every order is acknowledged with `code: 0` and then fails on `mt: 24` with `sr: 34`. The flag is readable only as `Account.fw` on the trading WS. Onboarding and key health must check it. (api-docs README, "API Auth vs Smart Contract Account")

**Order frame details.**
- Set a unique non-zero `sn` on every `mt: 22`. `mt: 3` echoes it as `cid`. Without it, acks can't be matched to orders.
- Seed `rq` from `Account.lfr`: `rq = max(local, lfr) + 1`. `sr: 32` means retry once with a new `rq`.
- `lb: 0` is legal on any order (server uses the max window). Otherwise `head < lb ≤ head + order_ttl_blocks`. `order_ttl_blocks` is 20 on every market today.
- `Close*` orders are reduce-only **and clamped to the position size by the exchange**, so they can't flip a position. Our allowlist is still the primary guard: a Trade key can open positions.
- `mnp` never applies to reducing fills.
- `order_max_market_slippage_bps` is 100 (1%) on mainnet and 1000 on testnet BTC/ETH/SOL. Our 0.5% worst price fits both.
- `t: 6` takes the amount in `a` as a string. The docs don't say whether it's scaled CNS or a decimal. M0 finds out.

**Heartbeats and block numbers.** The trading WS sends `mt: 100 {sn, h}`, where `h` is the head block. `sn` must be strictly +1, starting from the WalletSnapshot's `sn`; a gap means reconnect. The market-data WS has a `heartbeat@<chain>` stream. `MarketState.at.b` carries the block at which that market's state last changed. It is *not* a freshness signal on its own (see 3a).

**Two side encodings.** The trading WS reports `sd` as 1 = long, 2 = short (0 unspecified). The contract's `PositionEnum`, returned by `getPositionV2`, is 0 = long, 1 = short (dex-sdk `state/position.rs`), and an empty slot is `lotLNS == 0` with type 0. Found on 23 Sep when a live lookup of testnet account 641 dropped its three longs and read its ZEC short as a long.

**Entry price has a residue.** `Position.ep` is rounded (ceil for longs, floor for shorts) and `epr` carries a Q16 residue. Effective long entry = `(ep − 1 + epr/65536) / 10^pd` when `epr > 0`. Needed to match Perpl's liquidation price to the dollar.

**Premium PnL from funding sums.** `premium = −side · (fundingSum_now − efs) · size / (div · 10^pd)`, where `div = 10^funding_sum_scaling_exp`. Funding is realized on every size change. This is derived from the SDK's converters; M0 checks it against the chain's `getPositionV2`.

**Trigger orders exist.** The API supports `tp`/`tpc` trigger orders, including mark-price conditions (`tpc` 3/4), and Perpl's UI flags show `stopLossTakeProfit: on`. The brief's "stops are not native" is only half true: they're executed by Perpl's forwarder, not the contract, but users do have stop-losses. Airbag's gap is still real: a stop closes a fixed size at a fixed price, while Airbag sizes each trim to a liquidation-distance target, re-adds margin and re-arms. **Idea for later:** park a reduce-only trigger just above liquidation as a backstop for when Airbag's engine is down.

**No key-introspection endpoint.** Listing keys (scope, IP list) is UI-only. At link time we can prove the key signs in and can see the account. Scope can be probed with a harmless order the exchange will refuse (e.g. cancel a non-existent order: a read key gets `403` at the gateway, a trade key gets `code: 0` then `sr: 33`). The IP lock can't be read. Options: ask Perpl for a `GET /v1/api-key/self`, or probe sign-in from a second, non-allowlisted egress and expect `3401`. Open question for M0/M2.

**Trading WS connections are capped at 4 per wallet**, shared with the user's browser tabs. The engine needs one. If a user has four Perpl tabs open, our connection is refused. Surface it in key health.

## 3a. Measured on 23 Sep (M0, public data)

`spike/measure.ts`, 60 s per network, plus `MarkUpdated` logs over 6,000 blocks (~30 min):

| | Testnet | Mainnet |
|---|---|---|
| Monad block time (header timestamps) | 303 ms | 303 ms |
| Monad `newHeads` arrival interval p50 / p95 | 301 / 405 ms | 306 / 469 ms |
| Perpl `heartbeat` | every block, no `sn` gaps | every block, no `sn` gaps |
| Perpl `market-state` messages per block | 0.66 (largest skip 4 blocks) | 0.92 (largest skip 2) |
| `market-state` for block b arrives after Monad's `newHeads` for b, p50 / p95 | 177 / 353 ms | 335 / 496 ms |
| Blocks behind the newest head when it arrives, p95 / max | 1 / 1 | 1 / 2 |
| BTC `MarkUpdated` in 30 min | 76 | 76 |
| Gap between mark updates p50 / p90 / max (blocks) | 1 / 167 / 169 | 1 / 168 / 169 |
| Mark step size p90 / max | 0.033% / 0.057% | 0.028% / 0.056% |

What it means:
- **The mark moves in small steps, not every block.** Perpl posts a new mark when the price moves roughly 0.03–0.06%, or after at most ~169 blocks (~51 s), often in back-to-back pairs. Airbag still checks every block, but the value that decides liquidation changes a few times a minute.
- **The stale guard must measure feed lag, not mark age.** An unchanged mark is legitimately ~169 blocks old. We compare the latest heartbeat head (and Monad's head) with the newest block our market data has caught up to.
- Perpl's price feed runs about one block (~200–350 ms) behind Monad's head. Budget: mark lands in block k, we see it around k+1, the close is forwarded around k+2. Real numbers come from the M0 deploy.
- **Liquidation split confirmed onchain:** `getLiquidationInfo(perpId)` returns user/insurance/protocol = 80,000/10,000/10,000 per 100k on every market on both networks. The engine reads it rather than hard-coding 0.8.

## 4. Hosting with a static egress IP

| Option | Static egress | Notes |
|---|---|---|
| **Fly.io** | App-scoped static egress IPv4 + IPv6 pair per region, $3.60/mo, dedicated to the app, survives redeploys | Machines may egress over IPv6. The key's allow-list must hold both addresses, or we force IPv4. |
| Railway | Static outbound IPs on paid plans | Less control over region |
| Render | Static outbound IP *ranges* per region, shared across Render customers | Weakens the IP lock. Rejected. |
| VPS (Hetzner etc.) | Dedicated IPv4 | Cheapest and fully static, but we'd own patching, TLS and deploys |

Decision in `docs/adr/0004-hosting.md`.

## 5. PerplBot (reference)

MIT, TypeScript, owner/operator wallet pattern. The roadmap lists "Auto-defend liquidation (using available collateral or wallet assets)" as unbuilt, which confirms the brief. Useful patterns: it cross-checks liquidation prices by forking the chain with anvil and simulating (`sdk/simulation/fork-liquidation.ts`), and it reads positions onchain via `getPosition`.
