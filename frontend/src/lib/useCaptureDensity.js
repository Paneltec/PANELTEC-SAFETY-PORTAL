// v160.3.9.58.13.39 — Capture tile density hook.
// v160.3.9.58.13.47 — Fire-and-forget telemetry on every setMode +
//   one initial `resolved_from_auto` ping per (page, session).
//   Debounced 500 ms so rapid A/B/A clicks don't spam the endpoint.
//   Silent on failure — analytics MUST NOT surface toasts or block
//   the UX. Non-'auto' persisted modes short-circuit the initial
//   ping so we only capture what auto actually resolved to.
//
// Central density state for Capture list pages. Manages the
// user-facing "Auto / Compact / Comfortable / Spacious" segmented
// control in `CaptureListToolbar` and derives the effective grid
// classes + card min-height + subtitle visibility that
// `GroupedTilesView`, `CaptureCardGrid`, and `CaptureCard` consume.
//
// Persistence: per-page localStorage key `captureDensity:<pageKey>`.
// Users tend to browse Incidents in Comfortable but scan a big
// Sign-In register in Compact — per-page is more useful than global.
//
// Auto-density thresholds (fired when mode === 'auto'):
//   ·  <12 items  → Spacious   (breathing room; sparse days)
//   · 12–48 items → Comfortable (default; current pre-v58.13.39 look)
//   · >48 items   → Compact    (dense; scanning long registers)
//
// Grid classes are per-mode Tailwind strings; card min-heights are
// px values (so callers can pass them as inline `min-h-[Xpx]`
// classes or as inline styles). Subtitle lines: 0 = hidden,
// 1 = line-clamp-1, 2 = line-clamp-2.

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import axios from 'axios';

const MODES = ['auto', 'compact', 'comfortable', 'spacious'];
const TELEMETRY_DEBOUNCE_MS = 500;
const TELEMETRY_URL = `${process.env.REACT_APP_BACKEND_URL || ''}/api/metrics/capture-density`;

// v58.13.47 — fire-and-forget POST. Never awaits, never throws,
// never surfaces a toast. Timeout at 2 s so a slow endpoint can't
// pile up in-flight requests. Uses a bare axios instance (NOT the
// authed `/lib/api` client) so this call can't accidentally trip
// a 401-redirect interceptor.
function _emit(payload) {
  if (typeof window === 'undefined') return;
  if (!TELEMETRY_URL) return;
  try {
    axios.post(TELEMETRY_URL, payload, {
      timeout: 2000,
      // eslint-disable-next-line no-empty-function
    }).catch(() => {});
  } catch { /* never throws */ }
}

const SPEC = {
  spacious: {
    gridClass:
      'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
    cardMinH: '96px',
    subtitleLines: 2,
  },
  comfortable: {
    gridClass:
      'grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6',
    cardMinH: '96px',
    subtitleLines: 1,
  },
  compact: {
    gridClass:
      'grid gap-1.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8',
    cardMinH: '64px',
    subtitleLines: 0,
  },
};

/**
 * @param {number} itemCount
 * @returns {'compact'|'comfortable'|'spacious'}
 */
export function autoModeForCount(itemCount) {
  const n = Number(itemCount) || 0;
  if (n < 12) return 'spacious';
  if (n > 48) return 'compact';
  return 'comfortable';
}

function _lsKey(pageKey) {
  return `captureDensity:${pageKey || 'default'}`;
}

/**
 * @param {string} pageKey
 * @param {number} itemCount
 */
export default function useCaptureDensity(pageKey, itemCount) {
  const [mode, _setMode] = useState('auto');
  // v58.13.47 — debounce + initial-ping tracking.
  const debounceRef = useRef(null);
  const initialPingSentRef = useRef(false);

  // Read persisted mode on mount (SSR-safe: localStorage lazy-check).
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined'
        ? window.localStorage.getItem(_lsKey(pageKey)) : null;
      if (raw && MODES.includes(raw)) _setMode(raw);
    } catch { /* ignore quota / disabled */ }
  }, [pageKey]);

  const setMode = useCallback((next) => {
    if (!MODES.includes(next)) return;
    // Grab the previous value BEFORE React batches the update so
    // the telemetry payload can report the transition.
    const prev = mode;
    _setMode(next);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(_lsKey(pageKey), next);
      }
    } catch { /* ignore */ }
    // v58.13.47 — debounced telemetry ping. No-op when the mode
    // didn't actually change (idempotent click on the same button).
    if (next === prev) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      _emit({
        page: pageKey || 'default',
        mode: next,
        previous_mode: prev,
        effective_mode: next === 'auto' ? autoModeForCount(itemCount) : next,
        item_count: Number(itemCount) || 0,
        ts: Date.now(),
        event: 'setMode',
      });
    }, TELEMETRY_DEBOUNCE_MS);
  }, [pageKey, mode, itemCount]);

  const effectiveMode = mode === 'auto' ? autoModeForCount(itemCount) : mode;
  const spec = SPEC[effectiveMode] || SPEC.comfortable;

  // v58.13.47 — one-shot initial ping capturing what `auto`
  // actually resolved to (or what the persisted non-auto choice
  // is). Fires exactly once per hook instance, only after
  // `itemCount` has been non-zero at least once (avoids emitting
  // during the initial `items = []` render pass while the list is
  // still loading).
  useEffect(() => {
    if (initialPingSentRef.current) return;
    if (!itemCount) return;
    initialPingSentRef.current = true;
    _emit({
      page: pageKey || 'default',
      mode,
      effective_mode: effectiveMode,
      item_count: Number(itemCount) || 0,
      ts: Date.now(),
      event: 'resolved_from_auto',
    });
  }, [pageKey, mode, effectiveMode, itemCount]);

  return useMemo(() => ({
    mode,
    effectiveMode,
    setMode,
    gridClass: spec.gridClass,
    cardMinH: spec.cardMinH,
    subtitleLines: spec.subtitleLines,
  }), [mode, effectiveMode, setMode, spec]);
}
