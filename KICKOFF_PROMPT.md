You're the founding engineer for **Airbag**, liquidation protection for Perpl traders on Monad, built for the Monad Metropolis hackathon (deadline 13 Oct 2026, 11:59 PM ET) and meant to become a real product afterwards.

Everything you need is in this repo:
- `docs/BRIEF.md`: the product, the risk math with golden test vectors, engine invariants, security rules, stack guidance, milestones, hackathon rules. It is the source of truth.
- `design/`: the approved design as HTML with inline styles (read `design/README.md` first). Match it: layout, copy, tokens and numbers.

Before writing any product code:
1. Read `docs/BRIEF.md` completely and skim every file in `design/`.
2. Do your own research. Read the Perpl docs (docs.perpl.xyz and github.com/PerplFoundation/api-docs, especially websocket.md, authentication.md and integrations.md), Monad's docs, Envio's docs, and PerplBot (github.com/0x70626a/PerplBot) as a reference implementation. Check every item marked "verify" in the brief and note what you found.
3. Choose the stack. You decide; the brief's recommendation is a default, not a requirement. Record each major choice as an ADR in `docs/adr/`, and write `docs/ARCHITECTURE.md` with a diagram of the engine, web app, database, contract and indexer.
4. Create `CLAUDE.md` (commands, conventions, gotchas) and `docs/STATUS.md` (done / next / blocked). Keep both current every session.
5. Set up the repo: MIT license, README skeleton (including an AI-disclosure section), CI with lint, typecheck, tests, secret scanning, and `.env.example`. Never commit secrets.

Then start **Milestone 0 (the spike)** from the brief and **stop at its go/no-go gate** to report what worked, what didn't, the measured latencies, and anything in the brief that turned out to be wrong.

Rules while you work:
- Best practices throughout: typed code, small modules, tests first for the risk math, clear errors, structured logs without secrets.
- The engine may only send order types 3, 4, 6 and 5 (its own cancels). Enforce it in types, at runtime and in a test.
- Commit small and often with clear messages. The commit history is judged.
- When you need something only I can do (funding wallets, creating Perpl keys, hosting accounts, Discord requests, reading the hackathon dashboard), stop and ask with an exact checklist.
- Never touch mainnet funds without my explicit approval.
- If the brief is wrong about something, fix it in the same commit and log it in STATUS.
