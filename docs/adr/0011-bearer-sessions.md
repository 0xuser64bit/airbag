# 0011. Sessions are bearer tokens from Sign-In with Ethereum

Date: 23 Sep 2026. Amends 0007 (which planned an HTTP-only cookie).

## Context

The web app (Vercel) and the engine API (Fly) are on different sites until the owner puts both
under one domain. A cookie set by `*.fly.dev` for pages on `*.vercel.app` is a third-party cookie,
which Safari blocks and Chrome is phasing out. The live dashboard also needs a streaming
connection that carries the session.

## Decision

- The browser signs an EIP-4361 message; the engine checks the domain (from `WEB_ORIGIN`), the
  chain id, a single-use nonce that expires in 10 minutes, the times, and the signer. EOAs are
  recovered locally; if that fails, the engine asks the chain (EIP-1271 smart wallets).
- On success the engine returns a random 32-byte token, stored only as its SHA-256 hash, valid for
  7 days, revocable by logging out. The browser keeps it in localStorage and sends
  `Authorization: Bearer` on every call.
- The live dashboard is server-sent events read with `fetch`, because `EventSource` can't send
  headers. CORS allows only the `WEB_ORIGIN` origins; no credentials mode is involved.

## Consequences

- Works across any hosting split, including `localhost` ports, with no CSRF surface: nothing is
  sent automatically.
- A token in localStorage is readable by script on the page, so XSS would expose it. Mitigations:
  React's escaping, no third-party scripts, and a narrow blast radius. A session can change
  settings and link or unlink keys for its own wallet only; it can never read a secret. Demo mode
  (aggressive thresholds) is refused unless the wallet is on the operator's `DEMO_WALLETS` list,
  so a stolen session can't turn Airbag into a position closer.
- Moving to a same-site cookie later is a contained change in `auth.ts` and `lib/api.ts`.
