// v160.3.9.48 — HR Employees Register page.
//
// Active + Archived tabs, server-side sparse column set (`GET /columns`),
// search + business_unit / employment_status / manager filters, and a
// bright amber banner whenever `security_flag_count > 0`. Row click
// opens `<HrEmployeeDrawer>` for detail + PII reveal actions.
import React from 'react';
import { toast } from 'sonner';

import api, { apiError } from '../../lib/api';
import { PageHeader } from '../../components/capture/Ui';
import HrEmployeeDrawer from './HrEmployeeDrawer';

const FIXED_COLUMNS = [
  { key: 'employee_id',       label: 'ID',           width: 70 },
  { key: 'first_name',        label: 'First name',   width: 140 },
  { key: 'last_name',         label: 'Last name',    width: 140 },
  { key: 'email',             label: 'Email',        width: 220 },
  { key: 'business_unit',     label: 'Business unit', width: 180 },
  { key: 'employment_status', label: 'Employment',   width: 130 },
  { key: 'manager',           label: 'Manager',      width: 160 },
];

export default function HrEmployeesPage() {
  const [tab, setTab] = React.useState('active');    // active | archived
  const [q, setQ] = React.useState('');
  const [businessUnit, setBusinessUnit] = React.useState('');
  const [employmentStatus, setEmploymentStatus] = React.useState('');
  const [manager, setManager] = React.useState('');
  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [flagCount, setFlagCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [openId, setOpenId] = React.useState(null);
  // v160.3.9.49 — "Refresh from Simpro" tactile state (mirrors the
  // v42.3 Users pattern — spinner + 500 ms floor + toast + reload).
  // The endpoint re-parses the on-disk `hr_employees_source.xlsx`
  // (see `POST /hr/employees/refresh-from-source`) — treated as our
  // Simpro sync equivalent until Simpro exposes an HR endpoint.
  const [isRefreshingSimpro, setIsRefreshingSimpro] = React.useState(false);
  // v160.3.9.49 — Row-level delete confirm target. `null` = closed.
  const [confirmDelete, setConfirmDelete] = React.useState(null);
  const [deleting, setDeleting] = React.useState(false);

  const refreshFromSimpro = async () => {
    if (isRefreshingSimpro) return;
    setIsRefreshingSimpro(true);
    const started = Date.now();
    try {
      const { data } = await api.post('/hr/employees/refresh-from-source');
      toast.success(
        `HR refresh — ${data.parsed_rows} parsed · ` +
        `${data.inserted ?? 0} new · ${data.updated ?? 0} updated · ` +
        `${data.security_flags ?? 0} flagged`,
      );
      await load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      const elapsed = Date.now() - started;
      const remaining = Math.max(0, 500 - elapsed);
      setTimeout(() => setIsRefreshingSimpro(false), remaining);
    }
  };

  const deleteRow = async (row) => {
    if (!row) return;
    setDeleting(true);
    try {
      await api.delete(`/hr/employees/${encodeURIComponent(row.id || row.employee_id)}`);
      toast.success(`Deleted ${row.first_name || ''} ${row.last_name || ''}`.trim());
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDeleting(false);
    }
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = { archived: tab, limit: 500 };
      if (q) params.q = q;
      if (businessUnit) params.business_unit = businessUnit;
      if (employmentStatus) params.employment_status = employmentStatus;
      if (manager) params.manager = manager;
      const { data } = await api.get('/hr/employees/', { params });
      setItems(data.items || []);
      setTotal(data.total || 0);
      setFlagCount(data.security_flag_count || 0);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }, [tab, q, businessUnit, employmentStatus, manager]);

  React.useEffect(() => { load(); }, [load]);

  // Derive filter options from the current result set. Cheap on <200 rows.
  const businessUnits = React.useMemo(
    () => Array.from(new Set(items.map((r) => r.business_unit).filter(Boolean))).sort(),
    [items],
  );
  const employmentStatuses = React.useMemo(
    () => Array.from(new Set(items.map((r) => r.employment_status).filter(Boolean))).sort(),
    [items],
  );
  const managers = React.useMemo(
    () => Array.from(new Set(items.map((r) => r.manager).filter(Boolean))).sort(),
    [items],
  );

  return (
    <div className="max-w-[1600px] mx-auto pb-16" data-testid="hr-employees-page">
      <PageHeader
        crumb="Settings / HR Employees"
        title="HR Employees"
        subtitle="Full employee register with PII masking and audit trail."
        action={
          <button
            type="button"
            onClick={refreshFromSimpro}
            disabled={isRefreshingSimpro}
            data-testid="hr-refresh-simpro-btn"
            data-refreshing={isRefreshingSimpro ? 'true' : 'false'}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Re-parse the HR source spreadsheet and upsert every row"
          >
            <span className={isRefreshingSimpro ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
            {isRefreshingSimpro ? 'Refreshing…' : 'Refresh from Simpro'}
          </button>
        }
      />

      {/* v53 Piece D — Collapsible "how does data get here" note for
          non-technical staff. Default collapsed; expands to 5 plain-
          English bullets covering ingest / refresh / manual / linkage /
          PII behaviour. */}
      <details className="mb-4 rounded-lg border border-slate-200 bg-slate-50 open:bg-white open:shadow-sm"
               data-testid="hr-info-banner">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-slate-700 hover:text-slate-900 flex items-center gap-2">
          <span aria-hidden className="text-sky-600">ⓘ</span>
          <span className="font-semibold">How does data get here?</span>
          <span className="text-xs text-slate-500 ml-2">(tap to expand)</span>
        </summary>
        <div className="px-4 pb-4 pt-1 text-sm text-slate-700 space-y-1.5" data-testid="hr-info-banner-body">
          <div>
            • <b>Initial 121 rows</b> — seeded at first boot from
            <code className="mx-1 px-1 rounded bg-slate-100 text-[12px]">/app/backend/scripts/data/hr_employees_source.xlsx</code>
            via the v48 ingest migration
            (<code className="mx-1 px-1 rounded bg-slate-100 text-[12px]">import_hr_employees.py</code>).
          </div>
          <div>
            • <b>Ongoing refresh</b> — the <i>Refresh from Simpro</i> button (top-right) calls
            <code className="mx-1 px-1 rounded bg-slate-100 text-[12px]">POST /api/hr/employees/refresh-from-source</code>;
            it re-parses the same XLSX and does a <b>merge-safe <code>$set</code></b> per row (existing fields you edited in the drawer stay; source columns overwrite). Rows removed at the source are <b>NOT</b> auto-deleted here — offboarding is manual.
          </div>
          <div>
            • <b>Manual entry</b> — no in-app "Add employee" form yet; new hires enter via the XLSX + refresh. Ask an admin if you need a row created ad-hoc.
          </div>
          <div>
            • <b>Worker linkage</b> — the <code className="px-1 rounded bg-slate-100 text-[12px]">linked_worker_id</code> field is reserved on the schema; the Employee ↔ Worker linker UI is queued as a follow-up.
          </div>
          <div>
            • <b>PII &amp; delete</b> — every <i>Reveal DOB / Address / Next-of-kin</i> click writes an audit row (actor, IP, timestamp). Delete is <b>soft-delete</b> only — the row hides from lists but the audit trail is preserved.
          </div>
        </div>
      </details>

      {flagCount > 0 && (
        <div
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 flex items-start gap-3"
          data-testid="hr-security-flag-banner"
        >
          <span className="text-xl" aria-hidden>⚠</span>
          <div className="text-sm">
            <div className="font-semibold">
              {flagCount} employee record{flagCount === 1 ? '' : 's'} flagged during import
            </div>
            <div className="text-amber-800/90 mt-0.5">
              A plaintext password fragment was detected in the Notes column
              on import and the Notes field has been redacted. The original
              value is preserved in the audit trail.
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-3" data-testid="hr-tabs">
        {[
          { k: 'active',   label: 'Active' },
          { k: 'archived', label: 'Archived' },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={
              'px-4 py-1.5 rounded-full text-sm font-semibold border transition ' +
              (tab === t.k
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')
            }
            data-testid={`hr-tab-${t.k}`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto text-sm text-slate-500 self-center" data-testid="hr-total">
          {loading ? 'Loading…' : `${total} ${tab === 'active' ? 'active' : 'archived'} employee${total === 1 ? '' : 's'}`}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3" data-testid="hr-filters">
        <input
          type="search"
          placeholder="Search name, email, ID, business unit…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="px-3 py-1.5 rounded border border-slate-300 text-sm min-w-[280px]"
          data-testid="hr-filter-search"
        />
        <select
          value={businessUnit}
          onChange={(e) => setBusinessUnit(e.target.value)}
          className="px-3 py-1.5 rounded border border-slate-300 text-sm"
          data-testid="hr-filter-business-unit"
        >
          <option value="">All business units</option>
          {businessUnits.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select
          value={employmentStatus}
          onChange={(e) => setEmploymentStatus(e.target.value)}
          className="px-3 py-1.5 rounded border border-slate-300 text-sm"
          data-testid="hr-filter-employment-status"
        >
          <option value="">All employment</option>
          {employmentStatuses.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select
          value={manager}
          onChange={(e) => setManager(e.target.value)}
          className="px-3 py-1.5 rounded border border-slate-300 text-sm"
          data-testid="hr-filter-manager"
        >
          <option value="">All managers</option>
          {managers.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="hr-table">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                {FIXED_COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-left font-semibold border-b border-slate-200"
                      style={{ minWidth: c.width }}>
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-left font-semibold border-b border-slate-200">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !loading && (
                <tr><td colSpan={FIXED_COLUMNS.length + 1} className="px-3 py-6 text-center text-slate-500">
                  No {tab} employees.
                </td></tr>
              )}
              {items.map((row) => (
                <tr key={row.id || row.employee_id}
                    className="hover:bg-slate-50 cursor-pointer border-b border-slate-100"
                    onClick={() => setOpenId(row.id || row.employee_id)}
                    data-testid={`hr-row-${row.employee_id}`}>
                  {FIXED_COLUMNS.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-slate-800">
                      {row[c.key] || <span className="text-slate-300">—</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {row.security_flag && (
                      <span className="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs mr-1"
                            data-testid={`hr-row-flag-${row.employee_id}`}>
                        ⚠ Flagged
                      </span>
                    )}
                    {row.archived === 'Archived' && (
                      <span className="inline-block px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-xs">
                        Archived
                      </span>
                    )}
                    {row.terminated_employee === 'Yes' && (
                      <span className="inline-block px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-xs ml-1">
                        Terminated
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(row); }}
                      className="ml-2 text-xs text-rose-600 hover:text-rose-800 font-semibold"
                      data-testid={`hr-row-delete-${row.employee_id}`}
                      title="Soft-delete this employee"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openId && (
        <HrEmployeeDrawer
          uid={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}
          data-testid="hr-delete-confirm"
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="text-lg font-semibold text-slate-900">
              Delete employee?
            </div>
            <div className="text-sm text-slate-600 mt-1">
              <span className="font-semibold">
                {[confirmDelete.first_name, confirmDelete.last_name].filter(Boolean).join(' ')}
              </span>{' '}
              (ID {confirmDelete.employee_id}) will be soft-deleted (hidden from
              every list). Their audit trail is preserved. An admin can restore
              via direct DB access if needed.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="px-4 py-1.5 rounded border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                data-testid="hr-delete-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteRow(confirmDelete)}
                disabled={deleting}
                className="px-4 py-1.5 rounded bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
                data-testid="hr-delete-confirm-btn"
              >
                {deleting ? 'Deleting…' : 'Delete employee'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
