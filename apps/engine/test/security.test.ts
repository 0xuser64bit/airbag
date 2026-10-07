import { createECDH, randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { describe, expect, it } from 'vitest';
import { Auth } from '../src/auth.ts';
import { openStore } from '../src/db.ts';
import { redact } from '../src/log.ts';
import { validatePush } from '../src/notify.ts';

it('consumes a nonce before asynchronous signature verification', async () => {
  const store = openStore(':memory:');
  try {
    const auth = new Auth({ store, domains: ['localhost:3000'], chainId: 10143 });
    const account = privateKeyToAccount(generatePrivateKey());
    const message = createSiweMessage({
      domain: 'localhost:3000',
      address: account.address,
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 10143,
      nonce: auth.nonce(),
      issuedAt: new Date(),
    });
    const signature = await account.signMessage({ message });
    const results = await Promise.allSettled([
      auth.verify(message, signature),
      auth.verify(message, signature),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const bad of [
      message.replace('http://localhost:3000', 'https://evil.example'),
      message.replace(/Issued At: .*/, 'Issued At: invalid'),
      message.replace('Version: 1', 'Version: 2'),
      `${message}\nExpiration Time: invalid`,
    ]) {
      await expect(auth.verify(bad, await account.signMessage({ message: bad }))).rejects.toThrow();
    }
  } finally {
    store.close();
  }
});

it('accepts valid browser push subscriptions and blocks SSRF destinations and malformed keys', () => {
  const key = createECDH('prime256v1');
  key.generateKeys();
  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test',
    keys: {
      p256dh: key.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
  for (const host of [
    'fcm.googleapis.com',
    'updates.push.services.mozilla.com',
    'web.push.apple.com',
    'wns1.notify.windows.com',
  ]) {
    expect(() => validatePush({ ...sub, endpoint: `https://${host}/test` })).not.toThrow();
  }
  for (const endpoint of [
    'https://127.0.0.1/private',
    'https://[::1]/',
    'https://metadata.google.internal/',
    'https://fcm.googleapis.com.evil.example/',
    'https://evil.example/?fcm.googleapis.com',
    'https://fcm.googleapis.com:8443/',
    'https://user:pass@fcm.googleapis.com/',
    'http://fcm.googleapis.com/',
  ])
    expect(() => validatePush({ ...sub, endpoint })).toThrow();
  expect(() => validatePush({ ...sub, keys: { ...sub.keys, auth: 'invalid' } })).toThrow();
  expect(() =>
    validatePush({
      ...sub,
      keys: { ...sub.keys, p256dh: Buffer.alloc(65, 4).toString('base64url') },
    }),
  ).toThrow();
});

describe('log redaction', () => {
  it('redacts push keys, endpoints, chats and sealed envelopes at any depth', () => {
    const out = redact({
      sub: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/secret',
        keys: { p256dh: 'pub', auth: 'auth-secret' },
      },
      telegram: { chat_id: 123, chat: 'private' },
      link: { sealed: { ct: 'x', tag: 'y' }, wallet: '0xabc' },
    }) as Record<string, unknown>;
    expect(out).toMatchObject({
      sub: {
        endpoint: '[redacted]',
        keys: { p256dh: '[redacted]', auth: '[redacted]' },
      },
      telegram: { chat_id: '[redacted]', chat: '[redacted]' },
      link: { sealed: '[redacted]', wallet: '0xabc' },
    });
  });

  it('truncates deep objects instead of returning them raw', () => {
    let deep: Record<string, unknown> = { auth: 'shh' };
    for (let i = 0; i < 10; i++) deep = { nested: deep };
    const redacted = redact(deep) as Record<string, unknown>;
    expect(redacted).toEqual({ nested: expect.anything() });
    let v: unknown = redacted;
    for (let d = 0; d < 10 && v !== null && typeof v === 'object'; d++) {
      v = (v as Record<string, unknown>).nested;
    }
    expect(v).toBe('[truncated]');
  });
});
