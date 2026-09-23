// Airbag service worker: Web Push only. No offline cache: the app is live data or nothing.

self.addEventListener('push', (event) => {
  let msg = { title: 'Airbag', body: '', url: '/app', tag: 'airbag' };
  try {
    msg = { ...msg, ...event.data.json() };
  } catch {
    if (event.data) msg.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      data: { url: msg.url },
      icon: '/pwa-icon/192',
      badge: '/pwa-icon/192',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/app', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url === url);
      if (open) return open.focus();
      return self.clients.openWindow(url);
    }),
  );
});
