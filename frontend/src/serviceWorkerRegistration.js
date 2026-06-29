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

// v96.2 — Guard key is now PER-VERSION instead of a single static string.
// The previous static `paneltec_sw_reloaded_v70` meant that the FIRST SW
// upgrade in a browser session won the reload; every subsequent upgrade in
// the same session (v85 → v96 → v96.2 …) was silently dropped because the
// guard was already set. Keying off `data.version` lets every distinct
// CACHE_VERSION earn exactly one auto-reload per session.
function attachForceReloadListener() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || data.type !== 'paneltec_sw_force_reload') return;
    const guardKey = `paneltec_sw_reloaded_${data.version || 'unknown'}`;
    try {
      if (sessionStorage.getItem(guardKey) === '1') return;
      sessionStorage.setItem(guardKey, '1');
    } catch (_) { /* sessionStorage may have just been wiped — fine */ }
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
          .catch(() => { /* swallow — best-effort */ });
      }).catch(() => { /* ignore */ });
    }
    return;
  }
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then((reg) => {
      // v96.2 — Poll for SW updates every 60s while the tab is open so
      // long-lived sessions pick up new builds without a manual refresh.
      try {
        setInterval(() => { reg.update().catch(() => {}); }, 60_000);
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
        try {
          if (sessionStorage.getItem('paneltec_sw_controller_reloaded') === '1') return;
          sessionStorage.setItem('paneltec_sw_controller_reloaded', '1');
        } catch (_) { /* noop */ }
        setTimeout(() => window.location.reload(), 0);
      });
    }).catch(() => { /* ignore — non-fatal */ });
  });
}
