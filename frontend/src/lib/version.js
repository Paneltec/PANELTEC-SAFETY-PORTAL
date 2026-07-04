// Paneltec Civil · v156.1 — single-source-of-truth version constant
// for the currently running JS bundle.
//
// Bump this string every time the service-worker CACHE_VERSION in
// `/app/frontend/public/service-worker.js` is bumped. The
// `CacheBusterBanner` compares this compile-time value against the
// server's `/api/health/version` response. When they diverge, the
// user's tab is running a stale bundle — the banner surfaces a
// one-click SW-unregister + hard-reload flow.

export const RUNNING_VERSION = 'paneltec-v156.1';
