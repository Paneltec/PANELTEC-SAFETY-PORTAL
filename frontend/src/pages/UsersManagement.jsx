import React, { useEffect, useMemo, useState } from 'react';
import { UserPlus, Check, X as XIcon, Minus, RotateCcw, ShieldCheck, Save, Mail, Download, Loader2, AlertCircle, Search as SearchIcon, LogOut, Trash2, KeyRound, AlertTriangle, Pencil, Sparkles, Wand2 } from 'lucide-react';
// Phase 3.20 Wave 1 — row-action + toolbar icons migrated to Fluent.
// 20-pixel Regular variant for actions, matching the spec.
import {
  Key20Regular as FlKey,
  Edit20Regular as FlEdit,
  SignOut20Regular as FlSignOut,
  Delete20Regular as FlDelete,
  Mail20Regular as FlMail,
  PersonAdd20Regular as FlPersonAdd,
  ArrowDownload20Regular as FlDownload,
} from '@fluentui/react-icons';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader } from '../components/capture/Ui';
import { RESOURCE_LABELS, EMAIL_SUPPORTED, useCan } from '../lib/permissions';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
// Phase 4.7 — admin access controls (invite / PIN / reset / unlock).
import AccessSection from '../components/auth/AccessSection';
import AccessKebab from '../components/auth/AccessKebab';

const ROLES = ['admin', 'hseq_lead', 'supervisor', 'worker', 'auditor'];
const ROLE_LABELS = { admin: 'Admin', hseq_lead: 'HSEQ Lead', supervisor: 'Supervisor', worker: 'Worker', auditor: 'Auditor' };
const STATUSES = ['active', 'invited', 'disabled'];
const STATUS_LABELS = { active: 'Active', invited: 'Invited', disabled: 'Disabled' };
const ACTIONS = ['open', 'view', 'edit', 'email'];
const RESOURCES = Object.keys(RESOURCE_LABELS);

function StatusPill({ status }) {
  const map = { active: 'bg-emerald-100 text-emerald-800', invited: 'bg-amber-100 text-amber-800', disabled: 'bg-slate-200 text-slate-600' };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${map[status] || 'bg-slate-100'}`}>{status || 'active'}</span>;
}

function inviteMailtoHref(user) {
  const loginUrl = `${window.location.origin}/login`;
  const subject = 'Welcome to Paneltec Civil';
  const body = [
    `Hi ${user.name || ''},`,
    '',
    `You have been invited to join Paneltec Civil as a ${user.role}.`,
    '',
    'Sign in here to set your password and start using the platform:',
    loginUrl,
    '',
    'If you have any questions, just reply to this email.',
    '',
    '— Paneltec Civil',
  ].join('\n');
  return `mailto:${user.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function ConfirmActionModal({ kind, user, busy, onConfirm, onClose }) {
  const isDelete = kind === 'delete';
  const title = isDelete ? `Delete ${user.name || user.email}?` : `Force sign-out ${user.name || user.email}?`;
  const body = isDelete
    ? 'They will lose access immediately and their active sessions will be revoked. This is a soft-delete — an admin can restore the account from Mongo. SWMS sign-offs, sign-ons and audit records authored by this user are preserved.'
    : "They'll be signed out everywhere and need to sign in again. Their account, role and permissions are unchanged.";
  const cta = isDelete ? 'Delete user' : 'Sign them out';
  const ctaClass = isDelete
    ? 'bg-rose-600 hover:bg-rose-700'
    : 'bg-amber-600 hover:bg-amber-700';

  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);

  return (
    <div
      data-testid={isDelete ? 'user-delete-modal' : 'user-signout-modal'}
      className="fixed inset-0 z-[70] bg-slate-900/70 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose?.()}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3">
          <div className={`inline-flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 ${isDelete ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-slate-900 truncate">{title}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{user.email} · {user.role}</p>
          </div>
        </div>
        <div className="px-5 py-4 text-sm text-slate-700 leading-relaxed">{body}</div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            data-testid={isDelete ? 'user-delete-cancel' : 'user-signout-cancel'}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            data-testid={isDelete ? 'user-delete-confirm' : 'user-signout-confirm'}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-bold ${ctaClass} disabled:opacity-60`}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : (isDelete ? <Trash2 size={14} /> : <LogOut size={14} />)}
            {busy ? 'Working…' : cta}
          </button>
        </div>
      </div>
    </div>
  );
}


export default function UsersManagement() {
  const can = useCan();
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ role: '', status: 'active' });
  const [active, setActive] = useState(null);
  const [activeTab, setActiveTab] = useState('profile');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [simproStatus, setSimproStatus] = useState({ connected: false, companies: [] });
  const [confirmAction, setConfirmAction] = useState(null); // { kind: 'delete'|'signout', user }
  const [actionBusy, setActionBusy] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const me = getUser();

  const load = async () => { try { const { data } = await api.get('/users'); setUsers(data); } catch (e) { toast.error(apiError(e)); } };
  const loadSimpro = async () => {
    try {
      const { data } = await api.get('/integrations/simpro');
      const ok = data?.status === 'connected';
      const companies = (data?.companies_status || []).filter((c) => c.status === 'ok');
      setSimproStatus({ connected: ok && companies.length > 0, companies });
    } catch { setSimproStatus({ connected: false, companies: [] }); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); loadSimpro(); }, []);

  if (!can('users', 'view')) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500" data-testid="users-denied">Access denied — you need users.view permission.</div>;
  }
  const filtered = users.filter((u) => (!filters.role || u.role === filters.role) && (!filters.status || u.status === filters.status));
  const disabledCount = users.filter((u) => u.status === 'disabled').length;
  const bulkable = filtered.filter((u) => u.id !== me?.id && !u.deleted_at);
  const bulkAllChecked = bulkable.length > 0 && bulkable.every((u) => bulkSelected.has(u.id));
  const toggleBulk = (uid) => setBulkSelected((s) => { const n = new Set(s); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  const toggleBulkAll = () => setBulkSelected((s) => bulkAllChecked ? new Set() : new Set(bulkable.map((u) => u.id)));
  const runBulkDelete = async () => {
    setActionBusy(true);
    try {
      const ids = Array.from(bulkSelected);
      const { data } = await api.post('/users/bulk-delete', { user_ids: ids });
      const parts = [`Deleted ${data.deleted}`];
      if (data.skipped_self) parts.push(`skipped self ${data.skipped_self}`);
      if (data.skipped_last_admin) parts.push(`skipped last-admin ${data.skipped_last_admin}`);
      if (data.skipped_already_disabled) parts.push(`already disabled ${data.skipped_already_disabled}`);
      toast.success(parts.join(' · '));
      setBulkSelected(new Set());
      setBulkConfirmOpen(false);
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setActionBusy(false); }
  };

  return (
    <div className="max-w-6xl mx-auto" data-testid="users-page">
      <PageHeader crumb="Settings / Users" title="Users & permissions"
        subtitle={`${users.length} users in your org`}
        action={can('users', 'edit') ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setImportOpen(true)}
              disabled={!simproStatus.connected}
              data-testid="import-from-simpro-btn"
              title={simproStatus.connected ? 'Import employees from Simpro' : 'Connect Simpro in Settings → Integrations first'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={14} /> Import from Simpro
            </button>
            <button onClick={() => setInviteOpen(true)} data-testid="invite-user-btn"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600">
              <FlPersonAdd /> Invite user
            </button>
          </div>) : null} />

      {!can('users', 'edit') && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900" data-testid="users-readonly-banner">
          You can view users but not modify them. Contact an admin to make changes.
        </div>
      )}

      <div className="flex gap-2 mb-4 items-center">
        <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5">
          <option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5" data-testid="users-status-filter">
          <option value="">All statuses</option>{['active', 'invited', 'disabled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {filters.status === 'active' && disabledCount > 0 && (
          <span className="text-[11px] text-slate-500" data-testid="users-disabled-hint">
            · {disabledCount} disabled hidden ·{' '}
            <button onClick={() => setFilters({ ...filters, status: 'disabled' })}
              className="text-blue-600 hover:underline">show</button>
          </span>
        )}
        {can('users', 'edit') && bulkSelected.size > 0 && (
          <div className="ml-auto inline-flex items-center gap-2" data-testid="users-bulk-toolbar">
            <span className="text-xs text-slate-600"><strong>{bulkSelected.size}</strong> selected</span>
            <button onClick={() => setBulkSelected(new Set())}
              data-testid="users-bulk-clear"
              className="text-xs text-slate-500 hover:underline">Clear</button>
            <button onClick={() => setBulkConfirmOpen(true)}
              data-testid="users-bulk-delete-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
              <FlDelete /> Delete {bulkSelected.size} user{bulkSelected.size === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              {can('users', 'edit') && (
                <th className="text-left px-3 py-2.5 w-8" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={bulkAllChecked}
                    disabled={bulkable.length === 0}
                    onChange={toggleBulkAll}
                    data-testid="users-bulk-select-all"
                    className="h-4 w-4 accent-rose-600" />
                </th>
              )}
              <th className="text-left px-4 py-2.5">User</th><th className="text-left px-4 py-2.5">Role</th>
              <th className="text-left px-4 py-2.5">Status</th><th className="text-left px-4 py-2.5">Permissions</th>
              <th className="text-left px-4 py-2.5">Created</th>
              {can('users', 'edit') && <th className="text-right px-4 py-2.5">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => { setActiveTab('profile'); setActive(u); }} data-testid={`user-row-${u.id}`}>
                {can('users', 'edit') && (
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    {u.id !== me?.id && (
                      <input type="checkbox"
                        checked={bulkSelected.has(u.id)}
                        onChange={() => toggleBulk(u.id)}
                        data-testid={`user-checkbox-${u.id}`}
                        className="h-4 w-4 accent-rose-600" />
                    )}
                  </td>
                )}
                <td className="px-4 py-3"><div className="flex items-center gap-2"><Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{(u.name || u.email)[0]}</AvatarFallback></Avatar>
                  <div>
                    <div className="font-medium flex items-center gap-1.5">{u.name}
                      {u.imported_from === 'simpro' && (
                        <span
                          className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200"
                          title={`Imported from Simpro${u.simpro_company_name ? ` · ${u.simpro_company_name}` : ''}${u.created_at ? ` · ${new Date(u.created_at).toLocaleDateString()}` : ''}`}
                          data-testid={`simpro-badge-${u.id}`}
                        >Simpro</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </div>
                </div></td>
                <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 bg-slate-100 rounded font-medium">{u.role}</span></td>
                <td className="px-4 py-3"><StatusPill status={u.status} /></td>
                <td className="px-4 py-3 text-xs">{u.has_permission_overrides ? <span className="text-brand-violet font-medium">Custom</span> : <span className="text-slate-500">Role default</span>}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <span>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</span>
                    {u.status === 'invited' && (
                      <a
                        href={inviteMailtoHref(u)}
                        onClick={(e) => e.stopPropagation()}
                        title="Send via your email client"
                        aria-label={`Email invite to ${u.email}`}
                        data-testid={`mailto-invite-${u.id}`}
                        className="inline-flex items-center justify-center w-6 h-6 rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-300"
                      >
                        <FlMail />
                      </a>
                    )}
                  </div>
                </td>
                {can('users', 'edit') && (
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex gap-1 items-center">
                      <AccessKebab userId={u.id} canEdit={u.id !== me?.id} onAfterAction={load} />
                      <button
                        title="Edit permissions"
                        data-testid={`user-edit-perms-${u.id}`}
                        onClick={() => { setActiveTab('permissions'); setActive(u); }}
                        className="inline-flex items-center justify-center w-7 h-7 rounded bg-violet-100 text-violet-700 hover:bg-violet-200">
                        <FlKey />
                      </button>
                      <button
                        title="Edit user"
                        data-testid={`user-edit-${u.id}`}
                        onClick={() => { setActiveTab('profile'); setActive(u); }}
                        className="inline-flex items-center justify-center w-7 h-7 rounded bg-slate-100 text-slate-700 hover:bg-slate-200">
                        <FlEdit />
                      </button>
                      <button
                        title="Force sign-out everywhere"
                        data-testid={`force-signout-${u.id}`}
                        onClick={() => setConfirmAction({ kind: 'signout', user: u })}
                        className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#fbf3df] text-[#8c6a1a] hover:bg-[#f7eed1]">
                        <FlSignOut />
                      </button>
                      {u.id !== me?.id && (
                        <button
                          title="Delete user (soft)"
                          data-testid={`delete-user-${u.id}`}
                          onClick={() => setConfirmAction({ kind: 'delete', user: u })}
                          className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#fbe4e7] text-[#7a1f33] hover:bg-[#f4c7cd]">
                          <FlDelete />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bulkConfirmOpen && (
        <div data-testid="users-bulk-delete-modal"
          className="fixed inset-0 z-[70] bg-slate-900/70 grid place-items-center p-4"
          onClick={(e) => e.target === e.currentTarget && !actionBusy && setBulkConfirmOpen(false)}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3">
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-rose-100 text-rose-700 flex-shrink-0"><AlertTriangle size={18} /></div>
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-bold text-slate-900">Delete {bulkSelected.size} user{bulkSelected.size === 1 ? '' : 's'}?</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">They will lose access immediately. This is a soft-delete — admins can restore from Mongo.</p>
              </div>
            </div>
            <div className="px-5 py-3 text-sm text-slate-700 max-h-48 overflow-auto">
              {users.filter((u) => bulkSelected.has(u.id)).map((u) => (
                <div key={u.id} className="text-xs py-0.5 truncate">• {u.name || u.email} <span className="text-slate-400">({u.role})</span></div>
              ))}
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setBulkConfirmOpen(false)} disabled={actionBusy}
                data-testid="users-bulk-delete-cancel"
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={runBulkDelete} disabled={actionBusy}
                data-testid="users-bulk-delete-confirm"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-60">
                {actionBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {actionBusy ? 'Deleting…' : `Delete ${bulkSelected.size} user${bulkSelected.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {active && <UserDrawer userRow={active} onClose={() => setActive(null)} onReload={load} canEdit={can('users', 'edit')} defaultTab={activeTab} />}
      {confirmAction && (
        <ConfirmActionModal
          kind={confirmAction.kind}
          user={confirmAction.user}
          busy={actionBusy}
          onClose={() => !actionBusy && setConfirmAction(null)}
          onConfirm={async () => {
            const { kind, user: u } = confirmAction;
            setActionBusy(true);
            try {
              if (kind === 'delete') {
                await api.delete(`/users/${u.id}`);
                toast.success(`${u.name || u.email} deleted.`);
              } else {
                await api.post(`/users/${u.id}/force-signout`);
                toast.success(`${u.name || u.email}'s sessions revoked.`);
              }
              setConfirmAction(null);
              await load();
            } catch (e) {
              toast.error(apiError(e));
            } finally {
              setActionBusy(false);
            }
          }}
        />
      )}
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onDone={load} />}
      {importOpen && <ImportFromSimproDrawer
        companies={simproStatus.companies}
        onClose={() => setImportOpen(false)}
        onDone={() => { load(); }}
      />}
    </div>
  );
}

function UserDrawer({ userRow, onClose, onReload, canEdit, defaultTab = 'profile' }) {
  const [tab, setTab] = useState(defaultTab);
  const [detail, setDetail] = useState(null);
  const [perms, setPerms] = useState(null);
  const [profile, setProfile] = useState({ name: '', email: '', role: '', status: '', workspace_ids: [] });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hardConfirm, setHardConfirm] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [permSearch, setPermSearch] = useState('');
  const [presets, setPresets] = useState({ built_in: [], custom: [] });
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [appliedPreset, setAppliedPreset] = useState(null);
  const [savePresetOpen, setSavePresetOpen] = useState(false);

  const load = async () => {
    try {
      const { data: u } = await api.get(`/users/${userRow.id}`);
      setDetail(u);
      setProfile({ name: u.name, email: u.email || '', role: u.role, status: u.status || 'active', workspace_ids: u.workspace_ids || [] });
      const { data: p } = await api.get(`/users/${userRow.id}/permissions`);
      setPerms(p);
      try { const { data: ws } = await api.get('/workspaces'); setWorkspaces(ws || []); } catch { /* ignore */ }
    } catch (e) { toast.error(apiError(e)); }
  };
  const loadPresets = async () => {
    try {
      const { data } = await api.get('/permission-presets');
      setPresets({ built_in: data.built_in || [], custom: data.custom || [] });
    } catch { /* non-fatal */ }
  };
  useEffect(() => { load(); loadPresets(); /* eslint-disable-next-line */ }, [userRow.id]);

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const saveProfile = async () => {
    setBusy(true);
    try {
      const payload = { ...profile };
      // Drop email from payload if unchanged from server detail (avoids spurious
      // collision checks) or invalid format.
      const original = (detail?.email || '').toLowerCase();
      const next = (payload.email || '').toLowerCase().trim();
      if (!next || !emailRe.test(next)) {
        delete payload.email;
      } else if (next === original) {
        delete payload.email;
      } else {
        payload.email = next;
      }
      await api.patch(`/users/${userRow.id}`, payload);
      toast.success('Profile updated'); onReload(); load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const cycle = (resource, action) => {
    if (action === 'email' && !EMAIL_SUPPORTED[resource]) return;
    setPerms((p) => {
      const o = { ...(p.overrides || {}) };
      const sub = { ...(o[resource] || {}) };
      const cur = sub[action];
      if (cur === undefined) sub[action] = true;
      else if (cur === true) sub[action] = false;
      else delete sub[action];
      if (Object.keys(sub).length === 0) delete o[resource]; else o[resource] = sub;
      // Recompute effective: default from role_defaults, override wins.
      const eff = JSON.parse(JSON.stringify(p.effective || {}));
      const defVal = p.role_defaults?.[resource]?.[action] || false;
      eff[resource] = eff[resource] || {};
      eff[resource][action] = (o[resource]?.[action] !== undefined) ? o[resource][action] : defVal;
      return { ...p, overrides: o, effective: eff };
    });
  };

  const savePerms = async () => {
    setBusy(true);
    try { await api.put(`/users/${userRow.id}/permissions`, { overrides: perms.overrides }); toast.success('Permissions saved'); onReload(); load(); setAppliedPreset(null); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  const resetPerms = async () => {
    setBusy(true);
    try { await api.post(`/users/${userRow.id}/permissions/reset`); toast.success('Reset to role defaults'); onReload(); load(); setAppliedPreset(null); setSelectedPresetId(''); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const allPresets = useMemo(
    () => [...(presets.built_in || []), ...(presets.custom || [])],
    [presets]
  );
  const applyPresetLocal = () => {
    if (!selectedPresetId) return;
    const preset = allPresets.find((p) => p.id === selectedPresetId || p.key === selectedPresetId);
    if (!preset || !perms) return;
    // Replace overrides with the preset matrix. Recompute effective off the
    // role_defaults that came back from the server.
    const overrides = {};
    const eff = JSON.parse(JSON.stringify(perms.effective || {}));
    Object.entries(preset.permissions || {}).forEach(([res, acts]) => {
      overrides[res] = {};
      Object.entries(acts || {}).forEach(([act, val]) => {
        overrides[res][act] = !!val;
        eff[res] = eff[res] || {};
        eff[res][act] = !!val;
      });
    });
    setPerms({ ...perms, overrides, effective: eff });
    setAppliedPreset({ key: preset.key || preset.id, label: preset.label, is_builtin: !!preset.is_builtin });
  };

  const handlePresetCreated = (created) => {
    setPresets((s) => ({ ...s, custom: [...(s.custom || []), created] }));
    setSelectedPresetId(created.id);
    toast.success(`Saved preset "${created.label}"`);
  };
  const disable = async () => {
    if (!window.confirm('Disable this user? They will be unable to log in.')) return;
    try { await api.delete(`/users/${userRow.id}`); toast.success('User disabled'); onReload(); onClose(); }
    catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl h-full overflow-auto p-6" onClick={(e) => e.stopPropagation()} data-testid="user-drawer">
        <div className="flex items-start justify-between"><h2 className="font-display text-xl">{userRow.name}<div className="text-sm text-slate-500 font-normal">{userRow.email}</div></h2>
          <button onClick={onClose} className="text-2xl text-slate-400">&times;</button></div>
        <div className="mt-5 border-b border-slate-200 flex gap-4">
          {['profile', 'permissions', 'sessions'].map((t) => (
            <button key={t} onClick={() => setTab(t)} data-testid={t === 'sessions' ? 'session-history-tab' : `tab-${t}`}
              className={`pb-2 text-sm font-medium ${tab === t ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-slate-500'}`}>{t === 'sessions' ? 'Session history' : t}</button>
          ))}
        </div>

        {tab === 'sessions' && (
          <SessionHistoryTab userId={userRow.id} />
        )}

        {tab === 'profile' && detail && (
          <div className="mt-5 space-y-4">
            <label className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Name</div>
              <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" disabled={!canEdit} data-testid="user-name" /></label>
            <label className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Email</div>
              <input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50 disabled:text-slate-500"
                disabled={!canEdit} placeholder="name@example.com" autoComplete="off" data-testid="user-email" />
              {profile.email && !emailRe.test(profile.email.trim()) && (
                <div className="text-[11px] text-rose-600 mt-1">Enter a valid email address.</div>
              )}
            </label>
            <div className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Role</div>
              <Select value={profile.role || undefined} onValueChange={(v) => setProfile({ ...profile, role: v })} disabled={!canEdit}>
                <SelectTrigger className="w-full" data-testid="user-role"><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r} data-testid={`role-opt-${r}`}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Status</div>
              <Select value={profile.status || undefined} onValueChange={(v) => setProfile({ ...profile, status: v })} disabled={!canEdit}>
                <SelectTrigger className="w-full" data-testid="user-status"><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} data-testid={`status-opt-${s}`}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-[11px] text-slate-500 mt-1">Changing role / status / email will sign the user out of any active sessions.</div>
            </div>
            <div className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Workspaces</div>
              {workspaces.length === 0 ? <div className="text-xs text-slate-400 italic">No workspaces in your org.</div> : (
                <div className="space-y-1 border border-slate-200 rounded-lg p-2" data-testid="user-workspaces">
                  {workspaces.map((w) => (
                    <label key={w.id} className="flex items-center gap-2 text-sm px-1 py-0.5 hover:bg-slate-50 rounded cursor-pointer">
                      <input type="checkbox" disabled={!canEdit}
                        checked={profile.workspace_ids.includes(w.id)}
                        onChange={(e) => setProfile((p) => ({ ...p, workspace_ids: e.target.checked
                          ? [...p.workspace_ids, w.id]
                          : p.workspace_ids.filter((x) => x !== w.id) }))}
                        data-testid={`ws-toggle-${w.id}`} />
                      <span>{w.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {canEdit && (
              <div className="pt-4 border-t border-slate-200" data-testid="drawer-access-block">
                <AccessSection userId={userRow.id} />
              </div>
            )}
            {canEdit && (
              <div className="flex gap-2 pt-2 flex-wrap"><button onClick={saveProfile} disabled={busy} className="px-4 py-2 bg-brand-blue text-white rounded-lg text-sm inline-flex items-center gap-1.5" data-testid="save-profile"><Save size={13} /> Save changes</button>
                {profile.status === 'active' && <button onClick={() => setConfirmDelete(true)} className="px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm" data-testid="disable-user">Disable user</button>}
                {profile.status === 'disabled' && <button onClick={() => { setProfile({ ...profile, status: 'active' }); setTimeout(saveProfile, 0); }} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm" data-testid="reactivate-user">Reactivate</button>}
              </div>
            )}
          </div>
        )}

        {tab === 'permissions' && perms && (
          <div className="mt-5" data-testid="user-permissions-modal">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <div className="text-sm text-slate-700"><ShieldCheck size={13} className="inline mr-1 text-brand-blue" /> Role default: <strong>{perms.role}</strong></div>
              {canEdit && <button onClick={resetPerms} data-testid="perm-reset-defaults" className="text-xs inline-flex items-center gap-1 px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"><RotateCcw size={11} /> Reset to defaults</button>}
            </div>

            {canEdit && (
              <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2.5" data-testid="preset-picker">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] uppercase tracking-wider font-bold text-violet-700 inline-flex items-center gap-1.5">
                    <Wand2 size={12} /> Quick apply preset
                  </div>
                  <button onClick={() => setSavePresetOpen(true)} disabled={!perms.overrides || Object.keys(perms.overrides).length === 0}
                    data-testid="save-current-as-preset"
                    title={!perms.overrides || Object.keys(perms.overrides).length === 0 ? 'Tweak the matrix below, then save as a preset' : 'Save the current matrix as a custom preset'}
                    className="text-[11px] text-violet-700 hover:underline disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed inline-flex items-center gap-1">
                    <Sparkles size={11} /> Save current as new preset…
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <select value={selectedPresetId} onChange={(e) => setSelectedPresetId(e.target.value)}
                    data-testid="preset-select"
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-sm bg-white border border-violet-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400/40">
                    <option value="">Choose a preset…</option>
                    {(presets.built_in || []).length > 0 && (
                      <optgroup label="Built-in">
                        {(presets.built_in || []).map((p) => (
                          <option key={p.id} value={p.id} title={p.description} data-testid={`preset-option-${p.key}`}>{p.label}</option>
                        ))}
                      </optgroup>
                    )}
                    {(presets.custom || []).length > 0 && (
                      <optgroup label="Custom">
                        {(presets.custom || []).map((p) => (
                          <option key={p.id} value={p.id} title={p.description}>{p.label}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <button onClick={applyPresetLocal} disabled={!selectedPresetId}
                    data-testid="preset-apply-btn"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed">
                    <Wand2 size={11} /> Apply
                  </button>
                </div>
                {selectedPresetId && !appliedPreset && (
                  <div className="text-[11px] text-violet-700/80 mt-1.5">
                    {(allPresets.find((p) => p.id === selectedPresetId || p.key === selectedPresetId) || {}).description || 'Select Apply to populate the matrix below.'}
                  </div>
                )}
                {appliedPreset && (
                  <div className="mt-2 px-2.5 py-2 rounded-lg bg-white border border-violet-300 text-[12px] text-violet-900 inline-flex items-center gap-2" data-testid="preset-applied-banner">
                    <Sparkles size={12} className="text-violet-600" />
                    <span>Applied <strong>{appliedPreset.label}</strong> preset — review the matrix below, then click <strong>Save permissions</strong> to commit.</span>
                  </div>
                )}
              </div>
            )}

            <div className="relative mb-2">
              <SearchIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text" value={permSearch} onChange={(e) => setPermSearch(e.target.value)}
                placeholder="Search resources (e.g. workers, certifications, inductions)…"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                data-testid="perm-search"
              />
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr><th className="text-left px-3 py-2">Resource</th>{ACTIONS.map((a) => <th key={a} className="px-3 py-2">{a}</th>)}</tr>
                </thead>
                <tbody>
                  {RESOURCES.filter((res) => {
                    if (!permSearch.trim()) return true;
                    const s = permSearch.trim().toLowerCase();
                    return res.toLowerCase().includes(s)
                      || (RESOURCE_LABELS[res] || '').toLowerCase().includes(s);
                  }).map((res) => (
                    <tr key={res} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium">{RESOURCE_LABELS[res]}</td>
                      {ACTIONS.map((act) => {
                        const ov = perms.overrides?.[res]?.[act];
                        const isEmail = act === 'email';
                        const supported = !isEmail || EMAIL_SUPPORTED[res];
                        const eff = perms.effective?.[res]?.[act];
                        let icon, cls;
                        if (!supported) { icon = <span className="text-slate-300">—</span>; cls = ''; }
                        else if (ov === true) { icon = <Check size={14} className="text-emerald-600" />; cls = 'bg-emerald-50'; }
                        else if (ov === false) { icon = <XIcon size={14} className="text-red-600" />; cls = 'bg-red-50'; }
                        else { icon = eff ? <Check size={14} className="text-slate-400" /> : <Minus size={14} className="text-slate-300" />; cls = ''; }
                        return (
                          <td key={act} className={`px-3 py-2 text-center cursor-pointer ${cls}`}
                            onClick={() => canEdit && supported && cycle(res, act)}
                            data-testid={`perm-${res}-${act}`} title={ov === undefined ? 'Inherits from role' : `Override: ${ov}`}>
                            <div className="flex justify-center">{icon}</div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">Click a cell to cycle: <span className="inline-flex items-center gap-1"><Minus size={11} /> inherits</span> · <span className="inline-flex items-center gap-1"><Check size={11} className="text-emerald-600" /> explicit allow</span> · <span className="inline-flex items-center gap-1"><XIcon size={11} className="text-red-600" /> explicit deny</span></p>
            {canEdit && <button onClick={savePerms} disabled={busy} className="mt-4 px-4 py-2 bg-brand-blue text-white rounded-lg text-sm inline-flex items-center gap-1.5" data-testid="save-perms"><Save size={13} /> Save permissions</button>}
          </div>
        )}
        {canEdit && detail?.deleted_at && (
          <div className="mt-6 pt-4 border-t border-rose-200" data-testid="user-hard-delete-section">
            <div className="text-[11px] uppercase tracking-wider font-bold text-rose-700 mb-1.5">Danger zone</div>
            <p className="text-xs text-slate-600 mb-2">This user is soft-deleted. Permanently removing them deletes the row from Mongo — name, email, history pointer. This cannot be undone.</p>
            <button
              type="button" onClick={async () => {
                if (!hardConfirm) { setHardConfirm(true); return; }
                setBusy(true);
                try {
                  await api.delete(`/users/${detail.id}?hard=true`);
                  toast.success(`${detail.name || detail.email} permanently deleted.`);
                  onReload?.(); onClose();
                } catch (e) { toast.error(apiError(e)); }
                finally { setBusy(false); setHardConfirm(false); }
              }}
              data-testid={hardConfirm ? 'user-hard-delete-confirm' : 'user-hard-delete-btn'}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-60">
              <Trash2 size={12} /> {hardConfirm ? `Confirm — permanently delete ${detail.name || detail.email}` : 'Permanently delete'}
            </button>
            {hardConfirm && (
              <button type="button" onClick={() => setHardConfirm(false)}
                className="ml-2 text-xs text-slate-500 hover:text-slate-700">Cancel</button>
            )}
          </div>
        )}
        {savePresetOpen && (
          <SavePresetModal
            overrides={perms?.overrides || {}}
            onClose={() => setSavePresetOpen(false)}
            onCreated={(c) => { setSavePresetOpen(false); handlePresetCreated(c); }}
          />
        )}
      </div>
    </div>
  );
}

function SavePresetModal({ overrides, onClose, onCreated }) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      // Convert overrides → full matrix (assume false where absent).
      const permissions = {};
      Object.entries(overrides || {}).forEach(([res, acts]) => {
        permissions[res] = { ...acts };
      });
      const { data } = await api.post('/permission-presets', {
        label: label.trim(),
        description: description.trim(),
        permissions,
      });
      onCreated?.(data);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose?.()}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" data-testid="save-preset-modal">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-violet-100 text-violet-700 grid place-items-center"><Sparkles size={16} /></div>
          <div>
            <h3 className="font-display font-bold text-slate-900">Save current matrix as preset</h3>
            <p className="text-[11px] text-slate-500">Other admins can apply this preset to any user in your org.</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label className="block"><div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Label</div>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Family Admin"
              data-testid="save-preset-label" autoFocus
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40" /></label>
          <label className="block"><div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Description</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What this preset grants. Helps the next admin pick the right one."
              data-testid="save-preset-description" rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40" /></label>
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button onClick={submit} disabled={busy || !label.trim()}
            data-testid="save-preset-submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save preset
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteModal({ onClose, onDone }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'worker', workspace_ids: [] });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.post('/users', form); toast.success('Invite queued', { description: 'M365 not connected — message waits in outbox.' }); onDone(); onClose(); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()} data-testid="invite-modal">
        <h2 className="font-display text-xl mb-4">Invite a user</h2>
        <label className="block mb-3"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Email</div>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" data-testid="invite-email" /></label>
        <label className="block mb-3"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Name</div>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" data-testid="invite-name" /></label>
        <label className="block mb-5"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Role</div>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" data-testid="invite-role">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        <div className="flex gap-2 justify-end"><button onClick={onClose} className="px-4 py-2 border border-slate-300 rounded-lg text-sm">Cancel</button>
          <button onClick={submit} disabled={busy || !form.email || !form.name} className="px-4 py-2 bg-brand-blue text-white rounded-lg text-sm" data-testid="invite-submit">Send invite</button></div>
      </div>
    </div>
  );
}

function ImportStatusBadge({ row }) {
  if (row.is_already_imported) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-slate-200 text-slate-600" title={row.already_imported_reason || ''}>Already imported</span>;
  }
  if (row.email_missing) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-amber-100 text-amber-800" title="Add an email in Simpro to import">Email missing</span>;
  }
  return <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-emerald-100 text-emerald-800">New</span>;
}

const ROLE_OPTIONS_IMPORT = [
  { value: 'worker', label: 'Field Worker' },
  { value: 'supervisor', label: 'Site Supervisor' },
  { value: 'hseq_lead', label: 'HSEQ Lead' },
  { value: 'admin', label: 'Admin' },
];

function ImportFromSimproDrawer({ companies, onClose, onDone }) {
  const allCompanyIds = useMemo(() => companies.map((c) => String(c.id)), [companies]);
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  // Phase 3.21 — filterMode state retained internally as a constant
  // because the backend `/integrations/simpro/employees` endpoint still
  // accepts a `filter` query param. We pin it to `all` so the UI always
  // shows the full employee list (the whiteboard toggle is gone).
  const filterMode = 'all';
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  // Monotonically increasing request id used to discard stale responses
  // when the filter / company selection flips faster than the network can keep up.
  const reqIdRef = React.useRef(0);

  // Sync selectedCompanies to the companies prop on first arrival (and when
  // a new company appears that wasn't in the previous list — initial-population case).
  useEffect(() => {
    setSelectedCompanies((prev) => {
      if (prev.length === 0 && allCompanyIds.length > 0) return allCompanyIds;
      return prev;
    });
  }, [allCompanyIds]);

  // Fetch employees whenever companies/filter changes.
  // Uses a request-id guard so a slow earlier fetch can't overwrite a newer one.
  const fetchEmployees = async (ids, mode) => {
    if (ids.length === 0) { setEmployees([]); setSelected(new Set()); return; }
    reqIdRef.current += 1;
    const myReq = reqIdRef.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ company_ids: ids.join(','), filter: mode });
      const { data } = await api.get(`/integrations/simpro/employees?${qs.toString()}`);
      // Only commit results if this is still the latest in-flight request.
      if (reqIdRef.current !== myReq) return;
      setEmployees(data.employees || []);
      setSelected(new Set());
    } catch (e) {
      if (reqIdRef.current === myReq) toast.error(apiError(e));
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchEmployees(selectedCompanies, filterMode); }, [selectedCompanies.join(','), filterMode]);

  const toggleCompany = (cid) => {
    const k = String(cid);
    setSelectedCompanies((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);
  };

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return employees;
    return employees.filter((e) =>
      (e.name || '').toLowerCase().includes(s)
      || (e.email || '').toLowerCase().includes(s)
      || (e.position || '').toLowerCase().includes(s)
    );
  }, [employees, search]);

  const importableVisible = visible.filter((e) => e.importable);

  const toggleRow = (e) => {
    if (!e.importable) return;
    const k = String(e.id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const selectAllVisible = () => setSelected(new Set(importableVisible.map((e) => String(e.id))));
  const clearSelection = () => setSelected(new Set());

  const submit = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const payload = {
        employees: employees.filter((e) => selected.has(String(e.id))).map((e) => ({
          simpro_employee_id: String(e.id),
          simpro_company_id: String(e.company_id),
          email: e.email,
          first_name: e.first_name || '',
          last_name: e.last_name || '',
          name: e.name,
          mobile: e.phone || null,
          position: e.position || null,
          company_name: e.company_name || null,
        })),
      };
      const { data } = await api.post('/users/import-from-simpro', payload);
      const parts = [`Imported ${data.created}`];
      if (data.skipped?.length) parts.push(`Skipped ${data.skipped.length}`);
      toast.success(parts.join(' · '), {
        description: data.skipped?.length
          ? data.skipped.slice(0, 3).map((s) => `${s.email}: ${s.reason}`).join('  ·  ')
          : undefined,
      });
      onDone?.();
      onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose} data-testid="import-simpro-drawer">
      <div className="bg-white w-full sm:max-w-4xl h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl">Import users from Simpro</h2>
            <p className="text-xs text-slate-500 mt-0.5">Pull staff from your connected Simpro companies into Users &amp; Permissions.</p>
          </div>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-700" aria-label="Close" data-testid="import-simpro-close">&times;</button>
        </div>

        <div className="px-6 py-4 border-b border-slate-200 space-y-3 bg-slate-50">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Companies</div>
            <div className="flex flex-wrap gap-1.5">
              {companies.map((c) => {
                const k = String(c.id);
                const on = selectedCompanies.includes(k);
                return (
                  <button key={k} type="button" onClick={() => toggleCompany(c.id)}
                    data-testid={`import-company-chip-${c.id}`}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'}`}>
                    {c.name || `Company ${c.id}`} <span className="opacity-70">#{c.id}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <SearchIcon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, or position"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                data-testid="import-search"
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-2 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="text-slate-600">
            <strong>{selected.size}</strong> selected · {importableVisible.length} importable · {visible.length} shown
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={selectAllVisible} disabled={importableVisible.length === 0}
              className="text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline"
              data-testid="import-select-all">Select all (importable)</button>
            <button type="button" onClick={clearSelection} disabled={selected.size === 0}
              className="text-slate-500 hover:underline disabled:text-slate-400 disabled:no-underline"
              data-testid="import-clear">Clear</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="px-6 py-12 text-center text-slate-500 text-sm inline-flex items-center gap-2 justify-center w-full">
              <Loader2 size={14} className="animate-spin" /> Loading employees from Simpro…
            </div>
          ) : visible.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500 text-sm inline-flex items-center gap-2 justify-center w-full">
              <AlertCircle size={14} /> No employees match your filters.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-white text-[11px] uppercase tracking-wider text-slate-500 sticky top-0 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 w-8"></th>
                  <th className="text-left px-2 py-2.5">Name</th>
                  <th className="text-left px-2 py-2.5">Email</th>
                  <th className="text-left px-2 py-2.5">Mobile</th>
                  <th className="text-left px-2 py-2.5">Position</th>
                  <th className="text-left px-2 py-2.5">Company</th>
                  <th className="text-left px-2 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => {
                  const k = String(e.id);
                  const checked = selected.has(k);
                  const disabled = !e.importable;
                  return (
                    <tr key={k} className={`border-t border-slate-100 ${disabled ? 'bg-slate-50/60 opacity-70' : 'hover:bg-slate-50 cursor-pointer'}`}
                      onClick={() => { if (!disabled) toggleRow(e); }} data-testid={`import-row-${e.id}`}>
                      <td className="px-4 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                        <input type="checkbox" checked={checked} disabled={disabled}
                          onChange={() => toggleRow(e)}
                          className="h-4 w-4 accent-blue-600 disabled:opacity-50 cursor-pointer"
                          data-testid={`import-checkbox-${e.id}`} />
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7"><AvatarFallback className="text-[10px]">{(e.name || '?')[0]}</AvatarFallback></Avatar>
                          <span className="font-medium">{e.name || '—'}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-xs text-slate-600">{e.email || <span className="text-slate-400 italic">—</span>}</td>
                      <td className="px-2 py-2.5 text-xs text-slate-600">{e.phone || '—'}</td>
                      <td className="px-2 py-2.5 text-xs text-slate-600">{e.position || '—'}</td>
                      <td className="px-2 py-2.5 text-xs text-slate-600">{e.company_name || `#${e.company_id}`}</td>
                      <td className="px-2 py-2.5"><ImportStatusBadge row={e} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-end gap-4 pr-32 sm:pr-40">
          <div className="flex-1 text-[11px] text-slate-500">
            New users land as <strong>role: worker</strong> with no workspace
            assignment. Adjust per-user via the ✏️ Edit drawer after import.
          </div>
          <div className="ml-auto inline-flex items-center gap-2">
            <button onClick={submit} disabled={busy || selected.size === 0}
              data-testid="import-submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold uppercase tracking-[0.12em] disabled:opacity-50 hover:bg-blue-700">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span data-testid="import-submit-label">
                Import {selected.size} {selected.size === 1 ? 'user' : 'users'}
              </span>
            </button>
            <button onClick={onClose} type="button" disabled={busy}
              data-testid="import-cancel"
              className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Phase 3.21 Item 3 — Session history tab. Admin-only; the backend
// endpoint enforces the role check so the worst case for a non-admin is
// a 403 with an empty render. We render the last 50 sessions per user
// with semantic chips per end_reason so an auditor can see WHY a session
// ended at a glance.
const END_REASON_CHIP = {
  idle:               { label: 'Idle timeout',     cls: 'bg-slate-100 text-slate-700' },
  explicit_logout:    { label: 'Signed out',        cls: 'bg-blue-100 text-blue-800' },
  admin_revoke:       { label: 'Admin revoked',     cls: 'bg-rose-100 text-rose-800' },
  force_logout_all:   { label: 'Force-logout all',  cls: 'bg-violet-100 text-violet-800' },
  absolute_timeout:   { label: 'Absolute expiry',   cls: 'bg-amber-100 text-amber-800' },
  token_version_bump: { label: 'Password change',   cls: 'bg-indigo-100 text-indigo-800' },
};

function SessionHistoryTab({ userId }) {
  const [rows, setRows] = React.useState(null);
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    setRows(null); setError(null);
    api.get(`/admin/users/${userId}/session-history?limit=50`)
      .then((r) => { if (!cancelled) setRows(r.data?.history || []); })
      .catch((e) => { if (!cancelled) setError(apiError(e)); });
    return () => { cancelled = true; };
  }, [userId]);

  const fmt = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch (_) { return iso; }
  };

  if (error) return <div className="mt-5 text-sm text-rose-700" data-testid="session-history-error">{error}</div>;
  if (rows === null) return <div className="mt-5 text-sm text-slate-500">Loading session history…</div>;
  if (rows.length === 0) {
    return <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500" data-testid="session-history-empty">
      No session history for this user yet. History rows are written each time a session ends (idle timeout, sign-out, or admin revoke) and auto-purged after 30 days.
    </div>;
  }

  return (
    <div className="mt-5 rounded-xl border border-slate-200 overflow-x-auto" data-testid="session-history-table">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Login</th>
            <th className="text-left px-3 py-2 font-semibold">Ended</th>
            <th className="text-left px-3 py-2 font-semibold">Reason</th>
            <th className="text-left px-3 py-2 font-semibold">Role</th>
            <th className="text-left px-3 py-2 font-semibold">IP</th>
            <th className="text-left px-3 py-2 font-semibold">User agent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const chip = END_REASON_CHIP[r.end_reason] || { label: r.end_reason || 'Unknown', cls: 'bg-slate-100 text-slate-700' };
            return (
              <tr key={r.jti} className="border-t border-slate-100" data-testid={`session-history-row-${r.jti}`}>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap" title={r.login_at}>{fmt(r.login_at)}</td>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap" title={r.ended_at}>{fmt(r.ended_at)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${chip.cls}`}>{chip.label}</span>
                </td>
                <td className="px-3 py-2 text-slate-700">{r.role || '—'}</td>
                <td className="px-3 py-2 text-slate-600 font-mono text-[12px]">{r.ip_address || '—'}</td>
                <td className="px-3 py-2 text-slate-500 text-[11px] max-w-[280px] truncate" title={r.user_agent || ''}>{r.user_agent || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}




