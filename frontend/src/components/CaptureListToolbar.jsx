// Shared toolbar for Capture-tab list pages. v160.3.0-adjust-17.
// Client-side search + template chip filter + sort dropdown.
// Used by Pre-Starts, Hazards, Site Diary, Inspections, Incidents, Risk Assessments.
import React, { useMemo, useState, useEffect } from 'react';
import CaptureDensityControl from './CaptureDensityControl';

function useDebounced(value, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Props:
 *   items: array of submission-like records
 *   onFiltered: (filtered) => void
 *   testidPrefix: for data-testid stability
 */
export function CaptureListToolbar({
  items, onFiltered, testidPrefix = 'capture',
  // v58.13.40 — opt-in density segmented control.
  densityMode, onDensityChange,
}) {
  const [q, setQ] = useState('');
  const [tpl, setTpl] = useState('All');
  const [sort, setSort] = useState('date_desc');
  const debouncedQ = useDebounced(q, 200);

  // Derive template chips from data
  const templates = useMemo(() => {
    const set = new Set();
    (items || []).forEach((r) => {
      const t = r.template_name_snapshot || r.template_name || r.title;
      if (t) set.add(t);
    });
    return Array.from(set).sort();
  }, [items]);

  const showChips = templates.length > 1;

  // Apply filter + sort
  const filtered = useMemo(() => {
    const needle = (debouncedQ || '').trim().toLowerCase();
    let out = (items || []).filter((r) => {
      if (tpl !== 'All') {
        const t = r.template_name_snapshot || r.template_name || r.title || '';
        if (t !== tpl) return false;
      }
      if (!needle) return true;
      const hay = [
        r.template_name_snapshot, r.template_name, r.title,
        r.submitted_by_name, r.operator, r.created_by_name,
        r.date, r.submitted_at, r.imported_from_pdf,
        r.description, r.crew_lead, r.work_summary,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
    const cmp = {
      date_desc: (a, b) => (b.date || b.submitted_at || '').localeCompare(a.date || a.submitted_at || ''),
      date_asc:  (a, b) => (a.date || a.submitted_at || '').localeCompare(b.date || b.submitted_at || ''),
      operator:  (a, b) => (a.submitted_by_name || '').localeCompare(b.submitted_by_name || ''),
      template:  (a, b) => (a.template_name_snapshot || a.template_name || '').localeCompare(b.template_name_snapshot || b.template_name || ''),
    }[sort];
    if (cmp) out = [...out].sort(cmp);
    return out;
  }, [items, debouncedQ, tpl, sort]);

  useEffect(() => { onFiltered && onFiltered(filtered); }, [filtered, onFiltered]);

  return (
    <div className="mb-4" data-testid={`${testidPrefix}-toolbar`}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-slate-300"
          placeholder="Search records…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid={`${testidPrefix}-search`}
        />
        <select
          className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          data-testid={`${testidPrefix}-sort`}
        >
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="operator">Operator A-Z</option>
          <option value="template">Template A-Z</option>
        </select>
        {/* v58.13.40 — density segmented control. Rendered only when
            the parent page passes `densityMode` + `onDensityChange`
            (i.e. wired to `useCaptureDensity`). Legacy pages that
            don't supply these props keep their pre-v58.13.40 UI.
            v58.13.41 — delegated to shared `CaptureDensityControl`
            so pages without CaptureListToolbar can reuse the same
            visuals. */}
        {typeof onDensityChange === 'function' && (
          <CaptureDensityControl
            mode={densityMode}
            onChange={onDensityChange}
            testidPrefix="capture"
          />
        )}
        <div className="text-xs text-slate-500" data-testid={`${testidPrefix}-count`}>
          {filtered.length} / {(items || []).length}
        </div>
      </div>
      {showChips && (
        <div className="flex flex-wrap gap-2 mt-3">
          {['All', ...templates].map((t) => (
            <button
              key={t}
              onClick={() => setTpl(t)}
              className={
                'text-xs font-semibold px-3 py-1 rounded-full ring-1 transition ' +
                (tpl === t
                  ? 'bg-slate-900 text-white ring-slate-900'
                  : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300')
              }
              data-testid={`${testidPrefix}-chip-${t.replace(/\s+/g, '-').toLowerCase()}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default CaptureListToolbar;
