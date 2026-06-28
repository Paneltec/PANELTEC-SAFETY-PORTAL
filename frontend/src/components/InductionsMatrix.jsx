// Phase 3.11 — Live Inductions Matrix tab inside /app/workers.
//
// Wide sticky table: rows × workers, cols × induction columns. Sticky left
// column (worker name + chip), sticky top header. Cells render the current
// status as a coloured chip and open an inline editor on click for users
// with admin/manager/hseq_lead role.
import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, Upload, Download, Search, X, CalendarOff, Check,
  AlertTriangle, Calendar, Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getToken, getUser } from '../lib/auth';
import InductionImportWizard from './InductionImportWizard';

const WRITE_ROLES = new Set(['admin', 'manager', 'hseq_lead']);
const API_BASE = process.env.REACT_APP_BACKEND_URL + '/api';

// Status → chip styling. Kept consistent with brand tokens.
const STATUS_CHIP = {
  current:        { label: 'Current',     cls: 'bg-[#d8ecdd] text-[#1f7a3f]' },
  expiring:       { label: 'Expiring',    cls: 'bg-[#fef3c7] text-[#92400e]' },
  expired:        { label: 'Expired',     cls: 'bg-[#fbe4e7] text-[#7a1f33]' },
  not_held:       { label: 'Not held',    cls: 'bg-slate-100 text-slate-500' },
  held_no_expiry: { label: 'Held',        cls: 'bg-[#e6eff9] text-[#1e4a8c]' },
  invalid_date:   { label: 'Invalid',     cls: 'bg-[#fbe4e7] text-[#7a1f33]' },
  unknown:        { label: '—',           cls: 'bg-slate-50 text-slate-400 border border-dashed border-slate-300' },
};

const CATEGORY_TINT = {
  site_induction: 'bg-[#e6eff9] text-[#1e4a8c]',
  competency:     'bg-[#f5f3ff] text-[#5b21b6]',
  license:        'bg-[#fef3c7] text-[#92400e]',
};

export default function InductionsMatrix() {
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [editing, setEditing] = useState(null); // {row, col}

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/workers/inductions/matrix');
      setData(data);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (r.company || '').toLowerCase().includes(q));
  }, [data, search]);

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
    return (
      <div className="text-sm text-slate-500 inline-flex items-center gap-2 py-10">
        <Loader2 size={14} className="animate-spin" /> Loading inductions matrix…
      </div>
    );
  }
  if (!data) return null;

  const cols = data.columns;
  const empty = cols.length === 0;

  return (
    <div data-testid="inductions-matrix">
      {/* toolbar */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            data-testid="matrix-search"
            placeholder="Search worker, email or company…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
        </div>
        <button onClick={load} data-testid="matrix-refresh"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
          <RefreshCw size={14} /> Refresh
        </button>
        <button onClick={downloadExport} data-testid="matrix-export"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
          <Download size={14} /> Export .xlsx
        </button>
        <div className="flex-1" />
        {canEdit && (
          <button onClick={() => setShowWizard(true)} data-testid="matrix-import"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5b21b6] text-white text-sm font-semibold uppercase tracking-wider hover:bg-[#4c1d95]">
            <Upload size={14} /> Import .xlsx
          </button>
        )}
      </div>

      {/* summary bar */}
      <div className="mb-3 text-xs text-slate-500 flex items-center gap-3 flex-wrap">
        <span><strong className="text-slate-900">{data.summary.workers}</strong> workers</span>
        <span>·</span>
        <span><strong className="text-slate-900">{data.summary.columns}</strong> induction columns</span>
        <span>·</span>
        <span>Click a cell to edit (admin / manager / HSEQ only).</span>
      </div>

      {empty ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Settings2 size={28} className="text-slate-400 mx-auto mb-3" />
          <h3 className="font-semibold text-slate-900">No induction columns yet</h3>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto">
            Import your existing Excel tracker to seed the matrix. The wizard will preview matches
            before committing — nothing is written without your confirmation.
          </p>
          {canEdit && (
            <button onClick={() => setShowWizard(true)}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5b21b6] text-white text-sm font-semibold hover:bg-[#4c1d95]">
              <Upload size={14} /> Import .xlsx
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-auto max-h-[72vh]">
          <table className="text-xs w-max min-w-full" data-testid="matrix-table">
            <thead className="sticky top-0 z-20 bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="sticky left-0 z-30 bg-slate-50 text-left px-4 py-3 min-w-[220px] border-r border-slate-200">
                  Worker
                </th>
                {cols.map((c) => (
                  <th key={c.column_key} className="text-left px-3 py-3 min-w-[140px] border-r border-slate-100">
                    <div className="font-semibold text-slate-700 normal-case text-xs">{c.header}</div>
                    <span className={`inline-block mt-1 text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${CATEGORY_TINT[c.category] || 'bg-slate-100 text-slate-500'}`}>
                      {c.category.replace('_', ' ')}
                    </span>
                  </th>
                ))}
                <th className="text-left px-3 py-3 min-w-[120px] bg-[#f5f3ff]">
                  <div className="font-semibold text-[#5b21b6] normal-case text-xs">Access</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60" data-testid={`matrix-row-${r.id}`}>
                  <th scope="row" className="sticky left-0 z-10 bg-white text-left px-4 py-2 border-r border-slate-200 align-top">
                    <div className="font-semibold text-slate-900 truncate max-w-[200px]">{r.name}</div>
                    <div className="text-[10px] text-slate-400 truncate max-w-[200px]">{r.company || r.email}</div>
                    <RowChip status={r.chip} />
                  </th>
                  {cols.map((c) => {
                    const cell = r.cells[c.column_key];
                    return (
                      <td key={c.column_key} className="px-3 py-2 border-r border-slate-50 align-top">
                        <button onClick={() => canEdit && setEditing({ worker: r, col: c, cell })}
                          disabled={!canEdit}
                          data-testid={`cell-${r.id}-${c.column_key}`}
                          className={`w-full text-left ${canEdit ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}>
                          <Chip cell={cell} />
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 align-top bg-[#faf8ff]/40">
                    <AccessChips access={r.access} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showWizard && (
        <InductionImportWizard onClose={() => setShowWizard(false)} onCommitted={load} />
      )}
      {editing && (
        <CellEditor worker={editing.worker} col={editing.col} cell={editing.cell}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function Chip({ cell }) {
  if (!cell) {
    return <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded bg-slate-50 text-slate-400 border border-dashed border-slate-300">—</span>;
  }
  const meta = STATUS_CHIP[cell.status] || STATUS_CHIP.unknown;
  const label = cell.expiry_date
    ? `${meta.label} · ${shortIso(cell.expiry_date)}`
    : meta.label;
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded ${meta.cls}`}>
      {label}
    </span>
  );
}

function RowChip({ status }) {
  const meta = STATUS_CHIP[status] || STATUS_CHIP.unknown;
  return (
    <span className={`mt-1 inline-flex items-center text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function AccessChips({ access }) {
  if (!access) return <span className="text-slate-400">—</span>;
  const items = [
    access.vehicle && 'Vehicle',
    access.building_key && 'Building',
    access.gate_key && 'Gate',
  ].filter(Boolean);
  if (items.length === 0 && !access.extras) {
    return <span className="text-[10px] text-slate-400">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <span key={i} className="inline-flex items-center text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#ece6f4] text-[#5b21b6]">{i}</span>
      ))}
      {access.extras && (
        <span className="text-[10px] text-slate-500 italic" title={access.extras}>+{access.extras.length > 12 ? 'note' : access.extras}</span>
      )}
    </div>
  );
}

function shortIso(iso) {
  if (!iso || iso.length < 10) return iso;
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
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
            <span className={`mt-1 inline-block text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${CATEGORY_TINT[col.category]}`}>
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
              disabled={notHeld}
              data-testid="cell-editor-date"
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
            <button onClick={save} disabled={saving}
              data-testid="cell-editor-save"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-60">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
