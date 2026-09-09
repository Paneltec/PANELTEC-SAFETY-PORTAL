// Paneltec Civil · v154.3 — CacheBusterBanner.
// v160.3.6w — Option B: toned-down update-available toast.
// v58.13.24 — Stickier UX pass. Rebalances "don't nag admins" with
// "don't let users miss it entirely". Changes:
//   · AUTO_HIDE_MS 8s → 30s (3.75× more window to notice).
//   · Version-scoped localStorage dismiss so a "Dismiss" click for
//     server v58.13.24 does NOT suppress the toast for v58.13.25 —
//     each new server version gets its own fresh signal.
//   · Explicit **Dismiss** (was "Later") and **Reload now** (was
//     "Reload") buttons with `e.stopPropagation()` +
//     `e.preventDefault()` per v58.13.10 flash-bug guardrail.
//   · Subtle 5-second pulse ring when the toast first appears so
//     peripheral vision picks it up.
// Detects when the browser bundle version differs from the server's
// `/api/health/version`.
//   · Auto-hide after AUTO_HIDE_MS (unless the user dismisses first).
//   · Compact "Reload now" button + "Dismiss" button — no more
//     scrunched-together "Later" link.
//   · Version-scoped `paneltec_cachebust_dismissed_${serverVersion}`
//     localStorage key survives page reloads: if the user chose
//     Dismiss for that specific server version we won't nag again.
//     Bumps automatically when the next ship lands.
//   · Keeps the full hard-reload path (unregister SW + clear caches +
//     reload) for the "Reload now" button.
//
// Rationale: many patch versions per day, but the toast is the
// safety net for edge cases where the SW SKIP_WAITING /
// controllerchange auto-reload didn't fire.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, X as XIcon } from 'lucide-react';
import { RUNNING_VERSION, EXPECTED_CACHE_VERSION } from '../lib/version';

const HEALTH_URL = (process.env.REACT_APP_BACKEND_URL || '') + '/api/health/version';
const POLL_MS = 5 * 60 * 1000;         // 5 minutes
const BOOT_GRACE_MS = 30_000;          // suppress for first 30 s after mount
// v58.13.24 — bumped from 8_000 to 30_000. The old 8s window meant
// users could easily glance away and miss it. 30s is still short of
// "nag" territory but gives ~4x the peripheral-vision window.
const AUTO_HIDE_MS = 30_000;
// v58.13.24 — pulse the toast for the first 5 s on appear so the
// eye actually catches the movement.
const PULSE_MS = 5_000;

// v58.13.24 — Version-scoped dismiss. Reading and writing here is
// wrapped in try/catch because Safari private mode / iframes can
// throw on localStorage access.
const DISMISS_KEY_PREFIX = 'paneltec_cachebust_dismissed_';
function readDismissed(version) {
  if (!version) return false;
  try {
    return localStorage.getItem(DISMISS_KEY_PREFIX + version) === '1';
  } catch { return false; }
}
function writeDismissed(version) {
  if (!version) return;
  try {
    localStorage.setItem(DISMISS_KEY_PREFIX + version, '1');
  } catch { /* noop */ }
}

export default function CacheBusterBanner() {
  const [serverVersion, setServerVersion] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [autoHidden, setAutoHidden] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [ready, setReady] = useState(false);
  const bootTsRef = useRef(Date.now());
  const autoHideTimerRef = useRef(null);
  const pulseTimerRef = useRef(null);

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
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, [check]);

  // v58.13.24 — Reset session-dismiss when the server version
  // changes (so a Dismiss for the OLD server version doesn't
  // suppress the toast for a NEW server version). Belt-and-braces
  // alongside the version-scoped localStorage key.
  useEffect(() => { setDismissed(false); }, [serverVersion]);

  // v58.13.24 — Version-scoped persistent dismiss check.
  const persistentlyDismissed = readDismissed(serverVersion);

  // v58.13.132q_blink_hotfix — Under the new CACHE_VERSION batching
  // policy the SW cache_version stays behind RUNNING_VERSION most of
  // the time (only batched-ships bump the SW). Comparing serverVersion
  // (== SW cache_version, via /api/health/version) against RUNNING_VERSION
  // fires the toast on EVERY ship + puts a 1.2s pulseRing animation up
  // for 5 seconds — which the user reads as "blinking every second".
  //
  // Correct compare is: SW's advertised cache_version vs. what THIS
  // bundle expects the SW to be (EXPECTED_CACHE_VERSION). When we
  // deliberately bump the SW, we bump EXPECTED_CACHE_VERSION in the
  // same commit — that's the only time the toast should appear.
  const mismatched = ready
    && serverVersion
    && EXPECTED_CACHE_VERSION
    && serverVersion !== EXPECTED_CACHE_VERSION
    && !dismissed
    && !persistentlyDismissed
    && (Date.now() - bootTsRef.current) >= BOOT_GRACE_MS;

  // Kick off the auto-hide + pulse timers the first time the
  // mismatch is detected. Reset when serverVersion changes.
  useEffect(() => {
    if (!mismatched) return;
    setAutoHidden(false);
    setPulsing(true);
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    autoHideTimerRef.current = setTimeout(() => setAutoHidden(true), AUTO_HIDE_MS);
    pulseTimerRef.current = setTimeout(() => setPulsing(false), PULSE_MS);
    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, [mismatched, serverVersion]);

  if (!mismatched || autoHidden) return null;

  const dismiss = (e) => {
    // v58.13.10 flash-bug guardrail on both button handlers.
    e?.stopPropagation?.(); e?.preventDefault?.();
    writeDismissed(serverVersion);
    setDismissed(true);
  };

  const forceReload = async (e) => {
    e?.stopPropagation?.(); e?.preventDefault?.();
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
      className={`fixed bottom-4 right-4 z-[100] max-w-sm animate-[fadeInUp_0.25s_ease-out] ${pulsing ? 'animate-[pulseRing_1.2s_ease-in-out_infinite]' : ''}`}
    >
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white shadow-lg px-4 py-3">
        <div className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100 text-blue-600 shrink-0">
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
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 text-white text-[11px] font-semibold hover:bg-blue-700 disabled:opacity-60"
            >
              <RefreshCw size={10} className={reloading ? 'animate-spin' : ''} />
              {reloading ? 'Reloading…' : 'Reload now'}
            </button>
            <button
              type="button"
              onClick={dismiss}
              data-testid="cache-buster-dismiss"
              className="inline-flex items-center px-2.5 py-1 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              Dismiss
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          data-testid="cache-buster-close"
          aria-label="Dismiss update notice"
          className="text-slate-400 hover:text-slate-700 shrink-0 -mr-1 -mt-1 p-1"
        >
          <XIcon size={13} />
        </button>
      </div>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulseRing { 0%, 100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); } 50% { box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.18); } }
      `}</style>
    </div>
  );
}
