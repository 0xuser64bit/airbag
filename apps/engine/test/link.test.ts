import { randomBytes } from 'node:crypto';
import type { ConnectionState, OrderOutcome, TradingClient } from '@airbag/perpl';
import { describe, expect, it } from 'vitest';
import { Accounts, checkKey, LinkError } from '../src/accounts.ts';
import { openStore } from '../src/db.ts';
import type { Engine } from '../src/engine.ts';
import { createLogger } from '../src/log.ts';

const WALLET = '0x7a3f00000000000000000000000000000000c21e';
const account = { id: 4127, fr: false, fw: true, lfr: 9, b: '0', lb: '0' };

function client(opts: {
  ready?: ConnectionState;
  wallet?: string;
  account?: typeof account | undefined;
  /** The gateway's mt:3 code for the probe; undefined when none arrives. */
  status?: number | undefined;
  probe?: OrderOutcome;
}) {
  const sent: unknown[] = [];
  const c = {
    state: 'connecting' as ConnectionState,
    wallet: opts.wallet ?? WALLET,
    account: 'account' in opts ? opts.account : account,
    openOrders: new Map([[1, {} as never]]),
    start() {},
    async ready() {
      c.state = opts.ready ?? 'live';
      if (c.state !== 'live') throw new Error(c.state);
    },
    async close() {},
    async submit(
      build: (ids: { sn: number; rq: number }) => unknown,
      onStatus?: (code: number) => void,
    ) {
      sent.push(build({ sn: 1, rq: 10 }));
      const status = 'status' in opts ? opts.status : 0;
      if (status !== undefined) onStatus?.(status);
      return opts.probe ?? { result: 'failed', rq: 10 };
    },
  };
  return { c, sent };
}

const fails = async (p: Promise<unknown>, code: string) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(LinkError);
  expect((err as LinkError).code).toBe(code);
};

describe('checkKey', () => {
  it('accepts a Trade key for the signed-in wallet, probing scope with a harmless cancel', async () => {
    const { c, sent } = client({ wallet: WALLET.toUpperCase().replace('0X', '0x') });
    await expect(checkKey(c, WALLET, 16)).resolves.toEqual({
      accountId: 4127,
      forwarding: true,
      frozen: false,
      tradeScope: true,
    });
    // The probe cancels an order id that isn't one of the account's open orders.
    expect(sent).toEqual([
      expect.objectContaining({ mt: 22, t: 5, oid: Number.MAX_SAFE_INTEGER, acc: 4127, mkt: 16 }),
    ]);
  });

  it('needs only the gateway admitting the probe, whatever the chain makes of the cancel', async () => {
    const { c } = client({ status: 0, probe: { result: 'lost', rq: 10 } });
    await expect(checkKey(c, WALLET, 16)).resolves.toMatchObject({ tradeScope: true });
  });

  it('refuses to store a key when Perpl never proved its Trade scope', async () => {
    const { c } = client({ status: undefined, probe: { result: 'lost', rq: 10 } });
    await fails(checkKey(c, WALLET, 16), 'scope_unverified');
    const refused = client({ status: 400, probe: { result: 'rejected', rq: 10, code: 400 } });
    await fails(checkKey(refused.c, WALLET, 16), 'scope_unverified');
  });

  it('refuses a Read key', async () => {
    const { c } = client({ status: 403, probe: { result: 'rejected', rq: 10, code: 403 } });
    await fails(checkKey(c, WALLET, 16), 'read_only');
  });

  it('refuses a key that belongs to another wallet', async () => {
    const { c } = client({ wallet: '0x0000000000000000000000000000000000000001' });
    await fails(checkKey(c, WALLET, 16), 'wrong_wallet');
  });

  it('explains a wallet without an exchange account', async () => {
    const { c } = client({ account: undefined });
    await fails(checkKey(c, WALLET, 16), 'no_account');
  });

  it('explains a refused key and the connection cap', async () => {
    await fails(checkKey(client({ ready: 'rejected' }).c, WALLET, 16), 'key_rejected');
    await fails(checkKey(client({ ready: 'limited' }).c, WALLET, 16), 'too_many_connections');
    await fails(checkKey(client({ ready: 'down' }).c, WALLET, 16), 'perpl_timeout');
  });
});

it('serializes key changes and rechecks the guard after verification awaits Perpl', async () => {
  const store = openStore(':memory:');
  const guard = { hasPendingDeploy: false };
  const engine = { guards: new Map([[WALLET, guard]]) } as unknown as Engine;
  const { c } = client({});
  const gate = Promise.withResolvers<void>();
  let closed = false;
  c.ready = async () => {
    await gate.promise;
    c.state = 'live';
  };
  c.close = async () => {
    closed = true;
  };
  const accounts = new Accounts({
    store,
    engine,
    log: createLogger('error', {}, () => {}),
    master: { current: 1, keys: new Map([[1, randomBytes(32)]]) },
    probeMarketId: 16,
    openTrading: () => c as unknown as TradingClient,
  });
  try {
    const linking = accounts.link(WALLET, 'key-token', randomBytes(32).toString('hex'));
    await fails(accounts.link(WALLET, 'other', randomBytes(32).toString('hex')), 'key_busy');
    await fails(accounts.unlink(WALLET), 'key_busy');
    guard.hasPendingDeploy = true;
    gate.resolve();
    await fails(linking, 'deploying');
    expect(closed).toBe(true);
    expect(store.link(WALLET)).toBeUndefined();
    expect(engine.guards.get(WALLET)).toBe(guard);
    await fails(accounts.unlink(WALLET), 'deploying');
  } finally {
    store.close();
  }
});
