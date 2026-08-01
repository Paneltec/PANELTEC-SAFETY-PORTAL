// v160.3.9.18 — My Completed Training reference-library tab.
// Sparse-schema pattern (CS Incident v16): visible columns come from
// /completed-training/columns metadata so empty columns stay hidden
// until a future import populates them.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../lib/api';
import { loadListSort, saveListSort } from '../lib/listSort';
import { formatDate, formatDateTime12 } from '../lib/timeFormat';

const LABEL = {
  competency: 'Competency', issue_date: 'Issue date',
  expiry_date: 'Expiry date', business_unit: 'Business unit',
  created_by: 'Created by', licence_number: 'Licence #',
  card_number: 'Card #', certificate_number: 'Certificate #',
  issuer: 'Issuer', notes: 'Notes',
  date_entered: 'Date entered', description: 'Description',
};
const WIDTH = {
  competency: 200, issue_date: 110, expiry_date: 120,
  business_unit: 130, created_by: 140, licence_number: 110,
  card_number: 110, certificate_number: 130, issuer: 160,
  notes: 200, date_entered: 150, description: 240,
};
const COLUMN_ORDER = [
  'competency', 'issue_date', 'expiry_date', 'business_unit',
  'created_by', 'licence_number', 'card_number', 'certificate_number',
  'issuer', 'notes', 'date_entered', 'description',
];
const DATE_FIELDS = new Set(['issue_date', 'expiry_date']);
const DATETIME_FIELDS = new Set(['date_entered']);
const LONG_TEXT = new Set(['notes', 'description']);

// Expiry status per user's colour rules.
function expiryStatus(iso) {
  if (!iso) return { key: 'blank', label: '—', cls: 'text-slate-300' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { key: 'blank', label: '—', cls: 'text-slate-300' };
  const now = new Date();
  const diffDays = Math.round((d - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0)   return { key: 'expired',  cls: 'bg-rose-100 text-rose-800' };
  if (diffDays <= 60) return { key: 'expiring', cls: 'bg-amber-100 text-amber-800' };
  return { key: 'current', cls: 'bg-emerald-100 text-emerald-800' };
}

function ExpiryPill({ value, testid }) {
  const s = expiryStatus(value);
  if (s.key === 'blank') return <span className={s.cls} data-testid={testid}>—</span>;
  const text = formatDate(new Date(value)) || value;
  return (
    <span data-testid={testid}
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${s.cls}`}>
      {text}
    </span>
  );
}

function renderCell(key, value) {
  if (value == null || value === '') return <span className="text-slate-300 text-xs">—</span>;
  if (key === 'expiry_date') return <ExpiryPill value={value} />;
  if (DATE_FIELDS.has(key)) return <span className="text-xs text-slate-700">{formatDate(new Date(value)) || value}</span>;
  if (DATETIME_FIELDS.has(key)) return <span className="text-xs text-slate-700">{formatDateTime12(value) || value}</span>;
  if (LONG_TEXT.has(key)) {
    return <div className="text-xs text-slate-800 line-clamp-2 leading-snug" title={value}>{value}</div>;
  }
  return <span className="text-xs text-slate-800" title={value}>{value}</span>;
}

function DetailPanel({ row, populated }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 p-4 rounded-lg border border-slate-200 bg-slate-50/60"
      data-testid={`ct-detail-${row.id}`}>
      {populated.map((k) => (
        row[k] == null || row[k] === '' ? null : (
          <div key={k} className={LONG_TEXT.has(k) ? 'md:col-span-2' : ''}>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{LABEL[k] || k}</div>
            <div className="text-sm text-slate-800 whitespace-pre-line">
              {k === 'expiry_date' ? <ExpiryPill value={row[k]} />
                : DATE_FIELDS.has(k) ? (formatDate(new Date(row[k])) || row[k])
                : DATETIME_FIELDS.has(k) ? (formatDateTime12(row[k]) || row[k])
                : String(row[k])}
            </div>
          </div>
        )
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
    <div className="relative" data-testid="ct-scroll-wrap">
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
      if (file) { fd.append('file', file); resp = await api.post('/completed-training/reimport', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
      else if (url.trim()) { fd.append('url', url.trim()); resp = await api.post('/completed-training/reimport', fd); }
      else { setMsg('Provide a file OR a URL.'); setBusy(false); return; }
      setMsg(`Imported → new: ${resp.data.inserted}, unchanged: ${resp.data.unchanged}. Live rows: ${resp.data.live_total}.`);
      onDone();
    } catch (e) { setMsg(`Failed: ${e?.response?.data?.detail || e?.message}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="ct-import-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-semibold">Import Completed Training from XLSX</h3>
          <button onClick={onClose} className="text-slate-400" aria-label="Close">×</button>
        </div>
        <label className="block text-sm font-medium mb-1">Upload .xlsx</label>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-100"
          data-testid="ct-import-file" />
        <div className="my-3 text-center text-xs uppercase text-slate-400">or</div>
        <label className="block text-sm font-medium mb-1">Paste URL</label>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" data-testid="ct-import-url" />
        {msg && <div className="mt-3 text-sm">{msg}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-slate-300">Close</button>
          <button onClick={submit} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white disabled:opacity-50" data-testid="ct-import-submit">
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CompletedTrainingTab({ user }) {
  const [items, setItems] = useState([]);
  const [populated, setPopulated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [issuer, setIssuer] = useState('');
  const [expiryStatusFilter, setExpiryStatusFilter] = useState('all'); // all|current|expiring|expired
  const [issueAfter, setIssueAfter] = useState('');
  const [issueBefore, setIssueBefore] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState(() => loadListSort('completed_training', { key: 'expiry_date', dir: 'asc' }));
  const [importOpen, setImportOpen] = useState(false);
  const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/completed-training/', { params: { limit: 1000 } }),
      api.get('/completed-training/columns'),
    ]).then(([listResp, colsResp]) => {
      setItems(listResp.data.items || []);
      setPopulated(colsResp.data.populated || []);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const visibleCols = useMemo(
    () => COLUMN_ORDER.filter((k) => populated.includes(k)),
    [populated],
  );

  const distinctBU  = useMemo(() => [...new Set(items.map((r) => r.business_unit).filter(Boolean))].sort(), [items]);
  const distinctIss = useMemo(() => [...new Set(items.map((r) => r.issuer).filter(Boolean))].sort(), [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = items.filter((r) => {
      if (businessUnit && r.business_unit !== businessUnit) return false;
      if (issuer && r.issuer !== issuer) return false;
      if (expiryStatusFilter !== 'all') {
        const s = expiryStatus(r.expiry_date).key;
        if (s !== expiryStatusFilter) return false;
      }
      if (issueAfter && r.issue_date && r.issue_date < issueAfter) return false;
      if (issueBefore && r.issue_date && r.issue_date > issueBefore) return false;
      if (needle) {
        const hay = Object.values(r).filter((v) => typeof v === 'string').join(' ').toLowerCase();
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
      return dir * String(va).localeCompare(String(vb));
    });
    return out;
  }, [items, q, businessUnit, issuer, expiryStatusFilter, issueAfter, issueBefore, sort]);

  const cycleSort = (key) => {
    const next = sort.key !== key ? { key, dir: 'asc' } : { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    setSort(next); saveListSort('completed_training', next.key, next.dir);
  };
  const sortIndicator = (key) => sort.key !== key ? '' : (sort.dir === 'asc' ? '↑' : '↓');

  const gridTemplate = visibleCols.map((k) => (WIDTH[k] || 140) + 'px').join(' ') + ' 32px';

  return (
    <div data-testid="ct-tab">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search training…"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
          data-testid="ct-search" />

        {/* Business unit chips — auto-skip when <2 distinct values. */}
        {distinctBU.length >= 2 && (
          <div className="flex items-center gap-1 border-l border-slate-200 pl-3" data-testid="ct-bu-chips">
            {distinctBU.map((bu) => (
              <button key={bu} onClick={() => setBusinessUnit(businessUnit === bu ? '' : bu)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${businessUnit === bu ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-white text-slate-600 border-slate-200'}`}
                data-testid={`ct-bu-${bu.replace(/\s+/g, '-').toLowerCase()}`}>
                {bu}
              </button>
            ))}
          </div>
        )}

        {/* Issuer multi-select — auto-hide when 0 distinct values. */}
        {distinctIss.length >= 1 && (
          <select value={issuer} onChange={(e) => setIssuer(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
            data-testid="ct-issuer-select">
            <option value="">All issuers</option>
            {distinctIss.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}

        {/* Expiry status tri-state (four states — user said tri-state but
            expiry has 4 buckets; render as 4 buttons). */}
        <div className="flex items-center rounded-full border border-slate-200 overflow-hidden" data-testid="ct-expiry-toggle">
          {[
            { k: 'all', label: 'All' },
            { k: 'current', label: 'Current', cls: 'text-emerald-700' },
            { k: 'expiring', label: 'Expiring', cls: 'text-amber-700' },
            { k: 'expired', label: 'Expired', cls: 'text-rose-700' },
          ].map((opt) => {
            const active = expiryStatusFilter === opt.k;
            return (
              <button key={opt.k}
                onClick={() => setExpiryStatusFilter(opt.k)}
                data-testid={`ct-expiry-${opt.k}`}
                className={`px-3 py-1 text-xs font-semibold transition ${active ? 'bg-slate-900 text-white' : `bg-white ${opt.cls || 'text-slate-600'} hover:bg-slate-50`}`}>
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Issue date range */}
        <div className="flex items-center gap-1 border-l border-slate-200 pl-3 text-xs text-slate-600">
          <span>Issue</span>
          <input type="date" value={issueAfter} onChange={(e) => setIssueAfter(e.target.value)}
            className="rounded-md border border-slate-300 px-1 py-1 text-xs"
            data-testid="ct-issue-after" />
          <span>–</span>
          <input type="date" value={issueBefore} onChange={(e) => setIssueBefore(e.target.value)}
            className="rounded-md border border-slate-300 px-1 py-1 text-xs"
            data-testid="ct-issue-before" />
        </div>

        <div className="text-xs text-slate-500 ml-auto" data-testid="ct-count">
          {filtered.length} of {items.length} certificates
        </div>

        {isAdmin && (
          <button onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50"
            data-testid="ct-import-open">
            Import from XLSX…
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 p-6">Loading training records…</div>
      ) : items.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-300 rounded-lg text-center">
          <p className="font-medium">No completed training imported yet</p>
        </div>
      ) : (
        <MirrorScrollContainer>
          <div style={{ minWidth: 'max-content' }}>
            <div className="grid text-[11px] uppercase tracking-wider bg-slate-50 border-b border-slate-200 py-2 text-slate-600 font-semibold sticky top-0 z-20 gap-2 px-3"
              style={{ gridTemplateColumns: gridTemplate }}
              data-testid="ct-header">
              {visibleCols.map((col) => (
                <button key={col} className="text-left hover:text-slate-900"
                  onClick={() => cycleSort(col)}
                  data-testid={`ct-sort-${col}`}>
                  {LABEL[col] || col} {sortIndicator(col)}
                </button>
              ))}
              <div className="text-center">›</div>
            </div>

            <ul className="divide-y divide-slate-100" data-testid="ct-rows">
              {filtered.map((row) => {
                const isOpen = expanded === row.id;
                return (
                  <li key={row.id} className="bg-white" data-testid={`ct-row-${row.id}`}>
                    <button className={`w-full text-left grid items-start py-2.5 hover:bg-slate-50 gap-2 px-3 ${isOpen ? 'bg-slate-50' : ''}`}
                      style={{ gridTemplateColumns: gridTemplate }}
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                      aria-expanded={isOpen}>
                      {visibleCols.map((col) => (
                        <div key={col} className="pt-0.5">{renderCell(col, row[col])}</div>
                      ))}
                      <div className="text-center text-slate-400 text-xs pt-0.5">{isOpen ? '▾' : '▸'}</div>
                    </button>
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
    </div>
  );
}
