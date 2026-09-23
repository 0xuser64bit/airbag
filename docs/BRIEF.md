# Airbag: build brief

You are the founding engineer on Airbag. This file is the source of truth for what we're building, why, and the constraints. The design files in `/design` are the source of truth for how it looks and reads. Where this brief and the design disagree, ask.

Owner: Arth (solo founder). Written 23 Sep 2026. Deadline: **13 Oct 2026, 11:59 PM ET** (Monad Metropolis hackathon). We are building a real product, not a throwaway demo, but the deadline is fixed.

---

## 1. The product in one paragraph

Airbag is liquidation protection for perpetual futures traders on **Perpl** (a fully onchain perps exchange on **Monad**). It watches a trader's Perpl positions every Monad block. When a price move uses up a set share of a position's margin cushion, Airbag either adds the trader's spare margin (only when that alone is enough) or **trims just enough of the position, fee-free, with a reduce-only order**, so Perpl's liquidation engine never has to close the whole thing. It acts through a Perpl API key that **cannot withdraw funds**. Tagline: **"Get trimmed, not liquidated."**

### Why it works (the core insight, from Perpl's docs)

- When Perpl liquidates a position it closes the **whole** position on the order book, and the margin left is split **80% to the trader, 10% to the insurance fund, 10% to the protocol**.
- **Closing or reducing a position on Perpl is fee-free.** Fees only apply to size that opens or increases a position.
- So an early partial close costs nothing in fees and keeps the trader in the trade, while a liquidation costs a fifth of what's left and ends the position.

### Who it's for

Active Perpl traders using leverage (5x–15x), who can't watch the screen 24/7. Secondary audience: hackathon judges (Monad founders, VCs from Paradigm/Electric/Dragonfly etc., the Perpl co-founder). The Perpl co-founder's own public PerplBot roadmap lists "Auto-defend liquidation" as unbuilt; we are building it.

### What it is not

Not a trading bot, not an alpha tool, not a copy-trader. It never opens, adds to or flips positions. It only shrinks them or adds the user's own spare margin.

---

## 2. Hackathon rules that constrain the build

Source: Monad Metropolis rules v3.0 as quoted publicly by another participant. **Verify each on the hackathon dashboard (the user can log in; ask them) before relying on it.**

- Open source is mandatory: OSI license (use MIT), public GitHub repo "throughout and after" the hackathon.
- Commit history must show the work was done during the build window (1 Sep to 13 Oct). **Commit early and often. No giant squashed commits.**
- AI coding tools are allowed but **must be disclosed in the README**, specifically (which parts, which tool).
- Demo video: **3 minutes max**, public, showing the real product working and real Monad transactions. No mockups or slides.
- Submission must include contract addresses or tx hashes, mainnet or testnet, and explain **why Monad**.
- Review is non-confidential: **no secrets, keys or private notes in the repo, ever.**
- Judging (main track, 20% each): product quality and completeness, technical excellence, Monad integration, track fit (Track 1: Onchain Finance & Trading), innovation and impact.
- Sponsor bounties we're targeting (scored 40% on meeting the bounty's published requirements, so get the exact text from the dashboard): **Perpl "Best use of Perpl's API" ($5k)**, **Perpl "Best Analytics / Risk Tool" ($3k)**, **Envio "Best Use of Envio" ($1k)**.

---

## 3. Verified technical facts (as of 23 Sep 2026)

Re-verify anything marked (verify). Always fetch live config at runtime instead of hard-coding.

### Perpl

- Docs: https://docs.perpl.xyz (index: https://docs.perpl.xyz/llms.txt, every page has a `.md` version). API docs: https://github.com/PerplFoundation/api-docs (README, `authentication.md`, `websocket.md`, `rest-endpoints.md`, `types.md`, `integrations.md`, `examples/`).
- No official TypeScript SDK. The TS guide talks to the API directly with `@noble/ed25519`. There is a **Rust** SDK: https://github.com/PerplFoundation/dex-sdk (state cache, order helpers, custom anvil for Monad) and examples in `PerplFoundation/dex-sdk-examples`. Reference bot with an owner/operator pattern: https://github.com/0x70626a/PerplBot (TypeScript, MIT). Its author is the Perpl co-founder and a judge.
- Networks (from `networks-and-configuration.md`):

| | Mainnet | Testnet |
|---|---|---|
| REST | `https://app.perpl.xyz/api` | `https://testnet.perpl.xyz/api` |
| WS base | `wss://app.perpl.xyz` | `wss://testnet.perpl.xyz` |
| Chain ID | 143 | 10143 |
| RPC | `https://rpc.monad.xyz` | `https://testnet-rpc.monad.xyz` |
| Exchange | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` |
| Collateral | AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` (6 dp) | aUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` (6 dp) (verify: the api-docs README lists a different testnet collateral address; trust `GET /api/v1/pub/context`) |
| Markets | BTC 1, MON 10, ETH 20, SOL 31, HYPE 40, ZEC 50 | BTC 16, ETH 32, SOL 48, MON 64, ZEC 256 |

- **Market IDs differ per network. Never hard-code them.** Read `GET /api/v1/pub/context` at startup.
- **Auth:** API keys are Ed25519 keypairs. The user creates one in Perpl's UI (`/apikeys`) or an integration enrolls one programmatically (EIP-712 wallet signature plus Ed25519 proof of possession). **Programmatic enrollment requires Perpl to whitelist our Origin.** Scopes: `1` read, `2` trade (implies read). **Withdrawals and transfers out are never permitted via an API key, whatever the scope.** Keys can carry an IP allow-list (up to 4 CIDRs) and an expiry. Max 16 active keys per profile. Listing and revoking happen in Perpl's UI only.
- **API auth ≠ exchange account.** The exchange account is onchain (`createAccount(uint256)`, `getAccountByAddr(address)`).
- **Trading WebSocket** `…/ws/v1/trading`. Sign-in frame `mt: 29` (chain_id, api_key, timestamp, nonce, signature over `<chain_id>\ntrading-ws-signin\n<timestamp_ms>\n<nonce>`). Snapshots: WalletSnapshot `mt:19`, AccountUpdate `mt:21`, OrdersSnapshot `mt:23`, OrdersUpdate `mt:24`, FillsUpdate `mt:25`, PositionsSnapshot `mt:26`, PositionsUpdate `mt:27`. Command status `mt:3` (`code: 0` means accepted for forwarding, **not** filled). Ping `{mt:1,t:Date.now()}` every ~30 s. Track `sn` sequence numbers and reconnect/resnapshot on gaps. Idle timeout closes the socket (5 s mainnet, 10 s testnet), including before sign-in.
- **Order frame `mt: 22`**: `rq` (strictly increasing idempotency key), `mkt`, `acc`, `t` (order type), `p` (0 = market), `s` (scaled size), `ms` (max slippage bps), `fl` (flags), `lv` (leverage in hundredths), `lb` (last execution block: `head < lb ≤ head + order_ttl_blocks`), `a` (amount, for collateral), optional `bf` (builder fee).
  - `t`: 1 OpenLong, 2 OpenShort, **3 CloseLong, 4 CloseShort**, 5 Cancel, **6 IncreasePositionCollateral**, 7 Change.
  - `fl`: 0 GTC, 1 PostOnly, 2 FOK, **4 IOC**.
  - A "market" order is a marketable limit IOC bounded by the slippage limit. It can fill partly or not at all on a thin or fast book.
- **Rate limits.** Trading WS: 60 req/min testnet, 120 mainnet, 4 connections per wallet (shared with the user's own browser sessions). Market-data WS `…/ws/v1/market-data`: 10 req/min and 16 subscriptions per connection; data arrives every block and needs no pings. Exceeding request rate closes the socket with code 1008 and silently drops anything in flight.
- **Market-data streams:** `order-book@<mkt>`, `trades@<mkt>`, `market-state@<chain>` (prices, OI), `funding@<chain>`, `market-config@<chain>`, `gas-stats@<chain>`.
- **Margin:** isolated only today (each position has its own margin). Initial margin is dynamic (can rise for large positions or volatility). Liquidation is triggered on the **mark price**.
- **Liquidation price (Perpl docs):** `P_liq = P_entry + s · (C_MMR − C_deposit − C_funding) / L`, with `s = +1` long, `−1` short, `C_MMR` the maintenance requirement, `C_deposit` the position's collateral, `C_funding` funding owed (premium PnL), `L` lot size. Maintenance margin by market: BTC 4% (max 15x), ETH 5% (12x), SOL 5% (12x), MON 5% (10x), HYPE 5% (10x), ZEC ~6.7% (8x). Partial liquidations can happen. Large ones can be bought by the PLP vault.
- **Funding** is applied about hourly: every 8,571 blocks per the docs. It settles virtually via a cumulative "funding product sum", so premium PnL must be included in equity. Note: funding does **not** move every block. The mark price does. Don't claim otherwise in copy.
- **Stops and take-profits are not native contract operations.** They're SDK/keeper abstractions. That's part of why Airbag has a gap to fill.
- **Builder codes** (later, for revenue): register with Perpl, bind at key enrollment, fee ≤ 0.1%, and only on size that opens or increases a position. Trims earn nothing. Don't build this now.

### Monad

- Mainnet chain 143, testnet 10143 (network info: https://docs.monad.xyz/developer-essentials/testnet). Mainnet runs 300 ms blocks (Monad blog, 2026). Measure testnet yourself.
- Explorers: https://monadvision.com (mainnet), https://testnet.monadvision.com (testnet).
- WebSocket subscriptions: `newHeads`, `logs`, `monadNewHeads`, `monadLogs`. The `monad*` variants add `blockId` and `commitState` (`Proposed → Voted → Finalized → Verified`). Blocks can be abandoned implicitly. Public WS URLs aren't listed in the docs (verify with a provider: QuickNode, Alchemy, Chainstack and Dwellir all give free plans to hackathon teams).
- Execution Events SDK (C/Rust, shared memory, same host as a node) exists but is out of scope.
- Docs index: https://docs.monad.xyz/llms.txt

### Envio

- HyperIndex supports Monad (other Metropolis teams index Monad mainnet with it). Docs: https://docs.envio.dev. The Perpl exchange ABI is **not verified publicly** (one indexer project found no ABI on Sourcify/MonadScan). Check whether `dex-sdk` ships ABIs before planning to index Perpl events. Our own contract (section 7) is always indexable.

---

## 4. The risk model (implement exactly; these numbers are in the design)

Put this in a pure, dependency-free package with exhaustive tests. It is the heart of the product.

### Definitions (long side; mirror for shorts)

```
n        = position size (base units)
E        = entry price
M        = position deposit (collateral), after any realized PnL from earlier trims
r        = maintenance margin fraction for the market (BTC 0.04)
m        = r · E            (maintenance per unit, per Perpl's formula using entry notional; VERIFY)
MMR      = m · n
F        = accrued funding as premium PnL (positive = received), from Perpl's funding sum; VERIFY the sign convention against Perpl's C_funding
equity(P)= M + F − n · (E − P)          long
equity(P)= M + F − n · (P − E)          short
liqPrice = E − (M + F − MMR)/n          long   (E + (M + F − MMR)/n short)
```

### Cushion and trigger

- **Cushion** = equity above the maintenance requirement.
- **Reference cushion** `C0` is measured at a reference price: the **entry price** when a position is first armed, and the **fill price** after each deploy (re-arm). So `C0 = equity(P_ref) − MMR`.
- **Sensitivity** `f`: Early = 1/3, Balanced = 1/2 (default), Late = 3/4.
- **Deploy** when `equity(mark) ≤ MMR + (1 − f) · C0`. Equivalently, `Q = equity at trigger = MMR + (1 − f)·C0`, and the trigger price is `T = E − (M + F − Q)/n` for longs.

### What to do when triggered

1. **Spare margin first, only if it's enough.** With the account's unallocated balance `S`, if adding `S` alone puts `liqPrice` at least `d` away from `T`, send `IncreasePositionCollateral` (`t:6`) for the smallest amount that does. Otherwise **don't add any margin**. Keep it and trim.
2. **Trim the smallest amount** that puts liquidation at least `d` (default 10%) away from the trigger price. For a long with remaining fraction `s`:
   ```
   L'(s) = T + m − Q / (s · n)
   target L' ≤ T · (1 − d)  ⇒  s ≤ Q / (n · (m + T·d))
   trim fraction = 1 − s, capped at maxTrim (default 50%)
   ```
   Shorts: `L'(s) = T − m + Q/(s·n)`, target `L' ≥ T·(1 + d)`, same bound on `s`.
3. Send `CloseLong`/`CloseShort` (`t:3`/`t:4`), `fl:4` (IOC), with a worst price `0.5%` from mark (setting), valid `lb`.
4. On partial fill, recompute and retry next block with the remainder, up to a small cap, then alert.
5. **Re-arm** on the smaller position with the fill price as the new reference.

### Golden test vectors (from the design; must pass exactly, to the displayed precision)

BTC long, `n = 1.000`, `E = 100,000`, `M = 10,000`, `r = 4%`, `F = 0`, spare margin `S = 420`:

| Quantity | Value |
|---|---|
| Liquidation price | $94,000 |
| `C0` | $6,000 |
| Trigger, Early / Balanced / Late | $98,000 / **$97,000** / $95,500 |
| At mark $99,420: distance to liquidation | 5.45% |
| At mark $99,420: line below mark / cushion used | 2.43% / 9.7% |
| Balanced, `d = 10%`: spare $420 would give liq | $93,580 (3.53%) → **not used** |
| Balanced trim | **0.489 BTC** (48.9%), remaining 0.511 |
| New liquidation | **$87,300** (10.00% from $97,000) |
| Worst fill price (0.5%) | $96,515 |
| Realized PnL on the trim | −$1,467 |
| Leverage at trigger, before → after | 13.9x → 7.1x |
| Re-arm line (Balanced, reference = $97,000) | **$92,150** |
| Early trim / new liq | 0.420 BTC / $88,200 |
| Late with 50% cap | capped: 0.500 BTC, liq $88,500 (7.33%) |
| If mark later hits $94,000: without Airbag | liquidated, $3,200 returned (80% of $4,000 residual) |
| If mark later hits $94,000: with Airbag | open, equity $5,467 |
| Back at $100,000: without / with | $3,200 / **$8,533** → "kept $5,333" |

ETH long, `n = 2`, `E = 3,000`, `M = 1,200`, `r = 5%`: liq $2,550, Balanced line $2,775, distance at $3,060 = 16.67%, at $3,012 = 15.34%.

Add property tests (e.g. fast-check): trims never increase size, never flip side, always meet the target unless capped, `L'` monotonic in `s`, and long/short symmetry.

### Save vs precaution

- A deploy is a **Save** if, after it, the mark price reaches the **pre-deploy liquidation price** while the trimmed position is still open. Otherwise it's a **Precaution**. Never call a precaution a save.
- Counterfactual liquidation return is an estimate: `0.8 × (equity at old liq price)`, which is about `0.8 × MMR`. Label it "estimate" in the UI tooltip.
- Save value = current value of the Airbag path − counterfactual return. It's live while the position is open and frozen when it closes. The share card snapshots it.

---

## 5. Engine behaviour and non-negotiable invariants

- **Always-on process** (not serverless). One shared market-data connection plus one trading connection per linked account.
- Tick on every block (the `market-state` stream arrives every block; optionally cross-check block numbers with `monadNewHeads`).
- **Stale-data guard:** never act on data older than N blocks (configurable, default 3). Show "stale" in the UI and alert.
- **Hard allowlist of order types: 3, 4, 6, and 5 (cancel of its own orders) only.** Enforce at type level plus a runtime assert right before send, plus a test that fails if any other type can be emitted. Airbag must never open, increase or flip a position.
- Per-position lock (one deploy in flight per position). Strictly increasing `rq`. Reconcile outcomes from `mt:24/25/27`, not from `mt:3`.
- Respect rate limits with a token bucket per connection. Pings count against the budget.
- **Static egress IP is required** (the key's IP allow-list). Choose hosting that guarantees it, and show the IPs in onboarding from config.
- Structured logs (no secrets, ever). Per-block latency metrics: detect → send → fill, in blocks and ms. A `/health` endpoint.
- **Demo mode:** a per-account flag allowing aggressive thresholds (e.g. deploy after a 0.3% move) so we can trigger real deploys on testnet or small mainnet positions for the video. Off by default, and clearly labelled.
- **Simulation mode:** feed a scripted price path through the same engine code. The landing-page path is in `design/Main.dc.html`; the trigger must fire at block index 14 and fill at 15.

### Security

- The API secret is the crown jewel. Encrypt at rest with envelope encryption (a KMS or libsodium secretbox with a master key from a secret manager). Decrypt only in engine memory. Never log it, never return it to any client, never store it in the browser.
- **Preferred key flow:** get Perpl to whitelist our Origin, then generate the Ed25519 keypair **server-side** and have the user sign Perpl's EIP-712 enrollment payload with their wallet. The secret never exists anywhere else. **Fallback (MVP until whitelisted):** the user creates a Trade key in Perpl's UI with our IP ranges and pastes the key and secret over TLS straight to the engine API.
- Dashboard access and settings changes require **Sign-In with Ethereum** (EIP-4361) for the wallet that owns the Perpl account.
- Least privilege everywhere. Rotate the master key procedure documented. Dependency pinning plus `npm audit`/`osv-scanner` in CI. Secret scanning (gitleaks) in CI.

---

## 6. Product surface (routes and screens)

The design is in `/design` (see `design/README.md` for how to read it). Build these, matching layout, copy and numbers:

| Route | Design file | Notes |
|---|---|---|
| `/` | `Main.dc.html` | Landing. Hero has a **live crash-test replay** (SVG chart plus two lanes, one frame per 300 ms, loops, Replay button, respects `prefers-reduced-motion`). Sections: why it works, "same wick twice" table, how it works, safety model, what it can't promise, FAQ, final CTA, footer. |
| `/connect` | `Connect.dc.html` | Wallet connect (read-only address). Look up the Perpl account and show positions with distance to liquidation, "No airbag". |
| `/link-key` | `LinkKey.dc.html` | Paste flow now, programmatic enrollment when whitelisted. IP ranges from config. Verify key: scope, IP lock, account id. |
| `/setup` | `Settings.dc.html` | Sensitivity presets, trim target stepper (6–20%), max trim (25/50/75/100%), spare-margin switch, alerts. **Live preview computed by the risk package** on the user's riskiest position. |
| `/app` | `Dashboard.dc.html` | Status pill, block ticker, hero "closest to liquidation" plus runway, positions table, 60-block check tape, settings summary, key health, recent deploys. |
| `/app` (deploy state) | `Deployed.dc.html` | Deploy card with hazard stripe, before→after, block-by-block timeline with tx link, "if it keeps falling" counterfactual. |
| `/app/deploys/[id]` | `MobileDeploy.dc.html` | Deploy detail (responsive; the phone design is the reference). |
| `/s/[id]` | `SaveCard.dc.html`, `MobileSave.dc.html` | Public save report plus a 1200×675 OG image (the save card). |
| `/app/settings` | `Settings.dc.html` | Same controls as `/setup`, outside the stepper. |

All screens must be responsive. The phone designs (`MobileHome`, `MobileDeploy`, `MobileSave`) define the small-screen layouts. Build it as an installable PWA so web push works on phones.

**Notifications:** Web Push (VAPID) at minimum. Email optional. Push copy: "Airbag trimmed 0.489 BTC at $97,000. Liquidation now $87,300. Fee $0."

---

## 7. Onchain component (Monad integration)

A small, audited-by-tests contract, e.g. `AirbagLog`:

- `recordDeploy(accountId, market, perplTxHash, sizeBefore, sizeAfter, liqBefore, liqAfter, reasonCode)` emits an event, called by the engine's hot wallet (the only writer).
- `recordSave(deployId, oldLiqHitBlock)` for saves.
- Optionally users commit a hash of their settings (`policyHash`) so the policy in force at each deploy is provable.

Deploy it to testnet (and mainnet if time allows). Index it with Envio. Put the addresses in the README. If the Perpl ABI is obtainable, also index Perpl liquidation events for the landing-page stat "liquidated on Perpl in the last 30 days". **Never invent that number.** Use a placeholder until it's real.

---

## 8. Design system (summary; exact values are in `/design`)

Direction: **"crash-test instrument"**. Quiet until it matters.

- **Color rule:** graphite and bone while safe. **Yellow = Airbag** (the line it acts at, and anything it did). **Red = liquidation only.** Nothing else gets color.

| Token | Value | Use |
|---|---|---|
| ground | `#11110F` | page |
| panel | `#181815` | cards |
| raised | `#1F1F1B` | active nav, selected rows |
| line | `#2B2A25` | hairlines |
| line-strong | `#3A3932` | control borders |
| bone | `#ECE9E0` | primary text |
| text-2 | `#A5A298` | supporting text |
| text-3 | `#86837A` | captions (still ≥ 4.5:1 on ground) |
| soft-bone | `#D6D3CA` | long-form body on dark |
| airbag | `#F2C12E` | Airbag; text on it is `#11110F` |
| liquidation | `#FF6A55` | liquidation only |

- **Type:** Archivo at `font-stretch: 125%`, 700–800, for display (h1/h2 and the wordmark only). Instrument Sans for UI and body. Martian Mono at 75–87.5% width with `font-variant-numeric: tabular-nums` for **every number**. Load via `next/font/google` (or equivalent) with the `wdth` axis.
- **Shape:** 8 px control radius, 10–12 px small containers, 16 px cards, 999 px pills. 1 px borders. No drop shadows, no gradients. The **only** patterned fill is the hazard stripe (`repeating-linear-gradient(-45deg, #F2C12E 0 10px, #11110F 10px 20px)`), shown only when Airbag deploys and on the save card.
- **Logo:** crash-test target (inline SVG in every design file). Wordmark "AIRBAG" in Archivo 125% 800, letter-spacing 0.06em.
- **Signature component, the Runway:** horizontal track; red tick = liquidation, yellow tick = Airbag line, hatched zone between them (neutral when safe, yellow-tinted when near the line), bone dot = mark, dashed tick = entry or old liquidation ghost. Labels in mono caps (`LIQ $94,000`, `AIRBAG $97,000`, `MARK $99,420`).
- **Components to build:** Button (primary yellow / secondary outline / ghost), StatusPill (Armed, Deploying, Deployed · re-armed, Paused, Key rejected · relink), Runway, StatCell / before→after cell, PositionsTable, DeployTimeline row, BlockTape, SaveCard (also rendered as an OG image), HazardStripe, Stepper, Segmented, Switch, Toast.
- **Voice:** plain, precise, trader-literate. Sentence case. Numbers over adjectives. Honest about limits. No "seamless", "unlock", "leverage" (as a verb), and no exclamation marks.
- **Accessibility:** real buttons and links, labels on inputs, `aria-pressed`/`role="switch"` where used, focus-visible outline in yellow, 44 px targets, 4.5:1 text contrast, reduced-motion support. Run axe in CI.

---

## 9. Stack guidance

**You choose the stack.** Write an ADR for each major choice in `docs/adr/`. My default recommendation, which you can override with reasons:

- TypeScript monorepo (pnpm workspaces): `apps/web` (Next.js App Router plus Tailwind with the tokens above as CSS variables, viem/wagmi for wallet connect plus SIWE), `apps/engine` (Node LTS long-running service), `packages/risk` (pure math plus tests), `packages/perpl` (typed REST/WS client with Ed25519 signing), `packages/ui` (optional), `contracts/` (Foundry), `indexer/` (Envio).
- Postgres (users, settings, encrypted keys, positions cache, deploys, saves) with a typed ORM and migrations.
- Engine to web: SSE or WebSocket for live dashboard state.
- Hosting: the engine needs an always-on host with a **static egress IP** (research options, e.g. Fly.io, Railway, Render, a small VPS). The web app can live on Vercel or similar.
- Testing: unit plus property tests for `risk`, a simulation harness for the engine, Playwright end-to-end for web flows, Foundry tests for contracts. CI on every push.

---

## 10. Milestones (dates are IST; the deadline is 14 Oct 09:29 IST)

**M0: spike and go/no-go (by Sep 25).** Stop here and report to the owner.
- Testnet: fund a wallet, create the Perpl account onchain, create a Trade key, sign in to the trading WS, read positions.
- Compute the liquidation price for a live test position and **match Perpl's UI to the dollar**.
- Send a `CloseLong` IOC reduce and see the fill. Send `IncreasePositionCollateral` with a Trade-scoped key and confirm it works (this decides whether the spare-margin feature ships).
- Measure: block time, market-state cadence, detect→fill latency.
- **If any of this fails, report back before building further.**

**M1: core (Sep 26–29).** `packages/risk` with golden vectors plus property tests. `packages/perpl`. Engine loop with stale guard, allowlist, locks, reconciliation, simulation mode. DB schema. Structured logging.

**M2: web (Sep 30–Oct 3).** Design tokens and components. Landing (with replay), connect, link-key, setup, dashboard, live data. SIWE. **Deploy a public preview early.**

**M3: end to end (Oct 4–6).** Real deploys on testnet via demo mode. Deploy card and timeline. Push notifications. Save/precaution classification. Save report page plus OG image.

**M4: onchain and hardening (Oct 7–9).** `AirbagLog` contract deployed plus the Envio indexer. Security review of key handling. Small-stakes mainnet run with the owner and 5–10 invited traders, if the owner approves.

**M5: ship (Oct 10–11).** README (what, why Monad, architecture diagram, contract addresses, tx hashes, AI disclosure, how to run), screenshots, video support, submit. **Oct 12–13 is buffer only.**

---

## 11. Things only the owner can do (ask, don't guess)

- Testnet MON and aUSD funding, wallet private keys (never commit them), mainnet funds (**never touch mainnet funds without explicit approval**).
- Creating Perpl API keys in the Perpl UI. Contacting Perpl on Discord (Origin whitelisting, builder code, ABI).
- Hosting accounts (static IP host, DB, Vercel), RPC provider keys, the VAPID keys secret store.
- Reading the exact bounty requirements and rules on the hackathon dashboard.
- Recruiting beta traders. Recording the demo video.

---

## 12. Working agreements

- Keep a `CLAUDE.md` for yourself (commands, conventions, gotchas), `docs/STATUS.md` (what's done and what's next, updated every session), and `docs/adr/`.
- Research before building each integration. Read the actual docs linked above and cite them in code comments where behaviour is non-obvious.
- Small, focused commits with clear messages. Push often (the commit history is judged).
- No placeholder data presented as real. Sample data is labelled.
- If something in this brief turns out to be wrong, fix the brief in the same commit and note it in STATUS.
- The README's AI-disclosure section must say what Claude Code wrote and what the owner reviewed.

---

## 13. The demo story (build toward this)

A 3-minute cut:

1. **(0:00–0:20)** Hook: "On Perpl, a liquidation closes all of your position and keeps a fifth of what's left. Closing it yourself is free."
2. **(0:20–1:40)** Split screen, the same position with and without Airbag through a real price wick on testnet or small mainnet. Show the deploy card, fill tx on MonadVision, and the liquidation on the other side.
3. **(1:40–2:10)** Safety: a key that can't withdraw, IP-locked, reduce-only, open source.
4. **(2:10–2:40)** Monad: per-block checks at 300 ms, fee-free closes, onchain log plus Envio.
5. **(2:40–3:00)** Save report, the business (builder codes later), the ask.
