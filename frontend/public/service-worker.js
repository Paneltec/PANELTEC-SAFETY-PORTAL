/* Paneltec Civil — minimal service worker.
 * Strategy:
 *   - Static (HTML/CSS/JS/images/manifest): cache-first with background refresh
 *   - API (/api/*): NETWORK-ONLY. Never intercept or cache. Bad API caching was
 *     observed to cause "logged out straightaway" symptoms — stale 401s
 *     served from cache despite backend issuing fresh JWTs. Trust the network.
 *
 * Bump CACHE_VERSION whenever this file changes — old clients will purge their
 * caches on next activate.
 */
const CACHE_VERSION = 'paneltec-v12';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
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
      // Purge ALL caches that aren't the current STATIC_CACHE. This includes
      // any leftover paneltec-v1-api caches that may be serving stale 401s.
      Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
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
  if (url.origin !== self.location.origin) return;

  // CRITICAL: never intercept API requests. Always go to network.
  if (url.pathname.startsWith('/api/')) return;

  // Cache-first for static assets only.
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
