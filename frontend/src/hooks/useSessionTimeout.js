// Phase 3.16 — Idle-watch + warning-modal driver.
//
// Fetches the user's effective timeouts from /api/settings/session-timeout/me
// on mount, listens for activity events, fires `onWarn` when `warning_modal_seconds`
// before idle and `onLogout` when idle reached. Activity bumps are debounced
// (30 s) — matches the server's ACTIVITY_DEBOUNCE_SECONDS so the client and
// server stay in lockstep.
import { useEffect, useRef, useState } from 'react';
import api from '../lib/api';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];
const DEBOUNCE_MS = 30_000;

export default function useSessionTimeout({ onWarn, onLogout, enabled = true } = {}) {
  const [cfg, setCfg] = useState(null);
  const lastActivityRef = useRef(Date.now());
  const lastBumpRef = useRef(0);

  // Fetch effective timeouts.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.get('/settings/session-timeout/me')
      .then((r) => { if (alive) setCfg(r.data); })
      .catch(() => {}); // never block UI if endpoint hiccups
    return () => { alive = false; };
  }, [enabled]);

  // Activity → bump.
  useEffect(() => {
    if (!enabled || !cfg) return;
    const onActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      // Tell the server (idempotent — server also debounces).
      if (now - lastBumpRef.current > DEBOUNCE_MS) {
        lastBumpRef.current = now;
        api.get('/auth/me').catch(() => {});
      }
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
  }, [enabled, cfg]);

  // Tick loop — checks idle every second so the warning fires accurately.
  useEffect(() => {
    if (!enabled || !cfg) return;
    let warned = false;
    const idleMs = cfg.idle_minutes * 60_000;
    const warnAt = idleMs - (cfg.warning_modal_enabled ? cfg.warning_modal_seconds * 1000 : 0);
    const tick = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= idleMs) {
        clearInterval(tick);
        onLogout?.();
      } else if (!warned && cfg.warning_modal_enabled && elapsed >= warnAt) {
        warned = true;
        onWarn?.({
          secondsRemaining: cfg.warning_modal_seconds,
          stay: () => { lastActivityRef.current = Date.now(); warned = false; },
        });
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [enabled, cfg, onWarn, onLogout]);

  return cfg;
}
