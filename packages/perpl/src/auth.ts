// Ed25519 request signing with node:crypto.
// https://github.com/PerplFoundation/api-docs/blob/main/authentication.md

import { createPrivateKey, type KeyObject, randomBytes, sign } from 'node:crypto';

// DER prefix that wraps a raw 32-byte Ed25519 seed as PKCS#8 (RFC 8410).
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Loads Perpl's API secret (hex of the 32-byte Ed25519 private key, optional 0x). */
export function ed25519Key(secretHex: string): KeyObject {
  const hex = secretHex.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('API secret must be 32 bytes of hex');
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
}

export interface SignInFrame {
  mt: 29;
  chain_id: number;
  api_key: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

/** Trading WS sign-in (mt:29). Must be the first frame, sent within the idle timeout. */
export function signInFrame(
  chainId: number,
  apiKey: string,
  key: KeyObject,
  now = Date.now(),
  nonce = randomBytes(16).toString('base64url'),
): SignInFrame {
  const timestamp = String(now);
  const canonical = [chainId, 'trading-ws-signin', timestamp, nonce].join('\n');
  const signature = sign(null, Buffer.from(canonical), key).toString('base64url');
  return { mt: 29, chain_id: chainId, api_key: apiKey, timestamp, nonce, signature };
}
