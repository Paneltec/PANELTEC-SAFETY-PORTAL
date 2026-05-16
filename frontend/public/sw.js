// Paneltec Safety Portal — Service Worker
// Version-based cache busting (bump on each deploy)
const CACHE_VERSION = 'paneltec-v1.0.0';
const RUNTIME_CACHE = 'paneltec-runtime';

// Static assets to pre-cache (the app shell)
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

// Activate: wipe old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_VERSION && key !== RUNTIME_CACHE).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//   /api/*  — network-first, fall back to cached response (so offline still works)
//   static  — cache-first, fall back to network
//   navigation — network-first, fall back to cached index.html
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // API requests — network first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache a copy of the response for offline fallback
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Navigation requests — network first, fall back to index.html (SPA)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets — cache first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && (url.origin === self.location.origin)) {
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      });
    })
  );
});

// Background sync: replay queued form submissions when back online
self.addEventListener('sync', (event) => {
  if (event.tag === 'paneltec-sync-queue') {
    event.waitUntil(replayQueue());
  }
});

async function replayQueue() {
  try {
    const clients = await self.clients.matchAll();
    clients.forEach((c) => c.postMessage({ type: 'SYNC_QUEUE' }));
  } catch (e) {
    console.warn('Sync failed', e);
  }
}

// Push notifications
self.addEventListener('push', (event) => {
  let data = { title: 'Paneltec Safety', body: 'You have a new notification' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data = { title: 'Paneltec Safety', body: event.data.text() };
  }
  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'paneltec',
    data: data.url ? { url: data.url } : {},
    actions: data.actions || [],
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Click handler for notifications
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// Message handler — frontend can ask the SW to clear cache, etc.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});
