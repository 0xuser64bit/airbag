# Status

Updated every session. Newest first within each section.

**Milestone:** M0 (spike, go/no-go), due 25 Sep. **Paused at the gate, waiting on the owner** (checklist below).

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

## Next (after the gate)

- M1: rest of `packages/risk` (trigger line, trim sizing with cap, spare-margin check, re-arm, save/precaution, all golden vectors plus property tests), trading WS client with heartbeat `sn` tracking and reconnect, engine loop with stale guard, locks, reconciliation, simulation mode, DB schema, logging.

## Blocked (needs the owner)

- The M0 gate checklist above.
- Hackathon dashboard: paste the Monad Metropolis rules and the exact Perpl ("Best use of Perpl's API", "Best Analytics / Risk Tool") and Envio bounty texts into `docs/HACKATHON.md`.
- Before M2/M3: Fly.io, Vercel and Neon accounts. Ask Perpl on Discord to (a) whitelist our Origin for key enrollment, (b) say whether a key-info endpoint (scope and IP list) exists or is planned.
- Make the repo public before submission (it's private for now, by your choice). The rules want it public "throughout".

## Corrections to the brief

| Date | Section | Was | Now | Evidence |
|---|---|---|---|---|
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

- **Key verification.** No API returns a key's scope or IP list. Probe scope with a refused cancel. For the IP lock, ask Perpl for a key-info endpoint, or probe from a second egress.
- **`t:6` amount format.** Scaled CNS integer string or decimal? Found out in M0.
- **Design change.** The deploy timeline needs a row for the margin re-add, and "fill" latency now spans two orders. Confirm with the owner before M3.
- **Landing copy.** The hero replay says it "plays at real speed, one frame per 300 ms Monad block" while the price moves $100–600 per frame. Perpl's real mark moves in ~0.03–0.06% steps (~$25–50 on BTC). It's a scripted crash test, but "real speed" invites the question. Suggest "one frame per Monad block" or labelling it as a compressed wick. Owner's call.
- **Early warning.** The mark lags the oracle by design. The engine could also watch `orl` (oracle) and pre-compute the trim so it's ready when the mark crosses. Decide in M1.
