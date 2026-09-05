// v160.3.9.20a — Maintenance history section for the AssetDrawer.
// Renders every ingested Plant Maintenance record for a single asset,
// sorted date_completed DESC.
// v58.13.120g — Row-click now opens a nested sub-modal (z-[80], sits
// on top of the drawer at z-[70]) showing the full record detail.
// v58.13.121 — Sub-modal now shows a "Print sheet" button when the
// record carries `checklist_items` (i.e. it was submitted through
// the Service Check Sheet flow). Pre-v121 records don't have a
// sheet, so the button stays hidden for them.
import React, { useEffect, useMemo, useState } from 'react';
import { X, Printer } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/timeFormat';
import { openAuthedFile } from '../lib/downloads';

function StatusChip({ v }) {
  if (!v) return <span className="text-slate-300 text-xs">—</span>;
  const s = String(v).toLowerCase();
  const cls = s.includes('closed') ? 'bg-emerald-100 text-emerald-800'
    : s.includes('open') ? 'bg-amber-100 text-amber-800'
    : 'bg-slate-100 text-slate-700';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${cls}`}>{v}</span>;
}

const GRID_COLS = '70px 200px 160px 130px 120px 140px 100px 40px';

function DetailBlock({ row }) {
  const FIELDS = ['type', 'sub_type', 'manufacturer', 'asset_code',
    'latest_usage_reading', 'due_date', 'due_at', 'performed_by', 'notes'];
  const visible = FIELDS.filter((k) => row[k]);
  if (!visible.length) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 p-4 rounded-lg border border-slate-200 bg-slate-50/60"
      data-testid={`pmh-detail-${row.maintenance_id}`}>
      {visible.map((k) => (
        <div key={k} className={k === 'notes' ? 'md:col-span-2' : ''}>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            {k === 'due_date' ? 'Due (preferred)' : k === 'due_at' ? 'Due (raw)' : k.replace(/_/g, ' ')}
          </div>
          <div className="text-sm text-slate-800 whitespace-pre-line">
            {(k === 'due_date' || k === 'due_at') ? (formatDate(new Date(row[k])) || row[k]) : String(row[k])}
          </div>
        </div>
      ))}
    </div>
  );
}

// v58.13.120g — Nested sub-modal (z-[80] sits ABOVE the drawer's
// z-[70] backdrop). Closing returns to the drawer.
// v58.13.121 — When `assetId` is provided AND the record carries a
// `sheet_template_version`, shows a "Print sheet" button that downloads
// the generated PDF via the .107 authed-file opener.
function RecordSubModal({ row, assetId, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const hasSheet = !!row?.sheet_template_version;
  const printSheet = async () => {
    if (!assetId) return;
    await openAuthedFile(
      `/fleet/assets/${assetId}/service-sheet/${row.id}/pdf`,
      `service-sheet-${row.maintenance_id || row.id}.pdf`,
      { mode: 'blob' },
    );
  };
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => e.target === e.currentTarget && onClose()}
         data-testid="pmh-detail-modal">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <header className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Maintenance record</div>
            <div className="font-mono text-xs text-slate-700 mt-0.5">#{row.maintenance_id}</div>
            <h3 className="font-display text-lg font-bold text-slate-900 mt-1 break-words">
              {row.maintenance_type || 'Maintenance'} — {row.date_completed ? (formatDate(new Date(row.date_completed)) || row.date_completed) : '—'}
            </h3>
            {hasSheet && (
              <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-violet-100 text-violet-700"
                   data-testid="pmh-detail-has-sheet">
                Service Check Sheet · {row.sheet_template_version}
              </div>
            )}
          </div>
          <button onClick={onClose}
            data-testid="pmh-detail-modal-close"
            aria-label="Close detail"
            className="shrink-0 p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800">
            <X size={18} />
          </button>
        </header>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Cost</div>
              <div className="font-mono text-slate-800">{row.cost || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Company</div>
              <div className="text-slate-800">{row.company || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Performed by</div>
              <div className="text-slate-800">{row.performed_by || row.technician_name || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Status</div>
              <div><StatusChip v={row.maintenance_status} /></div>
            </div>
          </div>
          {row.description && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Description</div>
              <div className="text-sm text-slate-800 whitespace-pre-line">{row.description}</div>
            </div>
          )}
          <DetailBlock row={row} />
        </div>
        <footer className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-5 py-3 emergent-badge-safe flex justify-end gap-2">
          {hasSheet && assetId && (
            <button onClick={printSheet}
              data-testid="pmh-print-sheet"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-bold hover:bg-violet-700">
              <Printer size={14} /> Print sheet
            </button>
          )}
          <button onClick={onClose}
            data-testid="pmh-detail-modal-back"
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
            ← Back to drawer
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function PlantMaintenanceHistory({ asset }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!asset?.id) return;
    let alive = true;
    setLoading(true); setError('');
    api.get(`/plant/${asset.id}/maintenance`)
      .then((r) => { if (alive) setItems(r.data?.items || []); })
      .catch((e) => { if (alive) setError(e?.response?.data?.detail || e?.message || 'load failed'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [asset?.id]);

  const latest = useMemo(() => {
    if (!items.length) return null;
    return items.reduce((acc, r) => (r.date_completed && (!acc || r.date_completed > acc)) ? r.date_completed : acc, null);
  }, [items]);

  if (loading) {
    return <div className="text-sm text-slate-500 p-4" data-testid="pmh-loading">Loading maintenance history…</div>;
  }
  if (error) {
    return <div className="text-sm text-rose-600 p-4" data-testid="pmh-error">Failed to load: {error}</div>;
  }
  if (!items.length) {
    return (
      <div className="p-8 border border-dashed border-slate-300 rounded-lg text-center" data-testid="pmh-empty">
        <p className="font-medium text-slate-700">No maintenance records for this vehicle yet.</p>
        <p className="text-xs text-slate-500 mt-1">Records ingested from the Plant Maintenance XLSX will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="pmh-root">
      <div className="flex items-baseline justify-between">
        <h4 className="font-display text-sm font-semibold text-slate-800">
          Maintenance history · <span className="tabular-nums">{items.length}</span> {items.length === 1 ? 'record' : 'records'}
        </h4>
        {latest && (
          <div className="text-xs text-slate-500" data-testid="pmh-latest">
            Last serviced <span className="font-semibold text-slate-700">{formatDate(new Date(latest)) || latest}</span>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 overflow-hidden">
        <div className="grid text-[11px] uppercase tracking-wider bg-slate-50 border-b border-slate-200 py-2 text-slate-600 font-semibold gap-2 px-3"
          style={{ gridTemplateColumns: GRID_COLS }} data-testid="pmh-header">
          <div>ID</div>
          <div>Description</div>
          <div>Maintenance Type</div>
          <div>Date Completed</div>
          <div>Cost</div>
          <div>Company</div>
          <div>Status</div>
          <div className="text-center">›</div>
        </div>
        <ul className="divide-y divide-slate-100" data-testid="pmh-rows">
          {items.map((row) => (
            <li key={row.id} className="bg-white" data-testid={`pmh-row-${row.maintenance_id}`}>
              <button className="w-full text-left grid items-start py-2.5 hover:bg-slate-50 gap-2 px-3"
                style={{ gridTemplateColumns: GRID_COLS }}
                onClick={() => setSelected(row)}
                data-testid={`pmh-row-open-${row.maintenance_id}`}>
                <div className="font-mono text-xs text-slate-500 pt-0.5">#{row.maintenance_id}</div>
                <div className="text-xs text-slate-800 line-clamp-2 leading-snug" title={row.description || ''}>{row.description || '—'}</div>
                <div className="text-xs text-slate-700">{row.maintenance_type || '—'}</div>
                <div className="text-xs text-slate-700">{row.date_completed ? (formatDate(new Date(row.date_completed)) || row.date_completed) : '—'}</div>
                <div className="text-xs text-slate-700 font-mono">{row.cost || '—'}</div>
                <div className="text-xs text-slate-700 truncate" title={row.company || ''}>{row.company || '—'}</div>
                <div className="pt-0.5"><StatusChip v={row.maintenance_status} /></div>
                <div className="text-center text-slate-400 text-xs pt-0.5">▸</div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected && <RecordSubModal row={selected} assetId={asset?.id} onClose={() => setSelected(null)} />}
    </div>
  );
}
