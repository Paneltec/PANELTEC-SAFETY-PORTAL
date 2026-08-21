// v58.12.7 — Reusable grouped-tile list. Extracted from the PreStarts.jsx
// pattern to unify Inspections + Incidents (and any future Capture tab).
// PreStarts.jsx itself is deliberately NOT migrated in this ship — future
// pass will fold it in once the pattern has soaked here.
//
// Contract (see spec for the full JSDoc list):
//   items          — array of records (already filtered by parent toolbar).
//   groupBy(rec)   — returns a stable key per group (template_name, category, …).
//   groupLabels    — optional {key: 'Human label'} for the group header.
//   groupOrder     — optional array; groups sorted by this order first, then
//                    by alpha for any keys not in the array. Undefined → alpha.
//   renderTile     — (rec) => JSX rendered inside each tile card.
//   dateFn         — (rec) => sortable string; tiles within a group sort DESC.
//   loading/error/onRetry — states aligned with the v58.11.1 PreStarts pattern.
//   emptyMessage   — optional title/body text for the EmptyState.
//   testidPrefix   — required — data-testid seams built from this.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

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
  renderTile, dateFn = (r) => r.created_at || r.date || '',
  loading, error, onRetry,
  emptyMessage, testidPrefix,
}) {
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
        const palette = getGroupPalette(key, groupPaletteOverrides);
        const label = (groupLabels && groupLabels[key]) || key || 'Unnamed';
        return (
          <section key={key} data-testid={`${testidPrefix}-tile-group-${key}`}
                   className={`rounded-2xl border ${palette.header} overflow-hidden`}>
            <header className={`flex items-center gap-2 px-4 py-3 border-b ${palette.header}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${palette.dot}`} />
              <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
              <span data-testid={`${testidPrefix}-tile-count-${key}`}
                    className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full ${palette.chip}`}>
                {rows.length}
              </span>
            </header>
            <div className="p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 bg-white">
              {rows.map((rec) => (
                <div key={rec.id} data-testid={`${testidPrefix}-tile-${rec.id}`}
                     className="rounded-xl border border-slate-200 bg-white p-3 hover:shadow-sm transition-shadow">
                  {renderTile(rec)}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
