// v160.3.9.48 — HR Employee detail drawer.
//
// Right-side slide-over with three tabs: Detail (full field set with
// masked DOB / address / next-of-kin phone), Activity (per-employee
// audit trail from `GET /hr/employees/audit`), and Edit (inline
// PATCH form for a curated field subset).
//
// PII reveal buttons live in the Detail tab. Each POST writes a
// `reveal-dob` / `reveal-address` / `reveal-next-of-kin` audit row
// server-side, then swaps the masked value inline for the raw one.
//
// Archive / Restore lives in the header. Archive is idempotent
// (`POST /{uid}/archive`); Restore is a PATCH that flips the
// `archived` field back to `Active`.
import React from 'react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';

const DETAIL_FIELDS = [
  { key: 'employee_id',          label: 'Employee ID' },
  { key: 'first_name',           label: 'First name' },
  { key: 'middle_name',          label: 'Middle name' },
  { key: 'last_name',            label: 'Last name' },
  { key: 'preferred_name',       label: 'Preferred name' },
  { key: 'email',                label: 'Email' },
  { key: 'username',             label: 'Username' },
  { key: 'business_unit',        label: 'Business unit' },
  { key: 'employment_status',    label: 'Employment status' },
  { key: 'manager',              label: 'Manager' },
  { key: 'payroll_number',       label: 'Payroll #' },
  { key: 'position_title',       label: 'Position' },
  { key: 'start_date',           label: 'Start date' },
  { key: 'termination_date',     label: 'Termination date' },
  { key: 'terminated_employee',  label: 'Terminated?' },
  { key: 'archived',             label: 'Archived state' },
  { key: 'phone_number',         label: 'Phone' },
  { key: 'mobile_number',        label: 'Mobile' },
  { key: 'suburb',               label: 'Suburb' },
  { key: 'state',                label: 'State' },
  { key: 'postcode',             label: 'Postcode' },
  { key: 'country',              label: 'Country' },
  { key: 'gender',               label: 'Gender' },
  { key: 'working_visa',         label: 'Working visa' },
  { key: 'next_of_kin_first_name',   label: 'Next-of-kin first name' },
  { key: 'next_of_kin_last_name',    label: 'Next-of-kin last name' },
  { key: 'next_of_kin_relationship', label: 'Next-of-kin relationship' },
  { key: 'notes',                label: 'Notes' },
];

// v48 — Editable subset. Employee ID / content_hash / id / archived
// (managed via archive/restore actions) are excluded server-side too.
const EDITABLE_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'preferred_name',
  'email', 'phone_number', 'mobile_number',
  'business_unit', 'employment_status', 'manager',
  'position_title', 'payroll_number',
  'suburb', 'state', 'postcode', 'country',
  'notes',
];

function Row({ label, children, testid }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-slate-100 last:border-b-0"
         data-testid={testid}>
      <div className="text-xs font-semibold text-slate-500 min-w-[180px] pt-0.5">
        {label}
      </div>
      <div className="text-sm text-slate-800 flex-1 break-words">{children}</div>
    </div>
  );
}

export default function HrEmployeeDrawer({ uid, onClose, onChanged }) {
  const [tab, setTab] = React.useState('detail');
  const [doc, setDoc] = React.useState(null);
  const [audit, setAudit] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [revealed, setRevealed] = React.useState({}); // {dob, address, nok}
  const [edit, setEdit] = React.useState({});

  const load = React.useCallback(async () => {
    try {
      const { data } = await api.get(`/hr/employees/${encodeURIComponent(uid)}`);
      setDoc(data);
      setEdit({});
    } catch (e) {
      toast.error(apiError(e));
    }
  }, [uid]);

  const loadAudit = React.useCallback(async () => {
    try {
      const { data } = await api.get('/hr/employees/audit', {
        params: { employee_id: doc?.employee_id, limit: 100 },
      });
      setAudit(data.items || []);
    } catch (e) {
      toast.error(apiError(e));
    }
  }, [doc?.employee_id]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { if (tab === 'activity' && doc) loadAudit(); }, [tab, doc, loadAudit]);

  if (!doc) {
    return (
      <div className="fixed inset-0 bg-slate-900/40 z-50 flex justify-end" data-testid="hr-drawer-loading">
        <div className="w-full max-w-[720px] bg-white h-full p-6">Loading…</div>
      </div>
    );
  }

  const doReveal = async (kind) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/hr/employees/${encodeURIComponent(uid)}/reveal-${kind}`);
      setRevealed((prev) => ({ ...prev, [kind]: data }));
      toast.success(`Revealed — audit row written.`);
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  };

  const doArchive = async () => {
    setBusy(true);
    try {
      await api.post(`/hr/employees/${encodeURIComponent(uid)}/archive`);
      toast.success('Archived.');
      onChanged?.();
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const doRestore = async () => {
    setBusy(true);
    try {
      await api.patch(`/hr/employees/${encodeURIComponent(uid)}`, { archived: 'Active' });
      toast.success('Restored to Active.');
      onChanged?.();
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const doSaveEdits = async () => {
    if (Object.keys(edit).length === 0) return;
    setBusy(true);
    try {
      await api.patch(`/hr/employees/${encodeURIComponent(uid)}`, edit);
      toast.success('Saved.');
      onChanged?.();
      await load();
      setTab('detail');
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex justify-end"
         onClick={onClose}
         data-testid="hr-drawer">
      <div
        className="w-full max-w-[820px] bg-white h-full flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-start gap-3">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
              Employee {doc.employee_id}
            </div>
            <div className="text-xl font-bold text-slate-900 mt-0.5" data-testid="hr-drawer-name">
              {[doc.first_name, doc.middle_name, doc.last_name].filter(Boolean).join(' ')}
            </div>
            <div className="text-sm text-slate-500 mt-0.5">
              {doc.position_title || doc.business_unit || '—'}
            </div>
            {doc.security_flag && (
              <div className="mt-2 inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-semibold"
                   data-testid="hr-drawer-flag">
                ⚠ Security flag: {doc.security_flag}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 items-end">
            {doc.archived === 'Archived' ? (
              <button
                disabled={busy}
                onClick={doRestore}
                className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
                data-testid="hr-drawer-restore">
                Restore
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={doArchive}
                className="px-3 py-1.5 rounded bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900"
                data-testid="hr-drawer-archive">
                Archive
              </button>
            )}
            <button onClick={onClose}
                    className="text-slate-500 text-sm hover:text-slate-800"
                    data-testid="hr-drawer-close">
              ✕ Close
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 flex gap-2 border-b border-slate-200">
          {[
            { k: 'detail',   label: 'Detail' },
            { k: 'activity', label: 'Activity log' },
            { k: 'edit',     label: 'Edit' },
          ].map((t) => (
            <button key={t.k}
                    onClick={() => setTab(t.k)}
                    className={
                      'px-3 py-2 text-sm font-semibold border-b-2 transition ' +
                      (tab === t.k
                        ? 'border-slate-900 text-slate-900'
                        : 'border-transparent text-slate-500 hover:text-slate-800')
                    }
                    data-testid={`hr-drawer-tab-${t.k}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'detail' && (
            <div>
              <Row label="Date of birth" testid="hr-drawer-dob-row">
                <span className="font-mono">
                  {revealed.dob?.date_of_birth || doc.date_of_birth_masked || '—'}
                </span>
                {!revealed.dob && doc.date_of_birth_masked && (
                  <button
                    disabled={busy}
                    onClick={() => doReveal('dob')}
                    className="ml-3 text-xs px-2 py-0.5 rounded border border-violet-400 text-violet-700 hover:bg-violet-50"
                    data-testid="hr-drawer-reveal-dob">
                    Reveal DOB
                  </button>
                )}
              </Row>
              <Row label="Address" testid="hr-drawer-address-row">
                <span className="font-mono">
                  {revealed.address
                    ? [revealed.address.address_line_1, revealed.address.address_line_2]
                        .filter(Boolean).join(', ') || '—'
                    : (doc.address_line_1_masked || '—')}
                </span>
                {!revealed.address && doc.address_line_1_masked && (
                  <button
                    disabled={busy}
                    onClick={() => doReveal('address')}
                    className="ml-3 text-xs px-2 py-0.5 rounded border border-violet-400 text-violet-700 hover:bg-violet-50"
                    data-testid="hr-drawer-reveal-address">
                    Reveal address
                  </button>
                )}
              </Row>
              <Row label="Next-of-kin phone" testid="hr-drawer-nok-row">
                <span className="font-mono">
                  {revealed['next-of-kin']?.next_of_kin_phone_number
                    || doc.next_of_kin_phone_number_masked || '—'}
                </span>
                {!revealed['next-of-kin'] && doc.next_of_kin_phone_number_masked && (
                  <button
                    disabled={busy}
                    onClick={() => doReveal('next-of-kin')}
                    className="ml-3 text-xs px-2 py-0.5 rounded border border-violet-400 text-violet-700 hover:bg-violet-50"
                    data-testid="hr-drawer-reveal-nok">
                    Reveal next-of-kin
                  </button>
                )}
              </Row>
              <div className="mt-3">
                {DETAIL_FIELDS.map((f) => (
                  <Row key={f.key} label={f.label} testid={`hr-drawer-field-${f.key}`}>
                    {doc[f.key] || <span className="text-slate-300">—</span>}
                  </Row>
                ))}
              </div>
            </div>
          )}

          {tab === 'activity' && (
            <div data-testid="hr-drawer-activity">
              {audit.length === 0 && <div className="text-sm text-slate-500">No activity yet.</div>}
              {audit.map((r) => (
                <div key={r.id} className="py-2 border-b border-slate-100 last:border-b-0">
                  <div className="text-sm text-slate-800">
                    <span className="font-mono text-xs bg-slate-100 rounded px-1.5 py-0.5 mr-2">
                      {r.action}
                    </span>
                    {r.actor_email || r.actor_id}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {r.at} · IP {r.ip || '—'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'edit' && (
            <div data-testid="hr-drawer-edit-form">
              <div className="grid grid-cols-2 gap-3">
                {EDITABLE_FIELDS.map((k) => (
                  <div key={k}>
                    <label className="text-xs font-semibold text-slate-500">{k}</label>
                    <input
                      type="text"
                      defaultValue={doc[k] || ''}
                      onChange={(e) => setEdit((prev) => ({ ...prev, [k]: e.target.value }))}
                      className="w-full px-2 py-1 border border-slate-300 rounded text-sm mt-0.5"
                      data-testid={`hr-drawer-edit-${k}`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <button
                  disabled={busy || Object.keys(edit).length === 0}
                  onClick={doSaveEdits}
                  className="px-4 py-1.5 rounded bg-slate-900 text-white text-sm font-semibold disabled:opacity-40"
                  data-testid="hr-drawer-save"
                >
                  Save changes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
