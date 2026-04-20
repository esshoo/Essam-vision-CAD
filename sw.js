const CACHE_NAME = 'essam-cad-pwa-v23';
const CORE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './global.css',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './favicon.ico',
  './cache-urls.json'
];

async function getAppShellUrls() {
  try {
    const response = await fetch('./cache-urls.json', { cache: 'no-store' });
    const list = await response.json();
    if (!Array.isArray(list)) return CORE_URLS.slice();
    return Array.from(new Set([...CORE_URLS, ...list]));
  } catch (error) {
    console.warn('[SW] Failed to load cache-urls.json, using core list only.', error);
    return CORE_URLS.slice();
  }
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const urls = await getAppShellUrls();
  const requests = urls.map((url) => new Request(url, { cache: 'reload' }));
  const results = await Promise.allSettled(requests.map((request) => cache.add(request)));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    console.warn(`[SW] Precache completed with ${failed.length} failed request(s).`);
  }
}

async function notifyClients(type) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) {
    client.postMessage({ type });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await precacheAppShell();
    await self.skipWaiting();
    await notifyClients('ESSAM_PWA_CACHE_READY');
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
    await notifyClients('ESSAM_PWA_CACHE_READY');
  })());
});

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'ESSAM_PWA_PING') {
    event.source?.postMessage?.({ type: 'ESSAM_PWA_CACHE_READY' });
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate' || request.destination === 'document';

  if (isNavigation) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached =
        (await cache.match(request, { ignoreSearch: true })) ||
        (await cache.match('./')) ||
        (await cache.match('./index.html'));

      try {
        const network = await fetch(request);
        if (network && network.ok) cache.put(request, network.clone());
        return network;
      } catch (error) {
        return cached || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const network = await fetch(request);
      if (network && network.ok) {
        cache.put(request, network.clone());
      }
      return network;
    } catch (error) {
      return cached || Response.error();
    }
  })());
});
