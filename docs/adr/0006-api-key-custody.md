# 0006. API secret custody: AES-256-GCM envelope encryption in the engine only

Date: 23 Sep 2026

## Context

A user's Perpl API secret can't withdraw, but it can trade. Leaking it lets an attacker open positions on the user's account, from any IP on the key's allow-list. It's the crown jewel.

## Decision

- **Paste flow (MVP):** the browser sends the key and secret over TLS **directly to the engine's API**, never to the web app's server. The request needs a valid SIWE session for the wallet that owns the Perpl account.
- **Envelope encryption with `node:crypto`**: each secret is encrypted with its own random 256-bit data key (AES-256-GCM, random 96-bit nonce, the account id as associated data). The data key is wrapped with the **master key** (AES-256-GCM), which comes from the host's secret store (`MASTER_KEY`, 32 bytes base64). Stored: `{ciphertext, nonce, tag, wrappedDek, dekNonce, dekTag, keyVersion}`.
- Decrypt only in engine memory, only to sign. Secrets are never logged (redaction list), never returned by any endpoint, never written to disk unencrypted.
- **Rotation:** `MASTER_KEY_<version>` values can coexist. A script re-wraps every data key under the new version, and the old version is removed once none reference it. Procedure goes in `docs/SECURITY.md` (M4).
- **Preferred flow (when Perpl whitelists our Origin):** the engine generates the Ed25519 keypair, requests the EIP-712 payload, the user signs it in their wallet, and the engine submits the proof of possession. The secret never leaves the engine.

## Consequences

- No KMS dependency for the hackathon. A cloud KMS can wrap the data keys later without changing the storage format.
- libsodium was rejected: `node:crypto` AES-GCM gives the same guarantees with no dependency.
