# Deploying Airbag

What lives here: the public simulation demo on the free VM, a real deploy on testnet for demo day,
proving the live trading path on testnet, and operating the VM. The testnet run has not happened
yet — Airbag has never traded on Perpl, and it is the gate on shipping live. The steps that need an
account or funds are the owner's. Hosting is one free, shared VM
([ADR 0015](adr/0015-free-shared-vm.md)).

Commands assume the repo root.

## Public demo (simulation)

**Live at https://airbag.92-4-67-109.sslip.io** (engine:
https://airbag-engine.92-4-67-109.sslip.io/health). What a visitor can click through with no
wallet extension, funds or key: the real engine, guard and web app on the paper exchange,
scripted prices on Monad testnet's real blocks ([ADR 0014](adr/0014-simulation-on-monad-blocks.md)).
It never holds a real key and sends nothing to Perpl, so it needs no master key or egress IP.

A visitor opens `/connect`, picks "Connect a test wallet", signs in, uses "Use a test key", arms
and presses "Play a wick on BTC". Each wallet has its own prices, so visitors can't disturb each
other, and a room sharing one Wi-Fi IP gets ten times the live rate limits.

To deploy a commit, from a clean working tree:

```bash
deploy/vm/deploy.sh    # about a minute: ships HEAD, builds it on the VM, switches, checks /ready
```

It needs SSH to the VM (`AIRBAG_VM`, default `ubuntu@92.4.67.109`, key `AIRBAG_VM_KEY`). The first
run installs everything; later runs only add a release. See step 2 for what it puts where.

## Demo day: a real deploy on Perpl testnet

The strongest demo is a real one: Airbag trimming a real testnet position and re-adding its
margin, with Perpl transactions anyone can open. The code path exists; it needs the owner's
disposable testnet wallet. About fifteen minutes, testnet only:

1. Do the owner checklist in step 1 below: a new testnet wallet with MON and AUSD, a deposit,
   **One-Click Trading on**, a small BTC long at about 10x, and a **Trade** key. Leave its IP
   allow-list empty for a local run.
2. In `.env`, set `ENGINE_MODE=live`, `PERPL_NETWORK=testnet`, `DEMO_WALLETS=<that wallet>` and a
   stable `MASTER_KEY` (`openssl rand -base64 32`; a new one means relinking the key). Then:
   ```bash
   pnpm dev:engine    # .env overrides .env.example's simulation default
   pnpm dev:web
   ```
3. At http://localhost:3000/connect connect that wallet (Rabby or MetaMask on Monad testnet),
   sign in, paste the key and confirm the allow-list wording; the engine probes Trade scope
   before storing anything. In "Set your airbag", turn on **Demo mode** (deploys after a 0.3%
   move against the position, shown only to `DEMO_WALLETS`) and arm.
4. Wait for BTC to move 0.3% against the position. The dashboard's block log shows the
   reduce-only close and the margin re-add with their Perpl transactions; check the new
   liquidation price against Perpl's UI. Turn demo mode off afterwards.

## 1. Verify on testnet first

The engine's per-block loop, order allowlist, re-add and save logic are exercised against a paper
exchange in CI. What only a funded testnet account can prove is the live protocol path: that
Perpl's liquidation price matches ours to the dollar, that a `t:3`/`t:4` IOC close fills, and that
`t:6` re-adds the released margin and moves the liquidation price. The last one decides whether the
product works at all ([RISK-MODEL.md](RISK-MODEL.md)).

`spike/` holds the scripts. They are testnet-only, dry-run unless you pass `--send`, and every order
still goes through the allowlist.

```bash
cp .env.example .env    # then fill in PERPL_API_KEY and PERPL_API_SECRET

pnpm --filter @airbag/spike account                            # sign in, read positions, liquidation price two ways
pnpm --filter @airbag/spike deploy add --market BTC --amount 1 --send
pnpm --filter @airbag/spike deploy trim --market BTC --fraction 0.3 --send
pnpm --filter @airbag/spike measure 60                         # block time and feed lag, public data only
pnpm --filter @airbag/spike check                              # Airbag's position math vs the contract, no key
PERPL_NETWORK=mainnet MONAD_RPC_URL=https://rpc1.monad.xyz pnpm --filter @airbag/spike liquidations   # vs Perpl's liquidations
```

`account` prints the liquidation price derived from the trading WS beside the one derived from the
chain; both must equal what Perpl's own UI shows. `deploy trim` prints the block-by-block timeline:
trigger, send, fill, re-add, new liquidation.

### Owner checklist to unblock the run

1. Create a **new testnet-only wallet**. Don't use one that holds real funds.
2. Get testnet MON for gas at https://faucet.monad.xyz.
3. Get testnet AUSD through testnet.perpl.xyz's test-funds flow. The testnet minimum to open an
   account is 100 AUSD; about 1,000 AUSD gives room for a few runs.
4. On https://testnet.perpl.xyz: deposit (this creates the exchange account), then turn on
   **One-Click Trading** in settings. Without order forwarding every API order fails.
5. Open a small **BTC long at about 10x** (e.g. 0.01 BTC) and note the **liquidation price Perpl
   shows**.
6. At https://testnet.perpl.xyz/apikeys create a key with **Trade** scope. For the IP allow-list,
   add this machine's public IP, or leave it empty for the spike.
7. Put the key in `PERPL_API_KEY` and the 32-byte Ed25519 private key (hex) in `PERPL_API_SECRET`
   in `.env`. **Don't paste either into chat, an issue or a commit.** `.env` is gitignored.

Nothing goes to mainnet without the owner's explicit approval.

## 2. Operating the VM

`deploy/vm/deploy.sh` ships the committed tree with `git archive`; `deploy/vm/provision.sh` runs on
the VM as root. The VM serves other projects too, so Airbag keeps to its own corner:

| What | Where |
|---|---|
| Releases, one per commit (the three newest kept) | `/opt/airbag/releases/<sha>`, current one at `/opt/airbag/app` |
| Node 24, Airbag's own (the system Node is 20) | `/opt/airbag/node` |
| Engine and web, as user `airbag`, on localhost | `airbag-engine.service` (8789), `airbag-web.service` (3089) |
| Engine configuration, written once, never overwritten | `/etc/airbag/engine.env` (root:airbag, 0640) |
| SQLite | `/var/lib/airbag/airbag-simulation-testnet.db` |
| TLS and routing | Airbag's marked block in `/etc/caddy/Caddyfile`; backups beside it as `Caddyfile.bak-airbag-*` |

```bash
ssh ubuntu@92.4.67.109
journalctl -u airbag-engine -f                 # JSON-lines logs; also airbag-web
curl -s localhost:8789/health                  # mode, head, staleness, accounts, which clock
sudo ln -sfn /opt/airbag/releases/<sha> /opt/airbag/app && sudo systemctl restart airbag-engine airbag-web   # roll back
```

The public URLs are baked into each web build. Another hostname means
`AIRBAG_DOMAIN=... AIRBAG_ENGINE_DOMAIN=... deploy/vm/deploy.sh` and a matching `WEB_ORIGIN` in
`engine.env` (its first entry is the SIWE domain).

### Live mode on the VM

The VM's public IP is fixed for the instance's life, so it can be the egress address on users' key
allow-lists. Set in `/etc/airbag/engine.env`: `ENGINE_MODE=live`, a `MASTER_KEY`
(`openssl rand -base64 32`), `ENGINE_EGRESS_IPS=92.4.67.109/32`, a new `DATABASE_PATH` (a
simulation file is refused in live mode), optionally the VAPID keys
(`npx web-push generate-vapid-keys`), then `sudo systemctl restart airbag-engine`. The VM is shared
with other projects that administer it as root: fine for testnet, not for real funds
([ADR 0015](adr/0015-free-shared-vm.md)). Put an uptime check on `/ready` either way; while the engine
is down, nothing is trimmed.

### Database binding, backup and restore

Default local files are `data/airbag-<mode>-<network>.db`; the VM sets an explicit path. The file
records mode and chain id and rejects a mismatch. Separate live and simulation deployments need
separate files. Live mode refuses `:memory:`.

For an existing populated file created before environment binding, stop the engine, inspect its
source environment and take a backup. Then adopt it explicitly; this command is an assertion by
the operator and cannot determine whether legacy receipts were originally simulated:

```bash
DATABASE_PATH=./data/airbag.db node --env-file-if-exists=.env apps/engine/src/cli.ts backup ./backups/airbag-before-bind.db
DATABASE_PATH=./data/airbag.db node --env-file-if-exists=.env apps/engine/src/cli.ts bind-database live:10143
```

Use `simulation:10143` for the old testnet simulation, or `live:143` only for a verified mainnet
file. Select that same `DATABASE_PATH` when starting the engine; never switch identities to get
past a rejection. Do not reuse a mainnet file for tests.

The `backup` command uses SQLite's online backup API, works while the engine is running and
refuses to overwrite an existing destination. Copying only the live `.db` file can omit committed
rows still in its WAL. On the VM:

```bash
# on the VM
sudo -u airbag env DATABASE_PATH=/var/lib/airbag/airbag-simulation-testnet.db \
  /opt/airbag/node/bin/node /opt/airbag/app/apps/engine/src/cli.ts backup /var/lib/airbag/backup-2026-10-01.db
sudo install -m 600 -o ubuntu /var/lib/airbag/backup-2026-10-01.db ~ubuntu/
# from your machine
scp -i <key> ubuntu@92.4.67.109:backup-2026-10-01.db .
```

Keep an encrypted copy off the VM. Restore with the engine stopped: preserve the existing DB, WAL
and SHM files together, restore the backup to a clean target path, set `DATABASE_PATH`, keep the
matching master keys, and start once. Check `/ready`, linked accounts, settings and receipts.
A restore retains pending orders; restart waits out their recorded execution window before
reconciliation. File migration and backup/reopen are automated tests; a host disaster-recovery
drill is still required.

## 3. AirbagLog (optional)

See `contracts/README.md`. Deploy with a funded deployer, use a separate low-value wallet as the
writer, then add `AIRBAG_LOG_ADDRESS` and `AIRBAG_LOG_PRIVATE_KEY` to a live engine's
`/etc/airbag/engine.env` (simulation refuses a real log). Record the address and deploy transaction
in the root README.

## 4. Indexer on Envio Cloud (optional)

See `indexer/README.md`. Needs an `ENVIO_API_TOKEN`. Set `ENVIO_CHAIN_ID`,
`ENVIO_AIRBAG_LOG_ADDRESS` and, for mainnet, `ENVIO_PERPL_EXCHANGE`, then give the web app
`INDEXER_URL`, the GraphQL endpoint: `sudo systemctl edit airbag-web`, add
`[Service]` and `Environment=INDEXER_URL=...`, and restart it.

## 5. Before inviting users

- Step 1 passed: liquidation price matches Perpl's UI, a close fills, `t:6` re-adds, and the
  liquidation price moves.
- Link a real key through the web app from the deployed engine (its egress IP on the key's
  allow-list), check the dashboard shows the account, then arm demo mode on a small testnet
  position to record a real deploy and check the push alert arrives.
- An uptime check on `/ready`, and an uptime alert on the engine being down: while it is down,
  nothing is being trimmed.
- Match the live taker fee tier, observed `Order.f`, net released collateral and post-deploy
  liquidation with Perpl. The historical zero-fee landing replay is not a live estimate.
- Exercise pause/re-arm and restart during a close, during a re-add, and after a lost acknowledgement
  using only a disposable testnet position. No duplicate add or unexpected trim is acceptable.
