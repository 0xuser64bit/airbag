// Sign-In with Ethereum (EIP-4361) and bearer sessions (ADR 0011). Nonces are single-use and
// short-lived; sessions are random tokens stored only as SHA-256 hashes.

import { createHash, randomBytes } from 'node:crypto';
import { createPublicClient, getAddress, type Hex, http, recoverMessageAddress } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import type { Store } from './db.ts';

const NONCE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export interface AuthOptions {
  store: Store;
  /** Hosts allowed as the SIWE `domain`, from WEB_ORIGIN. */
  domains: string[];
  chainId: number;
  /** For EIP-1271 smart-wallet signatures. EOAs are verified locally. */
  rpcUrl?: string;
}

export class Auth {
  private readonly nonces = new Map<string, number>();
  private readonly opts: AuthOptions;
  private readonly client;

  constructor(opts: AuthOptions) {
    this.opts = opts;
    this.client = opts.rpcUrl
      ? createPublicClient({ transport: http(opts.rpcUrl, { timeout: 10_000 }) })
      : undefined;
  }

  nonce(now = Date.now()): string {
    for (const [n, exp] of this.nonces) if (exp <= now) this.nonces.delete(n);
    if (this.nonces.size > 10_000) throw new Error('too many pending sign-ins');
    const nonce = randomBytes(16).toString('hex');
    this.nonces.set(nonce, now + NONCE_TTL_MS);
    return nonce;
  }

  /** Verifies a signed SIWE message and opens a session. Throws a user-facing message. */
  async verify(
    message: string,
    signature: Hex,
    now = Date.now(),
  ): Promise<{ token: string; wallet: string; expiresAt: number }> {
    const m = parseSiweMessage(message);
    if (!m.address || !m.nonce || !m.domain) throw new Error('Not a sign-in message.');
    if (
      m.version !== '1' ||
      !m.uri ||
      !m.issuedAt ||
      !validateSiweMessage({ message: m, time: new Date(now) })
    ) {
      throw new Error('Invalid sign-in message.');
    }
    if (!this.opts.domains.includes(m.domain)) throw new Error(`Wrong domain ${m.domain}.`);
    const uri = new URL(m.uri);
    if (
      uri.host !== m.domain ||
      !['http:', 'https:'].includes(uri.protocol) ||
      uri.username ||
      uri.password
    ) {
      throw new Error('Sign-in URI does not match the domain.');
    }
    if (m.chainId !== this.opts.chainId) throw new Error(`Sign in on chain ${this.opts.chainId}.`);
    const exp = this.nonces.get(m.nonce);
    if (!exp || exp <= now) throw new Error('This sign-in request expired. Try again.');
    if (m.expirationTime && m.expirationTime.getTime() <= now) throw new Error('Sign-in expired.');
    if (m.notBefore && m.notBefore.getTime() > now) throw new Error('Sign-in not valid yet.');
    if (
      !Number.isFinite(m.issuedAt.getTime()) ||
      Math.abs(m.issuedAt.getTime() - now) > NONCE_TTL_MS
    ) {
      throw new Error('Sign-in was issued too long ago.');
    }
    // Consume before any await: two concurrent verifications must not share this nonce.
    this.nonces.delete(m.nonce);
    const address = getAddress(m.address);
    let ok = false;
    try {
      ok = (await recoverMessageAddress({ message, signature })) === address;
    } catch {
      ok = false;
    }
    if (!ok && this.client) {
      // Smart-contract wallets sign with EIP-1271; ask the chain.
      ok = await this.client.verifyMessage({ address, message, signature }).catch(() => false);
    }
    if (!ok) throw new Error('The signature does not match the wallet.');

    const token = randomBytes(32).toString('base64url');
    const wallet = address.toLowerCase();
    const expiresAt = now + SESSION_TTL_MS;
    this.opts.store.createSession(wallet, hashToken(token), expiresAt, now);
    return { token, wallet, expiresAt };
  }

  /** The wallet behind a bearer token, if the session is live. */
  wallet(token: string | undefined, now = Date.now()): string | undefined {
    return token ? this.opts.store.sessionWallet(hashToken(token), now) : undefined;
  }

  logout(token: string): void {
    this.opts.store.deleteSession(hashToken(token));
  }
}
