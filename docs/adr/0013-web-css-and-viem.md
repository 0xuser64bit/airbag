# 0013. Web: CSS custom properties and viem, no Tailwind or wagmi

Date: 23 Sep 2026. Amends 0007.

## Decision

- Styling is the design's tokens as CSS custom properties (`app/globals.css`), a few shared
  classes, and CSS modules per screen. The design is written as exact values; a utility layer
  would have added a build dependency to express the same values less directly.
- Wallets are viem only: EIP-6963 discovery of injected wallets, EIP-1193 requests, and viem's
  SIWE helpers. wagmi would add React Query and a connector stack for one account and one
  signature. WalletConnect needs a project id from an account only the owner can create; mobile
  users can open the app in their wallet's browser meanwhile.
- The rest of 0007 stands: Next.js App Router, `next/og` for the save card, `next/font` with the
  `wdth` axis, a PWA with Web Push, axe in end-to-end tests.
