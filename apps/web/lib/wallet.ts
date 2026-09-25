'use client';

// Wallet connection with nothing but viem: EIP-6963 discovery of injected wallets, EIP-1193
// requests, and Sign-In with Ethereum (EIP-4361). No wallet SDK, no project id.

import { createWalletClient, custom, type EIP1193Provider, getAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { api } from './api.ts';
import { type Session, saveSession } from './session.ts';

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  provider: EIP1193Provider;
}

interface AnnounceEvent extends Event {
  detail: {
    info: { uuid: string; name: string; icon: string; rdns: string };
    provider: EIP1193Provider;
  };
}

/** Lists injected wallets (EIP-6963), falling back to window.ethereum. */
export function discoverWallets(onChange: (wallets: WalletOption[]) => void): () => void {
  const found = new Map<string, WalletOption>();
  const onAnnounce = (e: Event) => {
    const { info, provider } = (e as AnnounceEvent).detail;
    found.set(info.rdns || info.uuid, {
      id: info.rdns || info.uuid,
      name: info.name,
      icon: info.icon,
      provider,
    });
    onChange([...found.values()]);
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const fallback = setTimeout(() => {
    const injected = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
    if (found.size === 0 && injected)
      found.set('injected', { id: 'injected', name: 'Browser wallet', provider: injected });
    // Always answer, so a browser with no wallet hears "none found" instead of waiting forever.
    onChange([...found.values()]);
  }, 300);
  return () => {
    clearTimeout(fallback);
    window.removeEventListener('eip6963:announceProvider', onAnnounce);
  };
}

export async function requestAddress(provider: EIP1193Provider): Promise<`0x${string}`> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  const first = accounts[0];
  if (!first) throw new Error('The wallet returned no account.');
  return getAddress(first);
}

/** Signs a SIWE message for this site and opens an engine session. */
export async function signIn(
  provider: EIP1193Provider,
  address: `0x${string}`,
  chainId: number,
): Promise<Session> {
  const { nonce } = await api<{ nonce: string }>('/v1/auth/nonce', { method: 'POST' });
  const message = createSiweMessage({
    domain: window.location.host,
    address,
    statement:
      'Sign in to Airbag to link your Perpl key and change your airbag. This signature does not move funds or approve anything.',
    uri: window.location.origin,
    version: '1',
    chainId,
    nonce,
    issuedAt: new Date(),
    expirationTime: new Date(Date.now() + 10 * 60_000),
  });
  const client = createWalletClient({ transport: custom(provider) });
  const signature = await client.signMessage({ account: address, message });
  const session = await api<Session>('/v1/auth/verify', {
    method: 'POST',
    body: { message, signature },
  });
  saveSession(session);
  return session;
}

/** Wallet errors people actually see, in plain words. */
export function walletError(err: unknown): string {
  const e = err as { code?: number; shortMessage?: string; message?: string };
  if (e.code === 4001 || /reject|denied|cancel/i.test(e.message ?? ''))
    return 'You cancelled in your wallet.';
  if (e.code === -32002) return 'Your wallet already has a request open. Check the wallet window.';
  return e.shortMessage ?? e.message ?? 'The wallet request failed.';
}
