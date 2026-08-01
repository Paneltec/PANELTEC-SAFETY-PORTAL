// v160.3.9.17 — List Roles reference-library tab.
// v160.3.9.25 — CRUD affordances via shared useCrudModal hook.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import useCrudModal from '../components/riskAssessments/useCrudModal';
import api from '../lib/api';
import { loadListSort, saveListSort } from '../lib/listSort';

function CountChip({ icon, n, kind, testid }) {
  const zero = !n || n === 0;
  const style = kind === 'cap'
    ? (zero ? 'bg-slate-100 text-slate-400' : 'bg-violet-100 text-violet-800')
    : (zero ? 'bg-slate-100 text-slate-400' : 'bg-slate-200 text-slate-700');
  return (
    <span data-testid={testid}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${style}`}>
      <span aria-hidden="true">{icon}</span> {n || 0}
    </span>
  );
}

function ChipRow({ items, kind }) {
  if (!items || items.length === 0) return null;
  const cls = kind === 'cap'
    ? 'bg-violet-100 text-violet-800'
    : 'bg-slate-200 text-slate-700';
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map((s, i) => (
        <span key={`${s}-${i}`} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>
          {s}
        </span>
      ))}
    </div>
  );
}

function ImportModal({ open, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  if (!open) return null;
  const submit = async () => {
    setBusy(true); setMsg('');
    try {
      const fd = new FormData(); let resp;
      if (file) { fd.append('file', file); resp = await api.post('/list-roles/reimport', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
      else if (url.trim()) { fd.append('url', url.trim()); resp = await api.post('/list-roles/reimport', fd); }
      else { setMsg('Provide a file OR a URL.'); setBusy(false); return; }
      setMsg(`Imported → new: ${resp.data.inserted}, updated: ${resp.data.updated}, unchanged: ${resp.data.unchanged}. Live rows: ${resp.data.live_total}.`);
      onDone();
    } catch (e) { setMsg(`Failed: ${e?.response?.data?.detail || e?.message}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="list-roles-import-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-semibold">Import List Roles from XLSX</h3>
          <button onClick={onClose} className="text-slate-400" aria-label="Close">×</button>
        </div>
        <label className="block text-sm font-medium mb-1">Upload .xlsx</label>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-100"
          data-testid="list-roles-import-file" />
        <div className="my-3 text-center text-xs uppercase text-slate-400">or</div>
        <label className="block text-sm font-medium mb-1">Paste URL</label>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" data-testid="list-roles-import-url" />
        {msg && <div className="mt-3 text-sm">{msg}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-slate-300">Close</button>
          <button onClick={submit} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white disabled:opacity-50" data-testid="list-roles-import-submit">
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ row }) {
  const hasCaps = Array.isArray(row.capabilities) && row.capabilities.length > 0;
  const hasPpl  = Array.isArray(row.people) && row.people.length > 0;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 p-4 rounded-lg border border-slate-200 bg-slate-50/60"
      data-testid={`list-roles-detail-${row.role_id}`}>
      <div className="md:col-span-2 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-slate-500">ID:</span>
        <span className="font-mono text-sm text-slate-800">#{row.role_id}</span>
        <span className="text-xs text-slate-500 ml-3">Capabilities:</span>
        <CountChip icon="⚙" n={row.capabilities_count} kind="cap" testid={`list-roles-detail-cap-${row.role_id}`} />
        <span className="text-xs text-slate-500 ml-3">People:</span>
        <CountChip icon="👥" n={row.people_count} kind="ppl" testid={`list-roles-detail-ppl-${row.role_id}`} />
      </div>
      <div className="md:col-span-2">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Description</div>
        <div className="text-sm text-slate-800 whitespace-pre-line">
          {row.description || <span className="italic text-slate-400">not provided</span>}
        </div>
      </div>
      {hasCaps && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Capability list</div>
          <ChipRow items={row.capabilities} kind="cap" />
        </div>
      )}
      {hasPpl && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">People</div>
          <ChipRow items={row.people} kind="ppl" />
        </div>
      )}
      {!hasCaps && !hasPpl && (
        <div className="md:col-span-2 text-xs text-slate-500 italic">
          The current export provides counts only. Individual capability and person names
          will appear here once a richer XLSX is uploaded.
        </div>
      )}
    </div>
  );
}

function MirrorScrollContainer({ children, maxHeight = '68vh' }) {
  const topRef = useRef(null); const bodyRef = useRef(null); const spacerRef = useRef(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const body = bodyRef.current; const spacer = spacerRef.current;
    if (!body || !spacer) return;
    const sync = () => { spacer.style.width = body.scrollWidth + 'px'; setOverflows(body.scrollWidth > body.clientWidth + 4); };
    sync();
    const ro = new ResizeObserver(sync); ro.observe(body);
    for (const el of body.children) ro.observe(el);
    window.addEventListener('resize', sync);
    return () => { ro.disconnect(); window.removeEventListener('resize', sync); };
  }, [children]);
  useEffect(() => {
    const body = bodyRef.current; const top = topRef.current;
    if (!body || !top) return;
    let lock = false;
    const onBody = () => { if (lock) return; lock = true; top.scrollLeft = body.scrollLeft; lock = false; };
    const onTop  = () => { if (lock) return; lock = true; body.scrollLeft = top.scrollLeft; lock = false; };
    body.addEventListener('scroll', onBody, { passive: true });
    top.addEventListener('scroll', onTop, { passive: true });
    return () => { body.removeEventListener('scroll', onBody); top.removeEventListener('scroll', onTop); };
  }, []);
  return (
    <div className="relative" data-testid="list-roles-scroll-wrap">
      <div ref={topRef} className="sticky top-0 z-40 bg-white border-x border-t border-slate-200 rounded-t-2xl"
        style={{ overflowX: 'scroll', overflowY: 'hidden', height: 14 }} aria-hidden="true">
        <div ref={spacerRef} style={{ height: 1 }} />
      </div>
      <div ref={bodyRef} className="bg-white border border-slate-200 rounded-b-2xl"
        style={{ overflowX: 'scroll', overflowY: 'auto', maxHeight, scrollbarGutter: 'stable' }}>
        {children}
      </div>
      {overflows && (
        <div className="absolute top-4 right-4 z-30 px-2.5 py-1 rounded-full bg-slate-900/80 text-white text-[10px] font-medium shadow-lg pointer-events-none">
          ← scroll to see all columns →
        </div>
      )}
    </div>
  );
}

const COLUMNS = [
  { key: 'role_id',            label: 'ID',           width: 60,  sortable: true,  kind: 'id' },
  { key: 'role_title',         label: 'Role title',   width: 220, sortable: true },
  { key: 'description',        label: 'Description',  width: 360, sortable: false },
  { key: 'capabilities_count', label: 'Capabilities', width: 130, sortable: true,  kind: 'cap' },
  { key: 'people_count',       label: 'People',       width: 120, sortable: true,  kind: 'ppl' },
];
const GRID_TEMPLATE = COLUMNS.map((c) => c.width + 'px').join(' ') + ' 32px';

function numericKey(v) {
  const n = parseInt(String(v || '').trim(), 10);
  return Number.isFinite(n) ? [0, n] : [1, 0];
}

export default function ListRolesTab({ user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [minCap, setMinCap] = useState(0);
  const [minPpl, setMinPpl] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState(() => loadListSort('list_roles', { key: 'role_title', dir: 'asc' }));
  const [importOpen, setImportOpen] = useState(false);
  const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);
  const canWrite = user && user.role === 'admin';

  const load = () => {
    setLoading(true);
    api.get('/list-roles/', { params: { limit: 1000 } })
      .then((r) => setItems(r.data.items || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const crud = useCrudModal({ tabKey: 'list_roles', isAdmin: canWrite, onRefresh: load });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = items.filter((r) => {
      if ((r.capabilities_count || 0) < minCap) return false;
      if ((r.people_count || 0) < minPpl) return false;
      if (needle) {
        const hay = [r.role_id, r.role_title, r.description]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      if (sort.key === 'role_id') {
        const [ra, na] = numericKey(a.role_id);
        const [rb, nb] = numericKey(b.role_id);
        return dir * (ra === rb ? na - nb : ra - rb);
      }
      if (sort.key === 'capabilities_count' || sort.key === 'people_count') {
        return dir * ((a[sort.key] || 0) - (b[sort.key] || 0));
      }
      const va = (a[sort.key] || '').toString().toLowerCase();
      const vb = (b[sort.key] || '').toString().toLowerCase();
      return dir * va.localeCompare(vb);
    });
    return out;
  }, [items, q, minCap, minPpl, sort]);

  const cycleSort = (key) => {
    const next = sort.key !== key ? { key, dir: 'asc' } : { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    setSort(next); saveListSort('list_roles', next.key, next.dir);
  };
  const sortIndicator = (key) => sort.key !== key ? '' : (sort.dir === 'asc' ? '↑' : '↓');

  return (
    <div data-testid="list-roles-tab">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search roles…"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
          data-testid="list-roles-search" />

        <label className="flex items-center gap-1.5 text-xs text-slate-600 border-l border-slate-200 pl-3">
          <span className="mr-1">Capabilities ≥</span>
          <input type="number" min="0" value={minCap} onChange={(e) => setMinCap(parseInt(e.target.value) || 0)}
            className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs"
            data-testid="list-roles-min-cap" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className="mr-1">People ≥</span>
          <input type="number" min="0" value={minPpl} onChange={(e) => setMinPpl(parseInt(e.target.value) || 0)}
            className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs"
            data-testid="list-roles-min-ppl" />
        </label>

        <div className="text-xs text-slate-500 ml-auto" data-testid="list-roles-count">
          {filtered.length} of {items.length} roles
        </div>

        {canWrite && crud.AddButton}
        {isAdmin && (
          <button onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50"
            data-testid="list-roles-import-open">
            Import from XLSX…
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 p-6">Loading roles…</div>
      ) : items.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-300 rounded-lg text-center">
          <p className="font-medium">No roles imported yet</p>
        </div>
      ) : (
        <MirrorScrollContainer>
          <div style={{ minWidth: 'max-content' }}>
            <div className="grid text-[11px] uppercase tracking-wider bg-slate-50 border-b border-slate-200 py-2 text-slate-600 font-semibold sticky top-0 z-20 gap-2 px-3"
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
              data-testid="list-roles-header">
              {COLUMNS.map((col) => (
                col.sortable ? (
                  <button key={col.key} className="text-left hover:text-slate-900"
                    onClick={() => cycleSort(col.key)}
                    data-testid={`list-roles-sort-${col.key}`}>
                    {col.label} {sortIndicator(col.key)}
                  </button>
                ) : (
                  <div key={col.key} className="text-left">{col.label}</div>
                )
              ))}
              <div className="text-center">›</div>
            </div>

            <ul className="divide-y divide-slate-100" data-testid="list-roles-rows">
              {filtered.map((row) => {
                const isOpen = expanded === row.id;
                return (
                  <li key={row.id} className="bg-white relative" data-testid={`list-roles-row-${row.role_id}`}>
                    <button className={`w-full text-left grid items-start py-2.5 hover:bg-slate-50 gap-2 px-3 ${isOpen ? 'bg-slate-50' : ''}`}
                      style={{ gridTemplateColumns: GRID_TEMPLATE }}
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                      aria-expanded={isOpen}>
                      <div className="font-mono text-xs text-slate-500 pt-0.5">#{row.role_id}</div>
                      <div className="text-sm font-medium text-slate-800 pt-0.5" title={row.role_title || ''}>
                        {row.role_title || <span className="italic text-slate-400">—</span>}
                      </div>
                      <div className="text-xs text-slate-800 line-clamp-2 leading-snug" title={row.description || ''}>
                        {row.description || <span className="italic text-slate-400">—</span>}
                      </div>
                      <div className="pt-0.5">
                        <CountChip icon="⚙" n={row.capabilities_count} kind="cap"
                          testid={`list-roles-cap-${row.role_id}`} />
                      </div>
                      <div className="pt-0.5">
                        <CountChip icon="👥" n={row.people_count} kind="ppl"
                          testid={`list-roles-ppl-${row.role_id}`} />
                      </div>
                      <div className="text-center text-slate-400 text-xs pt-0.5">{isOpen ? '▾' : '▸'}</div>
                    </button>
                    {canWrite && (
                      <div className="absolute top-1 right-8 z-10 bg-white/95 rounded-md shadow-sm border border-slate-200"
                           data-testid={`ra-row-actions-${row.role_id}`}>
                        {crud.RowActions(row)}
                      </div>
                    )}
                    {isOpen && (
                      <div className="px-4 pb-4"><DetailPanel row={row} /></div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </MirrorScrollContainer>
      )}

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
      {crud.Modals}
    </div>
  );
}
