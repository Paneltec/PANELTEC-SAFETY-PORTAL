// Paneltec Civil · v154.3 — CacheBusterBanner.
//
// Detects when the browser is running a stale JS bundle (e.g. an
// old service-worker cache) while the server has already deployed
// a newer version. Compares the compile-time constant
// `lib/version.js#RUNNING_VERSION` against the server's
// `/api/health/version` response.
//
// When mismatched, renders a sticky orange banner at the very top
// of the app with a "Reload now" button that:
//   1. Unregisters ALL service worker registrations
//   2. Clears every Cache Storage entry via the Cache API
//   3. Hard-reloads the tab (`window.location.reload(true)`)
//
// Renders ABOVE the SilentAgentAlert banner by design — a bundle
// mismatch might itself be the reason the silent-agent state is
// stale. Session-scoped "Later" dismissal only (no localStorage);
// the banner reappears on next mount so a bounced tab still
// re-surfaces the update.
//
// Polls every 5 minutes while the tab is visible. Pauses when
// `document.visibilityState === 'hidden'` so background tabs
// don't hammer the endpoint.
//
// Non-fatal: if `/api/health/version` errors, the banner simply
// doesn't render. Never blocks the app.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { RUNNING_VERSION } from '../lib/version';

const HEALTH_URL = (process.env.REACT_APP_BACKEND_URL || '') + '/api/health/version';
const POLL_MS = 5 * 60 * 1000;   // 5 minutes
const BOOT_GRACE_MS = 30_000;    // suppress banner for the first 30 s after mount
                                 // to avoid false-positives during SW install races

export default function CacheBusterBanner() {
  const [serverVersion, setServerVersion] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [ready, setReady] = useState(false);
  const bootTsRef = useRef(Date.now());

  const check = useCallback(async () => {
    try {
      const r = await fetch(HEALTH_URL, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      if (typeof d?.cache_version === 'string') {
        setServerVersion(d.cache_version);
      }
    } catch (_e) {
      // Non-fatal — leave state unchanged.
    }
  }, []);

  useEffect(() => {
    check();
    // Poll only while visible.
    let iv = null;
    const arm = () => {
      if (iv) return;
      iv = setInterval(() => {
        if (document.visibilityState === 'visible') check();
      }, POLL_MS);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        check();   // catch-up on wake
        arm();
      } else if (iv) {
        clearInterval(iv);
        iv = null;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    arm();
    // After the boot grace period expires, allow rendering.
    const t = setTimeout(() => setReady(true), BOOT_GRACE_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (iv) clearInterval(iv);
      clearTimeout(t);
    };
  }, [check]);

  const mismatched = ready
    && serverVersion
    && serverVersion !== RUNNING_VERSION
    && !dismissed
    && (Date.now() - bootTsRef.current) >= BOOT_GRACE_MS;

  if (!mismatched) return null;

  const forceReload = async () => {
    setReloading(true);
    // 1. Unregister every SW registration.
    try {
      if (navigator?.serviceWorker?.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => {
          try { return r.unregister(); } catch (_e) { return null; }
        }));
      }
    } catch (_e) { /* ignore */ }
    // 2. Clear every Cache Storage entry.
    try {
      if (typeof caches !== 'undefined' && caches.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => {
          try { return caches.delete(k); } catch (_e) { return null; }
        }));
      }
    } catch (_e) { /* ignore */ }
    // 3. Hard-reload — `reload(true)` is deprecated in modern browsers
    //    but `reload()` is enough once caches + SW are gone.
    try { window.location.reload(); } catch (_e) { /* ignore */ }
  };

  return (
    <div
      role="alert"
      data-testid="cache-buster-banner"
      style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'linear-gradient(180deg, #b45309 0%, #92400e 100%)',
        color: '#fef3c7',
        borderBottom: '2px solid #fbbf24',
        padding: '12px 20px',
        boxShadow: '0 6px 18px -6px rgba(180,83,9,0.55)',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        maxWidth: 1400, margin: '0 auto',
      }}>
        <div style={{
          flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
          background: 'rgba(254,243,199,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AlertCircle className="w-4 h-4" style={{ color: '#fef3c7' }}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#fff', marginBottom: 2 }}>
            A newer version of Paneltec Civil is available
          </div>
          <div style={{ fontSize: 12, color: '#fde68a', lineHeight: 1.4 }}
               data-testid="cache-buster-versions">
            Your browser is running <code style={{
              background: 'rgba(0,0,0,0.25)', padding: '1px 5px',
              borderRadius: 3, fontFamily: 'ui-monospace,SFMono-Regular,monospace',
              fontSize: 11,
            }}>{RUNNING_VERSION}</code>
            {" · server has "}
            <code style={{
              background: 'rgba(0,0,0,0.25)', padding: '1px 5px',
              borderRadius: 3, fontFamily: 'ui-monospace,SFMono-Regular,monospace',
              fontSize: 11,
            }}>{serverVersion}</code>. Reload to activate.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={forceReload}
            disabled={reloading}
            data-testid="cache-buster-reload"
            style={{
              background: '#fff', color: '#92400e',
              padding: '8px 14px', fontWeight: 800, fontSize: 12,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              border: '1px solid #fff', borderRadius: 4,
              cursor: reloading ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              opacity: reloading ? 0.7 : 1,
            }}>
            <RefreshCw className="w-3.5 h-3.5" style={{
              animation: reloading ? 'ptSpin 1s linear infinite' : 'none',
            }}/>
            {reloading ? 'Reloading…' : 'Reload now'}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            data-testid="cache-buster-later"
            style={{
              background: 'transparent', color: '#fde68a',
              padding: '8px 12px', fontWeight: 700, fontSize: 11,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              border: '1px solid rgba(254,243,199,0.35)', borderRadius: 4,
              cursor: 'pointer',
            }}>
            Later
          </button>
        </div>
      </div>
      <style>{`@keyframes ptSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
