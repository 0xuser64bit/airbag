import { sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ed25519Key, signInFrame } from '../src/auth.ts';

// RFC 8032 section 7.1, test 1: a public test vector, not a credential.
const SECRET = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'; // gitleaks:allow
const EMPTY_SIG =
  'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';

describe('Ed25519 signing', () => {
  it('loads a raw 32-byte secret and matches RFC 8032', () => {
    const key = ed25519Key(SECRET);
    expect(sign(null, Buffer.alloc(0), key).toString('hex')).toBe(EMPTY_SIG);
    expect(sign(null, Buffer.alloc(0), ed25519Key(`0x${SECRET}`)).toString('hex')).toBe(EMPTY_SIG);
  });

  it('rejects secrets that are not 32 bytes of hex', () => {
    expect(() => ed25519Key('abcd')).toThrow(/32 bytes/);
    expect(() => ed25519Key('zz'.repeat(32))).toThrow(/32 bytes/);
  });

  it('builds the mt:29 sign-in frame over the documented canonical string', () => {
    const key = ed25519Key(SECRET);
    const frame = signInFrame(10143, 'key-token', key, 1_790_000_000_000, 'bm9uY2U');
    const canonical = '10143\ntrading-ws-signin\n1790000000000\nbm9uY2U';
    expect(frame).toEqual({
      mt: 29,
      chain_id: 10143,
      api_key: 'key-token',
      timestamp: '1790000000000',
      nonce: 'bm9uY2U',
      signature: sign(null, Buffer.from(canonical), key).toString('base64url'),
    });
  });
});
