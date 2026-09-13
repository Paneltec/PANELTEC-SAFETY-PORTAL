// v58.12.7 — Reusable grouped-tile list. Extracted from the PreStarts.jsx
// pattern to unify Inspections + Incidents (and any future Capture tab).
// PreStarts.jsx itself is deliberately NOT migrated in this ship — future
// pass will fold it in once the pattern has soaked here.
//
// v58.12.9 — Hazard-parity tile visuals. Each tile now adopts the
// `CaptureCard` visual language (rounded-lg, tight `pl-2.5 pr-1.5 py-1.5`
// body, hover shadow, optional 4px absolute left stripe). Callers can
// opt in by passing `getStripeType(record) → typeKey`; the shared
// `paletteForType` (from `../../lib/preStartsPalette`) resolves each
// key to a hex + tint + chip palette. When `getStripeType` is present:
//   · Each tile gets an absolute left stripe styled inline from
//     `paletteForType(getStripeType(rec)).hex`.
//   · The group banner (background + border + dot + count chip) is
//     tinted from `paletteForType(getStripeType(rows[0]))` — the
//     first-card palette per user's approved brief.
// Callers passing `groupPaletteOverrides[key]` STILL win for the
// banner (backward compat — Incidents relies on this for its fixed
// CATS escalation ladder).
// Grid density also bumped: `sm:2 / lg:3 / xl:4` (was `sm:2 / lg:3`).
//
// Contract (see spec for the full JSDoc list):
//   items          — array of records (already filtered by parent toolbar).
//   groupBy(rec)   — returns a stable key per group (template_name, category, …).
//   groupLabels    — optional {key: 'Human label'} for the group header.
//   groupOrder     — optional array; groups sorted by this order first, then
//                    by alpha for any keys not in the array. Undefined → alpha.
//   getStripeType  — optional (rec) => typeKey string. Enables stripe +
//                    palette-derived banner. Absent → legacy hash palette.
//   groupPaletteOverrides — optional {key: {header, dot, chip}} to fix
//                    a specific group's banner. Wins over getStripeType.
//   renderTile     — (rec) => JSX rendered inside each tile card.
//   dateFn         — (rec) => sortable string; tiles within a group sort DESC.
//   loading/error/onRetry — states aligned with the v58.11.1 PreStarts pattern.
//   emptyMessage   — optional title/body text for the EmptyState.
//   testidPrefix   — required — data-testid seams built from this.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { paletteForType } from '../../lib/preStartsPalette';
import { resolveGroupPalette } from '../../lib/groupPalette';
import useCaptureDensity from '../../lib/useCaptureDensity';

// Six deterministic colour buckets keyed by a stable string hash.
// Kept local to this component so it doesn't couple to folderColors.js
// (which is scoped to document folders, semantically wrong here).
const TILE_PALETTE = [
  { header: 'bg-blue-50 border-blue-200',    dot: 'bg-blue-500',    chip: 'bg-blue-100 text-blue-800' },
  { header: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800' },
  { header: 'bg-amber-50 border-amber-200',  dot: 'bg-amber-500',   chip: 'bg-amber-100 text-amber-800' },
  { header: 'bg-violet-50 border-violet-200', dot: 'bg-violet-500', chip: 'bg-violet-100 text-violet-800' },
  { header: 'bg-teal-50 border-teal-200',    dot: 'bg-teal-500',    chip: 'bg-teal-100 text-teal-800' },
  { header: 'bg-rose-50 border-rose-200',    dot: 'bg-rose-500',    chip: 'bg-rose-100 text-rose-800' },
];

function hashKey(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i += 1) h = (h * 31 + String(s).charCodeAt(i)) & 0xffffffff;
  return Math.abs(h);
}

// Optional override: caller passes explicit {key: paletteObj} to override
// the hash-mapped palette (e.g. Incidents' CATS-fixed severity ladder).
export function getGroupPalette(key, overrides) {
  if (overrides && overrides[key]) return overrides[key];
  return TILE_PALETTE[hashKey(key) % TILE_PALETTE.length];
}

export default function GroupedTilesView({
  items, groupBy, groupLabels, groupOrder, groupPaletteOverrides,
  getStripeType,
  renderTile, dateFn = (r) => r.created_at || r.date || '',
  loading, error, onRetry,
  emptyMessage, testidPrefix,
  // v58.13.40 — density + palette wiring. Both are opt-in via `page`
  // (palette source-of-truth key) and `pageKey` (density localStorage
  // scope). Undefined preserves the pre-v58.13.40 behaviour.
  page, pageKey,
  // v58.13.132ek — Zebra-row shading opt-in. When true, every other
  // tile in each group gets a slate-50 background via the ctx passed
  // to renderTile. Row parity is computed from the currently-rendered
  // index within the group (respects search/filter narrowing).
  zebra = false,
  // v58.13.41 — optional external density instance. When supplied,
  // GroupedTilesView reuses the parent's hook instead of creating
  // its own — required so a toolbar segmented control at page level
  // and the tile grid stay in lockstep (they'd otherwise drift
  // because two `useCaptureDensity` calls maintain independent
  // React state even with the same localStorage key).
  density: densityProp,
}) {
  // Density hook. `pageKey` defaults to testidPrefix so callers that
  // don't pass an explicit pageKey still get per-page persistence.
  const internalDensity = useCaptureDensity(pageKey || testidPrefix, (items || []).length);
  const density = densityProp || internalDensity;
  // v58.11.1 auto-retry cadence — 3 s then 10 s.
  const [retrying, setRetrying] = useState(false);
  const retriedAtRef = useRef([]);
  useEffect(() => {
    if (!error || !onRetry) return undefined;
    const attempts = retriedAtRef.current;
    if (attempts.length >= 2) return undefined;
    const delay = attempts.length === 0 ? 3000 : 10000;
    const t = setTimeout(() => {
      attempts.push(Date.now()); setRetrying(true);
      Promise.resolve(onRetry()).finally(() => setRetrying(false));
    }, delay);
    return () => clearTimeout(t);
  }, [error, onRetry]);

  const groups = useMemo(() => {
    const m = new Map();
    (items || []).forEach((rec) => {
      const k = groupBy(rec);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(rec);
    });
    // Sort each group's rows by date DESC.
    m.forEach((arr) => arr.sort((a, b) => String(dateFn(b)).localeCompare(String(dateFn(a)))));
    // Group order: explicit `groupOrder` first, then alpha for the rest.
    const keys = Array.from(m.keys());
    const ordered = [];
    if (Array.isArray(groupOrder)) {
      groupOrder.forEach((k) => { if (m.has(k)) ordered.push(k); });
    }
    keys.sort((a, b) => String(a).localeCompare(String(b)))
      .forEach((k) => { if (!ordered.includes(k)) ordered.push(k); });
    return ordered.map((k) => ({ key: k, rows: m.get(k) }));
  }, [items, groupBy, groupOrder, dateFn]);

  // v58.13.132em — Live grid-columns tracking per group. `zebra` needs
  // to know how many tiles fit per horizontal row so parity paints
  // clean stripes across the grid, not a scattered checker. We read
  // `gridTemplateColumns` off each grid element and re-read on
  // resize (responsive breakpoints change the column count).
  const gridRefs = useRef({});
  const [colsByGroup, setColsByGroup] = useState({});
  useEffect(() => {
    if (!zebra) return;
    const recompute = () => {
      const next = {};
      for (const [key, el] of Object.entries(gridRefs.current)) {
        if (!el) continue;
        const tpl = getComputedStyle(el).gridTemplateColumns || '';
        const n = tpl.trim() ? tpl.split(/\s+/).length : 1;
        next[key] = Math.max(1, n);
      }
      setColsByGroup((prev) => {
        // Skip state update when nothing changed (avoids resize loops).
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const k of keys) if (prev[k] !== next[k]) return next;
        return prev;
      });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    Object.values(gridRefs.current).forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [zebra, groups]);

  if (loading) {
    return <div className="text-sm text-slate-500" data-testid={`${testidPrefix}-loading`}>Loading…</div>;
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center"
           data-testid={`${testidPrefix}-error-card`}>
        <div className="font-semibold text-amber-900">Could not load</div>
        <div className="text-sm text-amber-800 mt-1">{String(error?.message || error || 'Unknown error')}</div>
        <button type="button" onClick={onRetry} disabled={retrying}
                data-testid={`${testidPrefix}-retry-btn`}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-60">
          <RefreshCw size={14} className={retrying ? 'animate-spin' : ''} /> Retry
        </button>
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic px-4 py-8 text-center"
           data-testid={`${testidPrefix}-empty`}>{emptyMessage || 'No records yet.'}</div>
    );
  }
  return (
    <div className="space-y-6" data-testid={`${testidPrefix}-tiles`}>
      {groups.map(({ key, rows }) => {
        // Banner palette resolution (in order of precedence):
        //   1. v58.13.40 `page` → shared `resolveGroupPalette`.
        //   2. Explicit `groupPaletteOverrides[key]` — CATS ladder etc.
        //   3. `getStripeType` first-card tint via `paletteForType`.
        //   4. Legacy hash palette.
        const sharedPal = page
          ? resolveGroupPalette({ groupKey: key, page })
          : null;
        const override = !sharedPal && groupPaletteOverrides
          && groupPaletteOverrides[key];
        const stripeType = !sharedPal && !override && getStripeType && rows[0]
          ? getStripeType(rows[0]) : null;
        const stripePal = stripeType ? paletteForType(stripeType) : null;
        const hashPal = !sharedPal && !override && !stripePal
          ? getGroupPalette(key) : null;

        const bannerClass = sharedPal ? ''
          : override ? override.header
          : hashPal ? hashPal.header : '';
        const bannerStyle = sharedPal
          ? { backgroundColor: sharedPal.tint, borderColor: sharedPal.hex + '33' }
          : stripePal
          ? { backgroundColor: stripePal.tint, borderColor: stripePal.border }
          : undefined;
        const dotClass = sharedPal ? ''
          : override ? override.dot
          : hashPal ? hashPal.dot : '';
        const dotStyle = sharedPal ? { backgroundColor: sharedPal.hex }
          : stripePal ? { backgroundColor: stripePal.hex }
          : undefined;
        const chipClass = sharedPal ? ''
          : override ? override.chip
          : hashPal ? hashPal.chip : '';
        const chipStyle = sharedPal
          ? { backgroundColor: sharedPal.hex + '22', color: sharedPal.text }
          : stripePal
          ? { backgroundColor: stripePal.chipBg, color: stripePal.chipText }
          : undefined;
        const rowStripeHex = sharedPal ? sharedPal.hex : null;
        const label = (groupLabels && groupLabels[key]) || key || 'Unnamed';
        return (
          <section key={key} data-testid={`${testidPrefix}-tile-group-${key}`}
                   className={`rounded-2xl border overflow-hidden ${bannerClass}`} style={bannerStyle}>
            <header className={`flex items-center gap-2 px-4 py-3 border-b ${bannerClass}`} style={bannerStyle}>
              <span className={`w-2.5 h-2.5 rounded-full ${dotClass}`} style={dotStyle} />
              <h3 className="text-sm font-semibold text-slate-900" style={sharedPal ? { color: sharedPal.text } : undefined}>{label}</h3>
              <span data-testid={`${testidPrefix}-tile-count-${key}`}
                    className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full ${chipClass}`}
                    style={chipStyle}>
                {rows.length}
              </span>
            </header>
            <div ref={(el) => { if (el) gridRefs.current[key] = el; }}
                 className={`p-3 ${density.gridClass} bg-white`}
                 data-testid={`${testidPrefix}-tile-grid-${density.effectiveMode}`}>
              {rows.map((rec, rowIdx) => {
                // v58.13.45 — Double-stripe bugfix.
                //
                // Before: this wrapper rendered its own card chrome
                // (rounded, border, bg-white, hover-shadow) AND its
                // own left stripe using `rowStripe.hex`. `renderTile`
                // then returned a `<CaptureCard>` which is ALSO a
                // full card with its own stripe — producing a
                // card-within-a-card and TWO visible stripes (outer
                // at px 0-4, inner at px 10-14 after the `pl-2.5`
                // padding). User caught it on Inspections after
                // v58.13.40 introduced strong per-group hexes that
                // made the double-stripe visually loud.
                //
                // After: this wrapper is a minimal positioning
                // container (testid only). CaptureCard becomes the
                // sole visible tile chrome, and its own stripe is
                // painted from `ctx.stripeHex` (see below) — group
                // palette is now the single source of truth.
                const rowStripe = rowStripeHex
                  ? { hex: rowStripeHex }
                  : (getStripeType ? paletteForType(getStripeType(rec)) : null);
                // v58.13.132em — Zebra parity is now HORIZONTAL-ROW
                // based, not per-tile. Every OTHER row of tiles gets
                // the tint so the pattern reads as clean stripes
                // across the grid instead of a scattered checker.
                // `cols` is the live count of grid columns from the
                // resize-observed grid element (updated on layout
                // changes so responsive breakpoints stay honest).
                const cols = colsByGroup[key] || 1;
                const visualRow = Math.floor(rowIdx / cols);
                return (
                  <div key={rec.id} data-testid={`${testidPrefix}-tile-${rec.id}`}>
                    {renderTile(rec, {
                      subtitleLines: density.subtitleLines,
                      minH: density.cardMinH,
                      // v58.13.41 — pass the group palette hex down
                      // so `<CaptureCard>`'s own left stripe agrees
                      // with the group banner. v58.13.45 — this is
                      // now the ONLY stripe source (the outer
                      // wrapper no longer draws one).
                      stripeHex: rowStripe ? rowStripe.hex : null,
                      // v58.13.132ek — Zebra-shading parity flag.
                      // v58.13.132em — parity comes from `visualRow`
                      // (horizontal row within the grid), not from
                      // the flat tile index.
                      zebraTint: zebra && (visualRow % 2 === 1),
                    })}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
