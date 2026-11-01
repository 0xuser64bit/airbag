# Security

[Documentation](README.md) · [Architecture](ARCHITECTURE.md) · [Operations](DEPLOY.md)

What Airbag protects, how, and what it doesn't claim. Report a vulnerability privately to the owner,
not in a public issue.

Design decisions behind these controls are in [Architecture](ARCHITECTURE.md); the risk model they protect is in
[RISK-MODEL.md](RISK-MODEL.md).

## What an attacker would want

A user's Perpl API key. It can't withdraw or transfer (Perpl refuses that for every API key), but a Trade key can open positions, so a stolen key could trade the account into a loss. Everything below is about keeping keys where they are and limiting what anything else can do.

## Controls

| Threat | Control | Where |
|---|---|---|
| Airbag itself opens, grows or flips a position | Only order types 3, 4 (reduce-only closes, clamped by Perpl), 6 (add the user's own margin) and 5 leave the engine. The runtime allowlist checks immediately before send. The one cancel is a link-time scope probe with a high safe uint64 id outside the open-order snapshot. Trade-scope admission was exercised in the recorded testnet runs. | `packages/perpl/src/orders.ts`, [Architecture](ARCHITECTURE.md) |
| A stored secret leaks from the database | Envelope encryption: a random AES-256-GCM data key per secret, wrapped by a versioned master key; wallet and account are associated data, so ciphertext cannot be moved to another row. This protects a database-only leak, not compromise of a process that can also read the master key. See the host boundary below. | `apps/engine/src/vault.ts`, [Architecture](ARCHITECTURE.md) |
| A secret leaks through logs | JSON logs redact any field whose name looks like a secret, at any depth. The secret is never returned by any endpoint. | `apps/engine/src/log.ts` |
| A key works from somewhere else | When the operator publishes static egress IPs, the user sets those in Perpl's allow-list. Perpl exposes no IP-list readback, so this is user-confirmed, not verified. With an empty `ENGINE_EGRESS_IPS`, onboarding accepts acknowledgement of an explicitly unlocked key instead; this is not an IP restriction. | `/link-key` |
| Someone links a key to a wallet that isn't theirs | Linking needs a SIWE session. In live mode the engine checks that Perpl's wallet snapshot for the key is that same wallet. Simulation uses synthetic accounts and skips this check; never submit real credentials there. | `apps/engine/src/accounts.ts` |
| A Read key is linked and silently can't act | In live mode, the link-time scope probe rejects a Read key. Lost, timed-out or otherwise unproved scope is refused; no key is stored. Simulation skips upstream verification. Key changes serialize per wallet and check pending deploy locks before and after verification. | `checkKey`, `Accounts` |
| Phishing or replaying a sign-in | SIWE version, URI host, issued date, validity window, domain and chain are checked. Nonces expire in 10 minutes and are consumed synchronously before asynchronous signature recovery, including concurrent requests. | `apps/engine/src/auth.ts` |
| Session theft | Random 32-byte bearer tokens, stored as SHA-256 hashes, 7-day expiry, logout deletes them. A session can change its own wallet's settings and link or unlink its key; it can never read a secret. Demo mode (deploys after a 0.3% move) is refused for wallets not on `DEMO_WALLETS`, so a stolen session can't turn Airbag into a position closer. | [Architecture](ARCHITECTURE.md) |
| A script injected into the web app steals a pasted key or the session | Content-Security-Policy: the page can only connect to itself and the engine, can't be framed, loads no third-party scripts; no `dangerouslySetInnerHTML` anywhere. The key is sent once over TLS and never stored in the browser. | `apps/web/next.config.ts` |
| API abuse | CORS only for `WEB_ORIGIN`, JSON bodies capped at 16 KiB, per-IP token buckets per route (tighter on sign-in, lookup and key linking; ten times looser in simulation for shared demo networks), wallet lookups cached for 15 s. Simulation sends no real trading orders, but its default block clock and configured alert providers do make outbound requests. | `apps/engine/src/api.ts` |
| Acting on bad data | Every order rechecks pause, feed/account freshness, frozen/forwarding state, account and position identity after the request-budget wait. Explicit execution deadlines are persisted before send. Recovery waits beyond a lost order's deadline and holds while unsafe; the original policy and lot cap survive restart. Live funding and fee schedules must be known. | `packages/perpl/src/market.ts`, `apps/engine/src/guard.ts` |
| Arbitrary outbound requests through push | Only known HTTPS browser push providers and valid P-256/auth keys are accepted. Stored subscriptions are revalidated before delivery, with a request timeout. | `apps/engine/src/notify.ts` |
| Someone else's chat receives a wallet's alerts | A Telegram chat is linked only by pressing Start on a t.me link the wallet's own signed-in session created: 12 random bytes, one use, ten minutes. /stop, unlinking or blocking the bot removes it. The bot token stays in the engine's environment and never appears in logs or errors. | `apps/engine/src/telegram.ts` |
| Simulation and real accounts sharing state | SQLite binds mode and chain id and refuses mismatches or silent adoption of populated legacy files. Simulation cannot use a real-chain log writer. | `apps/engine/src/db.ts`, `config.ts` |
| Supply chain | Frozen lockfile installs, restricted install scripts, `pnpm audit` and gitleaks over full history in CI, Actions pinned by commit SHA, Foundry image pinned by digest. Runtime dependencies are pinned; some development ranges resolve through the lockfile. | `.github/workflows/ci.yml`, `pnpm-workspace.yaml` |

## What Airbag can't promise

- A price that gaps through the line and the liquidation price inside one block can still liquidate the position. Airbag acts on the next block.
- A trim fills on the order book with a worst-price limit; on a thin book it can fill partly or not at all. Airbag retries next block, up to `MAX_DEPLOY_ATTEMPTS`, then alerts.
- If Monad, Perpl or the engine is down, nothing is trimmed. The engine is one process on one machine.
- The IP lock on a key cannot be verified from here: Perpl exposes no endpoint that reads an
  allow-list back. Live scope admission does not establish an IP lock. Publish fixed egress
  addresses and configure the allow-list before real-money operation.

## The host is a trust boundary

Web application code does not intentionally read the engine database or master key. The checked-in
VM service units nevertheless run **both services as `airbag`**. That identity owns the database
directory and can read `/etc/airbag/engine.env`; a compromised web process can access both. Database
encryption does not protect secrets when the attacker can also read the master key.

Before real-money operation, separate engine and web service identities, restrict the engine data
and environment to the engine identity, and use a dedicated host. The current VM is shared with
other root-administered projects and is suitable only for simulation and disposable testnet keys.
These are open hardening requirements, not properties already enforced by the supplied units.

For an offline simulation engine, use `SIM_CLOCK=local` and leave external alert providers
unconfigured. This does not prevent the web app's optional public-data panels from attempting
network reads.

## Operating the keys

### Master key

Generate with `openssl rand -base64 32` and keep it only on the engine's host: on the VM, in `/etc/airbag/engine.env` (root:airbag, 0640), where deploys only ever touch `WEB_ORIGIN`. Losing it means every user must link their key again; leaking it together with the database file exposes every stored key. The VM is shared with other projects that have root on it: acceptable for testnet keys, not for real funds.

### Rotating the master key

1. Generate a new key. Set `MASTER_KEY` to it, `MASTER_KEY_VERSION` to the next version, and keep the old one as `MASTER_KEY_<old version>`. Restart the engine.
2. Take a SQLite backup (see [Operations](DEPLOY.md#database-binding-backup-and-restore)), then run `rotate-master-key` using the matching commands below. It re-wraps each stored key's data key under the new master key, proving each new envelope opens before replacement. The secret ciphertexts do not change.
3. Run `check-keys`: every key should report the new version. Both commands must use the same existing database and complete key-version environment as the service.
4. Remove `MASTER_KEY_<old version>` from the running service and restart. Retain it separately for backups that still use that version.

**Local**, from the repository root, after setting the new/old keys in the root `.env`. Replace the
database path with the file you intend to rotate:

```bash
DATABASE_PATH=./data/airbag-live-testnet.db \
  node --env-file=.env apps/engine/src/cli.ts rotate-master-key
DATABASE_PATH=./data/airbag-live-testnet.db \
  node --env-file=.env apps/engine/src/cli.ts check-keys
```

**On the supplied VM**, after updating `/etc/airbag/engine.env`, use the private runtime and the
service identity. A shell does not inherit systemd's environment. Replace the explicit database
path with the service's actual file; the public simulation uses a different file.

```bash
sudo -u airbag env DATABASE_PATH=/var/lib/airbag/airbag-live-testnet.db \
  /opt/airbag/node/bin/node --env-file=/etc/airbag/engine.env \
  /opt/airbag/app/apps/engine/src/cli.ts rotate-master-key
sudo -u airbag env DATABASE_PATH=/var/lib/airbag/airbag-live-testnet.db \
  /opt/airbag/node/bin/node --env-file=/etc/airbag/engine.env \
  /opt/airbag/app/apps/engine/src/cli.ts check-keys
```

Do not print keys to diagnose a failure. Stop and restore the matching configuration if any
envelope fails to open; do not remove an old version until checks succeed.

### If the database or a key may have leaked

1. Tell affected users to revoke their keys on Perpl's API keys page (this stops the key everywhere, at once) and link new ones.
2. Rotate the master key as above.
3. Rotate `AIRBAG_LOG_PRIVATE_KEY` (create a fresh writer wallet, then call `setWriter` from the owner wallet) and the VAPID keys if they may be exposed.

## Verification limits

A manual close/re-add and two engine-triggered testnet deploys were recorded on 2026-10-10
([evidence](VERIFICATION.md#live-testnet-evidence)). These establish the exercised protocol path,
not sustained safety under failures. Independent review of key custody and money movement,
restart/fault testing, dedicated hosting, backup restore and real alert delivery remain
[real-money release gates](VERIFICATION.md#real-money-release-gates). No mainnet trading is released.
