// v96.2 — Stuck-SW self-heal.
//
// Some Paneltec admins hit a state where the deployed bundle ships new
// UI (e.g. the Fluent icon migration in v96) yet their browser keeps
// rendering the previous build. Root cause is always the same: an old
// Service Worker is still controlling the tab and serving cached chunks.
//
// This module is invoked once from <AppShell> on mount. It:
//   1. Asks the backend what CACHE_VERSION it expects (single source of
//      truth = the SW file on disk).
//   2. postMessages the controlling SW with a MessageChannel asking
//      `GET_VERSION`.
//   3. If the SW's version doesn't match the backend's, OR no SW is
//      controlling despite a registration existing (which happens after a
//      version skew during install), it nukes every cache, unregisters
//      every SW, and force-reloads the page exactly once per browser
//      session (session-storage guard).
//
// Idempotent + best-effort: any thrown error is swallowed so a bad probe
// never breaks the app.

import { API_BASE } from '@/lib/api';
import api from '@/lib/api';

const GUARD_KEY = 'paneltec_sw_self_heal_done';
const PROBE_TIMEOUT_MS = 1500;

async function probeSwVersion() {
  if (!('serviceWorker' in navigator)) return null;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return null;
  return await new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event?.data?.version || null);
    };
    try {
      controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    } catch (_) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function fetchExpectedVersion() {
  try {
    const res = await fetch(`${API_BASE}/health/version`, { credentials: 'omit' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.cache_version || null;
  } catch (_) {
    return null;
  }
}

async function nukeAndReload() {
  try { sessionStorage.setItem(GUARD_KEY, '1'); } catch (_) { /* noop */ }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
  } catch (_) { /* noop */ }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    }
  } catch (_) { /* noop */ }
  // Defer one tick so any pending side-effects flush.
  setTimeout(() => window.location.reload(), 0);
}

export async function runSwVersionGuard() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  try {
    if (sessionStorage.getItem(GUARD_KEY) === '1') return;
  } catch (_) { /* sessionStorage unavailable — proceed once anyway */ }

  // In DEV mode `registerServiceWorker` already unregisters stale prod
  // SWs on every load — no further action needed here.
  if (process.env.NODE_ENV !== 'production') return;

  const [swVersion, expected] = await Promise.all([
    probeSwVersion(),
    fetchExpectedVersion(),
  ]);

  if (!expected || expected === 'unknown') return; // backend can't read — bail
  if (swVersion && swVersion === expected) return; // happy path

  // Either no SW is controlling (cold load — let the install handler do
  // its thing) or there IS a mismatch. Only force-heal on actual mismatch
  // so we don't loop-reload first-time visitors.
  if (swVersion && swVersion !== expected) {
    console.warn(`[paneltec-sw] version mismatch — sw=${swVersion} expected=${expected}. Self-healing.`);
    await nukeAndReload();
  }
}

// Phase 3.21 Item 5 — Force-refresh signal poll. Separate from the
// version-mismatch self-heal so an admin can broadcast a refresh
// without bumping the SW version (e.g. critical CSS hotfix).
//
// Persistence: localStorage so we DON'T loop-reload across sessions.
// First-read seeds with the current server signal so a returning user
// doesn't immediately reload on first poll.
const SIGNAL_KEY = 'paneltec_last_seen_force_refresh';

async function fetchSignal() {
  try {
    // Use the shared api wrapper which already attaches the JWT.
    const res = await api.get('/settings/force-refresh-signal');
    return res?.data?.signal_at || null;
  } catch (_) { return null; }
}

export async function runForceRefreshSignalCheck() {
  if (typeof window === 'undefined') return;
  const signal = await fetchSignal();
  if (!signal) return;
  let lastSeen = null;
  try { lastSeen = localStorage.getItem(SIGNAL_KEY); } catch (_) { /* noop */ }
  if (!lastSeen) {
    // First read this browser — seed without reloading so returning
    // users don't trigger on a historical signal.
    try { localStorage.setItem(SIGNAL_KEY, signal); } catch (_) { /* noop */ }
    return;
  }
  if (signal > lastSeen) {
    // eslint-disable-next-line no-console
    console.warn('[paneltec-sw] force-refresh-all signal received. Reloading.');
    try { localStorage.setItem(SIGNAL_KEY, signal); } catch (_) { /* noop */ }
    await nukeAndReload();
  }
}

// Kick off a 60s heartbeat once on first import so the poll keeps
// running even while the user is sitting on a long-lived screen.
if (typeof window !== 'undefined' && !window.__paneltec_force_refresh_poll_started) {
  window.__paneltec_force_refresh_poll_started = true;
  setInterval(() => { runForceRefreshSignalCheck(); }, 60_000);
  // Fire once shortly after AppShell mounts so the first poll isn't 60s away.
  setTimeout(() => { runForceRefreshSignalCheck(); }, 5_000);
}

