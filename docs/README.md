# Airbag documentation

Airbag is position protection for Perpl traders on Monad: watch a risk line, reduce exposure or
add spare margin, and move liquidation farther away. Start with the [project overview](../README.md)
or [try the simulation](https://airbag.user64bit.world/connect).

> **Know which environment you are reading about.** The public app is simulation. Live execution
> has been exercised on disposable Perpl testnet funds. Mainnet protection is not released.
> [Verification status](VERIFICATION.md) separates recorded evidence from open release gates.

## Use the product

| Guide | What it answers |
|---|---|
| [User guide](USER-GUIDE.md) | How do I connect, configure protection, read a receipt and handle a failure? |
| [Risk model](RISK-MODEL.md) | When does Airbag act, why is collateral re-added, and what can protection cost? |
| [Verification status](VERIFICATION.md) | What was tested, when, with which assumptions—and what remains unproven? |

## Build and integrate

| Guide | What it answers |
|---|---|
| [Contributing](../CONTRIBUTING.md) | How do I run the project, choose checks and make a safe change? |
| [Architecture](ARCHITECTURE.md) | How do components, execution, persistence and recovery fit together? |
| [HTTP API](API.md) | How do authentication, wallet endpoints, streams and simulation controls work? |
| [Perpl integration](PERPL.md) | Which protocol fields, units, order types and measured behaviors matter? |
| [Web design contract](../apps/web/DESIGN.md) | Which visual, wording and accessibility conventions should the UI preserve? |

## Operate and verify

| Guide | What it answers |
|---|---|
| [Operations](DEPLOY.md) | How do I configure, deploy, monitor, back up, restore and verify on testnet? |
| [Security](SECURITY.md) | What can a Trade key do, what does the host trust, and how do I rotate or revoke keys? |
| [AirbagLog](../contracts/README.md) | What does the optional onchain record check, and what does it not prove? |
| [Indexer](../indexer/README.md) | How do I generate handlers, test fixtures and configure optional event statistics? |

## Find the implementation

The [repository map](../README.md#under-the-hood) locates each workspace. For the core protection
path, read `packages/risk/src/index.ts`, `apps/engine/src/guard.ts`, then
`packages/perpl/src/orders.ts`. The public API is `apps/engine/src/api.ts`; browser journeys live
in `e2e/app.e2e.ts`.

Use current guides for supported behavior and Git history for superseded plans. Historical
measurements keep their original dates. Replay files—not copied totals—are the provenance source:
[`backtest.json`](../apps/web/lib/backtest.json) and
[`false-alarms.json`](../apps/web/lib/false-alarms.json).

## About the screenshots

The screenshots in `docs/img/` were captured from the local app on **2026-11-01**. Dashboard,
setup and receipt images show **simulation**, including scripted marks and paper fills. The
hero and save report use the zero-fee BTC example from the
[golden vectors](RISK-MODEL.md#golden-vectors); real fees and execution change the result.
The backtest screen displays the committed historical dataset, not a live execution test.

Screenshots illustrate the interface, not current availability, latency or returns. When changing
the UI, refresh the relevant capture and its alt text together; do not replace a simulation label
with a live-performance claim. See [contributor guidance](../CONTRIBUTING.md#documentation-and-commits).
