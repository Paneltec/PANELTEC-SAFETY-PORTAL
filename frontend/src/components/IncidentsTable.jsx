import React, { useMemo, useState, useEffect } from 'react';
import { ArrowUpDown, Archive as ArchiveIcon, ArchiveRestore, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PdfActions from './PdfActions';

/**
 * v58.13.132en — <IncidentsTable />
 *
 * Traditional table view for the Incident Reports list. Complements
 * (does not replace) the Cards grid; the parent toggles which surface
 * to render. Reuses the same `items` array the Cards grid consumes so
 * no new API is needed.
 *
 * Columns: CS # · Date · Type · Severity · Site · Reporter · Status · Actions
 * Actions: View · Archive/Restore · Download PDF (via <PdfActions>)
 *
 * Styling:
 *  · Zebra rows alternate `bg-white` / `bg-slate-100`.
 *  · Sticky `<thead>` on scroll (max-h 70vh container).
 *  · Sortable columns via click on header (asc/desc toggle).
 *  · Archived rows: greyed via `opacity-60 saturate-50` + inline
 *    "Archived" chip on the CS# cell.
 *  · Compact row height (`py-1.5`) so 30-50 rows fit per viewport.
 */
const COLS = [
  { key: 'external_id', label: 'CS #',     get: (r) => r.external_id || r.cs_number || (r.id || '').slice(0, 8) },
  { key: 'occurred_at', label: 'Date',     get: (r) => (r.occurred_at || r.created_at || '').slice(0, 10) },
  { key: 'category',    label: 'Type',     get: (r) => r.incident_type || r.category || r.title || '—' },
  { key: 'severity',    label: 'Severity', get: (r) => r.severity || '—' },
  { key: 'site',        label: 'Site',     get: (r) => r.site_name || r.workspace_name || r.site_id || r.workspace_id || '—' },
  { key: 'reporter',    label: 'Reporter', get: (r) => r.submitted_by_name || r.reported_by_name || r.created_by_name || r.created_by || '—' },
  { key: 'status',      label: 'Status',   get: (r) => r.follow_up_status || r.status || '—' },
];

export default function IncidentsTable({ items, isAdmin, onArchive, onUnarchive }) {
  const [sortKey, setSortKey] = useState('occurred_at');
  const [sortDir, setSortDir] = useState('desc');
  const navigate = useNavigate();

  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sortKey) || COLS[1];
    const arr = [...(items || [])];
    arr.sort((a, b) => {
      const va = String(col.get(a) ?? '').toLowerCase();
      const vb = String(col.get(b) ?? '').toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [items, sortKey, sortDir]);

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden" data-testid="incidents-table">
      <div className="overflow-auto max-h-[70vh]">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
            <tr>
              {COLS.map((c) => (
                <th key={c.key}
                    onClick={() => toggleSort(c.key)}
                    data-testid={`incidents-table-th-${c.key}`}
                    className="px-3 py-2 text-left font-semibold text-slate-700 cursor-pointer select-none hover:bg-slate-100 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    <ArrowUpDown size={12} className={sortKey === c.key ? 'text-blue-600' : 'text-slate-400'} />
                    {sortKey === c.key && (
                      <span className="text-[10px] text-blue-600">{sortDir === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold text-slate-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => {
              const isArchived = !!r.archived_at;
              return (
                <tr key={r.id}
                    data-testid={`incidents-table-row-${r.id}`}
                    data-archived={isArchived ? 'true' : 'false'}
                    className={
                      'border-t border-slate-100 ' +
                      (idx % 2 === 1 ? 'bg-slate-100 ' : 'bg-white ') +
                      (isArchived ? 'opacity-60 saturate-50 ' : '') +
                      'hover:bg-blue-50'
                    }>
                  {COLS.map((c) => (
                    <td key={c.key} className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                      {c.get(r) || '—'}
                      {c.key === 'external_id' && isArchived && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">Archived</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      {/* v58.13.132fv — View route `/app/incidents/${id}` does
                          NOT exist in App.js (only /app/incidents and
                          /app/incidents/new are registered). Mel's
                          "can't view incident reports" reproduced
                          from this broken navigate. Redirect through
                          the existing `?open=<id>` deep-link that
                          Incidents.jsx already honours via the
                          `deepLinkId → openInitially` prop on
                          CaptureCard (see Incidents.jsx L260). Cards
                          view flips automatically because
                          `?open=<id>` is captured before the
                          view-mode switch renders. */}
                      <button onClick={() => navigate(`/app/incidents?open=${r.id}`)}
                        title="View"
                        data-testid={`incidents-table-view-${r.id}`}
                        className="p-1 rounded hover:bg-slate-200 text-slate-600">
                        <Eye size={14} />
                      </button>
                      <PdfActions
                        resourceKind="incidents"
                        recordId={r.id}
                        title="Download PDF"
                        iconOnly
                      />
                      {isAdmin && !isArchived && (
                        <button onClick={() => onArchive?.(r)}
                          title="Archive"
                          data-testid={`incidents-table-archive-${r.id}`}
                          className="p-1 rounded hover:bg-slate-200 text-slate-600">
                          <ArchiveIcon size={14} />
                        </button>
                      )}
                      {isAdmin && isArchived && (
                        <button onClick={() => onUnarchive?.(r)}
                          title="Restore"
                          data-testid={`incidents-table-unarchive-${r.id}`}
                          className="p-1 rounded hover:bg-amber-50 text-amber-700">
                          <ArchiveRestore size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={COLS.length + 1} className="px-3 py-6 text-center text-slate-500">No matching incidents.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Small hook that persists the list view mode in localStorage.
 *  Key convention: `incidents.viewMode` = "cards" | "table". */
export function usePersistedViewMode(key, defaultMode = 'cards') {
  const [mode, setMode] = useState(() => {
    try { const v = localStorage.getItem(key); if (v === 'cards' || v === 'table') return v; } catch { /* noop */ }
    return defaultMode;
  });
  useEffect(() => {
    try { localStorage.setItem(key, mode); } catch { /* noop */ }
  }, [key, mode]);
  return [mode, setMode];
}
