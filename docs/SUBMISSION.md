# Submission text

Ready to paste into a hackathon form. Numbers are the dated snapshot the site and the docs show
(backtest to Perpl mainnet block 110,298,004, 2026-10-04); if the backtest is rerun, update them
here and in the README together.

## Name and one-liner

**Airbag** — get trimmed, not liquidated. Liquidation protection for Perpl traders on Monad.

## Short description (≈280 characters)

Airbag checks your Perpl positions every Monad block. When a wick eats half your margin cushion,
it trims the smallest amount and puts the released margin back, so liquidation moves away. Replayed
on Perpl's own mainnet liquidations: 363 of 369 would have been kept open.

## Long description

Perpl is a fully onchain perpetuals exchange on Monad. When a position's margin runs out, Perpl
liquidates all of it on the book and keeps 20% of what's left for its insurance fund and protocol.
Most liquidations are wicks: the price comes back, but the trader is already flat.

Airbag watches each position every Monad block (about 300 ms). When a price move uses up a set
share of the margin cushion (half, by default), it sends a reduce-only close for the smallest size
that puts liquidation a set distance away (10%), then adds the margin that close released back to
the position, because on Perpl a close alone doesn't move the liquidation price. Then it re-arms on
the smaller position. If the old liquidation price is hit later while the position is still open,
that's a save, with a public report and a share card.

It acts through a Perpl API key that cannot withdraw or transfer, whatever its scope, and the
engine only ever sends reduce-only closes and margin adds.

**Evidence, not promises:**

- **The backtest.** Every position Perpl fully liquidated on mainnet over 21 days, rebuilt from its
  `PositionLiquidated` event and replayed block by block through Airbag's production engine on the
  marks Perpl actually published. Airbag deployed first in all 369 (a median 50 minutes before
  Perpl liquidated); 363 trimmed positions were still open when Perpl liquidated the original,
  holding $35,244 at those blocks against the $19,629 the liquidations returned; none was liquidated
  in the day after. A control replay with Airbag paused liquidates every position where Perpl did.
  Each liquidation has its own page with the real mark and its MonadVision transaction.
- **The cost side.** The backtest only sees liquidations, so a second replay follows every
  position opened in the same 21 days: 557 of 601,810 crossed their Airbag line, and Perpl
  liquidated 137 of them. Where it didn't, the trims cost $860 across 398 positions (median 2.2% of
  margin); where it did, they kept $1,168 across 114 (median 20%). Protection has a premium, and
  the site shows both sides.
- **A live radar.** The site reads every open position on Perpl mainnet from the contract every few
  minutes: about 700, of which around 40 are past the line where Airbag would already have trimmed
  them. Any wallet can be checked for its positions now and its liquidations replayed.
- **A contract that checks Airbag.** AirbagLog reads Perpl's positions in the same transaction: a
  deploy's size and liquidation price after come from Perpl, not Airbag, and anyone can prove a
  save against Perpl's own mark. Tested against Perpl's real Exchange on a fork of Monad mainnet,
  and deployed on Monad testnet (0x52259e30d3687691F663033922472B43120276F7), where its onchain liquidation price
  matched Airbag's math to the tick on 16 of 16 real positions.

## How it uses Monad

- **300 ms blocks make per-block checks worth it:** a line crossed in one block is acted on in the
  next, while the price is still near the line.
- **Perpl's order book is onchain on Monad**, so every trim is a real fill with a transaction.
- **Composability:** AirbagLog reads Perpl's Exchange contract on the same chain to verify its own
  records, and its `liquidationPrice` view computes any Perpl position's liquidation price onchain.
- **Public chain data deep enough to test against:** the backtest is built entirely from Monad
  events (`PositionLiquidated`, `MarkUpdated`), and anyone can rerun it with one command.
- The simulation demo runs on Monad testnet's real block clock.

## How it's built

TypeScript monorepo on Node 24: a pure risk-math package shared by the engine and the browser
(golden vectors and property tests), a Perpl client (Ed25519 sign-in, trading and market-data
sockets, Multicall3-batched chain reads, an order-type allowlist in three layers), an always-on
engine (one guard per account, SQLite, SIWE sessions, Web Push and Telegram alerts), a Next.js app,
a Solidity contract (Foundry), and an Envio HyperIndex indexer. 208 unit and property tests, 8
Playwright journeys with axe accessibility checks, 16 contract tests plus a mainnet fork test.

## How it makes money

Traders pay a flat monthly fee per protected wallet, from the wallet, since Airbag's key can't
touch the account; the bigger path is Perpl itself, which keeps the volume of every trader a wick
no longer wipes out, as a native integration with a revenue share. (Perpl's builder codes only pay
on size that opens or increases a position, so trims can't fund it.)

## What is and isn't done

Working end to end in simulation (paper exchange, Monad testnet blocks) in CI and on the public
demo. Checked against Perpl mainnet's contract, its liquidations and its live positions without a
key. Not yet: a funded trim and re-add on Perpl testnet (the runbook is one step away), a deployed
AirbagLog on mainnet, and an independent security review before anyone uses it with real money.

## Links

- Live demo: https://airbag.user64bit.world (no wallet extension or funds needed)
- Backtest: https://airbag.user64bit.world/backtest
- Wallet check: https://airbag.user64bit.world/wallet
- Source: https://github.com/0xuser64bit/airbag
- Three-minute demo script: [docs/DEMO.md](DEMO.md)
