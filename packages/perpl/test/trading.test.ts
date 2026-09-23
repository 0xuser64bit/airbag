import { afterEach, describe, expect, it, vi } from 'vitest';
import { ed25519Key } from '../src/auth.ts';
import { closeOrder, increaseCollateral } from '../src/orders.ts';
import { TradingClient, type TradingEvent } from '../src/trading.ts';
import { fakeServer, flush } from './fake-ws.ts';

// RFC 8032 test vector 1: a public test key, not a credential.
const KEY = ed25519Key('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'); // gitleaks:allow

const account = { id: 42, fr: false, fw: true, lfr: 100, b: '1000000000', lb: '0' };
const position = {
  at: { b: 1 },
  mkt: 16,
  acc: 42,
  pid: 7,
  st: 1,
  sd: 1,
  c: '10000000000',
  ep: 1_000_000,
  s: 100_000,
  efs: 0,
  lv: 1000,
};

function setup() {
  const server = fakeServer();
  const events: TradingEvent[] = [];
  const client = new TradingClient({
    url: 'wss://perpl.test/ws/v1/trading',
    chainId: 10143,
    apiKey: 'key-token',
    key: KEY,
    requestsPerMinute: 60,
    WebSocket: server.WebSocket,
    onEvent: (e) => events.push(e),
  });
  return { server, client, events };
}

/** Plays Perpl's post-sign-in snapshots on the newest socket. */
async function snapshots(server: ReturnType<typeof fakeServer>, sn = 500) {
  await flush();
  server.last.push({ mt: 19, sn, addr: '0xabc', as: [account] });
  server.last.push({ mt: 23, d: [{ oid: 3, st: 2, rq: 1, mkt: 16, acc: 42 }] });
  server.last.push({ mt: 26, d: [position, { ...position, mkt: 32, st: 2 }] });
  server.last.push({ mt: 100, sn: sn + 1, h: 1_000 });
}

const close = (ids: { sn: number; rq: number }) =>
  closeOrder({
    ...ids,
    mkt: 16,
    acc: 42,
    lb: 1_020,
    side: 'long',
    lots: 48_905,
    limitPrice: 965_150,
    leverage: 1000,
  });

describe('TradingClient', () => {
  let client: TradingClient | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await client?.close();
  });

  it('signs in first, then goes live on the snapshots', async () => {
    const t = setup();
    client = t.client;
    client.start();
    const ready = client.ready(1_000);
    await snapshots(t.server);
    await ready;
    const signIn = t.server.last.sent[0];
    expect(signIn).toMatchObject({ mt: 29, chain_id: 10143, api_key: 'key-token' });
    expect(client.state).toBe('live');
    expect(client.wallet).toBe('0xabc');
    expect(client.account?.id).toBe(42);
    expect([...client.positions.keys()]).toEqual([16]);
    expect([...client.openOrders.keys()]).toEqual([3]);
    expect(client.head).toBe(1_000);
  });

  it('sends an allowlisted close with rq seeded from lfr and reports the fill', async () => {
    const t = setup();
    client = t.client;
    client.start();
    await snapshots(t.server);
    const outcome = client.submit(close);
    await flush();
    const frame = t.server.last.sent.at(-1);
    expect(frame).toMatchObject({ mt: 22, t: 3, rq: 101, fl: 4, s: 48_905, p: 965_150 });
    t.server.last.push({ mt: 3, cid: frame?.sn, status: { code: 0, error: '' } });
    t.server.last.push({ mt: 24, d: [{ rq: 101, acc: 42, st: 2, fs: 0, oid: 9 }] });
    t.server.last.push({
      mt: 24,
      d: [{ rq: 101, acc: 42, st: 4, fs: 48_905, fp: 970_000, oid: 9, at: { txid: '0x9c' } }],
    });
    await expect(outcome).resolves.toMatchObject({ result: 'filled', order: { fp: 970_000 } });
  });

  it('keeps rq strictly increasing across orders', async () => {
    const t = setup();
    client = t.client;
    client.start();
    await snapshots(t.server);
    void client.submit(close);
    void client.submit((ids) =>
      increaseCollateral({ ...ids, mkt: 16, acc: 42, lb: 0, amountCns: 5n }),
    );
    await flush();
    const rqs = t.server.last.sent.filter((f) => f.mt === 22).map((f) => f.rq);
    const sns = t.server.last.sent.filter((f) => f.mt === 22).map((f) => f.sn);
    expect(rqs).toEqual([101, 102]);
    expect(new Set(sns).size).toBe(2);
  });

  it('reports a gateway refusal as rejected (a Read-scoped key gets 403)', async () => {
    const t = setup();
    client = t.client;
    client.start();
    await snapshots(t.server);
    const outcome = client.submit(close);
    await flush();
    const frame = t.server.last.sent.at(-1);
    t.server.last.push({
      mt: 3,
      cid: frame?.sn,
      status: { code: 403, error: 'api key lacks trade scope' },
    });
    await expect(outcome).resolves.toMatchObject({ result: 'rejected', code: 403 });
  });

  it('retries once with a new rq on sr:32', async () => {
    const t = setup();
    client = t.client;
    client.start();
    await snapshots(t.server);
    const outcome = client.submit(close);
    await flush();
    t.server.last.push({ mt: 24, d: [{ rq: 101, acc: 42, st: 7, sr: 32, fs: 0 }] });
    await flush();
    const retry = t.server.last.sent.at(-1);
    expect(retry?.rq).toBe(102);
    t.server.last.push({ mt: 24, d: [{ rq: 102, acc: 42, st: 4, fs: 48_905, fp: 1 }] });
    await expect(outcome).resolves.toMatchObject({ result: 'filled', rq: 102 });
  });

  it('ignores a failure that follows a non-failure status, and reads a partial IOC', async () => {
    const t = setup();
    client = t.client;
    client.start();
    await snapshots(t.server);
    const outcome = client.submit(close);
    await flush();
    t.server.last.push({ mt: 24, d: [{ rq: 101, acc: 42, st: 3, fs: 20_000 }] });
    t.server.last.push({ mt: 24, d: [{ rq: 101, acc: 42, st: 7, sr: 36, fs: 0 }] });
    t.server.last.push({ mt: 24, d: [{ rq: 101, acc: 42, st: 5, sr: 16, fs: 20_000 }] });
    await expect(outcome).resolves.toMatchObject({ result: 'partial', order: { fs: 20_000 } });
  });

  it('marks in-flight orders lost when the socket drops', async () => {
    const t = setup();
    client = t.client;
    client.start();
    await snapshots(t.server);
    const outcome = client.submit(close);
    await flush();
    t.server.last.close(1006, '');
    await expect(outcome).resolves.toMatchObject({ result: 'lost' });
  });

  it('marks an order lost once its last execution block has passed', async () => {
    const t = setup();
    client = t.client;
    client.start();
    await snapshots(t.server, 500);
    const outcome = client.submit(close);
    await flush();
    t.server.last.push({ mt: 100, sn: 502, h: 1_023 });
    await expect(outcome).resolves.toMatchObject({ result: 'lost' });
  });

  it('gives an lb: 0 order a deadline too (a margin add must not hang the deploy lock)', async () => {
    const t = setup();
    client = t.client;
    client.start();
    await snapshots(t.server, 500);
    const outcome = client.submit((ids) =>
      increaseCollateral({ ...ids, mkt: 16, acc: 42, lb: 0, amountCns: 1_000_000n }),
    );
    await flush();
    t.server.last.push({ mt: 100, sn: 502, h: 1_030 });
    await flush();
    t.server.last.push({ mt: 100, sn: 503, h: 1_063 });
    await expect(outcome).resolves.toMatchObject({ result: 'lost' });
  });

  it('drops a socket that goes silent and reconnects', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'],
    });
    const t = setup();
    client = t.client;
    client.start();
    await snapshots(t.server, 500);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(t.server.sockets[0]?.readyState).toBe(1);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(t.server.sockets[0]?.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(t.server.sockets).toHaveLength(2);
  });

  it('reconnects with a fresh sign-in on a heartbeat sequence gap', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const t = setup();
    client = t.client;
    client.start();
    await snapshots(t.server, 500);
    t.server.last.push({ mt: 100, sn: 503, h: 1_002 });
    await flush();
    expect(t.server.sockets[0]?.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(t.server.sockets).toHaveLength(2);
    expect(t.server.last.sent[0]).toMatchObject({ mt: 29 });
    const first = t.server.sockets[0]?.sent[0];
    expect(t.server.last.sent[0]?.nonce).not.toBe(first?.nonce);
  });

  it('reports a refused key and fails ready()', async () => {
    const t = setup();
    client = t.client;
    client.start();
    const ready = client.ready(1_000);
    await flush();
    t.server.last.close(3401, 'unauthorized');
    await expect(ready).rejects.toThrow(/unauthorized/);
    expect(client.state).toBe('rejected');
    expect(t.events).toContainEqual({
      type: 'state',
      state: 'rejected',
      code: 3401,
      reason: 'unauthorized',
    });
  });

  it('drops a closed position and applies account updates', async () => {
    const t = setup();
    client = t.client;
    client.start();
    await snapshots(t.server);
    t.server.last.push({ mt: 27, d: [{ ...position, st: 2 }] });
    t.server.last.push({ mt: 21, ...account, fw: false, b: '5' });
    expect(client.positions.size).toBe(0);
    expect(client.account).toMatchObject({ fw: false, b: '5' });
  });

  it('refuses to send while not connected', async () => {
    const t = setup();
    client = t.client;
    await expect(client.submit(close)).resolves.toMatchObject({ result: 'lost' });
    expect(t.server.sockets).toHaveLength(0);
  });
});
