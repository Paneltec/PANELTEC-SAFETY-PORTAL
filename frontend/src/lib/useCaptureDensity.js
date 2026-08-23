// v160.3.9.58.13.39 — Capture tile density hook.
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

import { useEffect, useState, useMemo, useCallback } from 'react';

const MODES = ['auto', 'compact', 'comfortable', 'spacious'];

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
    _setMode(next);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(_lsKey(pageKey), next);
      }
    } catch { /* ignore */ }
  }, [pageKey]);

  const effectiveMode = mode === 'auto' ? autoModeForCount(itemCount) : mode;
  const spec = SPEC[effectiveMode] || SPEC.comfortable;

  return useMemo(() => ({
    mode,
    effectiveMode,
    setMode,
    gridClass: spec.gridClass,
    cardMinH: spec.cardMinH,
    subtitleLines: spec.subtitleLines,
  }), [mode, effectiveMode, setMode, spec]);
}
