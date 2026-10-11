# HTTP API

The engine serves JSON over HTTP, plus one authenticated server-sent event stream. Local default:
`http://localhost:8787`. The public simulation is proxied at
`https://airbag.user64bit.world/engine`. Source: `apps/engine/src/api.ts`; browser response types:
`apps/web/lib/types.ts`.

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
| `POST /v1/key` | `{apiKey, apiSecret, ipLocked: true}`; verifies ownership and Trade-scope admission before storing the encrypted secret | 6 |
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

Settings fields: `sensitivity` (`early`, `balanced`, `late`), `targetPct` (integer 6–20),
`maxTrimPct` (25, 50, 75, 100), `useSpare`, `push`, `armed`, `demo` (booleans).
Arming requires a linked key; demo mode requires `DEMO_WALLETS` eligibility. An episode already
in progress retains its original policy. The `push` setting controls notification delivery to
both configured channels; subscription and chat links are managed separately.

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
