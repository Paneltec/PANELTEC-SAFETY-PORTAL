// Registers /service-worker.js if supported. Shows a toast when an update is
// ready and clicking Reload activates the new worker + refreshes the page.
//
// v69 — Also listens for the `paneltec_sw_force_reload` broadcast from the
// service worker's activate handler. When the user is on a browser whose
// SW was stuck at an older version, the new activate handler (after they
// finally pick up v69) will postMessage every open client → we force a
// one-time reload gated by sessionStorage so the loop can't repeat.
//
// v96.2 — Combined with the new auto-skipWaiting flow below, we no longer
// nag users with a "Reload to update" toast — incoming SW grabs control
// immediately and `controllerchange` reloads the page once.

// v58.13.132p_web_stability_hotfix — SINGLE sticky per-session guard shared
// by both auto-reload mechanisms (`controllerchange` and the SW's
// `paneltec_sw_force_reload` broadcast). Previously the broadcast handler
// keyed its guard by version — so four rapid `CACHE_VERSION` bumps in a
// row (`.132l → m → n → o`) earned four separate page reloads for anyone
// with the tab open, which the user perceived as the app "blinking and
// resetting itself". One guard, one auto-reload per session, done.
const AUTO_RELOAD_GUARD_KEY = 'paneltec_sw_auto_reloaded';
const AUTO_RELOAD_COOLDOWN_MS = 30_000;

function shouldSkipAutoReload() {
  try {
    const raw = sessionStorage.getItem(AUTO_RELOAD_GUARD_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return true; // legacy '1' → sticky, honour it
    // Even if the guard is expired, we keep a per-session lock: any prior
    // auto-reload in this session means we don't reload again automatically.
    // The 30s window is only used to swallow *simultaneous* triggers from
    // both mechanisms firing on the same activate cycle.
    return Date.now() - ts < AUTO_RELOAD_COOLDOWN_MS
        ? true
        : Boolean(sessionStorage.getItem(AUTO_RELOAD_GUARD_KEY));
  } catch (_) {
    // No sessionStorage → treat as fresh; let the reload happen once.
    return false;
  }
}

function markAutoReloaded() {
  try { sessionStorage.setItem(AUTO_RELOAD_GUARD_KEY, String(Date.now())); }
  catch (_) { /* noop */ }
}

function attachForceReloadListener() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || data.type !== 'paneltec_sw_force_reload') return;
    if (shouldSkipAutoReload()) return;
    markAutoReloaded();
    // Defer one tick so the SW message handler returns cleanly.
    setTimeout(() => window.location.reload(), 0);
  });
}

// Attach the listener unconditionally — works in dev and prod, regardless
// of whether registerServiceWorker() ever ran (the SW from a previous
// production build may still be controlling the page).
attachForceReloadListener();

export function registerServiceWorker() {
  if (process.env.NODE_ENV !== 'production') {
    // v96.2 — DEV-MODE SAFETY NET. If a user previously visited this URL
    // while it was serving a production build, their browser still has a
    // stuck SW controlling every request. In dev that means our hot bundle
    // can be partially shadowed by the stale prod cache (the symptom Stephen
    // hit: new Fluent icons present in bundle.js but invisible in the UI).
    // Proactively unregister every SW + drop every cache so the next reload
    // is clean. Safe to run on every dev page load — idempotent if nothing
    // is registered.
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        if (regs.length === 0) return;
        Promise.all(regs.map((r) => r.unregister().catch(() => false)))
          .then(() => {
            if ('caches' in window) {
              return caches.keys().then((keys) =>
                Promise.all(keys.map((k) => caches.delete(k).catch(() => false))),
              );
            }
            return null;
          })
          .catch((err) => { console.warn('[sw] dev-cleanup cache clear failed', err); });
      }).catch((err) => { console.warn('[sw] dev-cleanup getRegistrations failed', err); });
    }
    return;
  }
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then((reg) => {
      // v96.2 — Poll for SW updates every 60s while the tab is open so
      // long-lived sessions pick up new builds without a manual refresh.
      try {
        setInterval(() => { reg.update().catch((err) => { console.debug('[sw] update poll skipped', err); }); }, 60_000);
      } catch (_) { /* setInterval should never throw — defensive */ }

      // v96.2 — Auto-activate the incoming SW. Previously we showed a
      // "Reload to update" toast that users ignored, leaving them on a
      // stale bundle. Now any new SW gets SKIP_WAITING immediately on
      // install; pair it with `controllerchange` to reload the tab once
      // the new SW takes over. Gated by sessionStorage so we don't loop
      // on the very first registration (when no controller existed yet).
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener('statechange', () => {
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            try { incoming.postMessage('SKIP_WAITING'); } catch (_) { /* noop */ }
          }
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // v58.13.132p_web_stability_hotfix — share the guard with the
        // force-reload broadcast handler so both mechanisms combined never
        // trigger more than ONE auto-reload per tab session, regardless of
        // how many CACHE_VERSION bumps arrive.
        if (shouldSkipAutoReload()) return;
        markAutoReloaded();
        setTimeout(() => window.location.reload(), 0);
      });
    }).catch((err) => { console.warn('[sw] register failed', err); });
  });
}
