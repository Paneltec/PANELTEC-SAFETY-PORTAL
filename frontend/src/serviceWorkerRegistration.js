// Registers /service-worker.js if supported. Shows a toast when an update is
// ready and clicking Reload activates the new worker + refreshes the page.
//
// v69 — Also listens for the `paneltec_sw_force_reload` broadcast from the
// service worker's activate handler. When the user is on a browser whose
// SW was stuck at an older version, the new activate handler (after they
// finally pick up v69) will postMessage every open client → we force a
// one-time reload gated by sessionStorage so the loop can't repeat.
import { toast } from 'sonner';

const RELOAD_GUARD = 'paneltec_sw_reloaded_v69';

function attachForceReloadListener() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || data.type !== 'paneltec_sw_force_reload') return;
    try {
      if (sessionStorage.getItem(RELOAD_GUARD) === '1') return;
      sessionStorage.setItem(RELOAD_GUARD, '1');
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
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then((reg) => {
      // Listen for updates.
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener('statechange', () => {
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            toast.message('New version available', {
              description: 'Reload to update.',
              action: {
                label: 'Reload',
                onClick: () => {
                  incoming.postMessage('SKIP_WAITING');
                  window.location.reload();
                },
              },
              duration: 12000,
            });
          }
        });
      });
    }).catch(() => { /* ignore — non-fatal */ });
  });
}
