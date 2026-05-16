// Service Worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Check for updates every 60s
        setInterval(() => reg.update(), 60_000);
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available — auto-activate
              installing.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((err) => console.warn('SW registration failed:', err));

    // Reload when a new SW takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      // Don't auto-reload to avoid interrupting work — let user reload manually
    });

    // Listen for SYNC_QUEUE messages from the SW (background sync trigger)
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SYNC_QUEUE') {
        window.dispatchEvent(new CustomEvent('paneltec-sync-queue'));
      }
    });
  });
}

// PWA install prompt handling
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  window.dispatchEvent(new CustomEvent('paneltec-install-available'));
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  window.dispatchEvent(new CustomEvent('paneltec-installed'));
});
window.paneltecInstall = async () => {
  if (!deferredInstallPrompt) return { ok: false, reason: 'unavailable' };
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  return { ok: choice.outcome === 'accepted', outcome: choice.outcome };
};
window.paneltecCanInstall = () => !!deferredInstallPrompt;
window.paneltecIsStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
