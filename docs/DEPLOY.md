# Deploying Airbag

What lives here: a public simulation demo, a real deploy on testnet for demo day, proving the live
trading path on testnet, and putting the engine and web app on their hosts. The testnet run has not
happened yet — Airbag has never traded on Perpl, and it is the gate on shipping live. The steps that
need an account or funds are the owner's.

Commands assume the repo root.

## Public demo (simulation)

What a visitor can click through with no wallet extension, funds or key: the real engine, guard
and web app on the paper exchange, scripted prices on Monad testnet's real blocks
([ADR 0014](adr/0014-simulation-on-monad-blocks.md)). It never holds a real key and sends nothing
to Perpl, so it needs no master key or egress IP. `fly.demo.toml` is the engine's config.

```bash
fly launch --no-deploy --copy-config --config fly.demo.toml   # pick a unique app name
fly volumes create airbag_demo_data --size 1 --config fly.demo.toml
fly secrets set WEB_ORIGIN=https://<web domain> --config fly.demo.toml
fly deploy --config fly.demo.toml
curl --fail https://<demo app>.fly.dev/ready
```

Then deploy the web app as in step 3 with `NEXT_PUBLIC_ENGINE_URL=https://<demo app>.fly.dev`.
A visitor opens `/connect`, picks "Connect a test wallet", signs in, uses "Use a test key", arms
and presses "Play a wick on BTC". Each wallet has its own prices, so visitors can't disturb each
other, and a room sharing one Wi-Fi IP gets ten times the live rate limits.

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

## 2. Engine on Fly.io

```bash
fly launch --no-deploy --copy-config          # uses fly.toml; pick a unique app name
fly volumes create airbag_data --size 1       # the SQLite file lives here
fly ips allocate-egress                       # a static IPv4 + IPv6 pair for the key allow-list
fly secrets set MASTER_KEY="$(openssl rand -base64 32)"
fly secrets set WEB_ORIGIN=https://<web domain> ENGINE_EGRESS_IPS=<egress IPv4>/32
fly secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:<you>
fly deploy
curl --fail https://<app>.fly.dev/ready
```

- Pick the region with the lowest round trip to `app.perpl.xyz` (`fly ping` from a few regions) and
  set `primary_region` in `fly.toml`.
- `ENGINE_MODE` defaults to `live`. For a public demo without funds, set `ENGINE_MODE=simulation`
  on a separate app; the UI labels everything as simulated.
- VAPID keys: `npx web-push generate-vapid-keys`. Without them, push is off and the UI says so.
- Keep one machine: the engine is a single process by design
  ([ADR 0003](adr/0003-engine-runtime.md)). `min_machines_running = 1` and auto-stop are already
  set in `fly.toml`, because protection must never sleep.
- Verify your provider's volume snapshot policy. Before migration or key rotation, make a
  consistent SQLite snapshot using the native backup command described below. Copying only
  the live `.db` file can omit committed rows still in its WAL.

### Database binding, backup and restore

Default local files are `data/airbag-<mode>-<network>.db`. Fly sets an explicit
`/data/airbag.db`; the file records mode and chain id and rejects a mismatch. Separate live and
simulation deployments need separate files/volumes. Live mode refuses `:memory:`.

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
refuses to overwrite an existing destination. On the Fly image, run from `/app/apps/engine`:

```bash
DATABASE_PATH=/data/airbag.db node src/cli.ts backup /data/airbag-backup-2026-09-27.db
```

Download the resulting backup with `fly ssh sftp get /data/airbag-backup-2026-09-27.db` and keep an
encrypted copy off the engine volume. Restore with the engine stopped: preserve the existing DB,
WAL and SHM files together, restore the backup to a clean target path, set `DATABASE_PATH`, keep
the matching master keys, and start once. Check `/ready`, linked accounts, settings and receipts.
A restore retains pending orders; restart waits out their recorded execution window before
reconciliation. File migration and backup/reopen are automated tests; a host disaster-recovery
drill is still required.

## 3. Web on Vercel

- Import the repo, set the root directory to `apps/web`. Install command
  `pnpm install --frozen-lockfile`; build command `pnpm build`.
- Environment: `NEXT_PUBLIC_ENGINE_URL=https://<app>.fly.dev`,
  `NEXT_PUBLIC_SITE_URL=https://<web domain>`, optionally `INDEXER_URL` (step 5).
- Add the web domain to the engine's `WEB_ORIGIN` (step 2). The first entry is the SIWE domain.

## 4. AirbagLog (optional)

See `contracts/README.md`. Deploy with a funded deployer, use a separate low-value wallet as the
writer, then `fly secrets set AIRBAG_LOG_ADDRESS=... AIRBAG_LOG_PRIVATE_KEY=...`. Record the
address and deploy transaction in the root README.

## 5. Indexer on Envio Cloud (optional)

See `indexer/README.md`. Needs an `ENVIO_API_TOKEN`. Set `ENVIO_CHAIN_ID`,
`ENVIO_AIRBAG_LOG_ADDRESS` and, for mainnet, `ENVIO_PERPL_EXCHANGE`, then set the web app's
`INDEXER_URL` to the GraphQL endpoint.

## 6. Before inviting users

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
