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
      />

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
    </div>
  );
}
