# 0004. Hosting: engine on Fly.io with static egress, web on Vercel, Postgres on Neon

> **Superseded by [0015](0015-free-shared-vm.md)** on 1 Oct 2026: engine and web on one free VM.

> **Amended by [0010](0010-engine-owns-state-in-sqlite.md):** no Neon; the engine keeps its state on a Fly volume.


Date: 23 Sep 2026

## Context

Each user's Perpl key is IP-locked to the engine, so the engine needs an egress IP that is static, dedicated to us, and survives redeploys. The web app is ordinary Next.js.

## Decision

- **Engine on Fly.io**, one Machine, with an **app-scoped static egress IP** (`fly ips allocate-egress`, $3.60/mo, an IPv4 + IPv6 pair per region). The engine forces IPv4 for Perpl connections so a single `/32` covers it. We allocate two IPv4 egress pairs, which gives the two ranges the LinkKey design shows and a spare for rolling deploys. The addresses come from config (`ENGINE_EGRESS_IPS`) and are shown in onboarding.
- Region: whichever Fly region has the lowest measured RTT to `app.perpl.xyz`, measured in M0/M1.
- **Web on Vercel.**
- **Postgres on Neon** (managed, TLS, free tier, branch per preview). The engine and web both connect over TLS.
- Secrets (master key, DB URL, VAPID keys) live in Fly and Vercel secret stores, never in the repo.

## Consequences

- Owner has to create Fly, Vercel and Neon accounts (checklist in STATUS).
- Rejected: Render (its static outbound IPs are shared ranges across customers, which weakens the IP lock). A plain VPS is cheaper but makes us own TLS, patching and deploys for no product gain right now.
