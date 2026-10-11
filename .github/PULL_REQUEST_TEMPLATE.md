## What this changes and why

## Verification

- [ ] `pnpm check` (lint, typecheck, unit and property tests)
- [ ] `pnpm e2e`, if it touches the web app or engine API
- [ ] `pnpm contracts:test`, if it touches `contracts/`
- [ ] `gitleaks git . --redact`, if it adds test vectors that look like keys

## Notes for review

Update the affected product documentation in the same change. Explain any change to the order allowlist, stale-data guard, per-position lock or risk arithmetic.
