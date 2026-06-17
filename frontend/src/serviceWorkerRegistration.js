// Registers /service-worker.js if supported. Shows a toast when an update is
// ready and clicking Reload activates the new worker + refreshes the page.
import { toast } from 'sonner';

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
