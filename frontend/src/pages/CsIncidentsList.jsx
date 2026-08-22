// v58.13.12 — CS Incident list migrated from the "Risk Assessments"
// tab into a dedicated "Submissions" nav bucket. Uses `GroupedTilesView`
// (same component powering Inspections / Incidents / Site Sign-In)
// grouped by `business_unit` so the reference-library data reads as
// browseable safety events rather than a 40-column spreadsheet.
//
// Preserved (verbatim behaviour, zero data change):
//   · Fetch  → `GET  /cs-incident/`     (existing endpoint, unchanged)
//   · Add    → `useCrudModal` AddButton (opens existing Add modal)
//   · Edit   → `useCrudModal` RowActions edit → existing schemas
//   · Delete → `useCrudModal` RowActions delete → existing modal
//   · Import → the existing `ImportModal` from CsIncidentTab (extracted
//              inline here as `CsIncidentImportModal` — same POST
//              endpoint `/cs-incident/reimport`).
//   · Filters (business_unit / status / issue_type) + free-text search.
//
// Removed (deliberately, per user brief "match the tile UX"):
//   · Horizontal-scroll grid + column-based sort + show-all-populated
//     columns toggle. The View modal surfaces every populated column
//     for the row.
//
// v58.13.10 flash-bug guardrail: every tile action button stops the
// synthetic-event bubble before mutating state so the freshly-mounted
// View modal cannot receive its own opening click.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api, { apiError } from '../lib/api';
import GroupedTilesView from '../components/capture/GroupedTilesView';
import CaptureCard from '../components/CaptureCard';
import { PageHeader, EmptyState, StatusBadge } from '../components/capture/Ui';
import useCrudModal from '../components/riskAssessments/useCrudModal';
import { useCan } from '../lib/permissions';
import { formatDate, formatDateTime12, formatTime12 } from '../lib/timeFormat';
import { toast } from 'sonner';

const LABEL_OVERRIDES = {
  immediate_action: 'Immediate action (injury)',
  immediate_action_2: 'Immediate action (near-miss)',
  immediate_action_3: 'Immediate action (hazard)',
  issue_number: 'Issue #',
  date_of_issue: 'Date of Issue',
  business_unit: 'Business unit',
  responsible_manager: 'Responsible',
  closeout_manager: 'Closeout',
  actual_incident_category: 'Actual severity',
  potential_incident_category: 'Potential severity',
};
const DATE_FIELDS = new Set(['date_of_issue', 'date_preapproved', 'date_reviewed']);
const DATETIME_FIELDS = new Set(['date_closed', 'date_of_entry', 'date_reported']);
const TIME_FIELDS = new Set(['time_of_issue']);
const LONG_TEXT_FIELDS = new Set([
  'description', 'hazard_description', 'immediate_action',
  'immediate_action_2', 'immediate_action_3', 'first_aid_description',
  'near_miss_description', 'plant_description', 'property_description',
  'other_description',
]);
const labelFor = (k) => LABEL_OVERRIDES[k]
  || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const renderVal = (k, v) => {
  if (v == null || v === '') return '—';
  if (DATE_FIELDS.has(k)) return formatDate(new Date(v)) || String(v);
  if (DATETIME_FIELDS.has(k)) return formatDateTime12(v) || String(v);
  if (TIME_FIELDS.has(k)) return formatTime12(v) || String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

// Status badge palette — inline (no shared component) so this ship
// stays self-contained. Colour-codes at a glance without needing to
// read the label on every tile.
function StatusPill({ value }) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  const cls = v.includes('closed')
    ? 'bg-emerald-100 text-emerald-800'
    : v.includes('open') || v.includes('progress')
      ? 'bg-amber-100 text-amber-800'
      : v.includes('review')
        ? 'bg-blue-100 text-blue-800'
        : 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>
      {value}
    </span>
  );
}

// Full-row detail modal. Renders every populated column so the tile's
// summary doesn't hide anything. Same portal-backdrop pattern as
// SubmissionViewer — click outside or the × button closes.
function CsIncidentDetailModal({ row, populated, onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (!row) return null;
  const entries = populated.filter(
    (k) => row[k] !== undefined && row[k] !== null && row[k] !== '',
  );
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={onClose}
         data-testid="cs-incident-viewer-backdrop">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col"
           onClick={(e) => e.stopPropagation()}
           data-testid="cs-incident-viewer">
        <div className="px-5 py-3 border-b border-slate-200 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              CS Incident · Issue #{row.issue_number}
            </div>
            <div className="text-lg font-semibold text-slate-900 truncate">
              {row.issue_type || 'Untyped issue'}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {row.business_unit || '—'}
              {row.date_of_issue && <> · {renderVal('date_of_issue', row.date_of_issue)}</>}
              {row.status && <> · <StatusPill value={row.status} /></>}
            </div>
          </div>
          <button onClick={onClose} data-testid="cs-incident-viewer-close"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 text-xl">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            {entries.map((k) => (
              <div key={k} className={LONG_TEXT_FIELDS.has(k) ? 'md:col-span-2' : ''}>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{labelFor(k)}</div>
                <div className="text-sm text-slate-800 whitespace-pre-line">{renderVal(k, row[k])}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CsIncidentImportModal({ open, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  if (!open) return null;
  const submit = async () => {
    setBusy(true); setMsg('');
    try {
      const fd = new FormData();
      if (file) fd.append('file', file);
      else if (url.trim()) fd.append('url', url.trim());
      else { setMsg('Provide a file OR a URL.'); setBusy(false); return; }
      const r = await api.post('/cs-incident/reimport', fd);
      setMsg(`Imported → new: ${r.data.inserted}, updated: ${r.data.updated}, unchanged: ${r.data.unchanged}. Live rows: ${r.data.live_total}.`);
      onDone();
    } catch (e) { setMsg(`Failed: ${apiError(e)}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="cs-incident-import-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-semibold">Import CS Incident from XLSX</h3>
          <button onClick={onClose} className="text-slate-400 text-xl" aria-label="Close">×</button>
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
            className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white disabled:opacity-50"
            data-testid="cs-incident-import-submit">
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CsIncidentsList() {
  const [items, setItems] = useState([]);
  const [populated, setPopulated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [status, setStatus] = useState('');
  const [issueType, setIssueType] = useState('');
  const [viewer, setViewer] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const can = useCan();
  const canWrite = can('reference_library', 'edit');

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      api.get('/cs-incident/', { params: { limit: 1000 } }),
      api.get('/cs-incident/columns'),
    ]).then(([listResp, colsResp]) => {
      setItems(listResp.data.items || []);
      setPopulated(colsResp.data.populated || []);
    }).catch((e) => setError(e)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Preserve the existing CRUD wiring so Add / Edit / Delete continue
  // to run through the same shared modal + schemas the tab used.
  const crud = useCrudModal({ tabKey: 'cs_incident', isAdmin: canWrite, onRefresh: load });

  const distinct = useMemo(() => {
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
    return items.filter((r) => {
      if (businessUnit && r.business_unit !== businessUnit) return false;
      if (status && r.status !== status) return false;
      if (issueType && r.issue_type !== issueType) return false;
      if (needle) {
        const hay = Object.values(r).filter((v) => typeof v === 'string').join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, q, businessUnit, status, issueType]);

  const renderTile = (row) => (
    <CaptureCard
      record={{
        id: row.id,
        template_name_snapshot: `#${row.issue_number} · ${row.issue_type || 'Untyped'}`,
        submitted_by_name: row.responsible_manager || null,
        date: row.date_of_issue || row.date_of_entry || '',
      }}
      resourceKind="reference_library"
      apiPath="cs-incident"
      subtitle={row.description || null}
      badges={row.status
        ? [<StatusBadge key="status" value={row.status} />]
        : []}
      onView={() => setViewer(row)}
      onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))}
    />
  );

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4" data-testid="cs-incidents-list-page">
      <PageHeader
        crumb="Capture / Submissions / CS Incidents"
        title="CS Incidents"
        subtitle="Cost & Safety incident register, grouped by business unit."
      />

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search incidents…"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
          data-testid="cs-incidents-search" />
        <select value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
          data-testid="cs-incidents-bu-select">
          <option value="">All business units</option>
          {distinct.business_unit.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
          data-testid="cs-incidents-status-select">
          <option value="">All statuses</option>
          {distinct.status.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={issueType} onChange={(e) => setIssueType(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
          data-testid="cs-incidents-type-select">
          <option value="">All issue types</option>
          {distinct.issue_type.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <div className="text-xs text-slate-500 ml-auto" data-testid="cs-incidents-count">
          {filtered.length} of {items.length}
        </div>
        {canWrite && crud.AddButton}
        {canWrite && (
          <button onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50"
            data-testid="cs-incidents-import-open">
            Import XLSX…
          </button>
        )}
      </div>

      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title="No CS Incident issues imported yet"
          body="Use Import XLSX above to seed the register from the CS Incident master workbook."
        />
      ) : (
        <GroupedTilesView
          items={filtered}
          groupBy={(r) => r.business_unit || 'Unassigned business unit'}
          renderTile={renderTile}
          dateFn={(r) => r.date_of_issue || r.date_of_entry || ''}
          loading={loading}
          error={error && apiError(error)}
          onRetry={() => { toast.info('Retrying…'); load(); }}
          emptyMessage="No incidents match the current filters."
          testidPrefix="cs-incidents"
        />
      )}

      {viewer && (
        <CsIncidentDetailModal
          row={viewer}
          populated={populated}
          onClose={() => setViewer(null)}
        />
      )}
      <CsIncidentImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => { setImportOpen(false); load(); }}
      />
      {crud.Modals}
    </div>
  );
}
