// v160.3.9.13 — Master Risks reference library tab.
//
// Read-only table for all users; admins get an "Import from XLSX" affordance
// and inline edit/delete (edit UI deferred — this ticket ships the list +
// import; row-level editing lives behind the /api/master-risks PATCH which
// is already wired backend-side).
//
// Design notes:
//   · Search + severity chips + classification dropdown all client-side so
//     the ~168-row dataset never round-trips.
//   · Severity pill background uses the XLSX-supplied `fill_hex` (preserves
//     the source's colour language) with a Tailwind fallback per severity.
//   · Text colour on the pill is auto-picked from the fill's luminance so
//     yellow fills stay readable.
//   · Sort persisted per browser via `paneltec_list_sort:master_risks`.
//
// Frontend consumer is `RiskAssessments.jsx` (mounted as a tab).
import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { loadListSort, saveListSort } from '../lib/listSort';

const SEVERITY_ORDER = ['extreme', 'high', 'medium', 'low'];
const SEVERITY_LABEL = {
  extreme: 'Extreme', high: 'High', medium: 'Medium', low: 'Low',
};
// Tailwind fallback if the XLSX row didn't carry a fill.
const SEVERITY_FALLBACK = {
  extreme: { bg: '#FEE2E2', fg: '#991B1B' },  // rose-100 / rose-800
  high:    { bg: '#FEF3C7', fg: '#92400E' },  // amber-100 / amber-800
  medium:  { bg: '#FEF9C3', fg: '#854D0E' },  // yellow-100 / yellow-800
  low:     { bg: '#D1FAE5', fg: '#065F46' },  // emerald-100 / emerald-800
  _null:   { bg: '#F1F5F9', fg: '#334155' },  // slate-100 / slate-700
};

// Pick a readable text colour (black or white) for a given hex background
// using the standard sRGB relative-luminance formula.
function readableTextOn(hex) {
  if (!hex || typeof hex !== 'string') return '#0F172A';
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#0F172A';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  // Perceptual luminance (Rec. 709).
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#0F172A' : '#FFFFFF';
}

function severityStyle(row) {
  if (row.fill_hex) {
    return { bg: row.fill_hex, fg: readableTextOn(row.fill_hex) };
  }
  const fb = SEVERITY_FALLBACK[row.severity] || SEVERITY_FALLBACK._null;
  return { bg: fb.bg, fg: fb.fg };
}

function SeverityPill({ row, testid, showScore = true }) {
  const s = severityStyle(row);
  return (
    <span
      data-testid={testid}
      className="inline-flex items-center px-2 py-0.5 rounded-md font-mono text-xs font-semibold"
      style={{ backgroundColor: s.bg, color: s.fg }}
      title={SEVERITY_LABEL[row.severity] || row.severity || 'Unclassified'}
    >
      {showScore ? (row.risk_score_uncontrolled || row.risk_id) : row.risk_id}
    </span>
  );
}

function ControlledPill({ row, testid }) {
  if (!row.risk_score_controlled) return <span className="text-slate-400">—</span>;
  const bg = row.fill_hex_controlled || SEVERITY_FALLBACK._null.bg;
  return (
    <span
      data-testid={testid}
      className="inline-flex items-center px-2 py-0.5 rounded-md font-mono text-xs font-semibold"
      style={{ backgroundColor: bg, color: readableTextOn(bg) }}
    >
      {row.risk_score_controlled}
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
        resp = await api.post('/master-risks/reimport', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else if (url.trim()) {
        const fd = new FormData();
        fd.append('url', url.trim());
        resp = await api.post('/master-risks/reimport', fd);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="master-risks-import-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Import Master Risks from XLSX</h3>
            <p className="text-sm text-slate-500 mt-1">Existing rows are matched by <code>risk_id</code>. Changed rows are updated; new rows are inserted; unchanged rows are skipped.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="master-risks-import-close" aria-label="Close">×</button>
        </div>

        <label className="block text-sm font-medium text-slate-700 mb-1">Upload .xlsx file</label>
        <input
          type="file" accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          data-testid="master-risks-import-file"
        />

        <div className="my-3 text-center text-xs uppercase tracking-wide text-slate-400">or</div>

        <label className="block text-sm font-medium text-slate-700 mb-1">Paste XLSX URL</label>
        <input
          type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/master_risks.xlsx"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          data-testid="master-risks-import-url"
        />

        {msg && <div className="mt-3 text-sm text-slate-700 whitespace-pre-line" data-testid="master-risks-import-msg">{msg}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50" data-testid="master-risks-import-cancel">Close</button>
          <button
            onClick={submit} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            data-testid="master-risks-import-submit"
          >
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
      data-testid={`master-risks-detail-${row.risk_id}`}
    >
      <div className="md:col-span-2 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-slate-500">Risk ID:</span>
        <span className="font-mono text-sm text-slate-800">#{row.risk_id}</span>
        <span className="text-xs text-slate-500 ml-3">Uncontrolled:</span>
        <SeverityPill row={row} testid={`master-risks-detail-pill-${row.risk_id}`} />
        <span className="text-xs text-slate-500 ml-3">Controlled:</span>
        <ControlledPill row={row} testid={`master-risks-detail-pill-c-${row.risk_id}`} />
        {row.classification && (
          <span className="text-xs text-slate-500 ml-3">{row.classification}</span>
        )}
      </div>
      <Field label="Unwanted event" value={row.unwanted_event} />
      <Field label="Hazard aspect" value={row.hazard_aspect} />
      <Field label="Mandatory controls" value={row.mandatory_controls} multiline />
      <Field label="Other controls" value={row.other_controls} multiline />
      <Field label="Legal &amp; other references" value={row.legal_references} multiline />
      <Field label="SWMS reference" value={row.swms_reference} />
    </div>
  );
}

function Field({ label, value, multiline }) {
  if (!value) return <div className="text-xs text-slate-400">{label}: <span className="italic">not provided</span></div>;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className={`text-sm text-slate-800 ${multiline ? 'whitespace-pre-line' : ''}`}>{value}</div>
    </div>
  );
}

// Sort helpers.
function riskIdSortKey(id) {
  // Numeric per-row Risk ID from column A. Sort numerically if it parses.
  const n = parseInt((id || '').trim(), 10);
  if (Number.isFinite(n)) return [0, n];
  return [1, 0];
}

function scoreSortKey(code) {
  const m = /^([EHMLehml])-(\d+)$/.exec((code || '').trim());
  if (!m) return [9, 0];
  const rank = { E: 0, H: 1, M: 2, L: 3 }[m[1].toUpperCase()];
  return [rank, -parseInt(m[2], 10)]; // Larger score first within band.
}

export default function MasterRisksTab({ user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sevOn, setSevOn] = useState({ extreme: true, high: true, medium: true, low: true });
  const [classification, setClassification] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState(() => loadListSort('master_risks', { key: 'risk_id', dir: 'asc' }));
  const [importOpen, setImportOpen] = useState(false);

  const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);

  const load = () => {
    setLoading(true);
    api.get('/master-risks/', { params: { limit: 1000 } })
      .then((r) => setItems(r.data.items || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const classifications = useMemo(() => {
    const s = new Set();
    items.forEach((r) => { if (r.classification) s.add(r.classification); });
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = items.filter((r) => {
      if (!sevOn[r.severity || '_null'] && r.severity) return false;
      if (classification && r.classification !== classification) return false;
      if (needle) {
        const hay = [r.risk_id, r.activity, r.hazard_aspect, r.unwanted_event,
                     r.mandatory_controls, r.other_controls, r.legal_references,
                     r.swms_reference, r.classification]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      if (sort.key === 'risk_id') {
        const [ra, na] = riskIdSortKey(a.risk_id);
        const [rb, nb] = riskIdSortKey(b.risk_id);
        return dir * (ra === rb ? na - nb : ra - rb);
      }
      if (sort.key === 'risk_score_uncontrolled') {
        const [ra, na] = scoreSortKey(a.risk_score_uncontrolled);
        const [rb, nb] = scoreSortKey(b.risk_score_uncontrolled);
        return dir * (ra === rb ? na - nb : ra - rb);
      }
      const va = (a[sort.key] || '').toString().toLowerCase();
      const vb = (b[sort.key] || '').toString().toLowerCase();
      return dir * va.localeCompare(vb);
    });
    return out;
  }, [items, q, sevOn, classification, sort]);

  const cycleSort = (key) => {
    let next;
    if (sort.key !== key) next = { key, dir: 'asc' };
    else next = { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    setSort(next);
    saveListSort('master_risks', next.key, next.dir);
  };

  const sortIndicator = (key) => sort.key !== key ? '' : (sort.dir === 'asc' ? '↑' : '↓');

  return (
    <div data-testid="master-risks-tab">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search risks…"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          data-testid="master-risks-search"
        />

        <div className="flex items-center gap-1" data-testid="master-risks-severity-chips">
          {SEVERITY_ORDER.map((sev) => {
            const active = sevOn[sev];
            const fb = SEVERITY_FALLBACK[sev];
            return (
              <button
                key={sev}
                onClick={() => setSevOn({ ...sevOn, [sev]: !active })}
                data-testid={`master-risks-chip-${sev}`}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${active ? '' : 'opacity-40'}`}
                style={{ backgroundColor: active ? fb.bg : '#FFF', color: fb.fg, borderColor: fb.bg }}
                title={`Toggle ${SEVERITY_LABEL[sev]}`}
              >
                {SEVERITY_LABEL[sev]}
              </button>
            );
          })}
        </div>

        <select
          value={classification} onChange={(e) => setClassification(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
          data-testid="master-risks-classification-select"
        >
          <option value="">All classifications</option>
          {classifications.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className="text-xs text-slate-500 ml-auto" data-testid="master-risks-count">
          {filtered.length} of {items.length} risks
        </div>

        {isAdmin && (
          <button
            onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            data-testid="master-risks-import-open"
          >
            Import from XLSX…
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-slate-500 p-6" data-testid="master-risks-loading">Loading master risks…</div>
      ) : items.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-300 rounded-lg text-center" data-testid="master-risks-empty">
          <p className="text-slate-700 font-medium">No master risks imported yet</p>
          <p className="text-slate-500 text-sm mt-1">
            {isAdmin
              ? 'Use "Import from XLSX" above to load the reference library.'
              : 'Ask an admin to import the master risks reference library.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div
            className="grid text-[11px] uppercase tracking-wider bg-slate-50 border-b border-slate-200 px-4 py-2 text-slate-600 font-semibold gap-2"
            style={{ gridTemplateColumns: '70px 90px 1.4fr 1.8fr 90px 40px' }}
          >
            <button className="text-left" onClick={() => cycleSort('risk_id')} data-testid="master-risks-sort-risk_id">ID {sortIndicator('risk_id')}</button>
            <button className="text-left" onClick={() => cycleSort('risk_score_uncontrolled')} data-testid="master-risks-sort-score_u">Score (U) {sortIndicator('risk_score_uncontrolled')}</button>
            <button className="text-left" onClick={() => cycleSort('activity')} data-testid="master-risks-sort-activity">Activity {sortIndicator('activity')}</button>
            <div>Hazard aspect</div>
            <div className="text-left">Score (C)</div>
            <div className="text-center">›</div>
          </div>

          <ul className="divide-y divide-slate-100" data-testid="master-risks-rows">
            {filtered.map((row) => {
              const isOpen = expanded === row.id;
              return (
                <li key={row.id} className="bg-white" data-testid={`master-risks-row-${row.risk_id}`}>
                  <button
                    className={`w-full text-left grid items-center px-4 py-2.5 hover:bg-slate-50 transition gap-2 ${isOpen ? 'bg-slate-50' : ''}`}
                    style={{ gridTemplateColumns: '70px 90px 1.4fr 1.8fr 90px 40px' }}
                    onClick={() => setExpanded(isOpen ? null : row.id)}
                    aria-expanded={isOpen}
                  >
                    <div className="font-mono text-xs text-slate-500">#{row.risk_id}</div>
                    <div><SeverityPill row={row} testid={`master-risks-pill-${row.risk_id}`} /></div>
                    <div className="text-sm text-slate-900 truncate pr-2" title={row.activity}>{row.activity || <span className="italic text-slate-400">—</span>}</div>
                    <div className="text-xs text-slate-600 line-clamp-2 pr-2" title={row.hazard_aspect}>{row.hazard_aspect || <span className="italic text-slate-400">—</span>}</div>
                    <div><ControlledPill row={row} testid={`master-risks-pill-c-${row.risk_id}`} /></div>
                    <div className="text-center text-slate-400 text-xs">{isOpen ? '▾' : '▸'}</div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4"><DetailPanel row={row} /></div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
    </div>
  );
}
