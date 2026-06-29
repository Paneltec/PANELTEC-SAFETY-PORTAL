// Phase 3.11 — Live Inductions Matrix (compact density redesign).
//
// 1280×800 fit-first: cells render as 22×22 coloured squares with a single
// glyph in default Compact mode. Density toggle (Compact / Comfortable /
// Detailed) flips to abbreviated or full-date cells. Category groups are
// collapsible — when closed, each row shows a single "n/N current" chip
// for that group instead of N cells.
import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, Upload, Download, Search, X, CalendarOff, Check,
  AlertTriangle, Calendar, Settings2, ChevronDown, ChevronRight,
  Columns3, Filter, LayoutGrid, Maximize2, Printer, Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getToken, getUser } from '../lib/auth';
import InductionImportWizard from './InductionImportWizard';
import { stashInlinePdf } from '../lib/pdfStash';
import PdfPreviewModal from './PdfPreviewModal';
import InductionCardModal from './InductionCardModal';

const WRITE_ROLES = new Set(['admin', 'manager', 'hseq_lead']);
const API_BASE = process.env.REACT_APP_BACKEND_URL + '/api';

// status → square colour + glyph (compact) / full chip (detailed).
const STATUS = {
  current:        { glyph: '✓',  sq: 'bg-[#d8ecdd] text-[#1f7a3f] border-[#b6dcbf]',     full: 'Current',  cls: 'bg-[#d8ecdd] text-[#1f7a3f]' },
  expiring:       { glyph: '!',  sq: 'bg-[#fef3c7] text-[#92400e] border-[#fcd34d]',     full: 'Expiring', cls: 'bg-[#fef3c7] text-[#92400e]' },
  expiring_90:    { glyph: '⏳', sq: 'bg-slate-100 text-slate-600 border-slate-300',     full: 'Soon',     cls: 'bg-slate-100 text-slate-600' },
  expired:        { glyph: '✕',  sq: 'bg-[#fbe4e7] text-[#7a1f33] border-[#e69aa3]',     full: 'Expired',  cls: 'bg-[#fbe4e7] text-[#7a1f33]' },
  not_held:       { glyph: '—',  sq: 'bg-slate-50 text-slate-400 border-slate-200',      full: 'Not held', cls: 'bg-slate-100 text-slate-500' },
  held_no_expiry: { glyph: '✓',  sq: 'bg-[#e6eff9] text-[#1e4a8c] border-[#bcd2ee]',     full: 'Held',     cls: 'bg-[#e6eff9] text-[#1e4a8c]' },
  invalid_date:   { glyph: '?',  sq: 'bg-yellow-50 text-[#7a1f33] border-2 border-[#e69aa3] ring-1 ring-[#e69aa3]', full: 'Invalid', cls: 'bg-[#fbe4e7] text-[#7a1f33]' },
  unknown:        { glyph: '',   sq: 'bg-slate-50 text-slate-300 border-dashed border-slate-300', full: '—',     cls: 'bg-slate-50 text-slate-400' },
};

const CAT_META = {
  site_induction: { label: 'Site Inductions', tint: 'bg-[#e6eff9] text-[#1e4a8c]', border: 'border-[#bcd2ee]' },
  competency:     { label: 'Competencies',    tint: 'bg-[#f5f3ff] text-[#5b21b6]', border: 'border-[#ddd6fe]' },
  license:        { label: 'Licences',        tint: 'bg-[#fef3c7] text-[#92400e]', border: 'border-[#fcd34d]' },
};

const CAT_ORDER = ['site_induction', 'competency', 'license'];
const LS_DENSITY = 'paneltec.inductions.density';
const LS_HIDDEN  = 'paneltec.inductions.hiddenCols';
const LS_GROUPS  = 'paneltec.inductions.collapsedGroups';

// Augment status: matrix returns 'expiring' for <=60d. Split into 30d (amber)
// vs 90d (slate) per spec, client-side, using expiry_date.
function refinedStatus(cell) {
  if (!cell) return 'unknown';
  const s = cell.status;
  if (s !== 'expiring' || !cell.expiry_date) return s;
  const d = new Date(cell.expiry_date + 'T00:00:00');
  const days = Math.ceil((d - new Date()) / 86400000);
  return days <= 30 ? 'expiring' : 'expiring_90';
}

export default function InductionsMatrix({ onWorkerClick }) {
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [editing, setEditing] = useState(null);
  // Phase 3.12 — Induction Card popup (preferred path for cell clicks).
  // Shape: `{ inductionId?, inductionNameHint?, mode }`.
  const [cardModal, setCardModal] = useState(null);
  // Phase 3.11h — pin to a single worker. Clicking a name in the matrix
  // narrows the view to just that worker. ✕ on the pinned chip clears it.
  const [pinnedWorkerId, setPinnedWorkerId] = useState(null);
  // Phase 3.11h — multi-select for print.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [printOpen, setPrintOpen] = useState(false);
  const [printOpts, setPrintOpts] = useState({
    layout: 'a4_landscape', include_cover: true, include_legend: true,
    include_raw: false, include_last_updated: false, combined: true,
  });
  const [printing, setPrinting] = useState(false);
  // Phase 3.13.1 — inline PDF preview now uses the same-origin stash URL
  // instead of a `blob:` object URL (which ad blockers refuse to load).
  const [previewDirectUrl, setPreviewDirectUrl] = useState(null);
  const [previewFilename, setPreviewFilename] = useState('');

  // Selection clears on search to avoid stale-id surprises.
  useEffect(() => { setSelectedIds(new Set()); }, [search]);

  const toggleSelect = (id) => {
    const n = new Set(selectedIds);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelectedIds(n);
  };
  const toggleSelectAllVisible = (rows) => {
    const visibleIds = rows.map((r) => r.id);
    const allSelected = visibleIds.every((i) => selectedIds.has(i));
    const n = new Set(selectedIds);
    if (allSelected) visibleIds.forEach((i) => n.delete(i));
    else visibleIds.forEach((i) => n.add(i));
    setSelectedIds(n);
  };

  const doPrint = async (workerIds, opts = printOpts, mode = 'download') => {
    if (!workerIds.length) return;
    setPrinting(true);
    try {
      const res = await fetch(`${API_BASE}/workers/inductions/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ worker_ids: workerIds, ...opts, mode }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (mode === 'inline') {
        // Same-origin HTTPS URL via the inline stash (ad-blocker friendly).
        const filename = workerIds.length === 1
          ? `paneltec-inductions-${workerIds.length}-worker.pdf`
          : `paneltec-inductions-${workerIds.length}-workers.pdf`;
        const { src } = await stashInlinePdf(blob, filename);
        setPreviewDirectUrl(src);
        setPreviewFilename(filename);
        toast.success(`Preview ready · ${workerIds.length} worker(s)`);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `paneltec-inductions-${Date.now()}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        toast.success(`Printed ${workerIds.length} worker(s)`);
      }
      setPrintOpen(false);
    } catch (e) { toast.error(e.message || 'Print failed'); }
    finally { setPrinting(false); }
  };

  const closePreview = () => {
    setPreviewDirectUrl(null);
    setPreviewFilename('');
  };

  // Persisted UI state.
  const [density, setDensity] = useState(() => localStorage.getItem(LS_DENSITY) || 'compact');
  const [hidden, setHidden] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_HIDDEN) || '[]')); }
    catch { return new Set(); }
  });
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_GROUPS) || '[]')); }
    catch { return new Set(); }
  });
  const [rowFilter, setRowFilter] = useState('all');
  const [colsOpen, setColsOpen] = useState(false);

  useEffect(() => { localStorage.setItem(LS_DENSITY, density); }, [density]);
  useEffect(() => { localStorage.setItem(LS_HIDDEN, JSON.stringify([...hidden])); }, [hidden]);
  useEffect(() => { localStorage.setItem(LS_GROUPS, JSON.stringify([...collapsed])); }, [collapsed]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/workers/inductions/matrix');
      setData(data);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Group columns by category, respecting hidden set.
  const grouped = useMemo(() => {
    if (!data) return [];
    const byCat = {};
    for (const c of data.columns) {
      if (hidden.has(c.column_key)) continue;
      (byCat[c.category] = byCat[c.category] || []).push(c);
    }
    return CAT_ORDER.filter((k) => byCat[k]?.length).map((k) => ({
      key: k, meta: CAT_META[k] || { label: k }, cols: byCat[k],
    }));
  }, [data, hidden]);

  // Row filtering: search + status filter chip + (highest precedence) pin.
  const filteredRows = useMemo(() => {
    if (!data) return [];
    if (pinnedWorkerId) {
      const row = data.rows.find((r) => r.id === pinnedWorkerId);
      return row ? [row] : [];
    }
    const q = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (q && !(`${r.name} ${r.email||''} ${r.company||''}`.toLowerCase().includes(q))) return false;
      if (rowFilter === 'expired') {
        return Object.values(r.cells).some((c) => c.status === 'expired');
      }
      if (rowFilter === 'expiring_30') {
        return Object.values(r.cells).some((c) => refinedStatus(c) === 'expiring');
      }
      if (rowFilter === 'missing') {
        return Object.keys(r.cells).length === 0;
      }
      return true;
    });
  }, [data, search, rowFilter, pinnedWorkerId]);

  const downloadExport = async () => {
    try {
      const res = await fetch(`${API_BASE}/workers/inductions/export.xlsx`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'paneltec-inductions-matrix.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast.success('Inductions matrix exported');
    } catch (e) { toast.error(e.message || 'Export failed'); }
  };

  if (loading) {
    return <div className="text-sm text-slate-500 inline-flex items-center gap-2 py-10">
      <Loader2 size={14} className="animate-spin" /> Loading inductions matrix…
    </div>;
  }
  if (!data) return null;
  const empty = data.columns.length === 0;

  // Cell sizing by density.
  const cellW = density === 'compact' ? 28 : density === 'comfortable' ? 56 : 110;
  const cellH = density === 'compact' ? 28 : density === 'comfortable' ? 32 : 38;
  const rowH  = density === 'compact' ? 38 : density === 'comfortable' ? 44 : 56;

  return (
    <div data-testid="inductions-matrix">
      {/* toolbar */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            data-testid="matrix-search"
            placeholder="Search worker…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
        </div>

        {/* row filter chips */}
        <div className="inline-flex items-center gap-1 text-xs" data-testid="matrix-rowfilter">
          {[
            ['all', 'All'],
            ['expired', 'Expired'],
            ['expiring_30', 'Expiring 30d'],
            ['missing', 'Missing'],
          ].map(([k, label]) => (
            <button key={k} onClick={() => setRowFilter(k)}
              data-testid={`rowfilter-${k}`}
              className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                rowFilter === k
                  ? 'bg-[#1e4a8c] text-white'
                  : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* density toggle */}
        <div className="inline-flex items-stretch rounded-lg border border-slate-300 bg-white overflow-hidden" data-testid="matrix-density">
          {[
            ['compact', LayoutGrid, 'Compact'],
            ['comfortable', Columns3, 'Comfortable'],
            ['detailed', Maximize2, 'Detailed'],
          ].map(([k, Ico, label]) => (
            <button key={k} onClick={() => setDensity(k)}
              data-testid={`density-${k}`}
              title={label}
              className={`px-2.5 py-1.5 text-xs font-medium inline-flex items-center gap-1 ${
                density === k ? 'bg-[#1e4a8c] text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              <Ico size={12} />
            </button>
          ))}
        </div>

        {/* columns picker */}
        <div className="relative">
          <button onClick={() => setColsOpen((v) => !v)}
            data-testid="matrix-cols-toggle"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50">
            <Filter size={12} /> Columns ({data.columns.length - hidden.size})
            <ChevronDown size={12} />
          </button>
          {colsOpen && (
            <div className="absolute right-0 z-20 mt-1 w-64 max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg p-2"
                 data-testid="matrix-cols-menu">
              {data.columns.map((c) => (
                <label key={c.column_key} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer">
                  <input type="checkbox" checked={!hidden.has(c.column_key)}
                    onChange={(e) => {
                      const n = new Set(hidden);
                      if (e.target.checked) n.delete(c.column_key); else n.add(c.column_key);
                      setHidden(n);
                    }}
                    data-testid={`colcheck-${c.column_key}`}
                    className="w-3.5 h-3.5" />
                  <span className="text-xs text-slate-700 truncate flex-1">{c.header}</span>
                  <span className={`text-[9px] uppercase tracking-wider font-semibold px-1 py-0.5 rounded ${CAT_META[c.category]?.tint || 'bg-slate-100'}`}>
                    {c.category.replace('_',' ')}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <button onClick={load} data-testid="matrix-refresh" title="Refresh"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
          <RefreshCw size={12} />
        </button>
        <button onClick={downloadExport} data-testid="matrix-export" title="Export .xlsx"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
          <Download size={12} />
        </button>
        {canEdit && (
          <button onClick={() => setPrintOpen(true)}
            disabled={selectedIds.size === 0 && !pinnedWorkerId}
            data-testid="matrix-preview"
            title={selectedIds.size === 0 && !pinnedWorkerId ? 'Select workers or pin one to preview' : `Preview ${selectedIds.size || 1} worker(s)`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold uppercase tracking-wider text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <Eye size={12} /> Preview {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </button>
        )}
        {canEdit && (
          <button onClick={() => setPrintOpen(true)}
            disabled={selectedIds.size === 0 && !pinnedWorkerId}
            data-testid="matrix-print"
            title={selectedIds.size === 0 && !pinnedWorkerId ? 'Select workers or pin one to print' : `Print ${selectedIds.size || 1} worker(s)`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold uppercase tracking-wider hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed">
            <Printer size={12} /> Print {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </button>
        )}
        {canEdit && (
          <button onClick={() => setShowWizard(true)} data-testid="matrix-import"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#5b21b6] text-white text-xs font-semibold uppercase tracking-wider hover:bg-[#4c1d95]">
            <Upload size={12} /> Import .xlsx
          </button>
        )}
      </div>

      {/* legend + summary */}
      <div className="mb-3 text-[11px] text-slate-500 flex items-center gap-3 flex-wrap">
        <span><strong className="text-slate-900">{filteredRows.length}</strong> / {data.summary.workers} workers</span>
        <span>·</span>
        <span><strong className="text-slate-900">{data.summary.columns - hidden.size}</strong> / {data.summary.columns} columns</span>
        {selectedIds.size > 0 && (<>
          <span>·</span>
          <span data-testid="matrix-selected-count"><strong className="text-slate-900">{selectedIds.size}</strong> selected</span>
        </>)}
        <span>·</span>
        <Legend />
      </div>

      {/* Pinned chip — visible only when a worker is pinned. ✕ clears. */}
      {pinnedWorkerId && (() => {
        const pinned = data.rows.find((r) => r.id === pinnedWorkerId);
        if (!pinned) return null;
        return (
          <div className="mb-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#e6eff9] border border-[#bcd2ee]"
               data-testid="matrix-pinned-chip">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-[#1e4a8c]">Pinned to</span>
            <span className="text-sm font-semibold text-[#1e4a8c]">{pinned.name}</span>
            {onWorkerClick && (
              <button onClick={() => onWorkerClick(pinned)}
                data-testid="matrix-pinned-open-profile"
                className="text-[11px] font-medium text-[#1e4a8c] underline hover:no-underline">
                Open profile
              </button>
            )}
            <button onClick={() => doPrint([pinned.id], printOpts, 'inline')}
              data-testid="matrix-pinned-preview" title="Preview this worker"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1e4a8c] underline hover:no-underline">
              <Eye size={11} /> Preview
            </button>
            <button onClick={() => doPrint([pinned.id])}
              data-testid="matrix-pinned-print" title="Print this worker"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1e4a8c] underline hover:no-underline">
              <Printer size={11} /> Print
            </button>
            <button onClick={() => setPinnedWorkerId(null)}
              data-testid="matrix-pinned-clear"
              title="Clear pin"
              className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded text-[#1e4a8c] hover:bg-white">
              <X size={12} />
            </button>
          </div>
        );
      })()}

      {empty ? (
        <EmptyMatrix canEdit={canEdit} onImport={() => setShowWizard(true)} />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-auto max-h-[72vh]"
             style={{ scrollbarGutter: 'stable' }}>
          <table className="text-xs border-separate" style={{ borderSpacing: 0 }} data-testid="matrix-table">
            {/* category header row (group titles + collapse chevrons) */}
            <thead className="sticky top-0 z-30 bg-white">
              <tr>
                <th className="sticky left-0 z-40 bg-white border-b border-r border-slate-200 align-middle" style={{ width: 32, minWidth: 32, padding: 4 }} rowSpan={2}>
                  <input type="checkbox"
                    data-testid="matrix-select-all"
                    checked={filteredRows.length > 0 && filteredRows.every((r) => selectedIds.has(r.id))}
                    onChange={() => toggleSelectAllVisible(filteredRows)}
                    title="Select all visible"
                    className="w-3.5 h-3.5" />
                </th>
                <th rowSpan={2}
                    className="sticky z-40 bg-white text-left px-3 py-2 border-b border-r border-slate-200 align-bottom"
                    style={{ width: 200, minWidth: 200, left: 32 }}>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Worker</div>
                </th>
                {grouped.map((g) => {
                  const isCollapsed = collapsed.has(g.key);
                  const span = isCollapsed ? 1 : g.cols.length;
                  return (
                    <th key={g.key} colSpan={span}
                        data-testid={`matrix-group-${g.key}`}
                        className={`text-left px-2 py-1.5 border-b ${g.meta.border} border-r border-slate-200 ${g.meta.tint}`}>
                      <button onClick={() => {
                          const n = new Set(collapsed);
                          if (isCollapsed) n.delete(g.key); else n.add(g.key);
                          setCollapsed(n);
                        }}
                        data-testid={`group-toggle-${g.key}`}
                        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold w-full">
                        {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                        {g.meta.label}
                        <span className="ml-1 opacity-70 normal-case font-normal">({g.cols.length})</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
              {/* column headers */}
              <tr>
                {grouped.map((g) => {
                  if (collapsed.has(g.key)) {
                    return (
                      <th key={`${g.key}-summary`}
                          className={`text-center px-1 py-1.5 border-b border-r border-slate-200 text-[9px] uppercase tracking-wider font-semibold text-slate-500`}
                          style={{ width: 80, minWidth: 80 }}>
                        Summary
                      </th>
                    );
                  }
                  return g.cols.map((c) => (
                    <th key={c.column_key}
                        title={c.header}
                        className="border-b border-r border-slate-100 align-bottom"
                        style={{
                          width: cellW + 6, minWidth: cellW + 6,
                          height: density === 'compact' ? 90 : 70,
                          padding: 0,
                        }}>
                      <div className={`flex items-end justify-start pb-1 pl-1 ${density === 'compact' ? 'rotate-180' : ''}`}
                           style={density === 'compact' ? {
                             writingMode: 'vertical-rl',
                             transform: 'rotate(180deg)',
                             height: 84,
                           } : { height: 64 }}>
                        <span className="text-[10px] font-semibold text-slate-700 whitespace-nowrap">
                          {c.header}
                        </span>
                      </div>
                    </th>
                  ));
                })}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={`worker-row-${r.id}`} className="hover:bg-slate-50/50" data-testid={`matrix-row-${r.id}`}>
                  <td className="sticky left-0 z-10 bg-white border-b border-r border-slate-100 text-center" style={{ width: 32, minWidth: 32, padding: 4 }}>
                    <input type="checkbox"
                      data-testid={`matrix-row-check-${r.id}`}
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      className="w-3.5 h-3.5" />
                  </td>
                  <th scope="row"
                      className="sticky z-10 bg-white text-left p-0 border-b border-r border-slate-100 align-middle"
                      style={{ width: 200, minWidth: 200, height: rowH, left: 32 }}>
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); setPinnedWorkerId(r.id); }}
                      data-testid={`matrix-worker-${r.id}`}
                      title={`Pin matrix to ${r.name}`}
                      className="w-full h-full text-left px-3 py-1.5 cursor-pointer hover:bg-slate-50">
                      <div className="font-semibold text-slate-900 truncate text-[12px] leading-tight">{r.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <RowChip status={r.chip} />
                        {r.company && <span className="text-[9px] text-slate-400 truncate">{r.company}</span>}
                      </div>
                    </button>
                  </th>
                  {grouped.map((g) => {
                    if (collapsed.has(g.key)) {
                      // single summary chip
                      const stats = summariseGroup(r, g.cols);
                      return (
                        <td key={`${g.key}-sum`}
                            className="border-b border-r border-slate-100 text-center"
                            style={{ width: 80, minWidth: 80, padding: 4 }}
                            data-testid={`group-summary-${r.id}-${g.key}`}>
                          <span className={`inline-flex items-center justify-center text-[10px] font-semibold px-1.5 py-0.5 rounded ${stats.tone}`}
                                title={`${stats.current}/${g.cols.length} current\n${stats.expired} expired\n${stats.not_held} not held`}>
                            {stats.current}/{g.cols.length}
                          </span>
                        </td>
                      );
                    }
                    return g.cols.map((c) => (
                      <Cell key={`${r.id}-${c.column_key}`}
                            worker={r} col={c} cell={r.cells[c.column_key]}
                            canEdit={canEdit} density={density} cellW={cellW} cellH={cellH}
                            onClick={() => {
                              // Phase 3.12 — every cell opens the Induction Card modal.
                              // Existing cert → view mode; empty slot → add mode (write roles only).
                              const cell = r.cells[c.column_key];
                              if (cell?.cert_id) {
                                setCardModal({ workerId: r.id, workerName: r.name,
                                  inductionId: cell.cert_id, mode: 'view' });
                              } else if (canEdit) {
                                setCardModal({ workerId: r.id, workerName: r.name,
                                  inductionNameHint: c.header, mode: 'add' });
                              }
                            }} />
                    ));
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showWizard && <InductionImportWizard onClose={() => setShowWizard(false)} onCommitted={load} />}
      {editing && (
        <CellEditor worker={editing.worker} col={editing.col} cell={editing.cell}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
      {printOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
             onClick={(e) => e.target === e.currentTarget && setPrintOpen(false)}
             data-testid="print-popover">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">Preview / Print options</div>
                <h3 className="font-semibold text-slate-900 mt-0.5">
                  {(selectedIds.size || (pinnedWorkerId ? 1 : 0))} worker{((selectedIds.size || (pinnedWorkerId ? 1 : 0)) === 1 ? '' : 's')}
                </h3>
              </div>
              <button onClick={() => setPrintOpen(false)} className="p-2 rounded-lg text-slate-500 hover:bg-white"><X size={16} /></button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Layout</div>
                <div className="grid grid-cols-3 gap-2">
                  {[['a4_portrait', 'A4 Portrait'], ['a4_landscape', 'A4 Landscape'], ['a3_landscape', 'A3 Landscape']].map(([k, label]) => (
                    <button key={k} onClick={() => setPrintOpts({ ...printOpts, layout: k })}
                      data-testid={`print-layout-${k}`}
                      className={`px-2 py-2 rounded-lg border text-xs font-medium ${printOpts.layout === k ? 'border-[#1e4a8c] bg-[#e6eff9] text-[#1e4a8c]' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Include</div>
                {[['include_cover','Cover page'],['include_legend','Status legend'],['include_raw','Raw input values'],['include_last_updated','Last update timestamps']].map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={printOpts[k]}
                      data-testid={`print-opt-${k}`}
                      onChange={(e) => setPrintOpts({ ...printOpts, [k]: e.target.checked })}
                      className="w-3.5 h-3.5" />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
              <div className="pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={printOpts.combined}
                    data-testid="print-opt-combined"
                    onChange={(e) => setPrintOpts({ ...printOpts, combined: e.target.checked })}
                    className="w-3.5 h-3.5" />
                  <span className="text-sm text-slate-700">Combined PDF (one file, one page per worker)</span>
                </label>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button onClick={() => setPrintOpen(false)} className="text-sm text-slate-500 hover:text-slate-900">Cancel</button>
              <button onClick={() => {
                  const ids = selectedIds.size > 0 ? [...selectedIds] : (pinnedWorkerId ? [pinnedWorkerId] : []);
                  doPrint(ids, printOpts, 'inline');
                }} disabled={printing}
                data-testid="preview-confirm"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                {printing ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} Preview
              </button>
              <button onClick={() => {
                  const ids = selectedIds.size > 0 ? [...selectedIds] : (pinnedWorkerId ? [pinnedWorkerId] : []);
                  doPrint(ids);
                }} disabled={printing}
                data-testid="print-confirm"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60">
                {printing ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />} Print
              </button>
            </div>
          </div>
        </div>
      )}
      {previewDirectUrl && (
        <PdfPreviewModal
          file={{ filename: previewFilename }}
          directUrl={previewDirectUrl}
          onClose={closePreview}
        />
      )}
      {cardModal && (
        <InductionCardModal
          workerId={cardModal.workerId}
          workerName={cardModal.workerName}
          inductionId={cardModal.inductionId}
          inductionNameHint={cardModal.inductionNameHint}
          initialMode={cardModal.mode}
          onClose={() => setCardModal(null)}
          onSaved={() => { load(); }}
        />
      )}
    </div>
  );
}

// ────────────────── Cell renderer (compact / comfortable / detailed) ──────────────────

function Cell({ worker, col, cell, canEdit, density, cellW, cellH, onClick }) {
  const status = refinedStatus(cell);
  const meta = STATUS[status] || STATUS.unknown;
  const tip = buildTooltip(col, cell);
  // Cells are always clickable — write roles get edit/add, others get view.
  // Empty cells for non-edit roles still open the modal in view mode (which
  // shows "No record" so a worker can read what they're missing).
  const common = {
    onClick,
    'data-testid': `cell-${worker.id}-${col.column_key}`,
    title: tip,
  };

  if (density === 'compact') {
    return (
      <td className="border-b border-r border-slate-100" style={{ padding: 3 }}>
        <button {...common}
          style={{ width: cellW, height: cellH }}
          className={`inline-flex items-center justify-center rounded-md text-[12px] font-bold border ${meta.sq} ${canEdit ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}>
          {meta.glyph}
        </button>
      </td>
    );
  }
  if (density === 'comfortable') {
    const date = cell?.expiry_date ? shortIso(cell.expiry_date) : '';
    return (
      <td className="border-b border-r border-slate-100" style={{ padding: 3 }}>
        <button {...common}
          style={{ width: cellW, height: cellH }}
          className={`inline-flex flex-col items-center justify-center rounded-md border text-[10px] leading-tight ${meta.sq} ${canEdit ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}>
          <span className="font-bold text-[11px]">{meta.glyph}</span>
          {date && <span className="font-mono text-[8px] opacity-80">{date}</span>}
        </button>
      </td>
    );
  }
  // detailed
  const label = cell?.expiry_date ? `${meta.full} · ${shortIso(cell.expiry_date)}` : meta.full;
  return (
    <td className="border-b border-r border-slate-100" style={{ padding: 4 }}>
      <button {...common}
        className={`w-full text-left inline-flex items-center text-[10px] font-medium px-2 py-1 rounded ${meta.cls} ${canEdit ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}>
        {label}
      </button>
    </td>
  );
}

function buildTooltip(col, cell) {
  if (!cell) return `${col.header}\n(no record)`;
  const parts = [col.header];
  if (cell.expiry_date) parts.push(`Expiry: ${cell.expiry_date}`);
  if (cell.not_held) parts.push('Marked: not held');
  if (cell.held_no_expiry) parts.push('Marked: held (no expiry on file)');
  if (cell.import_confidence) parts.push(`Source confidence: ${cell.import_confidence}`);
  return parts.join('\n');
}

function shortIso(iso) {
  if (!iso || iso.length < 10) return iso || '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

function RowChip({ status }) {
  const meta = STATUS[status] || STATUS.unknown;
  return (
    <span className={`inline-flex items-center text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded ${meta.cls}`}>
      {meta.full}
    </span>
  );
}

function Legend() {
  const items = [
    ['current', '✓ current'],
    ['expiring', '! 30d'],
    ['expiring_90', '⏳ 90d'],
    ['expired', '✕ expired'],
    ['not_held', '— not held'],
    ['invalid_date', '? invalid'],
  ];
  return (
    <div className="inline-flex items-center gap-2 text-[10px]">
      {items.map(([k, label]) => (
        <span key={k} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${STATUS[k].cls}`}>
          {label}
        </span>
      ))}
    </div>
  );
}

function summariseGroup(row, cols) {
  let current = 0, expired = 0, not_held = 0, other = 0;
  for (const c of cols) {
    const s = refinedStatus(row.cells[c.column_key]);
    if (s === 'current' || s === 'held_no_expiry') current++;
    else if (s === 'expired') expired++;
    else if (s === 'not_held') not_held++;
    else other++;
  }
  let tone = 'bg-slate-50 text-slate-500';
  if (expired > 0) tone = STATUS.expired.cls;
  else if (other > 0) tone = STATUS.expiring.cls;
  else if (current > 0) tone = STATUS.current.cls;
  return { current, expired, not_held, other, tone };
}

function EmptyMatrix({ canEdit, onImport }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <Settings2 size={28} className="text-slate-400 mx-auto mb-3" />
      <h3 className="font-semibold text-slate-900">No induction columns yet</h3>
      <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto">
        Import your existing Excel tracker to seed the matrix. The wizard previews matches before committing.
      </p>
      {canEdit && (
        <button onClick={onImport}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5b21b6] text-white text-sm font-semibold hover:bg-[#4c1d95]">
          <Upload size={14} /> Import .xlsx
        </button>
      )}
    </div>
  );
}

// ────────────────── Inline cell editor ──────────────────

function CellEditor({ worker, col, cell, onClose, onSaved }) {
  const [date, setDate] = useState(cell?.expiry_date || '');
  const [notHeld, setNotHeld] = useState(!!cell?.not_held);
  const [held, setHeld] = useState(!!cell?.held_no_expiry);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/workers/inductions/cell', {
        worker_id: worker.id, column_key: col.column_key,
        header: col.header, category: col.category,
        expiry_date: date || null,
        not_held: notHeld, held_no_expiry: held,
      });
      toast.success('Cell updated');
      onSaved?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  const clear = async () => {
    if (!cell) return onClose?.();
    setSaving(true);
    try {
      await api.put('/workers/inductions/cell', {
        worker_id: worker.id, column_key: col.column_key, clear: true,
      });
      toast.success('Cell cleared');
      onSaved?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
         onClick={(e) => e.target === e.currentTarget && onClose?.()} data-testid="cell-editor">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">{worker.name}</div>
            <h3 className="font-semibold text-slate-900 mt-0.5">{col.header}</h3>
            <span className={`mt-1 inline-block text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${CAT_META[col.category]?.tint || ''}`}>
              {col.category.replace('_', ' ')}
            </span>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:bg-white"><X size={16} /></button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1.5">
              <Calendar size={12} /> Expiry date
            </span>
            <input type="date" value={date}
              onChange={(e) => { setDate(e.target.value); if (e.target.value) { setNotHeld(false); setHeld(false); } }}
              disabled={notHeld} data-testid="cell-editor-date"
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:bg-slate-100" />
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={notHeld}
              onChange={(e) => { setNotHeld(e.target.checked); if (e.target.checked) { setDate(''); setHeld(false); } }}
              data-testid="cell-editor-notheld" className="w-4 h-4" />
            <span className="text-sm text-slate-700 flex items-center gap-1.5">
              <CalendarOff size={12} className="text-slate-400" /> Not held
            </span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={held}
              onChange={(e) => { setHeld(e.target.checked); if (e.target.checked) setNotHeld(false); }}
              data-testid="cell-editor-held" className="w-4 h-4" />
            <span className="text-sm text-slate-700 flex items-center gap-1.5">
              <Check size={12} className="text-emerald-500" /> Held (no expiry on file)
            </span>
          </label>
          {cell?.import_confidence === 'low' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[11px] text-amber-800 flex items-start gap-2">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              This cell was flagged during import as ambiguous. Please verify and re-save.
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button onClick={clear} disabled={saving || !cell}
            data-testid="cell-editor-clear"
            className="text-sm text-[#7a1f33] font-medium hover:underline disabled:opacity-50">
            Clear cell
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-900">Cancel</button>
            <button onClick={save} disabled={saving} data-testid="cell-editor-save"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-60">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
