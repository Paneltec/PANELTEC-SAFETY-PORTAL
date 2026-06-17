/* Paneltec Civil — minimal service worker.
 * Strategy:
 *   - Static (HTML/CSS/JS/images/manifest): cache-first with background refresh
 *   - API (/api/*): network-first, fall back to last cached response if offline
 *   - Auth-sensitive endpoints are never cached aggressively because the SW
 *     skips Authorization-header'd responses when offline-fallback is unavailable.
 */
const CACHE_VERSION = 'paneltec-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const PRECACHE = [
  '/',
  '/manifest.json',
  '/brand/mark.png',
  '/brand/icon-192.png',
  '/brand/icon-512.png',
  '/brand/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only handle same-origin (and our backend preview origin) requests.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Network-first for API.
    event.respondWith(
      fetch(req).then((resp) => {
        // Only cache successful, idempotent GETs without auth-sensitive responses.
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(API_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for static assets.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        fetch(req).then((resp) => {
          if (resp.ok) caches.open(STATIC_CACHE).then((c) => c.put(req, resp.clone())).catch(() => {});
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((resp) => {
        if (resp.ok && resp.type !== 'opaque') {
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match('/'));
    })
  );
});
