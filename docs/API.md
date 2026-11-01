# HTTP API

[Documentation](README.md) · [Architecture](ARCHITECTURE.md) · [Operations](DEPLOY.md)

The engine serves JSON over HTTP, plus one authenticated server-sent event stream. Local default:
`http://localhost:8787`. The public simulation is proxied at
`https://airbag.user64bit.world/engine`. Source: `apps/engine/src/api.ts`; browser response types:
`apps/web/lib/types.ts`.

## First requests

Start the local simulation with `pnpm dev:engine`, then inspect its environment and readiness:

```bash
curl -fsS http://localhost:8787/v1/config
curl -fsS http://localhost:8787/ready
```

Use the web app's sign-in flow to obtain a wallet-scoped session. With its token available as
`AIRBAG_TOKEN` in your shell, read a snapshot or stream updates:

```bash
curl -fsS -H "Authorization: Bearer $AIRBAG_TOKEN" http://localhost:8787/v1/state
curl -N -H "Authorization: Bearer $AIRBAG_TOKEN" http://localhost:8787/v1/stream
```

Treat a bearer token as a secret: do not include it in URLs, screenshots, issues or committed files.
An unlinked wallet can sign in, but needs a linked key before arming protection.

## Authentication and transport

Obtain a nonce from `POST /v1/auth/nonce`, sign an EIP-4361 message for the configured domain and
chain, then send `{ "message": "…", "signature": "0x…" }` to `POST /v1/auth/verify`.
The response contains `token`, `wallet` and `expiresAt`. Nonces expire after ten minutes and are
single-use; bearer sessions expire after seven days. Protected requests send
`Authorization: Bearer <token>`. Tokens grant access only to their signed-in wallet.

JSON request bodies need `Content-Type: application/json` and are capped at 16 KiB. Browser CORS
allows only configured `WEB_ORIGIN` origins. Each method/path has a per-IP request budget; default
120/minute, with tighter budgets below. Simulation multiplies those budgets by ten.

Successful JSON responses return HTTP 200. Errors have this shape and also set `X-Request-Id`:

```json
{"error":{"code":"bad_request","message":"…","requestId":"…"}}
```

Expect 400 for invalid input, 401 for an invalid session/signature, 403 for forbidden scope, 404
for an absent resource/disabled feature, 409 for a conflicting deploy or connection limit, 413 for
an oversized body, 415 for a non-JSON body, 429 for rate limits, 503 for unavailable readiness,
and 504 for an upstream timeout. A 429 sets `Retry-After: 60`; a 405 sets `Allow`.

## Public endpoints

| Method and path | Result | Budget/minute |
|---|---|---|
| `GET /health` | Mode, network, feed freshness, head, block source and account connection counts; diagnostic HTTP 200 even when `ok` is false | 120 |
| `GET /ready` | `{ok, mode, head}` or HTTP 503 if the feed/tick is stale; use for uptime monitoring | 120 |
| `GET /v1/config` | Mode, network, chain, explorers, egress IPs, covered markets and available alert providers | 120 |
| `GET /v1/lookup/:address` | Wallet's account and positions; address validated, result cached for 15 s | 20 |
| `POST /v1/auth/nonce` | `{nonce}`; no request body needed | 20 |
| `POST /v1/auth/verify` | SIWE message/signature → bearer session | 20 |
| `GET /v1/saves/:id` | Public report for a save; precautions and other receipts return 404 | 60 |

## Wallet endpoints

All require a bearer session.

| Method and path | Request / result | Budget/minute |
|---|---|---|
| `GET /v1/me` | Wallet, link metadata, settings, demo eligibility and Telegram linkage | 120 |
| `POST /v1/auth/logout` | Revokes this session | 120 |
| `POST /v1/auth/logout-all` | Revokes every session for this wallet, including the caller | 120 |
| `POST /v1/key` | `{apiKey, apiSecret, ipLocked: true}`; live mode verifies ownership and Trade-scope admission before encrypted storage; see mode distinctions below | 6 |
| `DELETE /v1/key` | Unlinks the key; refused while a deploy needs reconciliation | 120 |
| `PUT /v1/settings` | Partial settings update → complete stored settings | 60 |
| `GET /v1/state` | Complete dashboard state | 240 |
| `GET /v1/stream` | `text/event-stream`: `data: <dashboard JSON>` on blocks and during feed silence | 30 |
| `GET /v1/deploys` | Most recent 50 deploy summaries for this wallet | 120 |
| `GET /v1/deploys/:id` | Private receipt, including the timeline; another wallet's id returns 404 | 120 |
| `POST /v1/push` | Browser PushSubscription `{endpoint, keys: {p256dh, auth}}`; provider and encryption keys validated | 20 |
| `DELETE /v1/push` | `{endpoint}` removes this wallet's subscription | 120 |
| `POST /v1/telegram` | No body; returns `{url}` with a one-use Start link, or 404 if the bot is disabled | 10 |
| `DELETE /v1/telegram` | Removes this wallet's linked chat | 120 |

`apiSecret` is an Ed25519 secret encoded as **64 hexadecimal characters**, optionally prefixed
by `0x`. Live key verification checks Perpl ownership and proves gateway Trade-scope admission,
not a successful fill. `ipLocked: true` is a required user acknowledgement, not a verified IP list.
When `ENGINE_EGRESS_IPS` is empty, the UI instead acknowledges that the key is **not** IP-locked;
the API accepts the same Boolean. Fixed published egress IPs and a configured Perpl allow-list
are prerequisites for real-money operation.

**Simulation is different:** syntactically valid test credentials create a synthetic account;
no Perpl ownership or scope check occurs. The link response includes `simulated: true` alongside
`tradeScope: true`; the latter is not proof of live scope. Use the UI's test key and never submit
real exchange credentials to a simulation engine.

Settings fields: `sensitivity` (`early`, `balanced`, `late`), `targetPct` (integer 6–20),
`maxTrimPct` (25, 50, 75, 100), `useSpare`, `push`, `armed`, `demo` (booleans).
Arming requires a linked key; demo mode requires `DEMO_WALLETS` eligibility. An episode already
in progress retains its original policy. The `push` setting controls **Web Push only**. Telegram
delivery depends on chat linkage, independently of that setting; stop it with
`DELETE /v1/telegram` or `/stop` in the bot. Subscription and chat links are managed separately.

Read SSE using streaming `fetch` so the bearer header is sent. Reconnect after connection loss;
the engine ends expired sessions and drops clients with over 64 KiB of buffered output. Public
save reports contain derived trading figures but no wallet address or credentials.

## Simulation controls

All require a session and return 404 in live mode.

| Method and path | Body / behavior | Budget/minute |
|---|---|---|
| `POST /v1/sim/price` | `{symbol, price}` sets a positive mark for this simulated wallet | 120 |
| `POST /v1/sim/wick` | `{symbol}` plays a path through this position's Airbag line and original liquidation price; requires an existing position | 20 |
| `POST /v1/sim/reset` | Restores this wallet's sample positions and prices (receipt history is retained); requires a link and no pending deploy | 20 |

Keep simulation accounts and live accounts in different databases. Never use simulation controls
as a live integration test.
