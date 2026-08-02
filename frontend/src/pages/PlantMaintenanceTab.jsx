// v160.3.9.20 — All Maintenance sub-tab for the Plant & Vehicles page.
import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { formatDate } from '../lib/timeFormat';
import { useCan } from '../lib/permissions';

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

export default function PlantMaintenanceTab({ user, initialPlantFilter = 'all' }) {
  const [items, setItems] = useState([]);
  const [unmatched, setUnmatched] = useState({ total_unmatched_rows: 0, distinct_regos: 0, groups: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  // v160.3.9.21d — parent can preselect the filter (e.g. Unmatched tab).
  const [plantFilter, setPlantFilter] = useState(initialPlantFilter); // all | matched | unmatched | <plant_id>
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  // v160.3.9.20a — flat/grouped view toggle, persisted per-device.
  const VIEW_KEY = 'paneltec_plant_maintenance_view';
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'grouped' ? 'grouped' : 'flat'; }
    catch { return 'flat'; }
  });
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, viewMode); } catch { /* noop */ }
  }, [viewMode]);
  const [grouped, setGrouped] = useState(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [openGroup, setOpenGroup] = useState(null); // `plant:<id>` or `rego:<XXX>`
  // v160.3.9.29-2b — Migrated from `user.role`-based gate to assets.edit
  // token. Backend `plant_maintenance.py` also migrated to
  // `require_permission("assets", "edit"/"delete")` in the same commit.
  const can = useCan();
  const canWrite = can('assets', 'edit');
  const canDelete = can('assets', 'delete');
  const isAdmin = canWrite;
  void user;

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
  // Lazy-load grouped payload when the user first switches to Grouped view,
  // and refetch after imports flip `items.length`.
  useEffect(() => {
    if (viewMode !== 'grouped') return;
    let alive = true;
    setGroupLoading(true);
    api.get('/plant-maintenance/grouped').then((r) => {
      if (alive) setGrouped(r.data || { matched: [], unmatched: [] });
    }).finally(() => { if (alive) setGroupLoading(false); });
    return () => { alive = false; };
  }, [viewMode, items.length]);

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

        {/* v160.3.9.20a — Flat / Grouped view toggle. */}
        <div className="flex items-center rounded-full border border-slate-200 overflow-hidden" data-testid="pm-view-toggle">
          {[
            { k: 'flat', label: 'Flat' },
            { k: 'grouped', label: 'Group by vehicle' },
          ].map((opt) => (
            <button key={opt.k} onClick={() => setViewMode(opt.k)}
              data-testid={`pm-view-${opt.k}`}
              className={`px-3 py-1 text-xs font-semibold ${viewMode === opt.k ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
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
          {viewMode === 'grouped' && grouped
            ? `${grouped.matched_plants ?? grouped.matched?.length ?? 0} vehicles · ${grouped.unmatched_regos ?? grouped.unmatched?.length ?? 0} unmatched regos`
            : `${filtered.length} of ${items.length} maintenance records`}
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
            These regos appear in maintenance records but don&apos;t match any asset. Add them to Navixy / assets to associate history.
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
      ) : viewMode === 'grouped' ? (
        <GroupedView data={grouped} loading={groupLoading}
          openGroup={openGroup} setOpenGroup={setOpenGroup}
          q={q} plantFilter={plantFilter} />
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

// v160.3.9.20a — Grouped-by-vehicle view. Renders one card per plant
// asset (sorted by latest maintenance date DESC) then a phantom-vehicle
// section for rows whose rego doesn't match any asset.
function GroupedView({ data, loading, openGroup, setOpenGroup, q, plantFilter }) {
  if (loading || !data) {
    return <div className="text-sm text-slate-500 p-6" data-testid="pm-grouped-loading">Loading grouped view…</div>;
  }
  const needle = (q || '').trim().toLowerCase();
  const matchGroup = (records, headerHay) => {
    if (plantFilter === 'unmatched') return false;  // matched groups only
    if (!needle) return true;
    if (headerHay.includes(needle)) return true;
    return records.some((r) => (
      [r.maintenance_id, r.description, r.registration_no, r.notes,
       r.performed_by, r.company, r.maintenance_type].filter(Boolean)
        .join(' ').toLowerCase().includes(needle)
    ));
  };
  const unmatchedGroup = (records, rego) => {
    if (plantFilter === 'matched') return false;   // unmatched groups only
    if (!needle) return true;
    if ((rego || '').toLowerCase().includes(needle)) return true;
    return records.some((r) => (
      [r.maintenance_id, r.description, r.notes, r.performed_by,
       r.company, r.maintenance_type].filter(Boolean)
        .join(' ').toLowerCase().includes(needle)
    ));
  };
  const matched = (data.matched || []).filter((g) => matchGroup(g.records,
    [g.plant?.name, g.plant?.rego_serial, g.sample_rego, g.plant?.asset_type,
     g.plant?.kind, g.plant?.make, g.plant?.model].filter(Boolean).join(' ').toLowerCase()));
  const unmatched = (data.unmatched || []).filter((g) => unmatchedGroup(g.records, g.rego));

  return (
    <div className="space-y-3" data-testid="pm-grouped">
      {matched.length === 0 && unmatched.length === 0 && (
        <div className="p-6 text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg text-center">
          No maintenance groups match this filter.
        </div>
      )}
      {matched.map((g) => (
        <GroupCard key={`plant:${g.plant_id}`} groupKey={`plant:${g.plant_id}`}
          openGroup={openGroup} setOpenGroup={setOpenGroup}
          title={g.plant?.name || `Asset ${g.plant_id?.slice(0, 8)}`}
          rego={g.plant?.rego_serial || g.sample_rego}
          subtitle={[g.plant?.kind, g.plant?.asset_type, g.plant?.make, g.plant?.model, g.plant?.year]
            .filter(Boolean).join(' · ')}
          count={g.count} latestDate={g.latest_date}
          records={g.records} matched />
      ))}
      {unmatched.length > 0 && (
        <div className="pt-4 mt-4 border-t border-rose-200" data-testid="pm-grouped-unmatched-section">
          <div className="mb-2 flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-rose-800">
              ⚠ Unknown vehicles — <span className="tabular-nums">{unmatched.length}</span> phantom rego{unmatched.length === 1 ? '' : 's'}
            </h4>
            <span className="text-[11px] text-rose-700">Rego present in maintenance records but no matching asset</span>
          </div>
          <div className="space-y-3">
            {unmatched.map((g) => (
              <GroupCard key={`rego:${g.rego}`} groupKey={`rego:${g.rego}`}
                openGroup={openGroup} setOpenGroup={setOpenGroup}
                title={`Unknown vehicle · rego ${g.rego}`}
                rego={g.rego}
                subtitle={g.sample_description || g.sample_asset_code || ''}
                count={g.count} latestDate={g.latest_date}
                records={g.records} matched={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupCard({ groupKey, openGroup, setOpenGroup, title, rego, subtitle,
                    count, latestDate, records, matched }) {
  const isOpen = openGroup === groupKey;
  const shellCls = matched
    ? 'border-slate-200 bg-white'
    : 'border-rose-200 bg-rose-50/40';
  const chipCls = matched
    ? 'bg-blue-100 text-blue-800'
    : 'bg-rose-100 text-rose-800';
  return (
    <div className={`rounded-2xl border ${shellCls} overflow-hidden`} data-testid={`pm-group-${groupKey}`}>
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/60"
        onClick={() => setOpenGroup(isOpen ? null : groupKey)}
        aria-expanded={isOpen}
        data-testid={`pm-group-toggle-${groupKey}`}>
        {rego && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md ${chipCls} text-xs font-mono font-semibold`}>
            {matched ? '' : '⚠ '}{rego}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold truncate ${matched ? 'text-slate-800' : 'text-rose-900'}`}>{title}</div>
          {subtitle && <div className="text-xs text-slate-500 truncate">{subtitle}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Records</div>
          <div className="text-sm font-semibold tabular-nums text-slate-800">{count}</div>
        </div>
        <div className="text-right shrink-0 ml-4">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Latest</div>
          <div className="text-sm text-slate-700">{latestDate ? (formatDate(new Date(latestDate)) || latestDate) : '—'}</div>
        </div>
        <div className="text-slate-400 text-xs ml-2">{isOpen ? '▾' : '▸'}</div>
      </button>
      {isOpen && (
        <div className="border-t border-slate-100 bg-slate-50/40 px-3 py-3">
          <GroupInlineTable records={records} />
        </div>
      )}
    </div>
  );
}

function GroupInlineTable({ records }) {
  const cols = '70px 200px 150px 120px 110px 130px 90px';
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
      <div className="grid text-[11px] uppercase tracking-wider bg-slate-50 border-b border-slate-200 py-2 text-slate-600 font-semibold gap-2 px-3"
        style={{ gridTemplateColumns: cols }}>
        <div>ID</div>
        <div>Description</div>
        <div>Type</div>
        <div>Completed</div>
        <div>Cost</div>
        <div>Company</div>
        <div>Status</div>
      </div>
      <ul className="divide-y divide-slate-100">
        {records.map((row) => (
          <li key={row.id} className="grid items-start py-2 gap-2 px-3"
              style={{ gridTemplateColumns: cols }}
              data-testid={`pm-group-row-${row.maintenance_id}`}>
            <div className="font-mono text-xs text-slate-500">#{row.maintenance_id}</div>
            <div className="text-xs text-slate-800 line-clamp-2 leading-snug" title={row.description || ''}>{row.description || '—'}</div>
            <div className="text-xs text-slate-700">{row.maintenance_type || '—'}</div>
            <div className="text-xs text-slate-700">{row.date_completed ? (formatDate(new Date(row.date_completed)) || row.date_completed) : '—'}</div>
            <div className="text-xs text-slate-700 font-mono">{row.cost || '—'}</div>
            <div className="text-xs text-slate-700 truncate" title={row.company || ''}>{row.company || '—'}</div>
            <div><StatusChip v={row.maintenance_status} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
