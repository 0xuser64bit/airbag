import type { AddressInfo } from 'node:net';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openStore } from '../src/db.ts';
import { createLogger } from '../src/log.ts';
import { Telegram } from '../src/telegram.ts';

const WALLET = '0x7a3f00000000000000000000000000000000c21e';
const TOKEN = `12345:${'a'.repeat(35)}`;

/** A Bot API that records what it was asked and answers each method from `reply`. */
function bot(reply: (method: string, body: Record<string, unknown>) => unknown = () => true) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const method = String(url).split('/').at(-1) ?? '';
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ method, body });
    const result = reply(method, body);
    return new Response(
      JSON.stringify(
        result instanceof Error
          ? { ok: false, error_code: Number(result.message) }
          : { ok: true, result },
      ),
    );
  }) as typeof fetch;
  return { calls, fetchFn };
}

const telegram = (fetchFn: typeof fetch, simulated = false) => {
  const store = openStore(':memory:');
  return {
    store,
    tg: new Telegram({
      cfg: { token: TOKEN, username: 'AirbagAlertsBot' },
      store,
      log: createLogger('error', {}, () => {}),
      siteUrl: 'https://airbag.example',
      simulated,
      fetchFn,
    }),
  };
};

const start = (code: string, chat = 777) => ({
  update_id: 1,
  message: { chat: { id: chat }, text: `/start ${code}` },
});

describe('Telegram alerts', () => {
  it('links the chat that opens a one-time link, once, and /stop unlinks it', async () => {
    const api = bot();
    const { tg, store } = telegram(api.fetchFn);
    const url = tg.linkUrl(WALLET);
    expect(url).toMatch(/^https:\/\/t\.me\/AirbagAlertsBot\?start=[\w-]{16}$/);
    const code = new URL(url).searchParams.get('start') ?? '';
    await tg.handle(start(code));
    expect(store.telegramChat(WALLET)).toBe('777');
    expect(api.calls.at(-1)?.body.text).toMatch(/^Linked to 0x7a3f…c21e\./);
    // The same link again is spent.
    await tg.handle(start(code, 888));
    expect(store.telegramChat(WALLET)).toBe('777');
    expect(api.calls.at(-1)?.body).toMatchObject({ chat_id: 888, text: /expired/ });
    await tg.handle({ update_id: 2, message: { chat: { id: 777 }, text: '/stop' } });
    expect(store.telegramChat(WALLET)).toBeUndefined();
  });

  it('long-polls for updates from the last offset until stopped', async () => {
    let code = '';
    let polls = 0;
    const api = bot((method) => (method === 'getUpdates' ? (polls++ ? [] : [start(code)]) : true));
    const { tg, store } = telegram(api.fetchFn);
    code = new URL(tg.linkUrl(WALLET)).searchParams.get('start') ?? '';
    tg.start();
    for (let i = 0; i < 100 && !store.telegramChat(WALLET); i++)
      await new Promise((r) => setTimeout(r, 5));
    tg.stop();
    expect(store.telegramChat(WALLET)).toBe('777');
    const offsets = api.calls.filter((c) => c.method === 'getUpdates').map((c) => c.body.offset);
    expect(offsets.slice(0, 2)).toEqual([0, 2]);
  });

  it('refuses a link older than ten minutes', async () => {
    const { tg, store } = telegram(bot().fetchFn);
    const code = new URL(tg.linkUrl(WALLET, 0)).searchParams.get('start') ?? '';
    await tg.handle(start(code), 10 * 60_000 + 1);
    expect(store.telegramChat(WALLET)).toBeUndefined();
  });

  it('bounds pending link codes instead of growing without limit', async () => {
    const api = bot();
    const { tg, store } = telegram(api.fetchFn);
    const first = new URL(tg.linkUrl(WALLET, 0)).searchParams.get('start') ?? '';
    for (let i = 1; i < 10_000; i++) tg.linkUrl(`0x${String(i).padStart(40, '0')}`, 0);
    tg.linkUrl(WALLET, 0);
    // The oldest code was evicted to make room, so it reads as expired.
    await tg.handle(start(first, 999), 1);
    expect(store.telegramChat(WALLET)).toBeUndefined();
    expect(api.calls.at(-1)?.body).toMatchObject({ chat_id: 999, text: /expired/ });
  });

  it('sends alerts with a link to the app, labelled in simulation; a blocked bot unlinks', async () => {
    let blocked = false;
    const api = bot((method) => (method === 'sendMessage' && blocked ? new Error('403') : true));
    const { tg, store } = telegram(api.fetchFn, true);
    store.putTelegramChat(WALLET, '777');
    const msg = {
      title: 'Airbag trimmed your BTC long',
      body: 'Liquidation now $87,300.',
      url: '/app/deploys/x',
      tag: 'x',
    };
    await tg.send(WALLET, msg);
    expect(api.calls.at(-1)).toMatchObject({
      method: 'sendMessage',
      body: {
        chat_id: '777',
        text: 'Simulated · Airbag trimmed your BTC long\nLiquidation now $87,300.\nhttps://airbag.example/app/deploys/x',
      },
    });
    await tg.send('0x00000000000000000000000000000000000000ff', msg);
    expect(api.calls).toHaveLength(1);
    blocked = true;
    await tg.send(WALLET, msg);
    expect(store.telegramChat(WALLET)).toBeUndefined();
  });

  it('is offered by the API only when a bot is configured', async () => {
    const api = bot();
    const app = await buildApp(
      loadConfig({
        ENGINE_MODE: 'simulation',
        DATABASE_PATH: ':memory:',
        WEB_ORIGIN: 'http://localhost:3000',
        TELEGRAM_BOT_TOKEN: TOKEN,
        TELEGRAM_BOT_USERNAME: '@AirbagAlertsBot',
      }),
      { log: createLogger('error', {}, () => {}), manualClock: true, telegramFetch: api.fetchFn },
    );
    app.start();
    await new Promise<void>((r) => app.api.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(app.api.address() as AddressInfo).port}`;
    try {
      const json = async <T>(r: Promise<Response>) => (await (await r).json()) as T;
      const config = await json<{ telegram: string | null }>(fetch(`${base}/v1/config`));
      expect(config.telegram).toBe('AirbagAlertsBot');
      const account = privateKeyToAccount(generatePrivateKey());
      const { nonce } = await json<{ nonce: string }>(
        fetch(`${base}/v1/auth/nonce`, { method: 'POST' }),
      );
      const message = createSiweMessage({
        domain: 'localhost:3000',
        address: account.address,
        statement: 'Sign in to Airbag.',
        uri: 'http://localhost:3000',
        version: '1',
        chainId: 10143,
        nonce,
        issuedAt: new Date(),
      });
      const signature = await account.signMessage({ message });
      const { token } = await json<{ token: string }>(
        fetch(`${base}/v1/auth/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message, signature }),
        }),
      );
      const auth = { authorization: `Bearer ${token}` };
      const link = await json<{ url: string }>(
        fetch(`${base}/v1/telegram`, { method: 'POST', headers: auth }),
      );
      expect(link.url).toMatch(/^https:\/\/t\.me\/AirbagAlertsBot\?start=/);
      const me = await json<{ telegram: boolean }>(fetch(`${base}/v1/me`, { headers: auth }));
      expect(me.telegram).toBe(false);
      expect((await fetch(`${base}/v1/telegram`, { method: 'DELETE', headers: auth })).status).toBe(
        200,
      );
    } finally {
      await app.stop();
    }
    expect(() => loadConfig({ ENGINE_MODE: 'simulation', TELEGRAM_BOT_TOKEN: TOKEN })).toThrow(
      /both/,
    );
  });
});
