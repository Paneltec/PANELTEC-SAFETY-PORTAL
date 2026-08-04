// v160.3.9.16 — CS Incident (Issue List) reference-library tab.
// v160.3.9.25 — CRUD affordances via shared useCrudModal hook.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import useCrudModal from '../components/riskAssessments/useCrudModal';
import api from '../lib/api';
import { loadListSort, saveListSort } from '../lib/listSort';
import { formatDate, formatDateTime12, formatTime12 } from '../lib/timeFormat';
import { useCan } from '../lib/permissions';

// Contextual label overrides for columns with duplicate source headers.
const LABEL_OVERRIDES = {
  immediate_action:   'Immediate action (injury)',
  immediate_action_2: 'Immediate action (near-miss)',
  immediate_action_3: 'Immediate action (hazard)',
  location_2:         'Location',
  issue_number:       'Issue #',
  date_of_issue:      'Date of Issue',
  business_unit:      'Business unit',
  responsible_manager: 'Responsible',
  closeout_manager:   'Closeout',
  actual_incident_category: 'Actual severity',
  potential_incident_category: 'Potential severity',
};

// Default visible column keys (order matters). Everything else is
// available via "Show all populated columns".
const DEFAULT_VISIBLE = [
  'issue_number', 'issue_type', 'date_of_issue', 'business_unit',
  'status', 'identified_by', 'responsible_manager', 'description',
  'incident_categories', 'injury_severity',
  'actual_incident_category', 'potential_incident_category',
  'work_activity_performed', 'primary_hazard',
  'is_injury_near_miss', 'is_environmental_near_miss',
  'date_reported', 'employee_reporting',
];

const BOOL_FIELDS = new Set([
  'was_first_aid_provided', 'alert_generated',
  'is_injury_near_miss', 'is_environmental_near_miss',
  'is_plant_near_miss', 'is_other_near_miss',
  'erosion_and_sediment', 'land_contamination', 'spill_recovered',
  'contaminated_material_remediated', 'water_contamination_discharge',
  'recovered', 'contaminant_remediated', 'flora_affected',
  'fauna_affected', 'solid_or_other_waste_effects',
  'archaeological_or_cultural', 'indigenous', 'known_site',
]);
const DATE_FIELDS = new Set(['date_of_issue', 'date_preapproved', 'date_reviewed']);
const DATETIME_FIELDS = new Set(['date_closed', 'date_of_entry', 'date_reported']);
const TIME_FIELDS = new Set(['time_of_issue']);
const NUMERIC_FIELDS = new Set(['issue_number', 'shift_length', 'hours_into_shift']);
const LONG_TEXT_FIELDS = new Set([
  'description', 'hazard_description', 'immediate_action',
  'immediate_action_2', 'immediate_action_3', 'first_aid_description',
  'near_miss_description', 'plant_description', 'property_description',
  'other_description',
]);

function labelFor(key) {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function BoolPill({ value }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-100 text-emerald-800">
        <span aria-hidden="true">✓</span> Yes
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-600">
        <span aria-hidden="true">—</span> No
      </span>
    );
  }
  return <span className="text-slate-300 text-xs">—</span>;
}

function renderCell(key, value) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-slate-300 text-xs">—</span>;
  }
  if (BOOL_FIELDS.has(key)) return <BoolPill value={value} />;
  if (DATE_FIELDS.has(key)) return <span className="text-xs text-slate-700">{formatDate(new Date(value)) || value}</span>;
  if (DATETIME_FIELDS.has(key)) return <span className="text-xs text-slate-700">{formatDateTime12(value) || value}</span>;
  if (TIME_FIELDS.has(key)) return <span className="text-xs text-slate-700">{formatTime12(value) || value}</span>;
  if (NUMERIC_FIELDS.has(key)) return <span className="font-mono text-xs text-slate-700">{value}</span>;
  if (LONG_TEXT_FIELDS.has(key)) {
    return (
      <div className="text-xs text-slate-800 line-clamp-2 leading-snug" title={String(value)}>
        {String(value)}
      </div>
    );
  }
  return <span className="text-xs text-slate-800" title={String(value)}>{String(value)}</span>;
}

function DetailPanel({ row, populatedCols }) {
  // Show every populated field for this specific row.
  const entries = populatedCols.filter((k) => row[k] !== undefined && row[k] !== null && row[k] !== '');
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 p-4 rounded-lg border border-slate-200 bg-slate-50/60"
      data-testid={`cs-incident-detail-${row.issue_number}`}>
      {entries.map((k) => (
        <div key={k} className={LONG_TEXT_FIELDS.has(k) ? 'md:col-span-2' : ''}>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{labelFor(k)}</div>
          <div className="text-sm text-slate-800 whitespace-pre-line">
            {BOOL_FIELDS.has(k)
              ? <BoolPill value={row[k]} />
              : DATE_FIELDS.has(k) ? (formatDate(new Date(row[k])) || row[k])
              : DATETIME_FIELDS.has(k) ? (formatDateTime12(row[k]) || row[k])
              : TIME_FIELDS.has(k) ? (formatTime12(row[k]) || row[k])
              : String(row[k])}
          </div>
        </div>
      ))}
    </div>
  );
}

function MirrorScrollContainer({ children, maxHeight = '68vh' }) {
  const topRef = useRef(null);
  const bodyRef = useRef(null);
  const spacerRef = useRef(null);
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
    const onTop = () => { if (lock) return; lock = true; body.scrollLeft = top.scrollLeft; lock = false; };
    body.addEventListener('scroll', onBody, { passive: true });
    top.addEventListener('scroll', onTop, { passive: true });
    return () => { body.removeEventListener('scroll', onBody); top.removeEventListener('scroll', onTop); };
  }, []);
  return (
    <div className="relative" data-testid="cs-incident-scroll-wrap">
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

function widthFor(key) {
  if (key === 'issue_number') return 70;
  if (NUMERIC_FIELDS.has(key)) return 90;
  if (BOOL_FIELDS.has(key)) return 100;
  if (DATE_FIELDS.has(key)) return 110;
  if (DATETIME_FIELDS.has(key) || TIME_FIELDS.has(key)) return 160;
  if (LONG_TEXT_FIELDS.has(key)) return 280;
  return 160;
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
      let resp;
      const fd = new FormData();
      if (file) { fd.append('file', file); resp = await api.post('/cs-incident/reimport', fd); }
      else if (url.trim()) { fd.append('url', url.trim()); resp = await api.post('/cs-incident/reimport', fd); }
      else { setMsg('Provide a file OR a URL.'); setBusy(false); return; }
      setMsg(`Imported → new: ${resp.data.inserted}, updated: ${resp.data.updated}, unchanged: ${resp.data.unchanged}. Live rows: ${resp.data.live_total}.`);
      onDone();
    } catch (e) { setMsg(`Failed: ${e?.response?.data?.detail || e?.message}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="cs-incident-import-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-semibold">Import CS Incident from XLSX</h3>
          <button onClick={onClose} className="text-slate-400" aria-label="Close">×</button>
        </div>
        <label className="block text-sm font-medium mb-1">Upload .xlsx</label>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-100"
          data-testid="cs-incident-import-file" />
        <div className="my-3 text-center text-xs uppercase text-slate-400">or</div>
        <label className="block text-sm font-medium mb-1">Paste URL</label>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" data-testid="cs-incident-import-url" />
        {msg && <div className="mt-3 text-sm">{msg}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-slate-300">Close</button>
          <button onClick={submit} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white disabled:opacity-50" data-testid="cs-incident-import-submit">
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CsIncidentTab({ user }) {
  const [items, setItems] = useState([]);
  const [populated, setPopulated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [status, setStatus] = useState('');
  const [issueType, setIssueType] = useState('');
  const [showAll, setShowAll] = useState(() => localStorage.getItem('paneltec_cs_incident_show_all') === '1');
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState(() => loadListSort('cs_incident', { key: 'date_of_issue', dir: 'desc' }));
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
      api.get('/cs-incident/', { params: { limit: 1000 } }),
      api.get('/cs-incident/columns'),
    ]).then(([listResp, colsResp]) => {
      setItems(listResp.data.items || []);
      setPopulated(colsResp.data.populated || []);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const crud = useCrudModal({ tabKey: 'cs_incident', isAdmin: canWrite, onRefresh: load });

  const visibleCols = useMemo(() => {
    if (showAll) return populated.filter((k) => k !== 'issue_number').length
      ? ['issue_number', ...populated.filter((k) => k !== 'issue_number')]
      : populated;
    return DEFAULT_VISIBLE.filter((k) => populated.includes(k));
  }, [populated, showAll]);

  const distinctVals = useMemo(() => {
    const bu = new Set(); const st = new Set(); const it = new Set();
    items.forEach((r) => {
      if (r.business_unit) bu.add(r.business_unit);
      if (r.status) st.add(r.status);
      if (r.issue_type) it.add(r.issue_type);
    });
    return {
      business_unit: [...bu].sort(),
      status: [...st].sort(),
      issue_type: [...it].sort(),
    };
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = items.filter((r) => {
      if (businessUnit && r.business_unit !== businessUnit) return false;
      if (status && r.status !== status) return false;
      if (issueType && r.issue_type !== issueType) return false;
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
      if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb);
      return dir * String(va).localeCompare(String(vb));
    });
    return out;
  }, [items, q, businessUnit, status, issueType, sort]);

  const cycleSort = (key) => {
    const next = sort.key !== key ? { key, dir: 'asc' } : { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    setSort(next); saveListSort('cs_incident', next.key, next.dir);
  };
  const sortIndicator = (key) => sort.key !== key ? '' : (sort.dir === 'asc' ? '↑' : '↓');

  const toggleShowAll = () => {
    const next = !showAll;
    setShowAll(next);
    localStorage.setItem('paneltec_cs_incident_show_all', next ? '1' : '0');
  };

  const gridTemplate = visibleCols.map((k) => widthFor(k) + 'px').join(' ') + ' 32px';

  return (
    <div data-testid="cs-incident-tab">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search incidents…"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
          data-testid="cs-incident-search" />

        <select value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
          data-testid="cs-incident-bu-select">
          <option value="">All business units</option>
          {distinctVals.business_unit.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>

        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
          data-testid="cs-incident-status-select">
          <option value="">All statuses</option>
          {distinctVals.status.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>

        <select value={issueType} onChange={(e) => setIssueType(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
          data-testid="cs-incident-type-select">
          <option value="">All issue types</option>
          {distinctVals.issue_type.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>

        <label className="flex items-center gap-1.5 text-xs text-slate-700 ml-2">
          <input type="checkbox" checked={showAll} onChange={toggleShowAll}
            data-testid="cs-incident-show-all-toggle" />
          Show all populated columns ({populated.length})
        </label>

        <div className="text-xs text-slate-500 ml-auto" data-testid="cs-incident-count">
          {filtered.length} of {items.length} incidents
        </div>

        {canWrite && crud.AddButton}
        {isAdmin && (
          <button onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50"
            data-testid="cs-incident-import-open">
            Import from XLSX…
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 p-6">Loading incidents…</div>
      ) : items.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-300 rounded-lg text-center">
          <p className="font-medium">No CS Incident issues imported yet</p>
        </div>
      ) : (
        <MirrorScrollContainer>
          <div style={{ minWidth: 'max-content' }}>
            <div className="grid text-[11px] uppercase tracking-wider bg-slate-50 border-b border-slate-200 py-2 text-slate-600 font-semibold sticky top-0 z-20 gap-2 px-3"
              style={{ gridTemplateColumns: gridTemplate }}
              data-testid="cs-incident-header">
              {visibleCols.map((col) => (
                <button key={col} className="text-left hover:text-slate-900"
                  onClick={() => cycleSort(col)}
                  data-testid={`cs-incident-sort-${col}`}>
                  {labelFor(col)} {sortIndicator(col)}
                </button>
              ))}
              <div className="text-center">›</div>
            </div>

            <ul className="divide-y divide-slate-100" data-testid="cs-incident-rows">
              {filtered.map((row) => {
                const isOpen = expanded === row.id;
                return (
                  <li key={row.id} className="bg-white relative" data-testid={`cs-incident-row-${row.issue_number}`}>
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
                           data-testid={`ra-row-actions-${row.issue_number}`}>
                        {crud.RowActions(row)}
                      </div>
                    )}
                    {isOpen && (
                      <div className="px-4 pb-4">
                        <DetailPanel row={row} populatedCols={populated} />
                      </div>
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
