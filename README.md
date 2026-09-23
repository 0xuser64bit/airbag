# Airbag

**Get trimmed, not liquidated.** Liquidation protection for [Perpl](https://perpl.xyz) traders on [Monad](https://monad.xyz).

Airbag checks your Perpl positions every Monad block. When a price move uses up a set share of a position's margin cushion, it trims just enough of the position with a fee-free, reduce-only order and puts the released margin back into the position, so Perpl's liquidation engine never has to close the whole thing. It acts through a Perpl API key that can't withdraw.

> Status: early build for the Monad Metropolis hackathon (deadline 13 Oct 2026). Not yet usable. See [docs/STATUS.md](docs/STATUS.md).

## Why it works

- When Perpl liquidates a position it closes all of it, and the margin left is split 80% to the trader, 10% to the insurance fund, 10% to the protocol.
- Closing or reducing a position on Perpl is fee-free.
- So an early partial close costs nothing in fees and keeps the trader in the trade. A liquidation costs a fifth of what's left and ends the position.

## Why Monad

_To be written in M5: per-block checks at ~300 ms, fee-free reduce-only closes on a fully onchain order book, an onchain deploy log indexed by Envio._

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the decision records in [docs/adr/](docs/adr/).

| Path | What |
|---|---|
| `packages/risk` | Pure risk math with golden-vector and property tests |
| `docs/` | Brief, research notes, architecture, ADRs, status |
| `design/` | The approved design (reference HTML) |

## Contracts and transactions

_None deployed yet. Addresses and tx hashes go here._

## Running it

Requires Node 24 and pnpm 11.

```bash
pnpm install
pnpm check   # lint, typecheck, tests
```

## AI disclosure

This project is built with AI coding tools, as the hackathon rules allow. What was made by whom:

| Part | Written by | Reviewed by the owner |
|---|---|---|
| Product brief (`docs/BRIEF.md`, original version) and approved design (`design/`) | Owner (Arth). _Owner: say here which tools, if any, helped._ | n/a |
| Corrections to the brief, research notes, ADRs, architecture doc | Claude Code (Anthropic, Claude Opus 5.5) | Pending |
| All code, tests and CI in this repository | Claude Code (Anthropic, Claude Opus 5.5) | Pending |

Commits before 23 Sep session 2 carry a `Co-Authored-By: Claude` trailer; later ones don't, at the owner's request, and the table above is the disclosure of record. It is updated as the owner reviews each part.

## License

[MIT](LICENSE)
