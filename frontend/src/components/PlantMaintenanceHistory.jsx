// v160.3.9.20a — Maintenance history section for the AssetDrawer.
// Renders every ingested Plant Maintenance record for a single asset,
// sorted date_completed DESC. Row-click expands to show the full detail
// block. Empty-state when no records match.
import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { formatDate } from '../lib/timeFormat';

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

export default function PlantMaintenanceHistory({ asset }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

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
          {items.map((row) => {
            const isOpen = expanded === row.id;
            return (
              <li key={row.id} className="bg-white" data-testid={`pmh-row-${row.maintenance_id}`}>
                <button className={`w-full text-left grid items-start py-2.5 hover:bg-slate-50 gap-2 px-3 ${isOpen ? 'bg-slate-50' : ''}`}
                  style={{ gridTemplateColumns: GRID_COLS }}
                  onClick={() => setExpanded(isOpen ? null : row.id)}
                  aria-expanded={isOpen}>
                  <div className="font-mono text-xs text-slate-500 pt-0.5">#{row.maintenance_id}</div>
                  <div className="text-xs text-slate-800 line-clamp-2 leading-snug" title={row.description || ''}>{row.description || '—'}</div>
                  <div className="text-xs text-slate-700">{row.maintenance_type || '—'}</div>
                  <div className="text-xs text-slate-700">{row.date_completed ? (formatDate(new Date(row.date_completed)) || row.date_completed) : '—'}</div>
                  <div className="text-xs text-slate-700 font-mono">{row.cost || '—'}</div>
                  <div className="text-xs text-slate-700 truncate" title={row.company || ''}>{row.company || '—'}</div>
                  <div className="pt-0.5"><StatusChip v={row.maintenance_status} /></div>
                  <div className="text-center text-slate-400 text-xs pt-0.5">{isOpen ? '▾' : '▸'}</div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4">
                    <DetailBlock row={row} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
