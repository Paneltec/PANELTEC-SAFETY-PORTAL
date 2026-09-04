// v58.13.106 — Admin visitor register.
// v58.13.110 — Row selection + bulk delete + detail drawer + column
//              declutter. Bulk-delete via `POST /admin/visitors/bulk-delete`.
//              Detail drawer shows every field trimmed from the main
//              table (phone / purpose / visiting person / vehicle rego /
//              induction ack / exact timestamps / IP / user agent /
//              full site address). `include_deleted` toggle surfaces
//              soft-deleted rows for auditors.
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { apiError } from '../lib/api';
import { toast } from 'sonner';

// ── Helpers ───────────────────────────────────────────────
function relTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function durationMin(r) {
  if (!r.signed_in_at) return '';
  const end = r.signed_out_at ? new Date(r.signed_out_at) : new Date();
  const min = Math.max(0, Math.round((end - new Date(r.signed_in_at)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60); const mm = min % 60;
  return `${h}h ${mm}m`;
}

function StatusPill({ row }) {
  if (row.deleted_at) {
    return <span className="inline-flex px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold uppercase">Deleted</span>;
  }
  if (row.signed_out_at) {
    return <span className="inline-flex px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold uppercase">Signed out</span>;
  }
  return <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">On site</span>;
}

// ── Detail drawer ─────────────────────────────────────────
function DetailDrawer({ visitorId, onClose, onDeleted, onSignedOut }) {
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // v58.13.110a — in-drawer confirm view (not window.confirm). Values:
  //   null  → normal detail
  //   'delete'      → confirm delete
  //   'signout'     → confirm force sign-out
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const { data } = await api.get(`/admin/visitors/${visitorId}`);
        if (alive) setRow(data);
      } catch (e) { if (alive) setError(apiError(e)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [visitorId]);

  // v58.13.110a — Escape closes the drawer. Also cancels an in-drawer
  // confirm view first so a mis-clicked Delete can be undone with Esc.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (confirm) setConfirm(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, onClose]);

  const runForceSignOut = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/visitors/${row.id}/force-signout`);
      toast.success(`Signed out ${row.name}`);
      onSignedOut?.(row.id);
      onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  const runDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/admin/visitors/${row.id}`);
      toast.success(`Deleted ${row.name}`);
      onDeleted?.(row.id);
      onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40" data-testid="visitor-detail-drawer">
      <div className="absolute inset-0 bg-slate-900/40"
        onClick={() => (confirm ? setConfirm(null) : onClose())}
        aria-label="Close drawer backdrop" />
      <aside className="absolute inset-y-0 right-0 w-full max-w-md bg-white shadow-xl flex flex-col">
        <header className="px-5 py-4 border-b border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900" data-testid="visitor-detail-name">
                {loading ? 'Loading…' : (row?.name || 'Visitor')}
              </h2>
              {row && <p className="text-sm text-slate-500">{row.company || '—'} · {row.site_name || row.site_id || '—'}</p>}
            </div>
            {row && <StatusPill row={row} />}
            <button onClick={onClose} className="ml-2 text-slate-400 hover:text-slate-700" aria-label="Close" data-testid="visitor-detail-close">✕</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-sm">
          {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2">{error}</div>}
          {row && (
            <>
              <Section title="Contact">
                <KV label="Phone">
                  {row.phone
                    ? <a href={`tel:${row.phone}`} className="text-brand-blue hover:underline font-mono" data-testid="visitor-detail-phone">{row.phone}</a>
                    : '—'}
                </KV>
                <KV label="Company">{row.company || '—'}</KV>
              </Section>
              <Section title="Visit">
                <KV label="Purpose">{row.purpose || '—'}</KV>
                <KV label="Visiting person">{row.visiting_person || '—'}</KV>
                <KV label="Vehicle rego">{row.vehicle_rego || '—'}</KV>
              </Section>
              <Section title="Safety">
                <KV label="Induction acknowledged">
                  {row.induction_acknowledged
                    ? <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">Yes</span>
                    : <span className="inline-flex px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold uppercase">No</span>}
                </KV>
              </Section>
              <Section title="Timeline">
                <KV label="Signed in">{row.signed_in_at ? new Date(row.signed_in_at).toLocaleString() : '—'}</KV>
                <KV label="Signed out">{row.signed_out_at ? new Date(row.signed_out_at).toLocaleString() : '—'}</KV>
                <KV label="Duration">{durationMin(row)}</KV>
                {row.deleted_at && <KV label="Deleted">{new Date(row.deleted_at).toLocaleString()}</KV>}
              </Section>
              <Section title="Provenance">
                <KV label="Site name">{row.site_name || '—'}</KV>
                <KV label="Site address">{[row.site_address, row.site_suburb, row.site_state].filter(Boolean).join(', ') || '—'}</KV>
                <KV label="Source IP"><code className="text-xs">{row.source_ip || '—'}</code></KV>
                <KV label="User agent"><code className="text-xs break-all">{row.source_user_agent || '—'}</code></KV>
              </Section>
            </>
          )}
        </div>
        {/*
          v58.13.110a — Footer is now ALWAYS rendered (even on soft-
          deleted rows) so there's always a Close/Back exit from the
          drawer. Order: Close on the LEFT (safe, primary), destructive
          actions on the RIGHT. The Force-sign-out and Delete buttons
          only render when the record supports the action. If neither
          destructive action is available (record already
          signed-out AND deleted), the footer collapses to a solo
          "Close" — user is never trapped.

          When `confirm` is non-null, the footer swaps to an inline
          confirm view. Cancel returns to the detail view (drawer stays
          open). Confirm executes the mutation and then closes the
          drawer. Backdrop click / Escape / X-icon all cancel the
          confirm first, then close.
        */}
        {row && (
          <footer className="px-5 py-3 border-t border-slate-200 emergent-badge-safe" data-testid="visitor-detail-footer">
            {confirm ? (
              <div className="space-y-3" data-testid="visitor-detail-confirm">
                <p className="text-sm text-slate-800 font-medium">
                  {confirm === 'delete'
                    ? `Delete this visitor record for ${row.name}?`
                    : `Force sign-out ${row.name}?`}
                </p>
                <p className="text-xs text-slate-500">
                  {confirm === 'delete'
                    ? 'This soft-deletes the record. It still appears in audit exports and via the "Include deleted" toggle.'
                    : 'Records the current time as sign-out and marks the reason as admin_force.'}
                </p>
                <div className="flex items-center gap-2 justify-end">
                  <button onClick={() => !busy && setConfirm(null)} disabled={busy}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                    data-testid="visitor-detail-confirm-cancel">
                    Cancel
                  </button>
                  <button onClick={confirm === 'delete' ? runDelete : runForceSignOut} disabled={busy}
                    className={
                      (confirm === 'delete'
                        ? 'bg-rose-600 hover:bg-rose-700'
                        : 'bg-slate-800 hover:bg-slate-900') +
                      ' px-3 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50'
                    }
                    data-testid="visitor-detail-confirm-go">
                    {busy ? 'Working…' : (confirm === 'delete' ? 'Delete Anyway' : 'Sign out')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={onClose}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50"
                  data-testid="visitor-detail-back">
                  Close
                </button>
                <div className="ml-auto flex items-center gap-2">
                  {!row.signed_out_at && !row.deleted_at && (
                    <button onClick={() => setConfirm('signout')}
                      className="px-3 py-2 rounded-lg border border-rose-300 text-rose-700 text-sm font-semibold hover:bg-rose-50"
                      data-testid="visitor-detail-force-signout">
                      Force sign-out
                    </button>
                  )}
                  {!row.deleted_at && (
                    <button onClick={() => setConfirm('delete')}
                      className="px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700"
                      data-testid="visitor-detail-delete">
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{title}</h3>
      <dl className="space-y-1.5">{children}</dl>
    </div>
  );
}
function KV({ label, children }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-40 shrink-0 text-slate-500">{label}</dt>
      <dd className="flex-1 text-slate-900">{children}</dd>
    </div>
  );
}

// ── Confirm bulk-delete modal ──────────────────────────────
function BulkDeleteModal({ rows, onCancel, onConfirm, busy }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" data-testid="bulk-delete-modal">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-4 emergent-badge-safe">
        <h2 className="text-lg font-bold text-slate-900">Delete {rows.length} visitor{rows.length === 1 ? '' : 's'}?</h2>
        <p className="text-sm text-slate-600">This soft-deletes the records. Rows still appear in audit exports and via the "Include deleted" toggle.</p>
        <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs space-y-1">
          {rows.map((r) => <div key={r.id}>· <b>{r.name}</b> {r.company ? `— ${r.company}` : ''}</div>)}
        </div>
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onCancel} disabled={busy}
            className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50">Cancel</button>
          <button onClick={onConfirm} disabled={busy}
            className="px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
            data-testid="bulk-delete-confirm">
            {busy ? 'Deleting…' : `Delete ${rows.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────
export default function AdminVisitors() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [siteId, setSiteId] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [drawerId, setDrawerId] = useState(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const params = { limit: 200 };
      if (siteId) params.site_id = siteId;
      if (activeOnly) params.active_only = true;
      if (includeDeleted) params.include_deleted = true;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const { data } = await api.get('/admin/visitors', { params });
      setRows(data.items || []);
      setSelected(new Set());  // clear selection whenever the list refreshes
    } catch (e) { setError(apiError(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeOnly, includeDeleted]);

  // v58.13.115 — Deep-link auto-open. When Ask Intelligence (or any
  // caller) navigates to `/app/admin/visitors?open=<id>` we open the
  // detail drawer for that visitor id on mount. If the id isn't in
  // the current filter, we also flip `include_deleted` so soft-
  // deleted rows re-hydrate, then let the DetailDrawer's own fetch
  // load the record by id. Runs ONCE per unique `?open=` value; the
  // param is cleared afterwards so a back-button return doesn't
  // re-trigger the drawer.
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get('open');
  useEffect(() => {
    if (!openParam) return;
    setDrawerId(openParam);
    const inFilter = rows.some((r) => r.id === openParam);
    if (!inFilter && !includeDeleted) {
      setIncludeDeleted(true);  // triggers a re-fetch via the deps above
    }
    // Strip `?open=` from the URL so a back/forward navigation
    // doesn't re-open the drawer unexpectedly.
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam, rows.length]);

  const sites = useMemo(() => {
    const s = new Map();
    rows.forEach((r) => { if (r.site_id) s.set(r.site_id, r.site_name || r.site_id); });
    return Array.from(s.entries());
  }, [rows]);

  // ── Selection helpers ────────────────────────────────────
  const selectableRows = useMemo(() => rows.filter((r) => !r.deleted_at), [rows]);
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableRows.map((r) => r.id)));
  };
  const toggleOne = (id) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  // ── Bulk delete ─────────────────────────────────────────
  const runBulkDelete = async () => {
    setBulkBusy(true);
    try {
      const { data } = await api.post('/admin/visitors/bulk-delete', {
        ids: Array.from(selected),
      });
      const skipped = data.skipped?.length || 0;
      toast.success(`Deleted ${data.deleted}${skipped ? ` · ${skipped} skipped` : ''}`);
      setShowBulkConfirm(false);
      load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBulkBusy(false); }
  };

  return (
    <div className="p-6 space-y-6" data-testid="admin-visitors-page">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Site Visitors</h1>
        <p className="text-sm text-slate-500">Public sign-in register from site QR codes.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-2xl border border-slate-200">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">Site</span>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-[180px]"
            data-testid="admin-visitors-site-filter">
            <option value="">All sites</option>
            {sites.map(([sid, label]) => <option key={sid} value={sid}>{label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">From</span>
          <input type="date" value={dateFrom.slice(0, 10)}
            onChange={(e) => setDateFrom(e.target.value ? `${e.target.value}T00:00:00Z` : '')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm" data-testid="admin-visitors-date-from" />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">To</span>
          <input type="date" value={dateTo.slice(0, 10)}
            onChange={(e) => setDateTo(e.target.value ? `${e.target.value}T23:59:59Z` : '')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm" data-testid="admin-visitors-date-to" />
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)}
            className="h-4 w-4 accent-brand-blue" data-testid="admin-visitors-active-only" />
          <span className="text-sm">Active only</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)}
            className="h-4 w-4 accent-slate-500" data-testid="admin-visitors-include-deleted" />
          <span className="text-sm">Include deleted</span>
        </label>
        <button onClick={load} disabled={loading}
          className="px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          data-testid="admin-visitors-refresh">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 text-sm">{error}</div>}

      {/* Bulk selection toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-slate-900 text-white px-4 py-2 rounded-2xl" data-testid="bulk-toolbar">
          <span className="text-sm font-semibold" data-testid="bulk-selected-count">{selected.size} selected</span>
          <button onClick={() => setShowBulkConfirm(true)}
            className="ml-auto px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
            data-testid="bulk-delete-open">
            Delete selected
          </button>
          <button onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-white text-xs font-semibold hover:bg-slate-800"
            data-testid="bulk-clear">
            Clear
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm" data-testid="admin-visitors-table">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="w-10 px-3 py-2">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  className="h-4 w-4 accent-brand-blue" data-testid="admin-visitors-select-all"
                  aria-label="Select all rows on this page" />
              </th>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Company</th>
              <th className="text-left px-4 py-2">Site</th>
              <th className="text-left px-4 py-2">Signed in</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSel = selected.has(r.id);
              const isDel = !!r.deleted_at;
              return (
                <tr key={r.id}
                  className={`border-t border-slate-100 hover:bg-slate-50 ${isSel ? 'bg-blue-50' : ''} ${isDel ? 'opacity-60' : ''}`}
                  data-testid={`admin-visitors-row-${r.id}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={isSel} disabled={isDel}
                      onChange={() => toggleOne(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 accent-brand-blue"
                      data-testid={`admin-visitors-select-${r.id}`}
                      aria-label={`Select ${r.name}`} />
                  </td>
                  <td className="px-4 py-2 font-medium cursor-pointer" onClick={() => setDrawerId(r.id)}
                    data-testid={`admin-visitors-open-${r.id}`}>
                    {r.name}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{r.company || '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{r.site_name || r.site_id || '—'}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs" title={r.signed_in_at ? new Date(r.signed_in_at).toLocaleString() : ''}>
                    {relTime(r.signed_in_at)}
                  </td>
                  <td className="px-4 py-2"><StatusPill row={r} /></td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setDrawerId(r.id)}
                      className="text-xs px-3 py-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
                      data-testid={`admin-visitors-view-${r.id}`}>
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No visitors match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {drawerId && (
        <DetailDrawer visitorId={drawerId} onClose={() => setDrawerId(null)}
          onDeleted={load} onSignedOut={load} />
      )}
      {showBulkConfirm && (
        <BulkDeleteModal rows={selectedRows}
          onCancel={() => !bulkBusy && setShowBulkConfirm(false)}
          onConfirm={runBulkDelete} busy={bulkBusy} />
      )}
    </div>
  );
}
