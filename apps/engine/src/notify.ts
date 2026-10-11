// What the engine tells people: Web Push (VAPID) to every browser a wallet subscribed, and the
// optional onchain log. Copy follows the design's voice: plain, numbers first, no exclamation.

import { ECDH } from 'node:crypto';
import { fmt } from '@airbag/risk';
import webpush from 'web-push';
import type { Deploy, PushSubscription, Store } from './db.ts';
import type { Notifier } from './guard.ts';
import type { Logger } from './log.ts';

export interface PushMessage {
  title: string;
  body: string;
  /** Path in the web app to open on click. */
  url: string;
  tag: string;
}

/** A subscription is untrusted input, and sending a push makes an outbound server request. */
export function validatePush(sub: PushSubscription): void {
  const url = new URL(sub.endpoint);
  const provider =
    ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(
      url.hostname,
    ) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
  if (
    !provider ||
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('Use a subscription issued by Chrome, Firefox, Safari or Edge.');
  }
  const decode = (key: string, bytes: number) => {
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(key)) throw new Error('Invalid push encryption key.');
    const value = Buffer.from(key, 'base64url');
    if (value.length !== bytes) throw new Error('Invalid push encryption key.');
    return value;
  };
  const publicKey = decode(sub.keys.p256dh, 65);
  if (publicKey[0] !== 4) throw new Error('Invalid push public key.');
  ECDH.convertKey(publicKey, 'prime256v1');
  decode(sub.keys.auth, 16);
}

export function deployMessage(d: Deploy): PushMessage {
  const what = `your ${d.symbol} ${d.side}`;
  const liq = fmt.usd(d.data.after?.liquidation);
  if (d.kind === 'margin') {
    return {
      title: `Airbag added margin to ${what}`,
      body: `${fmt.usd(d.data.spareAdded)} of your spare margin. Liquidation now ${liq}. Fee $0.`,
      url: `/app/deploys/${d.id}`,
      tag: d.id,
    };
  }
  const c = d.data.close;
  const trimmed = c ? (c.filledLots / d.data.before.lots) * d.data.before.size : 0;
  // Lots are base units times 10^size_decimals: 500,000 MON in whole lots, not 500,000.000.
  const sd = Math.round(Math.log10(d.data.before.lots / d.data.before.size));
  return {
    title: `Airbag trimmed ${what}`,
    body: `Airbag trimmed ${fmt.size(trimmed, sd)} ${d.symbol} at ${fmt.usd(c?.fillPrice)}. Liquidation now ${liq}. Fee ${fmt.fee(c?.fee)}.`,
    url: `/app/deploys/${d.id}`,
    tag: d.id,
  };
}

function saveMessage(d: Deploy): PushMessage {
  return {
    title: `Saved: ${d.symbol} hit your old liquidation price`,
    body: `${d.symbol} reached ${fmt.usd(d.data.before.liquidation)}. Your ${d.side} is still open because Airbag ${d.kind === 'margin' ? 'added margin' : 'trimmed it'} first.`,
    url: `/s/${d.id}`,
    tag: `${d.id}-save`,
  };
}

/** Simulation's paper liquidation: what happened, and how to see Airbag stop it instead. */
export function liquidationMessage(
  l: { symbol: string; side: string; price: number; returned: number },
  armed: boolean,
): PushMessage {
  return {
    title: `Your ${l.symbol} ${l.side} was liquidated`,
    body: `At ${fmt.usd(l.price)}. ${fmt.usd(l.returned)}, 80% of what was left, came back to your balance.${armed ? '' : ' Airbag was paused. Reset the account, resume and play the wick again.'}`,
    url: '/app',
    tag: `liquidated-${l.symbol}`,
  };
}

export class Push {
  readonly enabled: boolean;
  private readonly store: Store;
  private readonly log: Logger;
  private readonly simulated: boolean;

  constructor(
    store: Store,
    log: Logger,
    vapid?: { publicKey: string; privateKey: string; subject: string },
    simulated = false,
  ) {
    this.store = store;
    this.log = log;
    this.simulated = simulated;
    this.enabled = !!vapid;
    if (vapid) webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  armed(wallet: string): boolean {
    return this.store.settings(wallet).armed;
  }

  async send(wallet: string, msg: PushMessage): Promise<number> {
    if (!this.enabled || !this.store.settings(wallet).push) return 0;
    // A simulated trim on a lock screen must not read as a real one.
    const payload = JSON.stringify(
      this.simulated ? { ...msg, title: `Simulated · ${msg.title}` } : msg,
    );
    let sent = 0;
    for (const sub of this.store.pushSubscriptions(wallet)) {
      try {
        validatePush(sub); // Also protects subscriptions stored before validation was introduced.
        await webpush.sendNotification(sub, payload, {
          TTL: 3_600,
          urgency: 'high',
          timeout: 10_000,
        });
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the browser unsubscribed. Forget it.
        if (status === 404 || status === 410) this.store.removePush(sub.endpoint);
        else this.log.warn('push.error', { wallet, status, err });
      }
    }
    return sent;
  }
}

export interface OnchainLog {
  recordDeploy(d: Deploy): Promise<void>;
  proveSave(d: Deploy): Promise<void>;
}

/** Something that can carry an alert to a wallet: Web Push, Telegram. */
interface Channel {
  send(wallet: string, msg: PushMessage): Promise<unknown>;
}

/**
 * Fans guard events out to push, Telegram and the onchain log. None of them may block or break
 * protection: each runs on its own, and a failure is logged.
 */
export function notifier(
  push: Push,
  log: Logger,
  onchain?: OnchainLog,
  telegram?: Channel,
): Notifier {
  const safely = (what: string, p: Promise<unknown>) =>
    p.catch((err: unknown) => log.warn(`${what}.error`, { err }));
  const tell = (wallet: string, msg: PushMessage) => {
    void safely('push', push.send(wallet, msg));
    if (telegram) void safely('telegram', telegram.send(wallet, msg));
  };
  return {
    deployed(d) {
      tell(d.wallet, deployMessage(d));
      if (onchain) void safely('onchain', onchain.recordDeploy(d));
    },
    saved(d) {
      tell(d.wallet, saveMessage(d));
      if (onchain) void safely('onchain', onchain.proveSave(d));
    },
    liquidated(wallet, l) {
      tell(wallet, liquidationMessage(l, push.armed(wallet)));
    },
    alert(wallet, text) {
      log.warn('alert', { wallet, text });
      tell(wallet, { title: 'Airbag needs you', body: text, url: '/app', tag: 'alert' });
    },
  };
}
