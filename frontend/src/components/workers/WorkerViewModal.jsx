// v160.2.2 — Read-only Worker view drawer for the Workers admin table.
// Opens from the eye icon on each row. Never mutates state — Fetches
// `GET /api/workers/{id}` and displays identity, contact, personal,
// availability, clients and certifications with expiring/expired highlights.
import React, { useEffect, useState } from 'react';
import { Award, Calendar, HardHat, Loader2, MapPin, Upload, Users, X, AlertTriangle, Trash2, Archive, ExternalLink } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { SimproZipUploadModal } from './SimproZipUploadModal';
import { toast } from 'sonner';

const DAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' }, { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

function fullName(w) {
  return `${w?.first_name || ''} ${w?.last_name || ''}`.trim() || '(unnamed)';
}

function shortDate(iso) {
  if (!iso || iso.length < 10) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

function CompanyChip({ label }) {
  const tints = {
    Paneltec: 'bg-[#e6eff9] text-[#1e4a8c]',
    Viatec:   'bg-[#ece6f4] text-[#4f3a8c]',
    Manual:   'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${tints[label] || tints.Manual}`}>
      {label || 'Simpro'}
    </span>
  );
}

function CertRow({ cert }) {
  const status = cert.status || {};
  const key = status.key || 'no_expiry';
  const map = {
    valid:         { bg: 'bg-[#d8ecdd]', ink: 'text-[#1f7a3f]', border: 'border-[#b6dcbf]' },
    expiring_soon: { bg: 'bg-[#fef3c7]', ink: 'text-[#92400e]', border: 'border-[#fcd34d]' },
    expired:       { bg: 'bg-[#fbe4e7]', ink: 'text-[#7a1f33]', border: 'border-[#e69aa3]' },
    no_expiry:     { bg: 'bg-[#d8e6f4]', ink: 'text-[#1e4a8c]', border: 'border-[#b9d2ec]' },
    missing_file:  { bg: 'bg-slate-100', ink: 'text-slate-600', border: 'border-slate-200' },
  };
  const style = map[key] || map.no_expiry;
  return (
    <tr className="border-t border-slate-100" data-testid={`view-cert-row-${cert.id}`}>
      <td className="px-3 py-2 font-medium text-slate-900 break-words max-w-[260px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span>{cert.name}</span>
          {cert.source === 'simpro' && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200"
              title="Imported from Simpro"
              data-testid={`view-cert-source-simpro-${cert.id}`}
            >SIMPRO</span>
          )}
          {cert.source !== 'simpro' && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200"
              title="Manually added"
              data-testid={`view-cert-source-manual-${cert.id}`}
            >MANUAL</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-slate-500 hidden md:table-cell">{cert.issuer || '—'}</td>
      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{shortDate(cert.expiry_date)}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${style.bg} ${style.ink} ${style.border}`}
          data-testid={`view-cert-status-${cert.id}`}>
          {status.label || '—'}
        </span>
      </td>
    </tr>
  );
}

export default function WorkerViewModal({ workerId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [worker, setWorker] = useState(null);
  const [certs, setCerts] = useState([]);
  const [clientMeta, setClientMeta] = useState({});
  const [error, setError] = useState(null);
  const [zipOpen, setZipOpen] = useState(false);  // v160.3.2 Simpro ZIP import
  const [currentUser, setCurrentUser] = useState(null);
  // v160.3.4 — Unmatched Documents triage tab
  const [tab, setTab] = useState('profile'); // profile | unmatched
  const [unmatchedCount, setUnmatchedCount] = useState(null);

  useEffect(() => {
    // Hydrate the viewer identity once — used to gate the ZIP upload button.
    api.get('/auth/me').then((r) => setCurrentUser(r.data)).catch(() => {});
  }, []);

  // v160.3.4 — refresh unmatched count for the tab badge.
  const refreshUnmatched = React.useCallback(async () => {
    const role = (currentUser?.role || '').toLowerCase();
    if (!['admin', 'hseq_lead', 'hr_lead'].includes(role)) return;
    try {
      const { data } = await api.get(`/workers/${workerId}/unmatched-documents`);
      setUnmatchedCount((data?.documents || []).length);
    } catch {
      setUnmatchedCount(null);
    }
  }, [workerId, currentUser]);

  useEffect(() => { refreshUnmatched(); }, [refreshUnmatched]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const w = await api.get(`/workers/${workerId}`);
        if (!alive) return;
        setWorker(w.data);
        try {
          const c = await api.get(`/workers/${workerId}/certifications`);
          if (alive) setCerts(c.data || []);
        } catch (e) { /* silent — non-blocking */ }
        // Best-effort hydrate client names from Simpro cache.
        if ((w.data?.client_ids || []).length > 0) {
          try {
            const r = await api.get('/integrations/simpro/customers?company=both');
            const map = {};
            (r.data?.customers || []).forEach((c) => {
              map[c.simpro_customer_id] = { name: c.name, company_label: c.company_label };
            });
            if (alive) setClientMeta(map);
          } catch (e) { /* silent */ }
        }
      } catch (e) {
        if (alive) setError(apiError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [workerId]);

  const enabledDays = worker?.availability
    ? DAYS.filter((d) => worker.availability[d.key]?.enabled)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="worker-view-modal">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 bg-[#e6eff9] flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[#1e4a8c]">Worker profile · Read only</div>
            <h2 className="font-display text-xl font-semibold text-slate-900 mt-0.5" data-testid="worker-view-name">
              {worker ? fullName(worker) : 'Loading…'}
            </h2>
            {worker && (
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <CompanyChip label={worker.company_label} />
                {worker.position && <span className="text-xs text-slate-600">{worker.position}</span>}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/60" data-testid="worker-view-close">
            <X size={16} />
          </button>
        </div>

        {/* v160.3.2 — Simpro ZIP import quick-action bar */}
        {!loading && worker && ['admin', 'hr_lead', 'hseq_lead'].includes((currentUser?.role || '').toLowerCase()) && (
          <div className="px-6 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Attach certifications + documents in bulk via a Simpro ZIP export.
            </div>
            <button
              onClick={() => setZipOpen(true)}
              data-testid="worker-simpro-zip-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 shadow-sm"
            >
              <Upload size={12} /> Upload Simpro ZIP
            </button>
          </div>
        )}

        {/* v160.3.4 — Tab strip (admin/hr_lead/hseq_lead only) */}
        {!loading && worker && ['admin', 'hr_lead', 'hseq_lead'].includes((currentUser?.role || '').toLowerCase()) && (
          <div className="px-6 border-b border-slate-200 bg-white flex items-center gap-1" data-testid="worker-view-tabs">
            <TabButton active={tab === 'profile'} onClick={() => setTab('profile')} testid="tab-profile">
              Profile
            </TabButton>
            <TabButton active={tab === 'unmatched'} onClick={() => setTab('unmatched')} testid="tab-unmatched">
              Unmatched Documents
              {unmatchedCount != null && unmatchedCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold" data-testid="unmatched-count-badge">
                  {unmatchedCount}
                </span>
              )}
            </TabButton>
          </div>
        )}

        <div className="px-6 py-4 overflow-y-auto space-y-4 flex-1">
          {loading && (
            <div className="text-sm text-slate-500 inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading worker profile…
            </div>
          )}
          {error && (
            <div className="text-sm text-[#7a1f33] bg-[#fbe4e7] border border-[#e69aa3] rounded-lg px-3 py-2" data-testid="worker-view-error">
              {error}
            </div>
          )}
          {!loading && worker && tab === 'profile' && (
            <>
              {/* Identity + contact */}
              <section className="border border-slate-200 rounded-xl px-4 py-3 bg-white" data-testid="view-section-identity">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-semibold text-sm">
                  <HardHat size={14} className="text-slate-500" /> Identity &amp; contact
                </div>
                <dl className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-sm">
                  <dt className="text-slate-500 text-xs">Email</dt><dd className="text-slate-800">{worker.email || '—'}</dd>
                  <dt className="text-slate-500 text-xs">Phone</dt><dd className="text-slate-800">{worker.phone || '—'}</dd>
                  <dt className="text-slate-500 text-xs">Mobile</dt><dd className="text-slate-800">{worker.mobile || '—'}</dd>
                  <dt className="text-slate-500 text-xs">Status</dt>
                  <dd>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${worker.active ? 'bg-[#d8ecdd] text-[#1f7a3f] border-[#b6dcbf]' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                      {worker.active ? 'Active' : 'Inactive'}
                    </span>
                  </dd>
                </dl>
              </section>

              {/* Personal */}
              <section className="border border-slate-200 rounded-xl px-4 py-3 bg-white" data-testid="view-section-personal">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-semibold text-sm">
                  <MapPin size={14} className="text-slate-500" /> Personal
                </div>
                <dl className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-sm">
                  <dt className="text-slate-500 text-xs">Birth date</dt><dd className="text-slate-800">{shortDate(worker.birth_date)}</dd>
                  <dt className="text-slate-500 text-xs">Country</dt><dd className="text-slate-800">{worker.country || '—'}</dd>
                  <dt className="text-slate-500 text-xs">State</dt><dd className="text-slate-800">{worker.state || '—'}</dd>
                  <dt className="text-slate-500 text-xs">Postal code</dt><dd className="text-slate-800">{worker.postal_code || '—'}</dd>
                  <dt className="text-slate-500 text-xs col-span-2">Street address</dt>
                  <dd className="col-span-2 text-slate-800">{[worker.street_address, worker.suburb, worker.state, worker.postal_code].filter(Boolean).join(', ') || '—'}</dd>
                </dl>
              </section>

              {/* Availability */}
              <section className="border border-slate-200 rounded-xl px-4 py-3 bg-white" data-testid="view-section-availability">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-semibold text-sm">
                  <Calendar size={14} className="text-slate-500" /> Availability
                  {enabledDays.length > 0 && (
                    <span className="ml-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#e6eff9] text-[#1e4a8c]">
                      {enabledDays.length} day{enabledDays.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                {enabledDays.length === 0 ? (
                  <div className="text-xs text-slate-400 italic">No days configured.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {enabledDays.map((d) => {
                      const row = worker.availability[d.key];
                      return (
                        <span key={d.key} data-testid={`view-availability-${d.key}`}
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-[#e6eff9] text-[#1e4a8c] border border-[#b9d2ec]">
                          <span className="font-semibold">{d.label}</span>
                          <span className="font-mono text-[11px]">{row.start}–{row.end}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Clients */}
              <section className="border border-slate-200 rounded-xl px-4 py-3 bg-white" data-testid="view-section-clients">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-semibold text-sm">
                  <Users size={14} className="text-slate-500" /> Clients
                  {(worker.client_ids || []).length > 0 && (
                    <span className="ml-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#e6eff9] text-[#1e4a8c]">
                      {worker.client_ids.length}
                    </span>
                  )}
                </div>
                {(worker.client_ids || []).length === 0 ? (
                  <div className="text-xs text-slate-400 italic">No clients assigned.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {worker.client_ids.map((id) => {
                      const meta = clientMeta[id];
                      return (
                        <span key={id} data-testid={`view-client-chip-${id}`}
                          className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-full text-xs">
                          <span className="text-slate-700">{meta?.name || `Customer #${id}`}</span>
                          {meta?.company_label && <CompanyChip label={meta.company_label} />}
                        </span>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Certifications */}
              <section className="border border-slate-200 rounded-xl px-4 py-3 bg-white" data-testid="view-section-certifications">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-semibold text-sm">
                  <Award size={14} className="text-slate-500" /> Certifications
                  {certs.length > 0 && (
                    <span className="ml-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#e6eff9] text-[#1e4a8c]">
                      {certs.length}
                    </span>
                  )}
                </div>
                {certs.length === 0 ? (
                  <div className="text-xs text-slate-400 italic">No certifications recorded.</div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-xs" data-testid="view-cert-table">
                      <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                        <tr>
                          <th className="text-left px-3 py-2">Name</th>
                          <th className="text-left px-3 py-2 hidden md:table-cell">Issuer</th>
                          <th className="text-left px-3 py-2 whitespace-nowrap">Expiry</th>
                          <th className="text-left px-3 py-2 whitespace-nowrap">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {certs.map((c) => <CertRow key={c.id} cert={c} />)}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
          {!loading && worker && tab === 'unmatched' && (
            <UnmatchedDocsTab
              workerId={workerId}
              onChange={refreshUnmatched}
            />
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 flex justify-end bg-slate-50">
          <button onClick={onClose} data-testid="worker-view-close-footer"
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100">
            Close
          </button>
        </div>
      </div>
      {zipOpen && worker && (
        <SimproZipUploadModal
          worker={worker}
          onClose={() => setZipOpen(false)}
          onDone={() => {
            // Refetch certs after commit
            api.get(`/workers/${workerId}/certifications`).then((r) => setCerts(r.data || [])).catch(() => {});
            refreshUnmatched();
          }}
        />
      )}
    </div>
  );
}

// v160.3.4 — small local tab button.
function TabButton({ active, onClick, testid, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={
        'px-3 py-2 text-xs font-semibold border-b-2 -mb-px inline-flex items-center gap-1 ' +
        (active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-slate-500 hover:text-slate-800')
      }
    >
      {children}
    </button>
  );
}

// v160.3.4 — Unmatched Documents triage panel. Lists all
// `worker_unmatched_documents` for the worker + provides Reclassify,
// Move-to-HR, and Delete (soft) actions.
function UnmatchedDocsTab({ workerId, onChange }) {
  const [rows, setRows] = React.useState(null);
  const [certKinds, setCertKinds] = React.useState([]);
  const [busy, setBusy] = React.useState('');
  const [reclassifyDoc, setReclassifyDoc] = React.useState(null); // doc being reclassified
  const [reclassifySlug, setReclassifySlug] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      const { data } = await api.get(`/workers/${workerId}/unmatched-documents`);
      setRows(data?.documents || []);
    } catch {
      setRows([]);
    }
  }, [workerId]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    // Load cert_kinds catalogue once for the reclassify dropdown.
    api.get('/integrations/simpro/workers/cert-kinds').then((r) => {
      setCertKinds(r.data?.cert_kinds || []);
    }).catch(() => {
      // Fallback: leave empty; users can still Delete + Move-to-HR
      setCertKinds([]);
    });
  }, []);

  const doReclassify = async () => {
    if (!reclassifyDoc || !reclassifySlug) return;
    setBusy(reclassifyDoc.id);
    try {
      await api.post(
        `/workers/${workerId}/unmatched-documents/${reclassifyDoc.id}/reclassify`,
        { cert_kind_slug: reclassifySlug }
      );
      toast.success('Reclassified as ' + reclassifySlug);
      setReclassifyDoc(null);
      setReclassifySlug('');
      await load();
      onChange?.();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy('');
    }
  };

  const doMoveToHR = async (doc) => {
    if (!window.confirm(`Move "${doc.filename}" to HR (private) documents?`)) return;
    setBusy(doc.id);
    try {
      await api.post(`/workers/${workerId}/unmatched-documents/${doc.id}/move-to-hr`);
      toast.success('Moved to HR documents');
      await load();
      onChange?.();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy('');
    }
  };

  const doDelete = async (doc) => {
    if (!window.confirm(`Delete "${doc.filename}"? (soft-delete · blob retained 30 days)`)) return;
    setBusy(doc.id);
    try {
      await api.delete(`/workers/${workerId}/unmatched-documents/${doc.id}`);
      toast.success('Document deleted');
      await load();
      onChange?.();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy('');
    }
  };

  if (rows === null) {
    return (
      <div className="text-sm text-slate-500 inline-flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading unmatched documents…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="border border-slate-200 rounded-xl px-4 py-6 text-center text-sm text-slate-500 bg-white" data-testid="unmatched-empty">
        <AlertTriangle size={20} className="mx-auto text-slate-400 mb-2" />
        No unmatched documents. Every Simpro ZIP file was routed to a cert row, HR folder, or a photo.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="unmatched-docs-tab">
      <div className="rounded-xl border border-rose-200 bg-rose-50/40 px-3 py-2 text-xs text-rose-900">
        <span className="font-semibold">{rows.length} unmatched document{rows.length === 1 ? '' : 's'}.</span>{' '}
        Preview each one, then Reclassify it as an existing cert_kind, Move it to HR (private), or Delete.
      </div>
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-xs" data-testid="unmatched-table">
          <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Filename</th>
              <th className="text-left px-3 py-2 hidden md:table-cell">Folder</th>
              <th className="text-left px-3 py-2 hidden md:table-cell">Uploaded</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50" data-testid={`unmatched-row-${d.id}`}>
                <td className="px-3 py-2 font-medium text-slate-900 max-w-[240px] truncate" title={d.filename}>
                  {d.filename}
                </td>
                <td className="px-3 py-2 uppercase text-[10px] tracking-wider text-slate-600 hidden md:table-cell">
                  {d.zip_folder || '—'}
                </td>
                <td className="px-3 py-2 text-slate-500 hidden md:table-cell whitespace-nowrap">
                  {(d.uploaded_at || '').slice(0, 10)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    <a
                      href={`/api/workers/${workerId}/unmatched-documents/${d.id}/file`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      data-testid={`unmatched-preview-${d.id}`}
                    >
                      <ExternalLink size={11} /> View
                    </a>
                    <button
                      type="button"
                      onClick={() => { setReclassifyDoc(d); setReclassifySlug(''); }}
                      disabled={busy === d.id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                      data-testid={`unmatched-reclassify-${d.id}`}
                    >
                      <Award size={11} /> Reclassify
                    </button>
                    <button
                      type="button"
                      onClick={() => doMoveToHR(d)}
                      disabled={busy === d.id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-300 bg-amber-50 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                      data-testid={`unmatched-move-hr-${d.id}`}
                    >
                      <Archive size={11} /> HR
                    </button>
                    <button
                      type="button"
                      onClick={() => doDelete(d)}
                      disabled={busy === d.id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-300 bg-white text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      data-testid={`unmatched-delete-${d.id}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reclassifyDoc && (
        <div
          className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && setReclassifyDoc(null)}
          data-testid="reclassify-modal"
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-900 mb-1">Reclassify document</div>
            <div className="text-xs text-slate-600 mb-3 truncate" title={reclassifyDoc.filename}>
              {reclassifyDoc.filename}
            </div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
              Cert kind
            </label>
            <select
              value={reclassifySlug}
              onChange={(e) => setReclassifySlug(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              data-testid="reclassify-slug-select"
            >
              <option value="">— select a cert kind —</option>
              {certKinds.map((k) => (
                <option key={k.slug} value={k.slug}>{k.name} ({k.slug})</option>
              ))}
            </select>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReclassifyDoc(null)}
                className="px-3 py-1.5 rounded-lg text-sm text-slate-700 hover:bg-slate-100"
                data-testid="reclassify-cancel"
              >Cancel</button>
              <button
                type="button"
                onClick={doReclassify}
                disabled={!reclassifySlug || busy === reclassifyDoc.id}
                className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50"
                data-testid="reclassify-confirm"
              >Reclassify</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
