/* Paneltec Civil — service worker.
 * Strategy:
 *   - index.html / navigation requests: NETWORK-FIRST with cache fallback.
 *     This prevents the "stale chunk reference" bug where a cached HTML
 *     points at a JS chunk hash that no longer exists on disk, causing the
 *     UI to load yesterday's bundle (which surfaced as the phantom
 *     "ReferenceError: refreshToken is not defined" on /app/ask).
 *   - Static hashed assets (CSS/JS/images/manifest): cache-first with
 *     background refresh. These are immutable once built so caching is safe.
 *   - API (/api/*): NETWORK-ONLY. Never intercept or cache. Stale 401s
 *     from cache previously caused phantom "logged out" loops.
 *
 * Bump CACHE_VERSION whenever this file changes.
 *
 * v69 — Forced reset path. Activate handler now hard-purges EVERY cache
 *       that doesn't carry the current `paneltec-v69` prefix and broadcasts
 *       `paneltec_sw_force_reload` to all open clients so they refresh once.
 *       Pairs with the backend `Clear-Site-Data` middleware (cookie-gated)
 *       so visitors with a stuck older SW self-heal on next API hit.
 * v76 — Inductions Matrix gains inline PDF preview alongside download via the
 *       existing PdfPreviewModal. Touches InductionsMatrix.jsx,
 *       PdfPreviewModal.jsx, and the backend print endpoint (mode flag).
 * v77 — Phase 3.12 Induction Card popup: every induction card / matrix cell
 *       opens InductionCardModal (detail view + iframe doc preview + edit /
 *       add / file upload). New backend endpoints under
 *       /workers/{wid}/inductions/...
 * v81 — Phase 3.16 Session Timeout: backend org settings + active_sessions
 *       + per-role JWT lifetimes + force-logout-all. Frontend gets the
 *       useSessionTimeout hook driving SessionWarningModal inside AppShell.
 * v82 — Phase 3.16 Part A+B: BSON-Date fail-SAFE normalisation in
 *       session_timeout.py (+ pytest cover), Settings → Session Timeout
 *       admin card (idle/absolute/warning/remember-me/per-role overrides/
 *       force-logout-all), and "Keep me logged in" checkbox on /login
 *       gated by GET /api/settings/login-options.
 * v83 — Phase 3.17 Certifications row actions: 👁 View PDF (PdfPreviewModal),
 *       ✏️ Edit (PATCH /workers/certifications/{id}), 🗑 Delete with proper
 *       confirmation modal (DELETE /workers/certifications/{id}, admin-only).
 * v84 — Phase 3.18 Granular permissions + Active Sessions panel:
 *       `delete` action added to ACTIONS, new resources (workers, inductions,
 *       certifications, documents, forms), HSEQ Lead loses delete by default.
 *       Cert/induction/worker DELETE routes now flow through require_permission
 *       so admins can grant per-user delete via override. UsersManagement
 *       gains a ✏️ Edit-permissions icon button + matrix search field.
 *       Live "Active sessions" panel inside the Session Timeout card
 *       (GET /api/admin/active-sessions + DELETE /api/admin/active-sessions/{jti}).
 * v85 — Phase 4.1 SWMS Assignments admin + version-chain commit:
 *       POST /api/swms now auto-chains: same title+org_id with bumped
 *       version archives the old row (status=superseded, superseded_by) and
 *       inserts a fresh one with supersedes pointer. Same version → in-place
 *       update (idempotent). GET /swms hides superseded unless
 *       ?include_superseded=true. New /swms/{id}/history (DFS, capped at 20
 *       hops). Backfill endpoint POST /admin/swms/backfill-version-chain
 *       (admin only). SWMS Assignments two-pane admin page with bulk mode.
 */
const CACHE_VERSION = 'paneltec-v85';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PRECACHE = [
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
  event.waitUntil((async () => {
    // Hard purge every cache that doesn't carry the current version prefix.
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => !k.startsWith(CACHE_VERSION))
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
    // Broadcast a one-time reload signal. The page-side listener gates on
    // sessionStorage so it never loops.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      try { c.postMessage({ type: 'paneltec_sw_force_reload', version: CACHE_VERSION }); }
      catch (_) { /* noop */ }
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isHtmlNavigation(req, url) {
  if (req.mode === 'navigate') return true;
  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  // bare "/" or paths with no file extension are SPA routes
  if (url.pathname === '/' || (!url.pathname.includes('.') && !url.pathname.startsWith('/static/'))) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // CRITICAL: never intercept API requests. Always go to network.
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for HTML / SPA navigations — guarantees the latest chunk
  // hashes are referenced after every deploy.
  if (isHtmlNavigation(req, url)) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/'))),
    );
    return;
  }

  // Cache-first for hashed static assets.
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
