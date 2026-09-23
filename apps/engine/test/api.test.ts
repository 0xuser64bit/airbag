import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createLogger } from '../src/log.ts';

let app: App;
let base: string;
const ORIGIN = 'http://localhost:3000';

beforeAll(async () => {
  app = await buildApp(
    loadConfig({ ENGINE_MODE: 'simulation', DATABASE_PATH: ':memory:', WEB_ORIGIN: ORIGIN }),
    { log: createLogger('error', {}, () => {}), manualClock: true },
  );
  app.start();
  await new Promise<void>((r) => app.api.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.api.address() as AddressInfo).port}`;
});
afterAll(() => app.stop());

const call = async (
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined };
};

async function signIn(key = generatePrivateKey()) {
  const account = privateKeyToAccount(key);
  const { body } = await call('POST', '/v1/auth/nonce');
  const message = createSiweMessage({
    domain: 'localhost:3000',
    address: account.address,
    statement: 'Sign in to Airbag.',
    uri: ORIGIN,
    version: '1',
    chainId: 10143,
    nonce: body.nonce,
    issuedAt: new Date(),
  });
  const signature = await account.signMessage({ message });
  const res = await call('POST', '/v1/auth/verify', { body: { message, signature } });
  return { ...res, account, message, signature };
}

const secret = () => randomBytes(32).toString('hex');
const blocks = async (n: number) => {
  for (let i = 0; i < n; i++) {
    app.sim?.step();
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('public endpoints', () => {
  it('reports health and config', async () => {
    await blocks(1);
    const health = await call('GET', '/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, mode: 'simulation', stale: false });
    const cfg = await call('GET', '/v1/config');
    expect(cfg.body).toMatchObject({ mode: 'simulation', chainId: 10143 });
    expect(cfg.body.markets.map((m: { symbol: string }) => m.symbol)).toEqual(['BTC', 'ETH']);
  });

  it('looks up a wallet and shows the design sample in simulation', async () => {
    const res = await call(
      'GET',
      `/v1/lookup/${privateKeyToAccount(generatePrivateKey()).address}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
    const btc = res.body.positions.find((p: { symbol: string }) => p.symbol === 'BTC');
    expect(btc).toMatchObject({ side: 'long', size: 1, nominalLeverage: 10, liquidation: 94_000 });
    expect((btc.distance * 100).toFixed(2)).toBe('5.45');
    expect((await call('GET', '/v1/lookup/0x123')).status).toBe(400);
  });

  it('answers CORS preflight for the web origin only', async () => {
    const ok = await fetch(`${base}/v1/me`, { method: 'OPTIONS', headers: { origin: ORIGIN } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const evil = await fetch(`${base}/v1/me`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('404s unknown routes and missing save reports', async () => {
    expect((await call('GET', '/nope')).status).toBe(404);
    expect((await call('GET', '/v1/saves/nope')).status).toBe(404);
  });
});

describe('sign-in', () => {
  it('opens a session from a SIWE signature', async () => {
    const res = await signIn();
    expect(res.status).toBe(200);
    expect(res.body.wallet).toBe(res.account.address.toLowerCase());
    const me = await call('GET', '/v1/me', { token: res.body.token });
    expect(me.body).toMatchObject({ wallet: res.body.wallet, link: null, demoAllowed: false });
  });

  it('refuses a replayed nonce, a wrong signer and a wrong domain', async () => {
    const first = await signIn();
    const replay = await call('POST', '/v1/auth/verify', {
      body: { message: first.message, signature: first.signature },
    });
    expect(replay.status).toBe(401);

    const other = privateKeyToAccount(generatePrivateKey());
    const { body } = await call('POST', '/v1/auth/nonce');
    const message = createSiweMessage({
      domain: 'localhost:3000',
      address: privateKeyToAccount(generatePrivateKey()).address,
      uri: ORIGIN,
      version: '1',
      chainId: 10143,
      nonce: body.nonce,
    });
    const forged = await call('POST', '/v1/auth/verify', {
      body: { message, signature: await other.signMessage({ message }) },
    });
    expect(forged.status).toBe(401);
    expect(forged.body.error.message).toMatch(/does not match/);

    const n2 = await call('POST', '/v1/auth/nonce');
    const phishing = createSiweMessage({
      domain: 'evil.example',
      address: other.address,
      uri: 'https://evil.example',
      version: '1',
      chainId: 10143,
      nonce: n2.body.nonce,
    });
    const res = await call('POST', '/v1/auth/verify', {
      body: { message: phishing, signature: await other.signMessage({ message: phishing }) },
    });
    expect(res.status).toBe(401);
  });

  it('needs a live session for private routes, and logout ends it', async () => {
    expect((await call('GET', '/v1/me')).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: 'garbage' })).status).toBe(401);
    const { body } = await signIn();
    expect((await call('POST', '/v1/auth/logout', { token: body.token })).status).toBe(200);
    expect((await call('GET', '/v1/me', { token: body.token })).status).toBe(401);
  });
});

describe('onboarding to a deploy, over HTTP', () => {
  it('links, arms, deploys on a wick, and publishes a save report', async () => {
    const { body: session } = await signIn();
    const token = session.token;

    // Settings can't arm before a key is linked.
    expect((await call('PUT', '/v1/settings', { token, body: { armed: true } })).status).toBe(400);

    // The key form requires the IP-lock confirmation and a well-formed secret.
    const noIp = await call('POST', '/v1/key', {
      token,
      body: { apiKey: 'k', apiSecret: secret() },
    });
    expect(noIp.status).toBe(400);
    const badSecret = await call('POST', '/v1/key', {
      token,
      body: { apiKey: 'k', apiSecret: 'nothex', ipLocked: true },
    });
    expect(badSecret.status).toBe(400);
    expect(badSecret.body.error.code).toBe('bad_secret');
    const linked = await call('POST', '/v1/key', {
      token,
      body: { apiKey: 'key-token-3f9a', apiSecret: secret(), ipLocked: true },
    });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ keyHint: '3f9a', forwarding: true, simulated: true });

    // Settings are validated field by field; demo mode needs the allow-list.
    expect((await call('PUT', '/v1/settings', { token, body: { targetPct: 30 } })).status).toBe(
      400,
    );
    expect((await call('PUT', '/v1/settings', { token, body: { maxTrimPct: 60 } })).status).toBe(
      400,
    );
    expect((await call('PUT', '/v1/settings', { token, body: { demo: true } })).status).toBe(403);
    const armed = await call('PUT', '/v1/settings', {
      token,
      body: { armed: true, targetPct: 10 },
    });
    expect(armed.body).toMatchObject({ armed: true, sensitivity: 'balanced', maxTrimPct: 50 });

    await blocks(2);
    const state = await call('GET', '/v1/state', { token });
    expect(state.body.status).toBe('armed');
    expect(state.body.account).toMatchObject({ spare: 420, forwarding: true });
    expect(Math.round(state.body.account.value)).toBe(11_160);
    const btc = state.body.positions[0];
    expect(btc).toMatchObject({ symbol: 'BTC', line: 97_000, liquidation: 94_000 });
    expect(btc.atLine.fraction.toFixed(3)).toBe('0.489');

    // Play the landing page's wick on BTC through the simulated chain.
    expect((await call('POST', '/v1/sim/wick', { token, body: { symbol: 'BTC' } })).status).toBe(
      200,
    );
    // Mid-deploy, the key can't be removed or swapped.
    let status = '';
    for (let i = 0; i < 30 && status !== 'deploying'; i++) {
      await blocks(1);
      status = (await call('GET', '/v1/state', { token })).body.status;
    }
    expect(status).toBe('deploying');
    expect((await call('DELETE', '/v1/key', { token })).status).toBe(409);
    await blocks(45);
    const deploys = await call('GET', '/v1/deploys', { token });
    expect(deploys.body).toHaveLength(1);
    const [d] = deploys.body;
    expect(d).toMatchObject({ symbol: 'BTC', kind: 'trim', phase: 'done', outcome: 'save' });
    expect(d.trimmed).toBeCloseTo(0.48906, 5);

    const detail = await call('GET', `/v1/deploys/${d.id}`, { token });
    expect(detail.body.simulated).toBe(true);
    expect(detail.body.data.timeline.map((e: { text: string }) => e.text)).toEqual(
      expect.arrayContaining([
        'Mark hit $97,000. Half your cushion is gone.',
        "Spare margin ($420) can't reach 10%. Trimming instead.",
        'Sent a reduce-only close for 0.489 BTC, worst price $96,515.',
        'Filled at $97,000. Realized −$1,467. Fee $0.',
        'BTC hit your old liquidation price, $94,000.',
      ]),
    );

    // Someone else can't read it, but the save report is public and wallet-free.
    const { body: stranger } = await signIn();
    expect((await call('GET', `/v1/deploys/${d.id}`, { token: stranger.token })).status).toBe(404);
    const save = await call('GET', `/v1/saves/${d.id}`);
    expect(save.status).toBe(200);
    expect(JSON.stringify(save.body)).not.toContain(session.wallet);
    expect(Math.round(save.body.kept)).toBe(5_333);
    expect(Math.round(save.body.counterfactual)).toBe(3_200);
    expect(Math.round(save.body.withAirbag)).toBe(8_533);
    expect(save.body.measuredAt).toBe(100_000);
    expect(save.body.nominalLeverage).toBe(10);

    // Unlink disarms and stops protection.
    expect((await call('DELETE', '/v1/key', { token })).status).toBe(200);
    const me = await call('GET', '/v1/me', { token });
    expect(me.body).toMatchObject({ link: null, settings: { armed: false } });
  });

  it('streams dashboard state as server-sent events', async () => {
    const { body: session } = await signIn();
    const res = await fetch(`${base}/v1/stream`, {
      headers: { authorization: `Bearer ${session.token}`, origin: ORIGIN },
    });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const reader = res.body?.getReader();
    const first = await reader?.read();
    const text = new TextDecoder().decode(first?.value);
    expect(text.startsWith('data: ')).toBe(true);
    expect(JSON.parse(text.slice(6)).status).toBe('unlinked');
    // Left open on purpose: afterAll's app.stop() has to end it, as a deploy's SIGTERM would.
  });
});

describe('abuse', () => {
  it('rejects non-JSON and oversized bodies', async () => {
    const { body } = await signIn();
    const notJson = await fetch(`${base}/v1/settings`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${body.token}`, 'content-type': 'text/plain' },
      body: 'x',
    });
    expect(notJson.status).toBe(400);
    const big = await call('PUT', '/v1/settings', {
      token: body.token,
      body: { pad: 'x'.repeat(20_000) },
    });
    expect(big.status).toBe(413);
  });

  it('rate-limits sign-in attempts per address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await call('POST', '/v1/auth/nonce')).status);
    expect(statuses).toContain(429);
  });
});
