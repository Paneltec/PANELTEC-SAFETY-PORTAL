// v160.3.9.14 — List Forms reference library tab.
// v160.3.9.25 — CRUD affordances (Add / Edit / Delete) via shared
//               useCrudModal hook — admin-only, matching the strict
//               `{admin}` backend RBAC on POST/PATCH/DELETE.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import useCrudModal from '../components/riskAssessments/useCrudModal';
import api from '../lib/api';
import { loadListSort, saveListSort } from '../lib/listSort';

const GROUP_CHIP = {
  Operations:     { bg: '#DBEAFE', fg: '#1E3A8A' }, // blue-100 / blue-900
  Administration: { bg: '#E2E8F0', fg: '#334155' }, // slate-200 / slate-700
};

function GroupChips({ groups, testid }) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return <span className="text-slate-400 italic text-xs">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1" data-testid={testid}>
      {groups.map((g) => {
        const c = GROUP_CHIP[g] || { bg: '#F1F5F9', fg: '#475569' };
        return (
          <span
            key={g}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ backgroundColor: c.bg, color: c.fg }}
          >
            {g}
          </span>
        );
      })}
    </div>
  );
}

function BoolPill({ value, testid }) {
  if (value === true) {
    return (
      <span
        data-testid={testid}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-100 text-emerald-800"
      >
        <span aria-hidden="true">✓</span> Yes
      </span>
    );
  }
  return (
    <span
      data-testid={testid}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-600"
    >
      <span aria-hidden="true">—</span> No
    </span>
  );
}

function ImportModal({ open, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState('');
  if (!open) return null;

  const submit = async () => {
    setBusy(true); setMsg('');
    try {
      let resp;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        resp = await api.post('/list-forms/reimport', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else if (url.trim()) {
        const fd = new FormData();
        fd.append('url', url.trim());
        resp = await api.post('/list-forms/reimport', fd);
      } else {
        setMsg('Provide a file OR a URL.'); setBusy(false); return;
      }
      setMsg(`Imported → new: ${resp.data.inserted}, updated: ${resp.data.updated}, unchanged: ${resp.data.unchanged}. Live rows: ${resp.data.live_total}.`);
      onDone();
    } catch (e) {
      setMsg(`Failed: ${e?.response?.data?.detail || e?.message || 'unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="list-forms-import-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Import List Forms from XLSX</h3>
            <p className="text-sm text-slate-500 mt-1">Existing rows are matched by <code>list_form_id</code>. Changed rows are updated; new rows are inserted; unchanged rows are skipped.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="list-forms-import-close" aria-label="Close">×</button>
        </div>

        <label className="block text-sm font-medium text-slate-700 mb-1">Upload .xlsx file</label>
        <input
          type="file" accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          data-testid="list-forms-import-file"
        />
        <div className="my-3 text-center text-xs uppercase tracking-wide text-slate-400">or</div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Paste XLSX URL</label>
        <input
          type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/list_forms.xlsx"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          data-testid="list-forms-import-url"
        />

        {msg && <div className="mt-3 text-sm text-slate-700" data-testid="list-forms-import-msg">{msg}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50" data-testid="list-forms-import-cancel">Close</button>
          <button onClick={submit} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            data-testid="list-forms-import-submit">
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ row }) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 p-4 rounded-lg border border-slate-200 bg-slate-50/60"
      data-testid={`list-forms-detail-${row.list_form_id}`}
    >
      <div className="md:col-span-2 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-slate-500">ID:</span>
        <span className="font-mono text-sm text-slate-800">#{row.list_form_id}</span>
        <span className="text-xs text-slate-500 ml-3">Group:</span>
        <GroupChips groups={row.form_group} testid={`list-forms-detail-groups-${row.list_form_id}`} />
      </div>
      <div className="md:col-span-2">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Description</div>
        <div className="text-sm text-slate-800 whitespace-pre-line">
          {row.description || <span className="italic text-slate-400">not provided</span>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 w-20">Public:</span>
        <BoolPill value={row.public_enabled} testid={`list-forms-detail-public-${row.list_form_id}`} />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 w-20">Mobile:</span>
        <BoolPill value={row.mobile_enabled} testid={`list-forms-detail-mobile-${row.list_form_id}`} />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 w-20">Asset:</span>
        <BoolPill value={row.asset_enabled} testid={`list-forms-detail-asset-${row.list_form_id}`} />
      </div>
    </div>
  );
}

// Mirror-scroll container — twin of the one in MasterRisksTab.
function MirrorScrollContainer({ children, maxHeight = '68vh' }) {
  const topRef = useRef(null);
  const bodyRef = useRef(null);
  const spacerRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const body = bodyRef.current;
    const spacer = spacerRef.current;
    if (!body || !spacer) return;
    const syncWidth = () => {
      spacer.style.width = body.scrollWidth + 'px';
      setOverflows(body.scrollWidth > body.clientWidth + 4);
    };
    syncWidth();
    const ro = new ResizeObserver(syncWidth);
    ro.observe(body);
    for (const el of body.children) ro.observe(el);
    window.addEventListener('resize', syncWidth);
    return () => { ro.disconnect(); window.removeEventListener('resize', syncWidth); };
  }, [children]);

  useEffect(() => {
    const body = bodyRef.current;
    const top = topRef.current;
    if (!body || !top) return;
    let lock = false;
    const onBody = () => { if (lock) return; lock = true; top.scrollLeft = body.scrollLeft; lock = false; };
    const onTop = () => { if (lock) return; lock = true; body.scrollLeft = top.scrollLeft; lock = false; };
    body.addEventListener('scroll', onBody, { passive: true });
    top.addEventListener('scroll', onTop, { passive: true });
    return () => { body.removeEventListener('scroll', onBody); top.removeEventListener('scroll', onTop); };
  }, []);

  return (
    <div className="relative" data-testid="list-forms-scroll-wrap">
      <div ref={topRef}
        className="sticky top-0 z-40 bg-white border-x border-t border-slate-200 rounded-t-2xl"
        style={{ overflowX: 'scroll', overflowY: 'hidden', height: 14 }}
        aria-hidden="true">
        <div ref={spacerRef} style={{ height: 1 }} />
      </div>
      <div ref={bodyRef}
        className="bg-white border border-slate-200 rounded-b-2xl"
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

// Column definitions.
const COLUMNS = [
  { key: 'list_form_id',   label: 'Id',          width: 60,  sortable: true,  kind: 'id' },
  { key: 'name',           label: 'Name',        width: 220, sortable: true },
  { key: 'description',    label: 'Description', width: 360, sortable: false },
  { key: 'form_group',     label: 'Form group',  width: 180, sortable: false, kind: 'groups' },
  { key: 'public_enabled', label: 'Public',      width: 80,  sortable: true,  kind: 'bool' },
  { key: 'mobile_enabled', label: 'Mobile',      width: 80,  sortable: true,  kind: 'bool' },
  { key: 'asset_enabled',  label: 'Asset',       width: 80,  sortable: true,  kind: 'bool' },
];
const GRID_TEMPLATE = COLUMNS.map((c) => c.width + 'px').join(' ') + ' 32px';

function numericSortKey(id) {
  const n = parseInt((id || '').trim(), 10);
  return Number.isFinite(n) ? [0, n] : [1, 0];
}

export default function ListFormsTab({ user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [groupsOn, setGroupsOn] = useState({ Operations: true, Administration: true });
  const [showPublic, setShowPublic] = useState(true);
  const [showMobile, setShowMobile] = useState(true);
  const [showAsset, setShowAsset] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState(() => loadListSort('list_forms', { key: 'name', dir: 'asc' }));
  const [importOpen, setImportOpen] = useState(false);

  const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);
  // v160.3.9.25 — Strict admin for CRUD, matching backend RBAC.
  const canWrite = user && user.role === 'admin';

  const load = () => {
    setLoading(true);
    api.get('/list-forms/', { params: { limit: 1000 } })
      .then((r) => setItems(r.data.items || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const crud = useCrudModal({ tabKey: 'list_forms', isAdmin: canWrite, onRefresh: load });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = items.filter((r) => {
      // Row's groups must intersect the "on" set (if row has no groups,
      // show only when at least one filter is on).
      const rowGroups = r.form_group || [];
      if (rowGroups.length === 0) {
        if (!groupsOn.Operations && !groupsOn.Administration) return false;
      } else {
        if (!rowGroups.some((g) => groupsOn[g])) return false;
      }
      // Boolean filters: each checkbox = "include rows where this flag
      // is true". If every checkbox is ON OR every checkbox is OFF, no
      // filter is applied (that's the "show all" state). Otherwise a
      // row must match at least one of the CHECKED dimensions.
      const anyOff = !(showPublic && showMobile && showAsset);
      const anyOn = showPublic || showMobile || showAsset;
      if (anyOff && anyOn) {
        const matches =
          (showPublic && r.public_enabled) ||
          (showMobile && r.mobile_enabled) ||
          (showAsset && r.asset_enabled);
        if (!matches) return false;
      }
      if (needle) {
        const hay = [r.list_form_id, r.name, r.description,
                     ...(r.form_group || [])]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      if (sort.key === 'list_form_id') {
        const [ra, na] = numericSortKey(a.list_form_id);
        const [rb, nb] = numericSortKey(b.list_form_id);
        return dir * (ra === rb ? na - nb : ra - rb);
      }
      if (['public_enabled', 'mobile_enabled', 'asset_enabled'].includes(sort.key)) {
        // true first (asc puts true above false).
        const va = a[sort.key] ? 0 : 1;
        const vb = b[sort.key] ? 0 : 1;
        return dir * (va - vb);
      }
      const va = (a[sort.key] || '').toString().toLowerCase();
      const vb = (b[sort.key] || '').toString().toLowerCase();
      return dir * va.localeCompare(vb);
    });
    return out;
  }, [items, q, groupsOn, showPublic, showMobile, showAsset, sort]);

  const cycleSort = (key) => {
    const next = sort.key !== key ? { key, dir: 'asc' }
                                  : { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    setSort(next);
    saveListSort('list_forms', next.key, next.dir);
  };
  const sortIndicator = (key) => sort.key !== key ? '' : (sort.dir === 'asc' ? '↑' : '↓');

  return (
    <div data-testid="list-forms-tab">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search forms…"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          data-testid="list-forms-search"
        />

        <div className="flex items-center gap-1" data-testid="list-forms-group-chips">
          {['Operations', 'Administration'].map((g) => {
            const c = GROUP_CHIP[g];
            const active = groupsOn[g];
            return (
              <button
                key={g}
                onClick={() => setGroupsOn({ ...groupsOn, [g]: !active })}
                data-testid={`list-forms-chip-${g.toLowerCase()}`}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${active ? '' : 'opacity-40'}`}
                style={{ backgroundColor: active ? c.bg : '#FFF', color: c.fg, borderColor: c.bg }}
                title={`Toggle ${g}`}
              >
                {g}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 pl-3 border-l border-slate-200 text-xs text-slate-600" data-testid="list-forms-bool-filters">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showPublic} onChange={(e) => setShowPublic(e.target.checked)}
              data-testid="list-forms-toggle-public" />
            Public
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showMobile} onChange={(e) => setShowMobile(e.target.checked)}
              data-testid="list-forms-toggle-mobile" />
            Mobile
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showAsset} onChange={(e) => setShowAsset(e.target.checked)}
              data-testid="list-forms-toggle-asset" />
            Asset
          </label>
        </div>

        <div className="text-xs text-slate-500 ml-auto" data-testid="list-forms-count">
          {filtered.length} of {items.length} forms
        </div>

        {canWrite && crud.AddButton}
        {isAdmin && (
          <button
            onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            data-testid="list-forms-import-open"
          >
            Import from XLSX…
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-slate-500 p-6" data-testid="list-forms-loading">Loading list forms…</div>
      ) : items.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-300 rounded-lg text-center" data-testid="list-forms-empty">
          <p className="text-slate-700 font-medium">No list forms imported yet</p>
          <p className="text-slate-500 text-sm mt-1">
            {isAdmin ? 'Use "Import from XLSX" above to load the reference library.'
                     : 'Ask an admin to import the list forms reference library.'}
          </p>
        </div>
      ) : (
        <MirrorScrollContainer>
          <div style={{ minWidth: 'max-content' }}>
            {/* Sticky headers */}
            <div
              className="grid text-[11px] uppercase tracking-wider bg-slate-50 border-b border-slate-200 py-2 text-slate-600 font-semibold sticky top-0 z-20 gap-2 px-3"
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
              data-testid="list-forms-header"
            >
              {COLUMNS.map((col) => (
                col.sortable ? (
                  <button
                    key={col.key}
                    className="text-left hover:text-slate-900"
                    onClick={() => cycleSort(col.key)}
                    data-testid={`list-forms-sort-${col.key}`}
                  >
                    {col.label} {sortIndicator(col.key)}
                  </button>
                ) : (
                  <div key={col.key} className="text-left">{col.label}</div>
                )
              ))}
              <div className="text-center">›</div>
            </div>

            <ul className="divide-y divide-slate-100" data-testid="list-forms-rows">
              {filtered.map((row) => {
                const isOpen = expanded === row.id;
                return (
                  <li key={row.id} className="bg-white relative" data-testid={`list-forms-row-${row.list_form_id}`}>
                    <button
                      className={`w-full text-left grid items-start py-2.5 hover:bg-slate-50 transition gap-2 px-3 ${isOpen ? 'bg-slate-50' : ''}`}
                      style={{ gridTemplateColumns: GRID_TEMPLATE }}
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                      aria-expanded={isOpen}
                    >
                      {COLUMNS.map((col) => {
                        if (col.kind === 'id') {
                          return <div key={col.key} className="font-mono text-xs text-slate-500 pt-0.5">#{row.list_form_id}</div>;
                        }
                        if (col.kind === 'groups') {
                          return <div key={col.key} className="pt-0.5"><GroupChips groups={row.form_group} testid={`list-forms-groups-${row.list_form_id}`} /></div>;
                        }
                        if (col.kind === 'bool') {
                          return <div key={col.key} className="pt-0.5"><BoolPill value={row[col.key]} testid={`list-forms-${col.key}-${row.list_form_id}`} /></div>;
                        }
                        const v = row[col.key];
                        return (
                          <div
                            key={col.key}
                            className={`text-xs text-slate-800 leading-snug ${col.key === 'description' ? 'line-clamp-2' : 'font-medium text-sm'}`}
                            title={v || ''}
                          >
                            {v || <span className="italic text-slate-400">—</span>}
                          </div>
                        );
                      })}
                      <div className="text-center text-slate-400 text-xs pt-0.5">{isOpen ? '▾' : '▸'}</div>
                    </button>
                    {canWrite && (
                      <div className="absolute top-1 right-8 z-10 bg-white/95 rounded-md shadow-sm border border-slate-200"
                           data-testid={`ra-row-actions-${row.list_form_id}`}>
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
