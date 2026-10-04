'use client';

// Web Push for this browser: a service worker (public/sw.js), a VAPID subscription, and the
// engine's record of it. iPhones only allow push for apps added to the Home Screen.

import { api } from './api.ts';

const toKey = (base64url: string): Uint8Array<ArrayBuffer> => {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export const pushSupported = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export async function subscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

const BLOCKED =
  'Notifications are blocked for this site. Allow them in your browser settings, then try again.';

/**
 * What to tell someone whose browser refused to subscribe. Chrome-family browsers say only
 * 'Registration failed - push service error'; the usual causes are Brave, which turns Google's
 * push service off by default, and a VPN or firewall in the way.
 */
export function subscribeProblem(err: unknown, brave: boolean): string {
  if (brave)
    return 'Brave turns off the push service that browser alerts need. Turn on “Use Google services for push messaging” in Settings → Privacy and security, restart Brave, then press this again.';
  if (err instanceof Error && err.name === 'NotAllowedError') return BLOCKED;
  const said = err instanceof Error && err.message ? ` It said: “${err.message}”.` : '';
  return `This browser’s push service refused to sign it up.${said} A VPN or firewall blocking it is the usual cause; Chrome, Firefox and Safari work.`;
}

const isBrave = async (): Promise<boolean> => {
  const brave = (navigator as Navigator & { brave?: { isBrave(): Promise<boolean> } }).brave;
  return brave ? brave.isBrave().catch(() => false) : false;
};

/** Asks permission, subscribes this browser and registers it with the engine. */
export async function enablePush(vapidPublicKey: string): Promise<void> {
  if (!pushSupported()) {
    throw new Error(
      "This browser can't receive push alerts. On an iPhone, add Airbag to your Home Screen first.",
    );
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(BLOCKED);
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: toKey(vapidPublicKey) })
      .catch(async (err: unknown) => {
        throw new Error(subscribeProblem(err, await isBrave()));
      }));
  await api('/v1/push', { method: 'POST', body: sub.toJSON() });
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api('/v1/push', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(
    () => undefined,
  );
  await sub.unsubscribe();
}
