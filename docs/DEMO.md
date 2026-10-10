# Showing Airbag in three minutes

For a submission video or a judge at the table. Everything below runs on the public demo,
https://airbag.user64bit.world, with nothing to install. The live testnet run, if it has happened,
replaces step 3's simulation with real Perpl transactions ([DEPLOY.md](DEPLOY.md#demo-day-a-real-deploy-on-perpl-testnet)).
Either way, the real trim on Perpl testnet ([its transactions](DEPLOY.md#first-real-trim-on-perpl-testnet-2026-10-10))
is worth ten seconds after 1:40.

## Before you start

- In a fresh browser profile, open https://airbag.user64bit.world/engine/health: `ok: true` and
  `blocks: "monad"` mean the engine is on Monad testnet's real blocks.
- Open the landing once so its live radar has a reading (it refreshes every five minutes).
- For the push alerts, go through the demo once beforehand in the same browser, turn on "Push to
  this browser" in Settings, allow notifications, and reset the account. "Telegram" in Settings
  links @airbagalertbot instead, for a browser that refuses push (Brave, by default).

## The script

**0:00 — The problem, live.** The landing. Read the "Perpl now" line under the hero: how many
open positions on Perpl mainnet are, right now, past the line where Airbag would already have
trimmed them, read from Perpl's contract a few minutes ago. *"Every one of those is a trader one
wick from losing the whole position and 20% of what's left."*

**0:20 — Does it work? The chain says so.** Open `/backtest`. *"We took every position Perpl
liquidated on mainnet in three weeks, rebuilt each from its own liquidation event, and replayed the
marks Perpl actually published, block by block, through our production engine."* Point at 363 of
369, the $19,629 versus $35,244, and the paused control that liquidates where Perpl did. Open the
featured liquidation: the trace crossing the yellow line, the trim, liquidation moving away, Perpl
liquidating the original while the trimmed position stays open. Click "The liquidation on
MonadVision": it's a real transaction.

**1:00 — The product.** `/connect` → "Connect a test wallet" → sign in → "Use a test key" → the
settings preview (the numbers are the engine's own math) → don't arm yet; go to the dashboard.

**1:20 — Without Airbag.** Press "Play a wick on BTC" while paused. Twelve seconds later: the
liquidation lamp, $3,200 back of a $10,000 position, the push alert. *"That's Perpl's liquidation:
whole position gone, 20% of what's left to the insurance fund and protocol."*

**1:40 — With Airbag.** "Reset account", "Resume", play the same wick. Watch the block log: line
crossed in one Monad block, the reduce-only close fills in the next, the released margin goes back
in the one after, re-armed lower; then the old liquidation price arrives and the position is
still open: a save. Open the save report and its share card. Optional: "Play a wick on MON", a
short, trims the other way.

**2:20 — Why Monad.** Back on the landing's "Built on 300 ms blocks": per-block checks, real fills
on Perpl's onchain book, and AirbagLog, which reads Perpl's positions in the same transaction, so
a deploy's after-state and a save are Perpl's word, not ours. It's deployed on Monad testnet at
`0x52259e30d3687691F663033922472B43120276F7`: call `liquidationPrice(16, 12)` on MonadVision (BTC, a real testnet
account) and compare it with Perpl's UI, or run the fork test against Perpl mainnet
(`MONAD_FORK_RPC=https://rpc1.monad.xyz forge test --match-contract Fork -vvvv`).

**2:45 — What it can't do, said plainly.** The key can't withdraw; Airbag only shrinks positions.
A gap through the line and the liquidation price inside one block still liquidates, and nothing
is trimmed while the engine or Perpl is down. Its orders have traded on Perpl testnet, not mainnet.

## Questions judges ask

- **What stops Airbag from wrecking my account?** Perpl API keys can't withdraw or transfer, whatever
  their scope; Airbag's engine only ever sends reduce-only closes and margin adds (an allowlist in
  three layers, [ADR 0003](adr/0003-engine-runtime.md)); the key is IP-locked to Airbag's servers.
- **Why not just a stop loss?** A stop closes a fixed size at a fixed price. Airbag trims the
  smallest amount that moves liquidation a set distance away, puts the released margin back (a
  close alone doesn't move Perpl's liquidation price, [ADR 0002](adr/0002-deploy-is-close-then-readd.md))
  and re-arms.
- **What if the price keeps going?** The smaller position can be liquidated at its new price and
  returns less than the first liquidation would have. In the backtest none of the 363 did within a
  day.
- **What does it cost when the wick doesn't come?** Over the backtest's 21 days, about one line
  crossing in four ended in liquidation. On the others the trims cost a median 2.2% of margin (the
  trimmed part misses the recovery); on the liquidated ones they kept a median 20%. Both sides are
  on `/backtest`, below the featured replay.
- **Has it traded on Perpl?** On testnet, yes: a 30% reduce-only close filled 3 blocks after
  sending, the liquidation price didn't move, and re-adding the released margin moved it from
  $77,196 to $73,300, all in 2.2 s ([transactions](DEPLOY.md#first-real-trim-on-perpl-testnet-2026-10-10)).
  The engine has also deployed on its own, logged in AirbagLog
  ([its first live deploy](DEPLOY.md#the-engines-first-live-deploy-2026-10-10)). Not on mainnet.
