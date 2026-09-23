# 0009. AirbagLog contract with Foundry, indexed by Envio HyperIndex

Date: 23 Sep 2026

## Decision

- `contracts/` is a **Foundry** project with one contract, `AirbagLog`. It emits `DeployRecorded(accountId, market, perplTxHash, sizeBefore, sizeAfter, liqBefore, liqAfter, reasonCode)` and `SaveRecorded(deployId, oldLiqHitBlock)`, plus an optional `PolicyCommitted(accountId, policyHash)`. There is one writer (the engine's hot wallet), set at construction, and an owner who can rotate it. It holds no funds.
- `indexer/` is an **Envio HyperIndex** project over HyperSync (Monad 143/10143) that indexes `AirbagLog`, plus Perpl's `PositionLiquidated` using the ABI shipped in `PerplFoundation/dex-sdk` (MIT). That makes the landing-page stat ("liquidated on Perpl in the last 30 days") real.
- The engine logs a deploy onchain only after the Perpl fill and re-add are reconciled. A failure to log never blocks protection.

## Consequences

- The hot wallet needs a little MON for gas. It's a separate key from anything that touches user funds.
- Foundry isn't installed on the dev machine yet (M4 task).
