# Status

Updated every session. Newest first within each section.

**Milestone:** M0 (spike, go/no-go). Due 25 Sep.

## Done

- 23 Sep: Research on Perpl, Monad, Envio and hosting (`docs/RESEARCH.md`). Every "verify" item in the brief is checked.

## Next

- Stack ADRs, architecture doc, CLAUDE.md, README, CI.
- M0 spike (see the gate checklist below).

## Blocked (needs the owner)

- Read the Monad Metropolis rules and the Perpl and Envio bounty texts on the hackathon dashboard, and paste them into `docs/HACKATHON.md`.

## Corrections to the brief

| Date | Section | Was | Now | Evidence |
|---|---|---|---|---|
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
