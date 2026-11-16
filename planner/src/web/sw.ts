/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

self.skipWaiting();
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// App shell for every page except the API
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string; requireInteraction?: boolean } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'Today', body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Today', {
      body: data.body,
      tag: data.tag,
      // re-alert even when replacing an earlier notification with the same tag
      renotify: !!data.tag,
      requireInteraction: data.requireInteraction,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data?.url as string) || '/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if ('focus' in w) {
          await w.focus();
          w.postMessage({ type: 'navigate', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
