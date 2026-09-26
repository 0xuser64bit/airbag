# Security

What Airbag protects, how, and what it doesn't claim. Report a vulnerability privately to the owner,
not in a public issue.

Design decisions behind these controls are in [adr/](adr/); the risk model they protect is in
[RISK-MODEL.md](RISK-MODEL.md).

## What an attacker would want

A user's Perpl API key. It can't withdraw or transfer (Perpl refuses that for every API key), but a Trade key can open positions, so a stolen key could trade the account into a loss. Everything below is about keeping keys where they are and limiting what anything else can do.

## Controls

| Threat | Control | Where |
|---|---|---|
| Airbag itself opens, grows or flips a position | Only order types 3, 4 (reduce-only closes, clamped by Perpl), 6 (add the user's own margin) and 5 leave the engine. The runtime allowlist checks immediately before send. The one cancel is a link-time scope probe with a high safe uint64 id outside the open-order snapshot. Its live acceptance remains a testnet gate. | `packages/perpl/src/orders.ts`, [ADR 0003](adr/0003-engine-runtime.md) |
| A stored secret leaks from the database | Envelope encryption: a random AES-256-GCM data key per secret, wrapped by a versioned master key from the host's secret store; the wallet and account are associated data, so a ciphertext can't be moved to another row. The web tier has no database access at all. | `apps/engine/src/vault.ts`, [ADR 0006](adr/0006-api-key-custody.md), [0010](adr/0010-engine-owns-state-in-sqlite.md) |
| A secret leaks through logs | JSON logs redact any field whose name looks like a secret, at any depth. The secret is never returned by any endpoint. | `apps/engine/src/log.ts` |
| A key works from somewhere else | The user sets the key's IP allow-list to the engine's static egress IPs. Perpl doesn't let anyone read an allow-list back, so Airbag can't verify it; the UI says exactly that and asks the user to confirm. | `/link-key` |
| Someone links a key to a wallet that isn't theirs | Linking needs a SIWE session, and the engine checks that Perpl's wallet snapshot for the key is that same wallet. | `apps/engine/src/accounts.ts` |
| A Read key is linked and silently can't act | The scope probe at link time: Perpl refuses a Read key's order frame with 403. Lost, timed-out or otherwise unproved scope is refused; no key is stored. Key changes serialize per wallet and independently check pending deploy locks before and after verification. | `checkKey`, `Accounts` |
| Phishing or replaying a sign-in | SIWE version, URI host, issued date, validity window, domain and chain are checked. Nonces expire in 10 minutes and are consumed synchronously before asynchronous signature recovery, including concurrent requests. | `apps/engine/src/auth.ts` |
| Session theft | Random 32-byte bearer tokens, stored as SHA-256 hashes, 7-day expiry, logout deletes them. A session can change its own wallet's settings and link or unlink its key; it can never read a secret. Demo mode (deploys after a 0.3% move) is refused for wallets not on `DEMO_WALLETS`, so a stolen session can't turn Airbag into a position closer. | [ADR 0011](adr/0011-bearer-sessions.md) |
| A script injected into the web app steals a pasted key or the session | Content-Security-Policy: the page can only connect to itself and the engine, can't be framed, loads no third-party scripts; no `dangerouslySetInnerHTML` anywhere. The key is sent once over TLS and never stored in the browser. | `apps/web/next.config.ts` |
| API abuse | CORS only for `WEB_ORIGIN`, JSON bodies capped at 16 KB, per-IP token buckets per route (tighter on sign-in, lookup and key linking), wallet lookups cached for 15 s. | `apps/engine/src/api.ts` |
| Acting on bad data | Every order rechecks pause, feed/account freshness, frozen/forwarding state, account and position identity after the request-budget wait. Explicit execution deadlines are persisted before send. Recovery waits beyond a lost order's deadline and holds while unsafe; the original policy and lot cap survive restart. Live funding and fee schedules must be known. | `packages/perpl/src/market.ts`, `apps/engine/src/guard.ts` |
| Arbitrary outbound requests through push | Only known HTTPS browser push providers and valid P-256/auth keys are accepted. Stored subscriptions are revalidated before delivery, with a request timeout. | `apps/engine/src/notify.ts` |
| Simulation and real accounts sharing state | SQLite binds mode and chain id and refuses mismatches or silent adoption of populated legacy files. Simulation cannot use a real-chain log writer. | `apps/engine/src/db.ts`, `config.ts` |
| Supply chain | Frozen lockfile installs, restricted install scripts, `pnpm audit` and gitleaks over full history in CI, Actions pinned by commit SHA, Foundry image pinned by digest. Runtime dependencies are pinned; some development ranges resolve through the lockfile. | `.github/workflows/ci.yml`, `pnpm-workspace.yaml` |

## What Airbag can't promise

- A price that gaps through the line and the liquidation price inside one block can still liquidate the position. Airbag acts on the next block.
- A trim fills on the order book with a worst-price limit; on a thin book it can fill partly or not at all. Airbag retries next block, up to `MAX_DEPLOY_ATTEMPTS`, then alerts.
- If Monad, Perpl or the engine is down, nothing is trimmed. The engine is one process on one machine.
- The IP lock on a key cannot be verified from here: Perpl exposes no endpoint that reads an
  allow-list back. Airbag proves the scope and says plainly that the user confirmed the lock.

## Operating the keys

### Master key

Generate with `openssl rand -base64 32` and keep it only in the host's secret store (`fly secrets set MASTER_KEY=...`). Losing it means every user must link their key again; leaking it together with the database file exposes every stored key.

### Rotating the master key

1. Generate a new key. Set `MASTER_KEY` to it, `MASTER_KEY_VERSION` to the next version, and keep the old one as `MASTER_KEY_<old version>`. Deploy.
2. Take a SQLite backup (see DEPLOY), then run `node --env-file-if-exists=.env apps/engine/src/cli.ts rotate-master-key`. It re-wraps each stored key's data key under the new master key, proving each new envelope opens before replacing the old one. The ciphertexts don't change.
3. Run `node --env-file-if-exists=.env apps/engine/src/cli.ts check-keys`: every key should report the new version. Set `DATABASE_PATH` to the existing target file for both commands.
4. Remove `MASTER_KEY_<old version>` and deploy.

### If the database or a key may have leaked

1. Tell affected users to revoke their keys on Perpl's API keys page (this stops the key everywhere, at once) and link new ones.
2. Rotate the master key as above.
3. Rotate `AIRBAG_LOG_PRIVATE_KEY` (deploy a new writer with `setWriter` from the owner wallet) and the VAPID keys if they may be exposed.

## Not yet verified

- The whole live path against a funded testnet account. Everything above is exercised against the
  paper exchange and Perpl's public data; the testnet run in [DEPLOY.md](DEPLOY.md) is the gate and
  has not happened.
- An independent review of the engine's key handling.
