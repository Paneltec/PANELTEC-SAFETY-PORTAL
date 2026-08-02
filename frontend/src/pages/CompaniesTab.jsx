// v160.3.9.19 — Companies reference-library tab.
// v160.3.9.25 — CRUD affordances via shared useCrudModal hook.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import useCrudModal from '../components/riskAssessments/useCrudModal';
import api from '../lib/api';
import { loadListSort, saveListSort } from '../lib/listSort';
import { useCan } from '../lib/permissions';

const LABEL = {
  company_id: 'ID', company: 'Company', company_category: 'Category',
  phone: 'Phone', suburb: 'Suburb', state: 'State',
  general_email: 'Email', archived: 'Archived',
  account_type: 'Account Type', company_classification: 'Classification',
};
const WIDTH = {
  company_id: 60, company: 220, company_category: 140, phone: 130,
  suburb: 120, state: 70, general_email: 210, archived: 100,
  account_type: 140, company_classification: 160,
};
const ORDER = ['company_id', 'company', 'company_category', 'phone', 'suburb',
               'state', 'general_email', 'archived', 'account_type',
               'company_classification'];

function ArchivedPill({ value }) {
  if (value === true) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-100 text-rose-800">Archived</span>;
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-100 text-emerald-800">Active</span>;
}

function renderCell(key, value) {
  if (key === 'archived') return <ArchivedPill value={!!value} />;
  if (value == null || value === '') return <span className="text-slate-300 text-xs">—</span>;
  if (key === 'phone')         return <a href={`tel:${String(value).replace(/\s+/g, '')}`} className="text-xs text-blue-700 hover:underline">{value}</a>;
  if (key === 'general_email') return <a href={`mailto:${value}`} className="text-xs text-blue-700 hover:underline">{value}</a>;
  if (key === 'state')         return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono text-[11px]">{value}</span>;
  if (key === 'company_id')    return <span className="font-mono text-xs text-slate-500">#{value}</span>;
  if (key === 'company')       return <span className="text-sm font-medium text-slate-800" title={value}>{value}</span>;
  return <span className="text-xs text-slate-800" title={value}>{value}</span>;
}

function DetailPanel({ row, populated }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 p-4 rounded-lg border border-slate-200 bg-slate-50/60"
      data-testid={`companies-detail-${row.company_id}`}>
      {populated.map((k) => (
        <div key={k}>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{LABEL[k] || k}</div>
          <div className="text-sm text-slate-800">
            {k === 'archived' ? <ArchivedPill value={!!row[k]} />
              : row[k] == null || row[k] === '' ? <span className="italic text-slate-400">not provided</span>
              : k === 'phone' ? <a href={`tel:${String(row[k]).replace(/\s+/g, '')}`} className="text-blue-700 hover:underline">{row[k]}</a>
              : k === 'general_email' ? <a href={`mailto:${row[k]}`} className="text-blue-700 hover:underline">{row[k]}</a>
              : String(row[k])}
          </div>
        </div>
      ))}
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
    <div className="relative" data-testid="companies-scroll-wrap">
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
      if (file) { fd.append('file', file); resp = await api.post('/companies/reimport', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
      else if (url.trim()) { fd.append('url', url.trim()); resp = await api.post('/companies/reimport', fd); }
      else { setMsg('Provide a file OR a URL.'); setBusy(false); return; }
      setMsg(`Imported → new: ${resp.data.inserted}, updated: ${resp.data.updated}, unchanged: ${resp.data.unchanged}. Live: ${resp.data.live_total}.`);
      onDone();
    } catch (e) { setMsg(`Failed: ${e?.response?.data?.detail || e?.message}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="companies-import-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-semibold">Import Companies from XLSX</h3>
          <button onClick={onClose} className="text-slate-400" aria-label="Close">×</button>
        </div>
        <label className="block text-sm font-medium mb-1">Upload .xlsx</label>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-100"
          data-testid="companies-import-file" />
        <div className="my-3 text-center text-xs uppercase text-slate-400">or</div>
        <label className="block text-sm font-medium mb-1">Paste URL</label>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" data-testid="companies-import-url" />
        {msg && <div className="mt-3 text-sm">{msg}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-slate-300">Close</button>
          <button onClick={submit} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white disabled:opacity-50" data-testid="companies-import-submit">
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CompaniesTab({ user }) {
  const [items, setItems] = useState([]);
  const [populated, setPopulated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [state, setState] = useState('');
  const [accountType, setAccountType] = useState('');
  const [classification, setClassification] = useState('');
  const [archivedFilter, setArchivedFilter] = useState('all'); // all|active|archived
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState(() => loadListSort('companies', { key: 'company', dir: 'asc' }));
  const [importOpen, setImportOpen] = useState(false);
  // v160.3.9.29-2b — Migrated from `user.role`-based gates to the granular
  // reference_library tokens. Per Phase 3c decision #5, hseq_lead now
  // gains write access here (seeded in permissions.py ROLE_DEFAULTS in
  // the same commit). `isAdmin` kept as a legacy JSX alias.
  const can = useCan();
  const canWrite = can('reference_library', 'edit');
  const canDelete = can('reference_library', 'delete');
  const isAdmin = canWrite;
  void user;

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/companies/', { params: { limit: 1000 } }),
      api.get('/companies/columns'),
    ]).then(([lr, cr]) => {
      setItems(lr.data.items || []);
      setPopulated(cr.data.populated || []);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const crud = useCrudModal({ tabKey: 'companies', isAdmin: canWrite, onRefresh: load });

  const visibleCols = useMemo(
    () => ORDER.filter((k) => populated.includes(k)),
    [populated]);

  const distinctCat = useMemo(() => [...new Set(items.map((r) => r.company_category).filter(Boolean))].sort(), [items]);
  const distinctState = useMemo(() => [...new Set(items.map((r) => r.state).filter(Boolean))].sort(), [items]);
  const distinctAcct  = useMemo(() => [...new Set(items.map((r) => r.account_type).filter(Boolean))].sort(), [items]);
  const distinctClass = useMemo(() => [...new Set(items.map((r) => r.company_classification).filter(Boolean))].sort(), [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = items.filter((r) => {
      if (category && r.company_category !== category) return false;
      if (state && r.state !== state) return false;
      if (accountType && r.account_type !== accountType) return false;
      if (classification && r.company_classification !== classification) return false;
      if (archivedFilter === 'active'   && r.archived) return false;
      if (archivedFilter === 'archived' && !r.archived) return false;
      if (needle) {
        const hay = [r.company_id, r.company, r.phone, r.suburb, r.general_email,
                     r.company_category, r.company_classification]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      const va = a[sort.key]; const vb = b[sort.key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'boolean') return dir * ((va ? 1 : 0) - (vb ? 1 : 0));
      return dir * String(va).localeCompare(String(vb));
    });
    return out;
  }, [items, q, category, state, accountType, classification, archivedFilter, sort]);

  const cycleSort = (key) => {
    const next = sort.key !== key ? { key, dir: 'asc' } : { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    setSort(next); saveListSort('companies', next.key, next.dir);
  };
  const sortIndicator = (key) => sort.key !== key ? '' : (sort.dir === 'asc' ? '↑' : '↓');

  const gridTemplate = visibleCols.map((k) => (WIDTH[k] || 140) + 'px').join(' ') + ' 32px';

  return (
    <div data-testid="companies-tab">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search companies…"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
          data-testid="companies-search" />

        {/* Category chips — skip when <2 distinct. */}
        {distinctCat.length >= 2 && (
          <div className="flex items-center gap-1 border-l border-slate-200 pl-3">
            {distinctCat.map((c) => (
              <button key={c} onClick={() => setCategory(category === c ? '' : c)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${category === c ? 'bg-violet-100 text-violet-800 border-violet-200' : 'bg-white text-slate-600 border-slate-200'}`}>
                {c}
              </button>
            ))}
          </div>
        )}

        {/* State chips — skip when <2 distinct. */}
        {distinctState.length >= 2 && (
          <div className="flex items-center gap-1 border-l border-slate-200 pl-3">
            {distinctState.map((s) => (
              <button key={s} onClick={() => setState(state === s ? '' : s)}
                className={`px-2 py-1 rounded-full text-[11px] font-mono ${state === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Account Type — skip when <2. */}
        {distinctAcct.length >= 2 && (
          <select value={accountType} onChange={(e) => setAccountType(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white">
            <option value="">All account types</option>
            {distinctAcct.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}

        {/* Classification — skip when <2. */}
        {distinctClass.length >= 2 && (
          <select value={classification} onChange={(e) => setClassification(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white">
            <option value="">All classifications</option>
            {distinctClass.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}

        {/* Archived tri-state — always render. */}
        <div className="flex items-center rounded-full border border-slate-200 overflow-hidden" data-testid="companies-archived-toggle">
          {[
            { k: 'all', label: 'All' },
            { k: 'active', label: 'Active' },
            { k: 'archived', label: 'Archived' },
          ].map((opt) => {
            const active = archivedFilter === opt.k;
            return (
              <button key={opt.k} onClick={() => setArchivedFilter(opt.k)}
                data-testid={`companies-archived-${opt.k}`}
                className={`px-3 py-1 text-xs font-semibold ${active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-slate-500 ml-auto" data-testid="companies-count">
          {filtered.length} of {items.length} companies
        </div>

        {canWrite && crud.AddButton}
        {isAdmin && (
          <button onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50"
            data-testid="companies-import-open">
            Import from XLSX…
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 p-6">Loading companies…</div>
      ) : items.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-300 rounded-lg text-center">
          <p className="font-medium">No companies imported yet</p>
        </div>
      ) : (
        <MirrorScrollContainer>
          <div style={{ minWidth: 'max-content' }}>
            <div className="grid text-[11px] uppercase tracking-wider bg-slate-50 border-b border-slate-200 py-2 text-slate-600 font-semibold sticky top-0 z-20 gap-2 px-3"
              style={{ gridTemplateColumns: gridTemplate }}
              data-testid="companies-header">
              {visibleCols.map((col) => (
                <button key={col} className="text-left hover:text-slate-900"
                  onClick={() => cycleSort(col)}
                  data-testid={`companies-sort-${col}`}>
                  {LABEL[col] || col} {sortIndicator(col)}
                </button>
              ))}
              <div className="text-center">›</div>
            </div>

            <ul className="divide-y divide-slate-100" data-testid="companies-rows">
              {filtered.map((row) => {
                const isOpen = expanded === row.id;
                return (
                  <li key={row.id} className="bg-white relative" data-testid={`companies-row-${row.company_id}`}>
                    <button className={`w-full text-left grid items-start py-2.5 hover:bg-slate-50 gap-2 px-3 ${isOpen ? 'bg-slate-50' : ''}`}
                      style={{ gridTemplateColumns: gridTemplate }}
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                      aria-expanded={isOpen}>
                      {visibleCols.map((col) => (
                        <div key={col} className="pt-0.5">{renderCell(col, row[col])}</div>
                      ))}
                      <div className="text-center text-slate-400 text-xs pt-0.5">{isOpen ? '▾' : '▸'}</div>
                    </button>
                    {canWrite && (
                      <div className="absolute top-1 right-8 z-10 bg-white/95 rounded-md shadow-sm border border-slate-200"
                           data-testid={`ra-row-actions-${row.company_id}`}>
                        {crud.RowActions(row)}
                      </div>
                    )}
                    {isOpen && (
                      <div className="px-4 pb-4"><DetailPanel row={row} populated={populated} /></div>
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
