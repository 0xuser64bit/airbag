# Verification and release status

Last reviewed: **2026-10-11**. This is dated evidence, not a guarantee of protection or an
independent security audit. The public app runs in simulation. Live trading has been exercised
on disposable Perpl testnet funds; mainnet trading is not released.

## Current validation

| Check | Result on 2026-10-11 |
|---|---|
| Lint, TypeScript and unit/property tests | Passed; 210 tests across 23 files |
| Next.js production build | Passed; includes the committed historical replay pages |
| Production browser journeys and accessibility checks | Passed; 8 Playwright journeys with axe checks |
| Envio code generation, typecheck and handler tests | Passed; 4 handler tests |
| Production-only engine dependencies and readiness | Passed in an isolated copy matching the Dockerfile source layout |
| AirbagLog unit tests | Passed; 16 tests using local Foundry |
| AirbagLog against a Monad mainnet fork | Passed with `MONAD_FORK_RPC=https://rpc1.monad.xyz` |
| Public-chain risk arithmetic check | Passed on 45 open testnet positions; PnL and funding differed by at most $0.000001 |
| Dependency audit, including low severity | No known vulnerabilities after patching transitive esbuild to 0.28.1 |
| Secret scan | No leaks in Git history or the proposed tracked changes |

The engine Docker image was not rebuilt locally: Docker was unavailable. The isolated engine
check verifies the production dependency/source layout, not the container build. Image build and
smoke testing remain in CI. Alert delivery on physical devices and an off-host restore drill
were not repeated during this review.

The fork test reads open positions across BTC, MON, ETH, SOL and ZEC and requires at least five
valid positions. It checks that computed liquidation prices agree with Perpl's own accounting
within a tick's position value plus one cent. Without `MONAD_FORK_RPC`, its test body returns
early; a passing default Foundry suite alone is not fork evidence.

The public VM's engine and web services were active and `/engine/ready` returned ready on this
date, running release `8671ab25233a` in simulation on Monad testnet blocks. Local changes require
a committed release and deployment before that public release changes.

## Live testnet evidence

These transactions were executed on **2026-10-10**, not repeated as part of this cleanup.
They demonstrate the protocol path and automated engine execution, not sustained production
reliability. All links use the Monad testnet explorer.

### Manual protocol check

| Action | Evidence |
|---|---|
| Add exactly $1 of collateral using scaled CNS units | [Collateral add](https://testnet.monadvision.com/tx/0xf45e3fd5cc721d2792fb04272736d1473c40bd22b61e021db5cf8edc8b5cb7c6) |
| Reduce-only close of 30% of a BTC position | [Close](https://testnet.monadvision.com/tx/0x820a5ba9b33467647c964e04e1d021036380fb71868bec385eb280d174b06131) |
| Re-add $3.273093 of released collateral | [Re-add](https://testnet.monadvision.com/tx/0x40caf0b1c7fe484e11b146442319b5bcba6b0bbcf98d5f0a40e4edb4a7a967c0) |

The close alone left liquidation at $77,196.3; the re-add moved it to $73,299.8. The cycle
completed in about 2.2 seconds. Trade-key admission and the scope probe were exercised through
the engine's web onboarding during the automated tests below.

### Automated engine deploys

The first run protected a MON short, reducing size from 4,000 to 3,283 MON and moving liquidation
from $0.02825 to $0.03003. Its [AirbagLog record](https://testnet.monadvision.com/tx/0x81b0d994d50589809c2beff8914ed844c6455e956bc6f2900575d76b3c1810f1)
contains a zero Perpl transaction hash: the adapter omitted the hash until fixed in `029e439`.
The run also exposed a rejected close followed by a retry that incorrectly resent a successful
collateral add; `516d1f4` changed that path to retry only the close and reconcile the deposit.

The second run completed with one attempt per step:

| Action | Evidence |
|---|---|
| Close 27 MON, four blocks after the trigger | [Perpl close](https://testnet.monadvision.com/tx/0xc0cf28b5864eab30b6730989c6d356d83291046820dacea13aa0ac6c881120bc) |
| Re-add $0.27, four blocks after the close | [Collateral re-add](https://testnet.monadvision.com/tx/0xf74cfcb20c1f41bcc09f8da6db501ec4eb69dba83861693c4b05afb610b83ab0) |
| Read Perpl's resulting size/liquidation and record the close hash | [AirbagLog record](https://testnet.monadvision.com/tx/0x012186d0dfd2a74a12de24764d17410aaf1f5c8b1e5d9a23c3342cfec14ce575) |

[AirbagLog](https://testnet.monadvision.com/address/0x52259e30d3687691F663033922472B43120276F7)
was deployed on testnet on 2026-10-04. Its liquidation view matched the risk package to the tick
on 16 open positions during the original deployment check. The contract holds no funds and
has no authority to trade. See [contracts/README.md](../contracts/README.md) for its trust model.

## Historical replay evidence

The committed datasets cover **2026-09-13 through 2026-10-04**, ending at Perpl mainnet block
110,298,004. They have not been refreshed during this cleanup.

- Of 372 fully liquidated positions, 369 were replayable. In the simulation, 363 remained open
  at the original liquidation block; six one-lot positions could not be trimmed within the 50%
  per-deploy cap. Simulated value at those blocks was $35,244, compared with $19,629 returned
  by the original liquidations.
- A separate cost replay followed 601,810 opened positions. Of 557 line crossings, 137 ended
  in an actual liquidation. Among included non-liquidated positions, protection reduced value
  by $860 across 398 positions, with a median change of -2.2% of margin. Among 114 included
  liquidated positions, it increased value by $1,168, with a median change of +20.3%.
- The cost comparison excludes 19 untrimmable positions and 26 control mismatches. Those
  exclusions limit comparability; their effect on aggregate benefit is not established.

Fills are simulated with a two-block delay, 25 bps of adverse execution and taker fees. The replay
does not reconstruct later discretionary trading or continuing funding. It cannot prove live
execution, future performance or that protection always costs less than liquidation.
[Risk model](RISK-MODEL.md#backtest-on-perpls-own-liquidations) describes the inputs and rerun commands.

## Real-money release gates

The following remain open before offering mainnet protection:

- Independent review of key custody, API authorization, recovery and money movement.
- A dedicated host for Trade keys, plus verified network egress restrictions. The current
  public simulation host is shared with other root-administered applications.
- Sustained disposable testnet runs covering disconnects, partial fills, failed collateral
  adds, restart recovery and adversarial price paths. Two short live runs do not clear this gate.
- External readiness/account monitoring and verified alert delivery on supported devices.
- Encrypted off-host backups, separate master-key retention and a completed restore drill.
- If onchain receipts are offered on mainnet: deploy the mainnet log, fund its writer and address
  the in-memory queue's lack of durable backfill. The optional indexer is not a core engine dependency.

The engine cannot protect positions while it or Perpl is unavailable, or after a price gap crosses
both the configured line and liquidation before execution. A compromised Trade key cannot withdraw
through Perpl's API, but can damage the account by trading. See [Security](SECURITY.md) and
[Operations](DEPLOY.md) for mitigations and operating procedures.
