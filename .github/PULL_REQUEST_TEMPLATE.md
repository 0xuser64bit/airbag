## What this changes and why

## Verification

- [ ] `pnpm check` (lint, typecheck, unit and property tests)
- [ ] `pnpm e2e`, if it touches the web app or engine API
- [ ] `pnpm contracts:test`, if it touches `contracts/`
- [ ] `gitleaks git . --redact`, if it adds test vectors that look like keys

## Notes for review

Docs updated in the same commit (`docs/` fix, or a new ADR linked from the one it supersedes). No weakened invariants (order-type allowlist, stale-data guard, per-position lock, risk arithmetic).
