import React, { useEffect, useMemo, useState } from 'react';
import { UserPlus, Check, X as XIcon, Minus, RotateCcw, ShieldCheck, Save, Mail, Download, Loader2, AlertCircle, Search as SearchIcon, LogOut, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { PageHeader } from '../components/capture/Ui';
import { RESOURCE_LABELS, EMAIL_SUPPORTED, useCan } from '../lib/permissions';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';

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

export default function UsersManagement() {
  const can = useCan();
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ role: '', status: '' });
  const [active, setActive] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [simproStatus, setSimproStatus] = useState({ connected: false, companies: [] });

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
              <UserPlus size={14} /> Invite user
            </button>
          </div>) : null} />

      {!can('users', 'edit') && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900" data-testid="users-readonly-banner">
          You can view users but not modify them. Contact an admin to make changes.
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5">
          <option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="text-sm border border-slate-300 rounded-lg px-2 py-1.5">
          <option value="">All statuses</option>{['active', 'invited', 'disabled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-4 py-2.5">User</th><th className="text-left px-4 py-2.5">Role</th>
              <th className="text-left px-4 py-2.5">Status</th><th className="text-left px-4 py-2.5">Permissions</th>
              <th className="text-left px-4 py-2.5">Created</th>
              {can('users', 'edit') && <th className="text-right px-4 py-2.5">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setActive(u)} data-testid={`user-row-${u.id}`}>
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
                        <Mail size={12} />
                      </a>
                    )}
                  </div>
                </td>
                {can('users', 'edit') && (
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex gap-1 items-center">
                      <button
                        title="Force sign-out everywhere"
                        data-testid={`force-signout-${u.id}`}
                        onClick={async () => {
                          if (!window.confirm(`Force sign-out ${u.name || u.email}? They'll need to sign in again.`)) return;
                          try {
                            const { data } = await api.post(`/users/${u.id}/force-signout`);
                            toast.success(`${u.name || u.email}'s sessions revoked.`);
                            if (data?.new_token_version) console.info('new token_version:', data.new_token_version);
                          } catch (e) { toast.error(apiError(e)); }
                        }}
                        className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#fbf3df] text-[#8c6a1a] hover:bg-[#f7eed1]">
                        <LogOut size={13} />
                      </button>
                      <button
                        title="Delete user (soft)"
                        data-testid={`delete-user-${u.id}`}
                        onClick={async () => {
                          const extra = u.imported_from === 'simpro'
                            ? ' (This user came from Simpro and can be re-imported later.)'
                            : '';
                          if (!window.confirm(`Permanently disable ${u.name || u.email}? They will lose access immediately. This is reversible by re-enabling them.${extra}`)) return;
                          try {
                            await api.delete(`/users/${u.id}`);
                            toast.success(`${u.name || u.email} deleted.`);
                            await load();
                          } catch (e) { toast.error(apiError(e)); }
                        }}
                        className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#fbe4e7] text-[#7a1f33] hover:bg-[#f4c7cd]">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && <UserDrawer userRow={active} onClose={() => setActive(null)} onReload={load} canEdit={can('users', 'edit')} />}
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onDone={load} />}
      {importOpen && <ImportFromSimproDrawer
        companies={simproStatus.companies}
        onClose={() => setImportOpen(false)}
        onDone={() => { load(); }}
      />}
    </div>
  );
}

function UserDrawer({ userRow, onClose, onReload, canEdit }) {
  const [tab, setTab] = useState('profile');
  const [detail, setDetail] = useState(null);
  const [perms, setPerms] = useState(null);
  const [profile, setProfile] = useState({ name: '', email: '', role: '', status: '', workspace_ids: [] });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);

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
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [userRow.id]);

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
    try { await api.put(`/users/${userRow.id}/permissions`, { overrides: perms.overrides }); toast.success('Permissions saved'); onReload(); load(); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  const resetPerms = async () => {
    setBusy(true);
    try { await api.post(`/users/${userRow.id}/permissions/reset`); toast.success('Reset to role defaults'); onReload(); load(); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
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
          {['profile', 'permissions'].map((t) => (
            <button key={t} onClick={() => setTab(t)} data-testid={`tab-${t}`}
              className={`pb-2 text-sm font-medium ${tab === t ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-slate-500'}`}>{t}</button>
          ))}
        </div>

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
              <div className="flex gap-2 pt-2 flex-wrap"><button onClick={saveProfile} disabled={busy} className="px-4 py-2 bg-brand-blue text-white rounded-lg text-sm inline-flex items-center gap-1.5" data-testid="save-profile"><Save size={13} /> Save changes</button>
                {profile.status === 'active' && <button onClick={() => setConfirmDelete(true)} className="px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm" data-testid="disable-user">Disable user</button>}
                {profile.status === 'disabled' && <button onClick={() => { setProfile({ ...profile, status: 'active' }); setTimeout(saveProfile, 0); }} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm" data-testid="reactivate-user">Reactivate</button>}
              </div>
            )}
          </div>
        )}

        {tab === 'permissions' && perms && (
          <div className="mt-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-slate-700"><ShieldCheck size={13} className="inline mr-1 text-brand-blue" /> Role default: <strong>{perms.role}</strong></div>
              {canEdit && <button onClick={resetPerms} className="text-xs inline-flex items-center gap-1 px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"><RotateCcw size={11} /> Reset to defaults</button>}
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr><th className="text-left px-3 py-2">Resource</th>{ACTIONS.map((a) => <th key={a} className="px-3 py-2">{a}</th>)}</tr>
                </thead>
                <tbody>
                  {RESOURCES.map((res) => (
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
  const [filterMode, setFilterMode] = useState('whiteboard'); // 'whiteboard' | 'all'
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [defaultRole, setDefaultRole] = useState('worker');
  const [workspaces, setWorkspaces] = useState([]);
  const [chosenWorkspaces, setChosenWorkspaces] = useState([]);
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

  // Load workspaces once
  useEffect(() => {
    (async () => {
      try { const { data } = await api.get('/workspaces'); setWorkspaces(data || []); } catch { /* ignore */ }
    })();
  }, []);

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
  const toggleWorkspace = (wid) => {
    setChosenWorkspaces((prev) => prev.includes(wid) ? prev.filter((x) => x !== wid) : [...prev, wid]);
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
        default_role: defaultRole,
        workspace_ids: chosenWorkspaces,
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
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs" data-testid="import-filter-toggle">
              {[['whiteboard', 'Only whiteboard-marked'], ['all', 'All employees']].map(([v, lbl]) => (
                <button key={v} type="button" onClick={() => setFilterMode(v)}
                  className={`px-3 py-1.5 font-medium ${filterMode === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
                  data-testid={`import-filter-${v}`}>
                  {lbl}
                </button>
              ))}
            </div>
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

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-end gap-4">
          <div className="min-w-[180px]">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Default role</div>
            <Select value={defaultRole} onValueChange={setDefaultRole}>
              <SelectTrigger className="w-full" data-testid="import-default-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS_IMPORT.map((r) => (
                  <SelectItem key={r.value} value={r.value} data-testid={`import-role-opt-${r.value}`}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Workspaces (optional)</div>
            {workspaces.length === 0 ? (
              <div className="text-xs text-slate-400 italic px-2 py-2">No workspaces in your org.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {workspaces.map((w) => {
                  const on = chosenWorkspaces.includes(w.id);
                  return (
                    <button key={w.id} type="button" onClick={() => toggleWorkspace(w.id)}
                      data-testid={`import-ws-chip-${w.id}`}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'}`}>
                      {w.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="ml-auto">
            <button onClick={submit} disabled={busy || selected.size === 0}
              data-testid="import-submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold uppercase tracking-[0.12em] disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              <span data-testid="import-submit-label">
                Import {selected.size} {selected.size === 1 ? 'user' : 'users'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

