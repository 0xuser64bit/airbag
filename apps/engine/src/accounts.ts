// Linking, unlinking and running accounts. A key is verified before it is stored: Perpl accepts
// it, it belongs to the wallet that signed in, the wallet has an exchange account, and it has
// the Trade scope (probed with a cancel that can't remove anything). The IP allow-list can't be
// read through any API, so the user confirms it and we say so.

import type { KeyObject } from 'node:crypto';
import {
  type ConnectionState,
  ed25519Key,
  scopeProbe,
  sleep,
  type TradingClient,
  type TradingEvent,
} from '@airbag/perpl';
import { fmt } from '@airbag/risk';
import type { Store } from './db.ts';
import type { Engine } from './engine.ts';
import type { Logger } from './log.ts';
import type { SimChain } from './sim.ts';
import { type MasterKeys, open, seal } from './vault.ts';

export class LinkError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface KeyCheck {
  accountId: number;
  forwarding: boolean;
  frozen: boolean;
  /** Perpl's gateway admitted the probe, which it refuses for Read keys. */
  tradeScope: boolean;
}

type Client = Pick<
  TradingClient,
  'start' | 'ready' | 'close' | 'state' | 'wallet' | 'account' | 'openOrders' | 'submit'
>;

/** Verifies a freshly opened trading client. Throws LinkError with a message for the user. */
export async function checkKey(
  client: Client,
  wallet: string,
  probeMarketId: number,
  timeoutMs = 15_000,
): Promise<KeyCheck> {
  client.start();
  try {
    await client.ready(timeoutMs);
  } catch {
    if (client.state === 'rejected') {
      throw new LinkError(
        400,
        'key_rejected',
        "Perpl refused this key. Check the key and secret, that the key isn't revoked or expired, and that its IP allow-list has Airbag's addresses.",
      );
    }
    if (client.state === 'limited') {
      throw new LinkError(
        409,
        'too_many_connections',
        'This wallet already has four Perpl connections open, and browser tabs count. Close a Perpl tab and try again.',
      );
    }
    throw new LinkError(
      504,
      'perpl_timeout',
      "Perpl didn't answer in time. Try again in a minute.",
    );
  }
  if (client.wallet?.toLowerCase() !== wallet) {
    throw new LinkError(
      403,
      'wrong_wallet',
      `This key belongs to ${fmt.short(client.wallet ?? 'another wallet')}, not the wallet you signed in with.`,
    );
  }
  const account = client.account;
  if (!account) {
    throw new LinkError(
      400,
      'no_account',
      'This wallet has no Perpl exchange account yet. Deposit on Perpl first, then link the key.',
    );
  }
  // Perpl's gateway answers every order frame with exactly one mt:3 and refuses a Read key's
  // with 403 there, so admission (code 0) proves Trade scope. What the chain later says about
  // cancelling an order that doesn't exist is irrelevant to the question.
  const status = Promise.withResolvers<number | undefined>();
  const sent = client.submit(
    (ids) =>
      scopeProbe(
        { ...ids, mkt: probeMarketId, acc: account.id, lb: 0 },
        new Set(client.openOrders.keys()),
      ),
    status.resolve,
  );
  void sent.then(() => status.resolve(undefined));
  const code = await Promise.race([status.promise, sleep(8_000).then(() => undefined)]);
  if (code === 403) {
    throw new LinkError(
      400,
      'read_only',
      'This is a Read key. Airbag needs the Trade scope to trim. Create a Trade key on Perpl and paste that one.',
    );
  }
  if (code !== undefined && code !== 0) {
    // A refusal settles the order at once; say what Perpl said, an IP allow-list most often.
    const refused = await Promise.race([sent, sleep(1_000).then(() => undefined)]);
    const why = refused?.error ? `: ${refused.error}` : '';
    throw new LinkError(
      400,
      'scope_unverified',
      `Perpl refused Airbag's test order (code ${code}${why}). Check the key's IP allow-list. No key was stored.`,
    );
  }
  if (code !== 0)
    throw new LinkError(
      504,
      'scope_unverified',
      'Perpl did not confirm Trade scope. No key was stored. Try again.',
    );
  return { accountId: account.id, forwarding: account.fw, frozen: account.fr, tradeScope: true };
}

export interface AccountsDeps {
  store: Store;
  engine: Engine;
  log: Logger;
  master: MasterKeys;
  /** Opens a live trading client (not started). */
  openTrading: (
    apiKey: string,
    key: KeyObject,
    onEvent: (e: TradingEvent) => void,
  ) => TradingClient;
  /** A covered market id, used for the scope probe. */
  probeMarketId: number;
  sim?: SimChain;
  onState?: (wallet: string, state: ConnectionState) => void;
}

export interface Linked {
  accountId: number;
  keyHint: string;
  forwarding: boolean;
  tradeScope: boolean;
  simulated: boolean;
}

const aad = (wallet: string, accountId: number) => `airbag:v1:${wallet}:${accountId}`;

export class Accounts {
  private readonly deps: AccountsDeps;
  private readonly clients = new Map<string, TradingClient>();
  private readonly changing = new Set<string>();
  private stopped = false;

  constructor(deps: AccountsDeps) {
    this.deps = deps;
  }

  private open(wallet: string, apiKey: string, secret: KeyObject): TradingClient {
    return this.deps.openTrading(apiKey, secret, (e) => {
      if (e.type === 'state') {
        this.deps.log.info('trading.state', {
          wallet,
          state: e.state,
          code: e.code,
          reason: e.reason,
        });
        this.deps.onState?.(wallet, e.state);
      }
    });
  }

  /** Reconnects every linked account at boot. Keys are decrypted only here, into memory. */
  startAll(): void {
    for (const link of this.deps.store.links()) {
      try {
        if (this.deps.sim) {
          this.deps.engine.add(link.wallet, this.deps.sim.paper(link.wallet, link.accountId));
          continue;
        }
        const { apiKey, secret } = JSON.parse(
          open(link.sealed, aad(link.wallet, link.accountId), this.deps.master),
        ) as { apiKey: string; secret: string };
        const client = this.open(link.wallet, apiKey, ed25519Key(secret));
        client.start();
        this.clients.set(link.wallet, client);
        this.deps.engine.add(link.wallet, client);
      } catch (err) {
        this.deps.log.error('account.start.error', { wallet: link.wallet, err });
      }
    }
  }

  async link(wallet: string, apiKey: string, secretHex: string): Promise<Linked> {
    return this.change(wallet, () => this.linkKey(wallet, apiKey, secretHex));
  }

  private assertIdle(wallet: string): void {
    if (this.stopped || this.deps.engine.guards.get(wallet)?.hasPendingDeploy) {
      throw new LinkError(
        409,
        'deploying',
        'Airbag has an unfinished deploy. Finish or resume it before changing the key.',
      );
    }
  }

  private async change<T>(wallet: string, job: () => Promise<T>): Promise<T> {
    this.assertIdle(wallet);
    if (this.changing.has(wallet))
      throw new LinkError(
        409,
        'key_busy',
        'A key change is already in progress. Try again shortly.',
      );
    this.changing.add(wallet);
    try {
      return await job();
    } finally {
      this.changing.delete(wallet);
    }
  }

  private async linkKey(wallet: string, apiKey: string, secretHex: string): Promise<Linked> {
    let key: KeyObject;
    try {
      key = ed25519Key(secretHex);
    } catch {
      throw new LinkError(400, 'bad_secret', 'The API secret should be 64 hex characters.');
    }
    const keyHint = apiKey.slice(-4);
    const now = Date.now();
    if (this.deps.sim) {
      const accountId = 4000 + (Number.parseInt(wallet.slice(-4), 16) % 1000);
      this.deps.store.putLink({
        wallet,
        accountId,
        keyHint,
        sealed: seal(
          JSON.stringify({ apiKey, secret: 'simulated' }),
          aad(wallet, accountId),
          this.deps.master,
        ),
        linkedAt: now,
      });
      this.replace(wallet, this.deps.sim.paper(wallet, accountId), undefined);
      return { accountId, keyHint, forwarding: true, tradeScope: true, simulated: true };
    }
    const client = this.open(wallet, apiKey, key);
    let check: KeyCheck;
    try {
      check = await checkKey(client, wallet, this.deps.probeMarketId);
      // Verification awaits Perpl. The existing guard may have started a deploy meanwhile.
      this.assertIdle(wallet);
      this.deps.store.putLink({
        wallet,
        accountId: check.accountId,
        keyHint,
        sealed: seal(
          JSON.stringify({ apiKey, secret: secretHex.replace(/^0x/, '') }),
          aad(wallet, check.accountId),
          this.deps.master,
        ),
        linkedAt: now,
      });
      this.replace(wallet, client, client);
      this.deps.log.info('key.linked', {
        wallet,
        account: check.accountId,
        forwarding: check.forwarding,
        tradeScope: check.tradeScope,
      });
      return {
        accountId: check.accountId,
        keyHint,
        forwarding: check.forwarding,
        tradeScope: check.tradeScope,
        simulated: false,
      };
    } catch (err) {
      if (this.clients.get(wallet) !== client) await client.close();
      if (err instanceof LinkError)
        this.deps.log.warn('key.link.refused', { wallet, code: err.code, reason: err.message });
      throw err;
    }
  }

  private replace(wallet: string, exchange: Parameters<Engine['add']>[1], client?: TradingClient) {
    const old = this.clients.get(wallet);
    this.deps.engine.remove(wallet);
    if (old && old !== client) void old.close();
    if (client) this.clients.set(wallet, client);
    else this.clients.delete(wallet);
    this.deps.engine.add(wallet, exchange);
  }

  async unlink(wallet: string): Promise<void> {
    return this.change(wallet, async () => {
      this.deps.engine.remove(wallet);
      const client = this.clients.get(wallet);
      this.clients.delete(wallet);
      await client?.close();
      this.deps.store.deleteLink(wallet);
      const s = this.deps.store.settings(wallet);
      this.deps.store.putSettings(wallet, { ...s, armed: false });
      this.deps.log.info('key.unlinked', { wallet });
    });
  }

  async closeAll(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
  }
}
