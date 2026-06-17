import React, { useEffect, useState } from 'react';
import { UserPlus, Check, X as XIcon, Minus, RotateCcw, ShieldCheck, Save, Mail } from 'lucide-react';
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

  const load = async () => { try { const { data } = await api.get('/users'); setUsers(data); } catch (e) { toast.error(apiError(e)); } };
  useEffect(() => { load(); }, []);

  if (!can('users', 'view')) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500" data-testid="users-denied">Access denied — you need users.view permission.</div>;
  }
  const filtered = users.filter((u) => (!filters.role || u.role === filters.role) && (!filters.status || u.status === filters.status));

  return (
    <div className="max-w-6xl mx-auto" data-testid="users-page">
      <PageHeader crumb="Settings / Users" title="Users & permissions"
        subtitle={`${users.length} users in your org`}
        action={can('users', 'edit') ? (
          <button onClick={() => setInviteOpen(true)} data-testid="invite-user-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600">
            <UserPlus size={14} /> Invite user
          </button>) : null} />

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
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setActive(u)} data-testid={`user-row-${u.id}`}>
                <td className="px-4 py-3"><div className="flex items-center gap-2"><Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{(u.name || u.email)[0]}</AvatarFallback></Avatar>
                  <div><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500">{u.email}</div></div></div></td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && <UserDrawer userRow={active} onClose={() => setActive(null)} onReload={load} canEdit={can('users', 'edit')} />}
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onDone={load} />}
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
