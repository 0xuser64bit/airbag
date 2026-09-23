import type { ConnectionState, OrderOutcome } from '@airbag/perpl';
import { describe, expect, it } from 'vitest';
import { checkKey, LinkError } from '../src/accounts.ts';

const WALLET = '0x7a3f00000000000000000000000000000000c21e';
const account = { id: 4127, fr: false, fw: true, lfr: 9, b: '0', lb: '0' };

function client(opts: {
  ready?: ConnectionState;
  wallet?: string;
  account?: typeof account | undefined;
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
    async submit(build: (ids: { sn: number; rq: number }) => unknown) {
      sent.push(build({ sn: 1, rq: 10 }));
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
    });
    // The probe cancels an order id that isn't one of the account's open orders.
    expect(sent).toEqual([expect.objectContaining({ mt: 22, t: 5, oid: 2, acc: 4127, mkt: 16 })]);
  });

  it('refuses a Read key', async () => {
    const { c } = client({ probe: { result: 'rejected', rq: 10, code: 403 } });
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
