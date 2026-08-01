// v160.3.9.20 — All Maintenance sub-tab for the Plant & Vehicles page.
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

function PlantChip({ row }) {
  if (row.plant_id) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 text-[11px] font-mono">{row.registration_no || row.registration_matched}</span>;
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[11px] font-mono" title="Rego present but no matching asset">
    ⚠ {row.registration_no || row.registration_matched}
  </span>;
}

export default function PlantMaintenanceTab({ user }) {
  const [items, setItems] = useState([]);
  const [unmatched, setUnmatched] = useState({ total_unmatched_rows: 0, distinct_regos: 0, groups: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [plantFilter, setPlantFilter] = useState('all'); // all | matched | unmatched | <plant_id>
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/plant-maintenance/', { params: { limit: 2000 } }),
      api.get('/plant-maintenance/unmatched'),
    ]).then(([listResp, unmResp]) => {
      setItems(listResp.data.items || []);
      setUnmatched(unmResp.data || { total_unmatched_rows: 0, distinct_regos: 0, groups: [] });
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = items.filter((r) => {
      if (plantFilter === 'matched' && !r.plant_id) return false;
      if (plantFilter === 'unmatched' && r.plant_id) return false;
      if (needle) {
        const hay = [r.maintenance_id, r.description, r.registration_no, r.registration_matched,
                     r.notes, r.performed_by, r.company, r.maintenance_type, r.type, r.sub_type]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    out.sort((a, b) => (b.date_completed || '').localeCompare(a.date_completed || ''));
    return out;
  }, [items, q, plantFilter]);

  const submitImport = async (fileOrUrl) => {
    const fd = new FormData();
    if (fileOrUrl.file) fd.append('file', fileOrUrl.file);
    else fd.append('url', fileOrUrl.url);
    const resp = await api.post('/plant-maintenance/reimport', fd,
      fileOrUrl.file ? { headers: { 'Content-Type': 'multipart/form-data' } } : {});
    return resp.data;
  };

  return (
    <div className="space-y-4" data-testid="plant-maintenance-tab">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search maintenance…"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
          data-testid="pm-search" />

        <div className="flex items-center rounded-full border border-slate-200 overflow-hidden" data-testid="pm-plant-toggle">
          {[
            { k: 'all', label: `All (${items.length})` },
            { k: 'matched', label: `Matched (${items.length - unmatched.total_unmatched_rows})` },
            { k: 'unmatched', label: `Unmatched (${unmatched.total_unmatched_rows})` },
          ].map((opt) => (
            <button key={opt.k} onClick={() => setPlantFilter(opt.k)}
              data-testid={`pm-filter-${opt.k}`}
              className={`px-3 py-1 text-xs font-semibold ${plantFilter === opt.k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {opt.label}
            </button>
          ))}
        </div>

        {unmatched.total_unmatched_rows > 0 && (
          <button onClick={() => setShowUnmatched(!showUnmatched)}
            className="px-3 py-1.5 text-xs rounded-md bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
            data-testid="pm-unmatched-toggle">
            ⚠ {unmatched.distinct_regos} unmatched regos
          </button>
        )}

        <div className="text-xs text-slate-500 ml-auto" data-testid="pm-count">
          {filtered.length} of {items.length} maintenance records
        </div>

        {isAdmin && (
          <button onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50"
            data-testid="pm-import-open">
            Import from XLSX…
          </button>
        )}
      </div>

      {/* Unmatched drill-down */}
      {showUnmatched && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4" data-testid="pm-unmatched-panel">
          <h4 className="text-sm font-semibold text-rose-800 mb-2">
            Unmatched maintenance regos ({unmatched.distinct_regos})
          </h4>
          <p className="text-xs text-rose-700 mb-3">
            These regos appear in maintenance records but don't match any asset. Add them to Navixy / assets to associate history.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {unmatched.groups.map((g) => (
              <div key={g.registration_matched} className="p-2 bg-white rounded-md border border-rose-100">
                <div className="font-mono text-xs font-semibold text-rose-900">{g.registration_matched}</div>
                <div className="text-[11px] text-slate-600">{g.count} record{g.count === 1 ? '' : 's'} · last {formatDate(new Date(g.last_date_completed)) || '—'}</div>
                {g.sample_description && (
                  <div className="text-[11px] text-slate-500 truncate mt-1" title={g.sample_description}>{g.sample_description}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-sm text-slate-500 p-6">Loading maintenance records…</div>
      ) : items.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-300 rounded-lg text-center">
          <p className="font-medium">No maintenance records imported yet</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <div className="grid text-[11px] uppercase tracking-wider bg-slate-50 border-b border-slate-200 py-2 text-slate-600 font-semibold gap-2 px-3"
            style={{ gridTemplateColumns: '70px 120px 200px 160px 130px 130px 140px 100px 40px' }}
            data-testid="pm-header">
            <div>ID</div>
            <div>Plant / Rego</div>
            <div>Description</div>
            <div>Maintenance Type</div>
            <div>Date Completed</div>
            <div>Cost</div>
            <div>Company</div>
            <div>Status</div>
            <div className="text-center">›</div>
          </div>
          <ul className="divide-y divide-slate-100" data-testid="pm-rows">
            {filtered.map((row) => {
              const isOpen = expanded === row.id;
              return (
                <li key={row.id} className="bg-white" data-testid={`pm-row-${row.maintenance_id}`}>
                  <button className={`w-full text-left grid items-start py-2.5 hover:bg-slate-50 gap-2 px-3 ${isOpen ? 'bg-slate-50' : ''}`}
                    style={{ gridTemplateColumns: '70px 120px 200px 160px 130px 130px 140px 100px 40px' }}
                    onClick={() => setExpanded(isOpen ? null : row.id)}
                    aria-expanded={isOpen}>
                    <div className="font-mono text-xs text-slate-500 pt-0.5">#{row.maintenance_id}</div>
                    <div className="pt-0.5"><PlantChip row={row} /></div>
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
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 p-4 rounded-lg border border-slate-200 bg-slate-50/60" data-testid={`pm-detail-${row.maintenance_id}`}>
                        {['type','sub_type','manufacturer','asset_code','latest_usage_reading',
                          'due_date','due_at','performed_by','notes'].map((k) => (
                          row[k] ? (
                            <div key={k} className={k === 'notes' ? 'md:col-span-2' : ''}>
                              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                                {k === 'due_date' ? 'Due (preferred)' : k === 'due_at' ? 'Due (raw)' : k.replace(/_/g, ' ')}
                              </div>
                              <div className="text-sm text-slate-800 whitespace-pre-line">
                                {(k === 'due_date' || k === 'due_at') ? (formatDate(new Date(row[k])) || row[k]) : String(row[k])}
                              </div>
                            </div>
                          ) : null
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="pm-import-modal">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold">Import Plant Maintenance from XLSX</h3>
              <button onClick={() => setImportOpen(false)} className="text-slate-400">×</button>
            </div>
            <PmImportBody onDone={() => { setImportOpen(false); load(); }} submit={submitImport} />
          </div>
        </div>
      )}
    </div>
  );
}

function PmImportBody({ onDone, submit }) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const go = async () => {
    setBusy(true); setMsg('');
    try {
      let resp;
      if (file) resp = await submit({ file });
      else if (url.trim()) resp = await submit({ url: url.trim() });
      else { setMsg('Provide a file OR a URL.'); setBusy(false); return; }
      setMsg(`Imported → new: ${resp.inserted}, updated: ${resp.updated}, unchanged: ${resp.unchanged}. Matched: ${resp.matched}, unmatched: ${resp.unmatched}. Live: ${resp.live_total}.`);
      onDone();
    } catch (e) { setMsg(`Failed: ${e?.response?.data?.detail || e?.message}`); }
    finally { setBusy(false); }
  };
  return (
    <>
      <label className="block text-sm font-medium mb-1">Upload .xlsx</label>
      <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)}
        className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-100"
        data-testid="pm-import-file" />
      <div className="my-3 text-center text-xs uppercase text-slate-400">or</div>
      <label className="block text-sm font-medium mb-1">Paste URL</label>
      <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" data-testid="pm-import-url" />
      {msg && <div className="mt-3 text-sm">{msg}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={go} disabled={busy}
          className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white disabled:opacity-50" data-testid="pm-import-submit">
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </>
  );
}
