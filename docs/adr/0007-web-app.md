# 0007. Web: Next.js App Router, Tailwind tokens, wagmi/viem, SIWE, PWA push

Date: 23 Sep 2026

## Decision

- **Next.js (App Router)** with server components for the public pages (`/`, `/s/[id]`) and client components for live views. `/s/[id]` renders its OG image with `next/og` at 1200×675.
- **Tailwind CSS** with the design tokens from `design/` as CSS variables. The three families come from `next/font/google`, with Archivo's `wdth` axis.
- **wagmi + viem** for wallet connect. **SIWE (EIP-4361)** via viem's built-in `createSiweMessage`/`verifySiweMessage` (no separate `siwe` package). The session is an HTTP-only cookie verified by the engine API.
- **Live data:** SSE from the engine.
- **PWA:** a web manifest plus a service worker for Web Push (VAPID). The engine sends pushes with `web-push`.
- **Accessibility:** axe checks in Playwright end-to-end tests, run in CI.

## Consequences

- The risk package runs unchanged in the browser for the live settings preview, so the preview and the engine can't disagree.
