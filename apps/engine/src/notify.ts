// What the engine tells people: Web Push (VAPID) to every browser a wallet subscribed, and the
// optional onchain log. Copy follows the design's voice: plain, numbers first, no exclamation.

import { fmt } from '@airbag/risk';
import webpush from 'web-push';
import type { Deploy, Store } from './db.ts';
import type { Notifier } from './guard.ts';
import type { Logger } from './log.ts';

export interface PushMessage {
  title: string;
  body: string;
  /** Path in the web app to open on click. */
  url: string;
  tag: string;
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
  return {
    title: `Airbag trimmed ${what}`,
    body: `Airbag trimmed ${fmt.size(trimmed)} ${d.symbol} at ${fmt.usd(c?.fillPrice)}. Liquidation now ${liq}. Fee $0.`,
    url: `/app/deploys/${d.id}`,
    tag: d.id,
  };
}

export function saveMessage(d: Deploy): PushMessage {
  return {
    title: `Saved: ${d.symbol} hit your old liquidation price`,
    body: `${d.symbol} reached ${fmt.usd(d.data.before.liquidation)}. Your ${d.side} is still open because Airbag trimmed it first.`,
    url: `/s/${d.id}`,
    tag: `${d.id}-save`,
  };
}

export class Push {
  readonly enabled: boolean;
  private readonly store: Store;
  private readonly log: Logger;

  constructor(
    store: Store,
    log: Logger,
    vapid?: { publicKey: string; privateKey: string; subject: string },
  ) {
    this.store = store;
    this.log = log;
    this.enabled = !!vapid;
    if (vapid) webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  async send(wallet: string, msg: PushMessage): Promise<number> {
    if (!this.enabled || !this.store.settings(wallet).push) return 0;
    let sent = 0;
    for (const sub of this.store.pushSubscriptions(wallet)) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(msg), { TTL: 3_600, urgency: 'high' });
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
  recordSave(d: Deploy): Promise<void>;
}

/** Fans guard events out to push and the onchain log. Neither may block or break protection. */
export function notifier(push: Push, log: Logger, onchain?: OnchainLog): Notifier {
  const safely = (what: string, p: Promise<unknown>) =>
    p.catch((err: unknown) => log.warn(`${what}.error`, { err }));
  return {
    deployed(d) {
      void safely('push', push.send(d.wallet, deployMessage(d)));
      if (onchain) void safely('onchain', onchain.recordDeploy(d));
    },
    saved(d) {
      void safely('push', push.send(d.wallet, saveMessage(d)));
      if (onchain) void safely('onchain', onchain.recordSave(d));
    },
    alert(wallet, text) {
      log.warn('alert', { wallet, text });
      void safely(
        'push',
        push.send(wallet, { title: 'Airbag needs you', body: text, url: '/app', tag: 'alert' }),
      );
    },
  };
}
