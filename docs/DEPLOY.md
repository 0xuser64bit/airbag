# Operations

Commands run from the repository root unless labeled as host commands. The public deployment is
simulation; live testnet evidence and real-money release gates are in [Verification status](VERIFICATION.md).
Do not change the public demo to live mode as part of a routine deploy.

## Configuration

The root `.env.example` lists engine and tool settings. Local engine commands load that template,
then the root `.env`. The default standalone engine mode is live and requires a master key;
`pnpm dev:engine` supplies simulation defaults explicitly.

| Setting | Purpose |
|---|---|
| `ENGINE_MODE`, `PERPL_NETWORK` | Select live/simulation and testnet/mainnet |
| `MASTER_KEY`, `MASTER_KEY_VERSION`, `MASTER_KEY_<n>` | Versioned envelope-encryption keys; required for live mode |
| `DATABASE_PATH` | Persistent state file, bound to mode and chain; live mode refuses `:memory:` |
| `WEB_ORIGIN` | Browser CORS origins; first origin supplies the sign-in domain |
| `ENGINE_EGRESS_IPS` | Addresses the trader must allow-list in Perpl |
| `MARKETS`, `STALE_BLOCKS`, `SLIPPAGE_BPS`, `MAX_DEPLOY_ATTEMPTS` | Coverage and execution safety limits |
| `HOST`, `PORT`, `CLIENT_IP_HEADER` | Listening address and trusted reverse-proxy client IP |
| `VAPID_*`, `TELEGRAM_BOT_*` | Optional alert providers |
| `AIRBAG_LOG_ADDRESS`, `AIRBAG_LOG_PRIVATE_KEY` | Optional live onchain writer; forbidden in simulation |
| `SIM_CLOCK` | `monad` with fallback, or `local` for offline simulation |

Keep web-only environment settings in `apps/web/.env.local` or the build/service environment.
`NEXT_PUBLIC_ENGINE_URL`, `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_SOURCE_URL` are fixed at build
time. `ENGINE_URL` is the web server's internal engine address. `RADAR_RPC_URL`, `INDEXER_URL`
and `AIRBAG_LENS_ADDRESS` configure optional public data reads. Never place engine secrets in web settings.

## VM deployment

`deploy/vm/deploy.sh` ships committed HEAD; a dirty tree is refused. Configure SSH access with
`AIRBAG_VM` and `AIRBAG_VM_KEY`, and the hostname with `AIRBAG_DOMAIN` if changing it.
The checked-in defaults target the existing public demo.

```bash
pnpm check
pnpm build
deploy/vm/deploy.sh
```

The provisioner installs a private Node 24 runtime, verifies its download checksum, installs and
builds as the unprivileged `airbag` user, then switches the application symlink and restarts the
services. A failed install/build leaves the running release in place. Caddy configuration is
validated and backed up before reload. Readiness is checked internally and through public TLS.

| Resource | Host location |
|---|---|
| Releases and current symlink | `/opt/airbag/releases/<sha>`, `/opt/airbag/app`; three newest releases retained |
| Node runtime | `/opt/airbag/node` |
| Engine service / listener | `airbag-engine.service`, `127.0.0.1:8789` |
| Web service / listener | `airbag-web.service`, `127.0.0.1:3089` |
| Engine environment | `/etc/airbag/engine.env`, root:airbag, mode 0640 |
| Simulation database | `/var/lib/airbag/airbag-simulation-testnet.db` |
| TLS and API routing | Managed Airbag block in `/etc/caddy/Caddyfile`; `/engine/*` proxies to the engine |

A deploy preserves engine configuration except `WEB_ORIGIN`, which follows the hostname. Caddy
overwrites `X-Real-IP`; the engine must remain unreachable directly when trusting that header.
The host is shared with other root-administered projects. Use a dedicated host before storing
real-money Trade keys; [Security](SECURITY.md) explains the trust boundary.

### Monitoring and rollback

Monitor the public `/engine/ready` endpoint externally and alert on repeated failure. `/health`
always responds with diagnostics; HTTP 200 there is not readiness. Monitor account-specific
key errors, stalled deployments, failed re-adds, notification failures and onchain write failures
in structured logs. A healthy feed does not prove every account can trade.

On the host:

```bash
journalctl -u airbag-engine -f
journalctl -u airbag-web -f
curl -fsS http://127.0.0.1:8789/ready
curl -fsS http://127.0.0.1:8789/health

# Choose an existing retained release with a compatible database schema.
sudo ln -sfn /opt/airbag/releases/<sha> /opt/airbag/app
sudo systemctl restart airbag-engine airbag-web
```

Recheck both services, public readiness, sign-in and receipts after rollback. A deployment that
fails after the symlink switch needs this manual rollback; there is no automatic rollback.
Never downgrade a database to get an older engine running. The engine refuses newer schema versions.

## Alerts

Configure both VAPID keys and a subject URL/contact on the engine host. Generate keys using the
installed `web-push` CLI. Restart the engine, enable push from Settings in a permitted browser,
and verify delivery with a simulated wick. Rotating VAPID keys requires browser resubscription.
An enabled toggle is not delivery proof; verify each supported browser/device separately.

For Telegram, create a bot through BotFather, set `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_BOT_USERNAME`, then restart. The engine long-polls; no inbound webhook is required.
Link the wallet's chat through Settings and the one-use Start link. `/stop`, unlinking or blocking
the bot removes linkage. Provider credentials belong only in the engine environment.

## Database binding, backup and restore

Default local files are `data/airbag-<mode>-<network>.db`. Each file records mode and chain id;
separate live and simulation deployments need separate files. Never change a binding to bypass
a rejection.

Operator commands require an existing database. Backups use SQLite's online backup API and refuse
an existing destination; copying a live `.db` alone can omit committed WAL rows.

```bash
DATABASE_PATH=./data/airbag-simulation-testnet.db \
  node --env-file-if-exists=.env apps/engine/src/cli.ts backup ./backups/airbag.db
node --env-file-if-exists=.env apps/engine/src/cli.ts check-keys
```

Set `DATABASE_PATH` to the actual file for every command. Keep encrypted backups off-host and
retain the matching master-key versions separately. On the VM, run commands as `airbag`, with the
engine's environment available and `/opt/airbag/node/bin/node` as the runtime.

For a populated legacy file without a binding: stop the engine, verify its original mode/network,
back it up, then explicitly adopt it:

```bash
DATABASE_PATH=./data/airbag.db \
  node --env-file-if-exists=.env apps/engine/src/cli.ts bind-database simulation:10143
```

Other valid identities are `live:10143` and `live:143`. Adoption asserts the operator's knowledge;
it cannot determine whether old receipts were simulated.

To restore: stop the engine; preserve the original DB, WAL and SHM together; restore the backup
to a clean target path; set `DATABASE_PATH` and matching master keys; start once. Check readiness,
linked accounts, settings, receipts and pending orders. Recovery waits out persisted execution
deadlines before reconciling. Complete an off-host restore drill before real-money release.
Key rotation and suspected leaks follow [Security](SECURITY.md#rotating-the-master-key).

## Testnet verification

Use a disposable testnet wallet with gas and collateral, an existing Perpl account, One-Click
Trading enabled, a small position and a Trade key restricted to the verification host's egress IP.
Set the root `.env` with `PERPL_NETWORK=testnet`, `PERPL_API_KEY` and `PERPL_API_SECRET`.
Never paste secrets into an issue, recording or chat.

```bash
pnpm --filter @airbag/tools account
# Dry-run; inspect the proposed action before sending:
pnpm --filter @airbag/tools run deploy trim --market BTC --fraction 0.3
# With an authorized disposable testnet account:
pnpm --filter @airbag/tools run deploy trim --market BTC --fraction 0.3 --send
```

The order tool refuses mainnet and uses the same allowlisted order builders. Compare liquidation
prices with Perpl before and after, verify exact released/re-added collateral, observed fees and
transaction receipts. Public chain checks need no key:

```bash
pnpm --filter @airbag/tools check
pnpm --filter @airbag/tools measure 60
```

To verify the full engine: set `ENGINE_MODE=live`, `PERPL_NETWORK=testnet`, a stable `MASTER_KEY`,
a separate persistent `DATABASE_PATH`, and `DEMO_WALLETS` for the test wallet. Link its Trade key
through the web app. Demo mode permits a 0.3% adverse-move trigger; turn spare margin off to
exercise close-plus-readd. Choose a target beyond the position's current distance if necessary.
Restore normal settings after testing. Do not reuse the public simulation database or switch a
mainnet account into this procedure.

## Optional chain services

Deploy and configure AirbagLog following [contracts/README.md](../contracts/README.md), with a
separate low-value writer wallet and gas. Simulation refuses a real writer. Investigate failed
writes: the queue is in memory and no automatic durable backfill exists.

Envio setup is in [indexer/README.md](../indexer/README.md). Configure its network, Exchange,
AirbagLog address and token, then set the web service's `INDEXER_URL`. The core engine does not
require the indexer; absent statistics stay hidden.

## Real-money release gate

[Verification status](VERIFICATION.md#real-money-release-gates) lists the open gates. Before opening
access, independently review key custody and money movement, isolate the host, prove sustained
fault/restart behavior on disposable testnet funds, verify egress restrictions and alert delivery,
and exercise monitoring and backup restore. Historical replays and short testnet runs do not clear
those gates.
