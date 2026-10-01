# 0014. Simulation runs on Monad's real block clock

Date: 1 Oct 2026. Amends [0012](0012-exchange-port-and-simulation.md).

## Context

Simulation is how most people will see Airbag before anyone links a funded key: the hackathon
judges, a public demo engine, CI. Its block clock was a local `setInterval` counting up from
1,000,000, so the dashboard's "every block, checked" strip and each deploy's block log showed block
numbers nobody could look up. The product's claim is per-block protection on Monad, and the one
part of that claim simulation can show for real, without funds or keys, is Monad's blocks.

## Decision

- In simulation, a second `MarketFeed` follows only Perpl's public `heartbeat@<chain>` stream:
  Monad's head, every block. It never subscribes to prices, funding or config, and nothing is ever
  sent to Perpl. The scripted prices, paper exchange and golden-vector sample positions are
  unchanged.
- `SimChain` applies each new Monad head to the simulated feed, which drives the engine's tick as
  before. Scripts are indexed by block, so a wick plays the same on either clock.
- While the heartbeat is quiet for a second (or has not arrived within three of boot), the local
  clock steps in every 300 ms, continuing from the last real head. A real head older than what is
  already shown only keeps the local clock out.
- The dashboard marks whether its head is a real Monad block (`block.onchain`) and links real ones
  to the explorer. `SIM_CLOCK=local` keeps the old offline clock; the end-to-end tests use it.

## Consequences

- A deploy's block log in simulation reads as real block numbers on Monad testnet, at the chain's
  real cadence, and the trigger-to-fill distance is measured in those blocks.
- Simulation now opens one outbound WebSocket by default. Offline or when Perpl's feed is down it
  falls back to the local clock, so a public demo does not depend on Perpl being up.
- After a long fallback the local clock can run a few blocks ahead of Monad; the engine then
  waits, reporting stale data, until Monad's heads pass it. Live mode is unaffected.
