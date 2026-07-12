// Paneltec Civil · v154.3 — CacheBusterBanner.
// v160.3.6w — Option B: toned-down update-available toast.
//
// Detects when the browser bundle version differs from the server's
// `/api/health/version`. Instead of a sticky brown top-of-page banner
// this now renders as a small, soft-slate toast at the BOTTOM-RIGHT with:
//   • Auto-hide after 8 s (session dismissal survives the auto-hide too)
//   • Compact "Reload" button + subtle "Later" link
//   • Keeps the full hard-reload path (unregister SW + clear caches + reload)
//
// Rationale: we deploy many patch versions per day so the old brown
// banner was constantly nagging admins. The auto-reload path (SW poll +
// SKIP_WAITING + controllerchange listener) handles 99 % of updates
// silently — this toast is now purely the safety net for edge cases.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, X as XIcon } from 'lucide-react';
import { RUNNING_VERSION } from '../lib/version';

const HEALTH_URL = (process.env.REACT_APP_BACKEND_URL || '') + '/api/health/version';
const POLL_MS = 5 * 60 * 1000;         // 5 minutes
const BOOT_GRACE_MS = 30_000;          // suppress for first 30 s after mount
const AUTO_HIDE_MS = 8_000;            // v6w — soft auto-dismiss after 8 s

export default function CacheBusterBanner() {
  const [serverVersion, setServerVersion] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [autoHidden, setAutoHidden] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [ready, setReady] = useState(false);
  const bootTsRef = useRef(Date.now());
  const autoHideTimerRef = useRef(null);

  const check = useCallback(async () => {
    try {
      const r = await fetch(HEALTH_URL, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      if (typeof d?.cache_version === 'string') {
        setServerVersion(d.cache_version);
      }
    } catch (_e) {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    check();
    let iv = null;
    const arm = () => {
      if (iv) return;
      iv = setInterval(() => {
        if (document.visibilityState === 'visible') check();
      }, POLL_MS);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        check();
        arm();
      } else if (iv) { clearInterval(iv); iv = null; }
    };
    document.addEventListener('visibilitychange', onVis);
    arm();
    const t = setTimeout(() => setReady(true), BOOT_GRACE_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (iv) clearInterval(iv);
      clearTimeout(t);
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, [check]);

  const mismatched = ready
    && serverVersion
    && serverVersion !== RUNNING_VERSION
    && !dismissed
    && (Date.now() - bootTsRef.current) >= BOOT_GRACE_MS;

  // v6w — kick off the auto-hide timer the first time the mismatch is
  // detected. If the server version changes again later we reset it.
  useEffect(() => {
    if (!mismatched) return;
    setAutoHidden(false);
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    autoHideTimerRef.current = setTimeout(() => setAutoHidden(true), AUTO_HIDE_MS);
    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, [mismatched, serverVersion]);

  if (!mismatched || autoHidden) return null;

  const forceReload = async () => {
    setReloading(true);
    try {
      if (navigator?.serviceWorker?.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => {
          try { return r.unregister(); } catch (_e) { return null; }
        }));
      }
    } catch (_e) { /* ignore */ }
    try {
      if (typeof caches !== 'undefined' && caches.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => {
          try { return caches.delete(k); } catch (_e) { return null; }
        }));
      }
    } catch (_e) { /* ignore */ }
    try { window.location.reload(); } catch (_e) { /* ignore */ }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="cache-buster-banner"
      className="fixed bottom-4 right-4 z-[100] max-w-sm animate-[fadeInUp_0.25s_ease-out]"
    >
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white shadow-lg px-4 py-3">
        <div className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-500 shrink-0">
          <RefreshCw size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900">
            Update available
          </div>
          <div
            className="mt-0.5 text-[11px] text-slate-500 leading-snug"
            data-testid="cache-buster-versions">
            You&apos;re on{' '}
            <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">{RUNNING_VERSION}</code>
            {' · '}
            <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">{serverVersion}</code>
            {' '}ready.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={forceReload}
              disabled={reloading}
              data-testid="cache-buster-reload"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 text-white text-[11px] font-semibold hover:bg-slate-900 disabled:opacity-60"
            >
              <RefreshCw size={10} className={reloading ? 'animate-spin' : ''} />
              {reloading ? 'Reloading…' : 'Reload'}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              data-testid="cache-buster-later"
              className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          data-testid="cache-buster-close"
          aria-label="Dismiss update notice"
          className="text-slate-400 hover:text-slate-700 shrink-0 -mr-1 -mt-1 p-1"
        >
          <XIcon size={13} />
        </button>
      </div>
      <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
