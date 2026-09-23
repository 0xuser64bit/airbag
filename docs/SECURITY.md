# Security

What Airbag protects, how, and what it doesn't claim. Report a vulnerability privately to the owner, not in a public issue.

## What an attacker would want

A user's Perpl API key. It can't withdraw or transfer (Perpl refuses that for every API key), but a Trade key can open positions, so a stolen key could trade the account into a loss. Everything below is about keeping keys where they are and limiting what anything else can do.

## Controls

| Threat | Control | Where |
|---|---|---|
| Airbag itself opens, grows or flips a position | Only order types 3, 4 (reduce-only closes, clamped by Perpl to the position), 6 (add the user's own margin) and 5 leave the engine. Builders can only produce those, `assertAllowed` runs right before `send`, tests cover both, and the paper exchange asserts every frame too. The one cancel is a link-time scope probe aimed at an order id that isn't one of the account's, so it can't cancel anything. | `packages/perpl/src/orders.ts`, ADR 0003 |
| A stored secret leaks from the database | Envelope encryption: a random AES-256-GCM data key per secret, wrapped by a versioned master key from the host's secret store; the wallet and account are associated data, so a ciphertext can't be moved to another row. The web tier has no database access at all. | `apps/engine/src/vault.ts`, ADR 0006, 0010 |
| A secret leaks through logs | JSON logs redact any field whose name looks like a secret, at any depth. The secret is never returned by any endpoint. | `apps/engine/src/log.ts` |
| A key works from somewhere else | The user sets the key's IP allow-list to the engine's static egress IPs. Perpl doesn't let anyone read an allow-list back, so Airbag can't verify it; the UI says exactly that and asks the user to confirm. | `/link-key` |
| Someone links a key to a wallet that isn't theirs | Linking needs a SIWE session, and the engine checks that Perpl's wallet snapshot for the key is that same wallet. | `apps/engine/src/accounts.ts` |
| A Read key is linked and silently can't act | The scope probe at link time: Perpl refuses a Read key's order frame with 403. | `checkKey` |
| Phishing a sign-in for another site | SIWE domain must be one of `WEB_ORIGIN`'s hosts; the chain id must match; nonces are single-use and expire in 10 minutes. | `apps/engine/src/auth.ts` |
| Session theft | Random 32-byte bearer tokens, stored as SHA-256 hashes, 7-day expiry, logout deletes them. A session can change its own wallet's settings and link or unlink its key; it can never read a secret. Demo mode (deploys after a 0.3% move) is refused for wallets not on `DEMO_WALLETS`, so a stolen session can't turn Airbag into a position closer. | ADR 0011 |
| API abuse | CORS only for `WEB_ORIGIN`, JSON bodies capped at 16 KB, per-IP token buckets per route (tighter on sign-in, lookup and key linking), wallet lookups cached for 15 s. | `apps/engine/src/api.ts` |
| Acting on bad data | Nothing is sent on stale data (feed silent, or Perpl's head behind Monad's by more than `STALE_BLOCKS`). Closes carry a worst-price limit (0.5% by default). Re-adds are capped by the risk model and the free balance. | `packages/perpl/src/market.ts`, `apps/engine/src/guard.ts` |
| Supply chain | Exact dependency pins, pnpm's release-age policy (no exceptions), install scripts denied unless approved, `pnpm audit` and gitleaks over the full history in CI, GitHub Actions pinned by commit SHA, the Foundry image pinned by digest. | `.github/workflows/ci.yml`, `pnpm-workspace.yaml` |

## What Airbag can't promise

- A price that gaps through the line and the liquidation price inside one block can still liquidate the position. Airbag acts on the next block.
- A trim fills on the order book with a worst-price limit; on a thin book it can fill partly or not at all. Airbag retries next block, up to `MAX_DEPLOY_ATTEMPTS`, then alerts.
- If Monad, Perpl or the engine is down, nothing is trimmed. The engine is one process on one machine.

## Operating the keys

### Master key

Generate with `openssl rand -base64 32` and keep it only in the host's secret store (`fly secrets set MASTER_KEY=...`). Losing it means every user must link their key again; leaking it together with the database file exposes every stored key.

### Rotating the master key

1. Generate a new key. Set `MASTER_KEY` to it, `MASTER_KEY_VERSION` to the next version, and keep the old one as `MASTER_KEY_<old version>`. Deploy.
2. On the engine machine, run `node src/cli.ts rotate-master-key`. It re-wraps each stored key's data key under the new master key, proving each new envelope opens before replacing the old one. The ciphertexts don't change.
3. Run `node src/cli.ts check-keys`: every key should report the new version.
4. Remove `MASTER_KEY_<old version>` and deploy.

### If the database or a key may have leaked

1. Tell affected users to revoke their keys on Perpl's API keys page (this stops the key everywhere, at once) and link new ones.
2. Rotate the master key as above.
3. Rotate `AIRBAG_LOG_PRIVATE_KEY` (deploy a new writer with `setWriter` from the owner wallet) and the VAPID keys if they may be exposed.

## Not yet verified

- The whole live path against a funded testnet account: the M0 gate in `docs/STATUS.md` is waiting on the owner. Everything above is tested against a paper exchange and Perpl's public data.
- An independent review of the engine's key handling (planned for M4).
