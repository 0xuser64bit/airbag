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

/** Asks permission, subscribes this browser and registers it with the engine. */
export async function enablePush(vapidPublicKey: string): Promise<void> {
  if (!pushSupported()) {
    throw new Error(
      "This browser can't receive push alerts. On an iPhone, add Airbag to your Home Screen first.",
    );
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      'Notifications are blocked for this site. Allow them in your browser settings, then try again.',
    );
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toKey(vapidPublicKey),
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
