// v160.3.9.15 — Incident Root Causes reference library tab.
// v160.3.9.25 — CRUD affordances via shared useCrudModal hook.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import useCrudModal from '../components/riskAssessments/useCrudModal';
import api from '../lib/api';
import { loadListSort, saveListSort } from '../lib/listSort';
import { useCan } from '../lib/permissions';

function BoolPill({ value, testid }) {
  if (value === true) {
    return (
      <span data-testid={testid}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-100 text-emerald-800">
        <span aria-hidden="true">✓</span> Yes
      </span>
    );
  }
  return (
    <span data-testid={testid}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-600">
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
        resp = await api.post('/incident-root-causes/reimport', fd);
      } else if (url.trim()) {
        const fd = new FormData();
        fd.append('url', url.trim());
        resp = await api.post('/incident-root-causes/reimport', fd);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="irc-import-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Import Incident Root Causes from XLSX</h3>
            <p className="text-sm text-slate-500 mt-1">Existing rows matched by <code>question_id</code>. Changed rows update; new rows insert; unchanged rows skip.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="irc-import-close" aria-label="Close">×</button>
        </div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Upload .xlsx file</label>
        <input type="file" accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          data-testid="irc-import-file" />
        <div className="my-3 text-center text-xs uppercase tracking-wide text-slate-400">or</div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Paste XLSX URL</label>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/incident_root_causes.xlsx"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          data-testid="irc-import-url" />
        {msg && <div className="mt-3 text-sm text-slate-700" data-testid="irc-import-msg">{msg}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50" data-testid="irc-import-cancel">Close</button>
          <button onClick={submit} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            data-testid="irc-import-submit">
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ row, onJumpToParent }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 p-4 rounded-lg border border-slate-200 bg-slate-50/60"
      data-testid={`irc-detail-${row.question_id}`}>
      <div className="md:col-span-2 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-slate-500">Question ID:</span>
        <span className="font-mono text-sm text-slate-800">{row.question_id}</span>
        <span className="text-xs text-slate-500 ml-3">Has action:</span>
        <BoolPill value={row.has_action} testid={`irc-detail-has-action-${row.question_id}`} />
        {row.parent_question_id && (
          <>
            <span className="text-xs text-slate-500 ml-3">Parent:</span>
            <button
              className="font-mono text-sm text-blue-700 hover:text-blue-900 underline underline-offset-2"
              onClick={() => onJumpToParent(row.parent_question_id)}
              data-testid={`irc-detail-parent-${row.question_id}`}
            >
              {row.parent_question_id}
            </button>
          </>
        )}
      </div>
      <div className="md:col-span-2">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Description</div>
        <div className="text-sm text-slate-800 whitespace-pre-line">
          {row.description || <span className="italic text-slate-400">not provided</span>}
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Contributing factor</div>
        <div className="text-sm text-slate-800">
          {row.contributing_factor
            ? <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-100 text-violet-800 text-xs font-medium">{row.contributing_factor}</span>
            : <span className="italic text-slate-400">not provided</span>}
        </div>
      </div>
    </div>
  );
}

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
    <div className="relative" data-testid="irc-scroll-wrap">
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

const COLUMNS = [
  { key: 'question_id',         label: 'Question ID',        width: 120, sortable: true,  kind: 'qid' },
  { key: 'description',         label: 'Description',        width: 360, sortable: false },
  { key: 'contributing_factor', label: 'Contributing factor', width: 200, sortable: true,  kind: 'cf' },
  { key: 'parent_question_id',  label: 'Parent QID',         width: 120, sortable: false, kind: 'parent' },
  { key: 'has_action',          label: 'Has action',         width: 90,  sortable: true,  kind: 'bool' },
];
const GRID_TEMPLATE = COLUMNS.map((c) => c.width + 'px').join(' ') + ' 32px';

// Compare question IDs like "1.02" numerically-then-lexically so
// "1.02" < "2" < "10" instead of the naive string ordering.
function qidSortKey(v) {
  const parts = String(v || '').split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? [0, n] : [1, p];
  });
  return parts;
}
function cmpQid(a, b) {
  const ka = qidSortKey(a); const kb = qidSortKey(b);
  const len = Math.max(ka.length, kb.length);
  for (let i = 0; i < len; i++) {
    const pa = ka[i] || [0, 0];
    const pb = kb[i] || [0, 0];
    if (pa[0] !== pb[0]) return pa[0] - pb[0];
    if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1;
  }
  return 0;
}

export default function IncidentRootCausesTab({ user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [selectedFactors, setSelectedFactors] = useState(() => new Set());
  const [hasActionFilter, setHasActionFilter] = useState('any'); // 'any' | 'yes' | 'no'
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState(() => loadListSort('incident_root_causes', { key: 'question_id', dir: 'asc' }));
  const [importOpen, setImportOpen] = useState(false);

  // v160.3.9.29-2b — reference_library gate migration (see CompaniesTab for pattern).
  const can = useCan();
  const canWrite = can('reference_library', 'edit');
  const canDelete = can('reference_library', 'delete');
  const isAdmin = canWrite;
  void user;

  const load = () => {
    setLoading(true);
    api.get('/incident-root-causes/', { params: { limit: 1000 } })
      .then((r) => setItems(r.data.items || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const crud = useCrudModal({ tabKey: 'incident_root_causes', isAdmin: canWrite, onRefresh: load });

  const factorsList = useMemo(() => {
    const s = new Set();
    items.forEach((r) => { if (r.contributing_factor) s.add(r.contributing_factor); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = items.filter((r) => {
      if (selectedFactors.size > 0 && !selectedFactors.has(r.contributing_factor)) return false;
      if (hasActionFilter === 'yes' && !r.has_action) return false;
      if (hasActionFilter === 'no'  &&  r.has_action) return false;
      if (needle) {
        const hay = [r.question_id, r.description, r.contributing_factor, r.parent_question_id]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      if (sort.key === 'question_id') return dir * cmpQid(a.question_id, b.question_id);
      if (sort.key === 'has_action') {
        const va = a.has_action ? 0 : 1;
        const vb = b.has_action ? 0 : 1;
        return dir * (va - vb);
      }
      const va = (a[sort.key] || '').toString().toLowerCase();
      const vb = (b[sort.key] || '').toString().toLowerCase();
      return dir * va.localeCompare(vb);
    });
    return out;
  }, [items, q, selectedFactors, hasActionFilter, sort]);

  const cycleSort = (key) => {
    const next = sort.key !== key ? { key, dir: 'asc' }
                                  : { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    setSort(next);
    saveListSort('incident_root_causes', next.key, next.dir);
  };
  const sortIndicator = (key) => sort.key !== key ? '' : (sort.dir === 'asc' ? '↑' : '↓');

  const toggleFactor = (f) => {
    const next = new Set(selectedFactors);
    if (next.has(f)) next.delete(f); else next.add(f);
    setSelectedFactors(next);
  };

  // Handler passed into DetailPanel — expand and scroll to the parent row.
  const jumpToParent = (parentQid) => {
    const parent = items.find((x) => x.question_id === parentQid);
    if (!parent) return;
    setExpanded(parent.id);
    setTimeout(() => {
      const el = document.querySelector(`[data-testid="irc-row-${CSS.escape(parentQid)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30);
  };

  return (
    <div data-testid="irc-tab">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search root causes…"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          data-testid="irc-search" />

        {/* Has-action tri-state */}
        <div className="flex items-center rounded-full border border-slate-200 overflow-hidden" data-testid="irc-hasaction-toggle">
          {[
            { k: 'any', label: 'Any' },
            { k: 'yes', label: 'Yes' },
            { k: 'no',  label: 'No'  },
          ].map((opt) => {
            const active = hasActionFilter === opt.k;
            return (
              <button key={opt.k}
                onClick={() => setHasActionFilter(opt.k)}
                data-testid={`irc-hasaction-${opt.k}`}
                className={`px-3 py-1 text-xs font-semibold transition ${active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                title={`Has action: ${opt.label}`}>
                {opt.label}
              </button>
            );
          })}
        </div>

        <details className="relative" data-testid="irc-factor-multiselect">
          <summary className="list-none cursor-pointer px-3 py-2 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 select-none">
            Contributing factor {selectedFactors.size > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] font-bold">{selectedFactors.size}</span>
            )}
          </summary>
          <div className="absolute z-30 mt-2 w-72 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg p-2">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Filter by factor</span>
              {selectedFactors.size > 0 && (
                <button onClick={() => setSelectedFactors(new Set())}
                  className="text-[11px] text-blue-600 hover:text-blue-800"
                  data-testid="irc-factor-clear">Clear</button>
              )}
            </div>
            {factorsList.length === 0 && <div className="text-xs text-slate-500 px-1 py-2">No factors available</div>}
            {factorsList.map((f) => (
              <label key={f} className="flex items-start gap-2 px-1 py-1 text-xs hover:bg-slate-50 rounded cursor-pointer">
                <input type="checkbox" checked={selectedFactors.has(f)} onChange={() => toggleFactor(f)}
                  data-testid={`irc-factor-${f.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)}`} />
                <span className="text-slate-800">{f}</span>
              </label>
            ))}
          </div>
        </details>

        <div className="text-xs text-slate-500 ml-auto" data-testid="irc-count">
          {filtered.length} of {items.length} root causes
        </div>

        {canWrite && crud.AddButton}
        {isAdmin && (
          <button onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            data-testid="irc-import-open">
            Import from XLSX…
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-slate-500 p-6" data-testid="irc-loading">Loading root causes…</div>
      ) : items.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-300 rounded-lg text-center" data-testid="irc-empty">
          <p className="text-slate-700 font-medium">No incident root causes imported yet</p>
          <p className="text-slate-500 text-sm mt-1">
            {isAdmin ? 'Use "Import from XLSX" above to load the reference library.'
                     : 'Ask an admin to import the root causes reference library.'}
          </p>
        </div>
      ) : (
        <MirrorScrollContainer>
          <div style={{ minWidth: 'max-content' }}>
            <div className="grid text-[11px] uppercase tracking-wider bg-slate-50 border-b border-slate-200 py-2 text-slate-600 font-semibold sticky top-0 z-20 gap-2 px-3"
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
              data-testid="irc-header">
              {COLUMNS.map((col) => (
                col.sortable ? (
                  <button key={col.key} className="text-left hover:text-slate-900"
                    onClick={() => cycleSort(col.key)}
                    data-testid={`irc-sort-${col.key}`}>
                    {col.label} {sortIndicator(col.key)}
                  </button>
                ) : (
                  <div key={col.key} className="text-left">{col.label}</div>
                )
              ))}
              <div className="text-center">›</div>
            </div>

            <ul className="divide-y divide-slate-100" data-testid="irc-rows">
              {filtered.map((row) => {
                const isOpen = expanded === row.id;
                return (
                  <li key={row.id} className="bg-white relative" data-testid={`irc-row-${row.question_id}`}>
                    <button
                      className={`w-full text-left grid items-start py-2.5 hover:bg-slate-50 transition gap-2 px-3 ${isOpen ? 'bg-slate-50' : ''}`}
                      style={{ gridTemplateColumns: GRID_TEMPLATE }}
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                      aria-expanded={isOpen}>
                      {COLUMNS.map((col) => {
                        if (col.kind === 'qid') {
                          return <div key={col.key} className="font-mono text-xs text-slate-700 pt-0.5">{row.question_id}</div>;
                        }
                        if (col.kind === 'parent') {
                          return (
                            <div key={col.key} className="font-mono text-xs text-slate-500 pt-0.5">
                              {row.parent_question_id || <span className="text-slate-300">—</span>}
                            </div>
                          );
                        }
                        if (col.kind === 'bool') {
                          return <div key={col.key} className="pt-0.5"><BoolPill value={row.has_action} testid={`irc-has-action-${row.question_id}`} /></div>;
                        }
                        if (col.kind === 'cf') {
                          return (
                            <div key={col.key} className="pt-0.5">
                              {row.contributing_factor
                                ? <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-100 text-violet-800 text-[11px] font-medium leading-tight">{row.contributing_factor}</span>
                                : <span className="italic text-slate-400 text-xs">—</span>}
                            </div>
                          );
                        }
                        const v = row[col.key];
                        return (
                          <div key={col.key}
                            className="text-xs text-slate-800 line-clamp-2 leading-snug"
                            title={v || ''}>
                            {v || <span className="italic text-slate-400">—</span>}
                          </div>
                        );
                      })}
                      <div className="text-center text-slate-400 text-xs pt-0.5">{isOpen ? '▾' : '▸'}</div>
                    </button>
                    {canWrite && (
                      <div className="absolute top-1 right-8 z-10 bg-white/95 rounded-md shadow-sm border border-slate-200"
                           data-testid={`ra-row-actions-${row.question_id}`}>
                        {crud.RowActions(row)}
                      </div>
                    )}
                    {isOpen && (
                      <div className="px-4 pb-4"><DetailPanel row={row} onJumpToParent={jumpToParent} /></div>
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
