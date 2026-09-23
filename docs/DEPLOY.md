# Deploying Airbag

The owner's runbook. Every step here needs an account or funds only the owner has. Commands assume the repo root.

## 1. Engine on Fly.io (ADR 0004, 0010)

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

- Pick the region with the lowest round trip to `app.perpl.xyz` (`fly ping` from a few regions); set `primary_region` in `fly.toml`.
- `ENGINE_MODE` defaults to `live`. For a public demo without funds, set `ENGINE_MODE=simulation` on a separate app; the UI labels everything as simulated.
- VAPID keys: `npx web-push generate-vapid-keys`. Without them, push is off and the UI says so.
- Keep one machine: the engine is a single process by design (ADR 0003).
- Backups: Fly snapshots volumes daily. Download one before any migration: `fly ssh sftp get /data/airbag.db`.

## 2. Web on Vercel

- Import the repo, set the root directory to `apps/web`. Install command `pnpm install --frozen-lockfile`; build command `pnpm build`.
- Environment: `NEXT_PUBLIC_ENGINE_URL=https://<app>.fly.dev`, `NEXT_PUBLIC_SITE_URL=https://<web domain>`, optionally `INDEXER_URL` (step 4).
- Add the web domain to the engine's `WEB_ORIGIN` (step 1). The SIWE domain is the first entry.

## 3. AirbagLog (optional, ADR 0009)

See `contracts/README.md`. Deploy with a funded deployer, use a separate low-value wallet as the writer, then `fly secrets set AIRBAG_LOG_ADDRESS=... AIRBAG_LOG_PRIVATE_KEY=...`. Record the address and deploy transaction in the README.

## 4. Indexer on Envio Cloud (optional)

See `indexer/README.md`. Needs an `ENVIO_API_TOKEN`. Set `ENVIO_CHAIN_ID`, `ENVIO_AIRBAG_LOG_ADDRESS` and, for mainnet, `ENVIO_PERPL_EXCHANGE`, then set the web app's `INDEXER_URL` to the GraphQL endpoint.

## 5. Before inviting users

- Run the M0 gate (`docs/STATUS.md`) on testnet with a real key: liquidation price matches Perpl's UI, a close fills, `t:6` re-adds, and the liquidation price moves.
- Link a real key through the web app from the deployed engine (its egress IP on the key's allow-list) and check the dashboard shows the account, then arm demo mode on a small testnet position to record a real deploy.
- Never touch mainnet funds without the owner's explicit approval.
