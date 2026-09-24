# Product

<!-- impeccable:product-schema 1 -->

Airbag's full brief is `docs/BRIEF.md` (risk math, engine invariants, security). This file keeps only what design work needs.

## Platform

web

## Users

Active Perpl traders using 5–15x leverage who can't watch the screen around the clock. They open Airbag once to set it up, glance at it beside Perpl's trading screen, and reach it from a push alert on their phone, often at night, right after a deploy. Secondary audience: hackathon judges (Monad founders, crypto VCs, Perpl's co-founder) who see it through a 3-minute demo video and the public repo.

## Product Purpose

Airbag watches a trader's Perpl positions every Monad block (about 300 ms). When a price move uses up a set share of a position's margin cushion, it adds the trader's spare margin (only when that alone is enough) or trims the smallest amount, reduce-only and fee-free, then puts the released margin back so liquidation sits at least the target distance away, and re-arms on the smaller position. Success: a liquidation that would have closed the whole position and kept a fifth of what was left becomes a small fee-free trim, and the trader can see exactly what happened, when, and why.

## Positioning

Perpl liquidates whole positions and keeps 20% of the remaining margin, while closing or reducing a position is fee-free. Airbag turns that asymmetry into protection: a check every block, a trim sized to move liquidation to a target distance, the margin re-add, the re-arm. A stop closes a fixed size at a fixed price; Airbag sizes each trim to the liquidation it has to move. It acts through a Perpl key that can't withdraw.

## Operating Context

- Onboarding: connect a wallet (read-only), Perpl account lookup, Sign-In with Ethereum, create a Trade key on Perpl and IP-lock it to Airbag's servers, paste key and secret, choose sensitivity, trim target, most per deploy, spare margin and push alerts, arm.
- Daily: the dashboard beside Perpl: status, the position closest to liquidation, what happens at the line, per-block liveness, key health.
- The deploy moment: a push alert ("Airbag trimmed 0.489 BTC at $97,000. Liquidation now $87,300. Fee $0."), then the deploy card: before and after, a block-by-block timeline, the transaction.
- Save report: a public page plus a 1200×675 share image, once the old liquidation price is later hit while the trimmed position is still open.
- Simulation mode: a paper exchange and scripted prices, used for demos and CI, always labelled.

## Capabilities and Constraints

- The engine owns all state and secrets. The web app talks to it over HTTP with a SIWE bearer session and a per-block event stream. No UI library; Next.js 16, React 19, CSS modules, viem.
- Airbag only shrinks positions or adds the user's own spare margin. It never opens, adds to or flips one.
- Status vocabulary: Armed, Deploying, Deployed · re-armed, Paused, Data stale · holding, Connecting, Key rejected, One-Click Trading off, Perpl connection limit, Account frozen. A deploy is a Save only if the old liquidation price is later hit while the position is open; otherwise it's a Precaution. Never call a precaution a save.
- The counterfactual liquidation return is an estimate and is labelled as one.
- Perpl doesn't expose a key's IP allow-list: the UI says the user confirmed it, never that Airbag verified it.
- Every number comes from `@airbag/risk`, the engine's own math. The golden vectors in `docs/BRIEF.md` §4 appear in the UI and in tests.
- Installable PWA so Web Push works on phones (iOS needs the Home Screen install).

## Brand Commitments

- The name Airbag, the tagline "Get trimmed, not liquidated.", and the crash-test target mark. Binding (owner, 24 Sep 2026).
- Color meaning, binding (owner, 24 Sep 2026): yellow means Airbag (the line it acts at, and anything it did); red means liquidation and nothing else.
- The hazard stripe marks a deploy and the save card.
- The original dark look and its three fonts, binding (owner, 24 Sep 2026, after rejecting a paper-stock redesign once it was built): graphite and bone, Archivo for display, Instrument Sans for UI, Martian Mono for every number.
- Voice: plain, precise, trader-literate. Sentence case. Numbers over adjectives. Honest about limits. No "seamless", "unlock", "leverage" as a verb, no exclamation marks.
- Composition, components, navigation, states and motion are open for the redesign (owner, 24 Sep 2026).
- The landing replay is a scripted wick, compressed: one frame per Monad block. Never "real speed" (owner, 24 Sep 2026).

## Evidence on Hand

- The worked example (golden vectors): BTC long 1.000 from $100,000 with $10,000 margin; liquidation $94,000, Airbag line $97,000, trim 0.489 BTC, new liquidation $87,300, re-arm at $92,150, kept $5,333 when BTC is back at $100,000. Computed live from `@airbag/risk` wherever it appears.
- "Liquidated on Perpl in the last 30 days" comes from the Envio indexer and is shown only when the indexer answers. Never invent it.
- No real users, testimonials, saves, volumes or partners yet. Nothing has traded on Perpl yet (the M0 gate is pending). Simulated data is always labelled.

## Product Principles

1. Quiet until it matters: calm while the trader is safe, unmistakable when Airbag acts.
2. Show the math: every claim on screen is a number the engine computed, with the price it's measured at.
3. Honest about limits: say what was verified, what the user confirmed, what's an estimate and what's simulated.
4. The trader stays in control: pause, edit, unlink and revoke are always one step away.
5. Every block counts: liveness is visible, and stale data looks stale.

## Accessibility & Inclusion

WCAG 2.1 AA, checked by axe in CI (serious and critical violations fail): real buttons and links, labelled inputs, `aria-pressed` and `role="switch"`, visible focus, 44 px targets, 4.5:1 text contrast, reduced-motion support. Color is never the only signal: liquidation and Airbag values also carry words.
