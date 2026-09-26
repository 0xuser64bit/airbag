# Deploying Airbag

Two things live here: proving the live trading path on testnet, and putting the engine and web app on
their hosts. The testnet run has not happened yet — Airbag has never traded on Perpl, and it is the
gate on shipping live. The steps that need an account or funds are the owner's.

Commands assume the repo root.

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
curl https://<app>.fly.dev/health
```

- Pick the region with the lowest round trip to `app.perpl.xyz` (`fly ping` from a few regions) and
  set `primary_region` in `fly.toml`.
- `ENGINE_MODE` defaults to `live`. For a public demo without funds, set `ENGINE_MODE=simulation`
  on a separate app; the UI labels everything as simulated.
- VAPID keys: `npx web-push generate-vapid-keys`. Without them, push is off and the UI says so.
- Keep one machine: the engine is a single process by design
  ([ADR 0003](adr/0003-engine-runtime.md)). `min_machines_running = 1` and auto-stop are already
  set in `fly.toml`, because protection must never sleep.
- Backups: Fly snapshots volumes daily. Download one before any migration:
  `fly ssh sftp get /data/airbag.db`.

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
- An uptime check on `/health`, and an uptime alert on the engine being down: while it is down,
  nothing is being trimmed.
