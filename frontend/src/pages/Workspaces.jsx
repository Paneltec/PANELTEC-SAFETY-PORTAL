import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ShieldCheck, Users2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { PageHeader, PrimaryButton, GhostButton, Field, inputClass, EmptyState } from '../components/capture/Ui';
// Phase 3.20 Wave 2 — lucide row-action/toolbar icons swapped
// to @fluentui/react-icons. Aliased back to the original lucide
// names so existing JSX call sites don't need to change.
import {
  Delete20Regular as Trash2,
  Edit20Regular as Pencil,
  Star20Regular as Star,
} from '@fluentui/react-icons';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '../components/ui/alert-dialog';

const EMPTY = { name: '', description: '', address: '', default_for_org: false };

export default function Workspaces() {
  const me = getUser();
  const isAdmin = me?.role === 'admin';
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // { id?, name, description, address, default_for_org }
  const [toDelete, setToDelete] = useState(null); // workspace doc
  const [forceDelete, setForceDelete] = useState(null); // workspace doc with user_count
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: ws }, usersRes] = await Promise.all([
        api.get('/workspaces'),
        isAdmin ? api.get('/users').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      setItems(ws);
      setUsers(usersRes.data || []);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const openCreate = () => setEditing({ ...EMPTY });
  const openEdit = (w) => setEditing({
    id: w.id,
    name: w.name || '',
    description: w.description || '',
    address: w.address || '',
    default_for_org: !!w.default_for_org,
  });

  const submitEdit = async () => {
    if (!editing.name.trim()) { toast.error('Name required'); return; }
    setBusy(true);
    try {
      const payload = {
        name: editing.name.trim(),
        description: editing.description || null,
        address: editing.address || null,
        default_for_org: !!editing.default_for_org,
      };
      if (editing.id) {
        await api.patch(`/workspaces/${editing.id}`, payload);
        toast.success('Workspace updated');
      } else {
        await api.post('/workspaces', payload);
        toast.success('Workspace created');
      }
      setEditing(null);
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const submitDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api.delete(`/workspaces/${toDelete.id}`);
      toast.success('Workspace deleted');
      setToDelete(null);
      await load();
    } catch (e) {
      const detail = e?.response?.data?.detail || '';
      // Surface the blocked-by-users case as a force-delete confirmation
      if (e?.response?.status === 400 && /user\(s\) assigned/i.test(detail)) {
        const m = detail.match(/(\d+)\s+user/);
        const n = m ? Number(m[1]) : 0;
        setBusy(false);
        setToDelete(null);
        setForceDelete({ ...toDelete, user_count: n });
        return;
      }
      toast.error(apiError(e));
    }
    finally { setBusy(false); }
  };

  const submitForceDelete = async () => {
    if (!forceDelete) return;
    setBusy(true);
    try {
      const { data } = await api.delete(`/workspaces/${forceDelete.id}?force=true`);
      toast.success(`Workspace deleted · ${data.users_updated || 0} user(s) unassigned`);
      setForceDelete(null);
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-5xl mx-auto" data-testid="workspaces-page">
      <PageHeader
        crumb="Settings / Workspaces"
        title="Workspaces"
        subtitle="Workspaces partition records and access — typically one per site, depot or region."
        action={isAdmin ? (
          <button
            onClick={openCreate}
            data-testid="workspace-create-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600"
          >
            + New workspace
          </button>
        ) : null}
      />

      {!isAdmin && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900" data-testid="workspaces-readonly-banner">
          Read-only — contact your administrator to add, edit or remove workspaces.
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No workspaces"
          body="Create your first workspace to start partitioning records."
          action={isAdmin ? <PrimaryButton onClick={openCreate} testid="workspaces-empty-create">+ New workspace</PrimaryButton> : null}
        />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-left px-4 py-3">Members</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`workspace-row-${w.id}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 flex items-center gap-2">
                      {w.name}
                      {w.default_for_org && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-brand-blue bg-brand-blue-soft px-1.5 py-0.5 rounded">
                          <Star /> Default
                        </span>
                      )}
                    </div>
                    {w.address && <div className="text-xs text-slate-500 mt-0.5">{w.address}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs max-w-md">{w.description || '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="inline-flex items-center gap-1 text-slate-700">
                      <Users2 size={13} className="text-slate-400" />
                      {w.member_count ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(w)}
                          title="Edit workspace"
                          aria-label={`Edit ${w.name}`}
                          data-testid={`workspace-edit-${w.id}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 transition-colors"
                        >
                          <Pencil />
                        </button>
                        <button
                          type="button"
                          onClick={() => setToDelete(w)}
                          title="Delete workspace"
                          aria-label={`Delete ${w.name}`}
                          data-testid={`workspace-delete-${w.id}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-rose-200 bg-white text-rose-500 hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-colors"
                        >
                          <Trash2 />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit / Create dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent data-testid="workspace-edit-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editing?.id ? 'Edit workspace' : 'New workspace'}
            </DialogTitle>
            <DialogDescription>
              Workspaces partition capture records and audit exports. Users can be assigned
              to multiple workspaces in Settings → Users.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 pt-2">
              <Field label="Name" required>
                <input
                  data-testid="workspace-field-name"
                  className={inputClass}
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </Field>
              <Field label="Description" hint="Optional — shown on the workspace switcher tooltip.">
                <textarea
                  data-testid="workspace-field-description"
                  className={inputClass}
                  rows={2}
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </Field>
              <Field label="Address" hint="Optional — site / depot address.">
                <input
                  data-testid="workspace-field-address"
                  className={inputClass}
                  value={editing.address}
                  onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  data-testid="workspace-field-default"
                  checked={editing.default_for_org}
                  onChange={(e) => setEditing({ ...editing, default_for_org: e.target.checked })}
                />
                <span>Default workspace for new users in this organisation</span>
              </label>
            </div>
          )}
          <DialogFooter>
            <GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton>
            <PrimaryButton onClick={submitEdit} busy={busy} testid="workspace-save-btn">
              {editing?.id ? 'Save changes' : 'Create workspace'}
            </PrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent data-testid="workspace-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && <span className="block font-medium text-slate-900 mb-2">{toDelete.name}</span>}
              This soft-deletes the workspace. The backend will refuse if it is the last
              workspace in the org, or if any users are still assigned to it — you&apos;ll get
              an option to force-unassign them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid="workspace-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={submitDelete}
              disabled={busy}
              data-testid="workspace-delete-confirm"
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
            >
              {busy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Trash2 className="mr-1.5" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Force-delete (unassign all users) confirmation */}
      <AlertDialog open={!!forceDelete} onOpenChange={(o) => { if (!o) setForceDelete(null); }}>
        <AlertDialogContent data-testid="workspace-force-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Force delete · unassign all users?</AlertDialogTitle>
            <AlertDialogDescription>
              {forceDelete && (
                <span className="block font-medium text-slate-900 mb-2">{forceDelete.name}</span>
              )}
              <strong className="text-rose-700">{forceDelete?.user_count || 0}</strong> user(s) are still
              assigned to this workspace. Force delete will remove this workspace from each of
              their <code>workspace_ids</code>, then soft-delete the workspace. Users left with
              zero workspaces will need to be reassigned manually in Settings → Users.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid="workspace-force-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={submitForceDelete}
              disabled={busy}
              data-testid="workspace-force-delete-confirm"
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
            >
              {busy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Trash2 className="mr-1.5" />}
              Force delete · unassign {forceDelete?.user_count || 0}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isAdmin && users.length > 0 && (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5" data-testid="workspaces-members-card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-display font-semibold flex items-center gap-2"><ShieldCheck size={14} className="text-brand-blue" /> Workspace membership</h3>
              <p className="text-xs text-slate-500 mt-0.5">Read-only summary. Edit assignments in Settings → Users.</p>
            </div>
            <Link to="/app/settings/users" className="text-xs text-brand-blue hover:underline">Manage in Settings → Users →</Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {items.map((w) => {
              const members = users.filter((u) => (u.workspace_ids || []).includes(w.id));
              return (
                <div key={w.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" data-testid={`workspace-members-${w.id}`}>
                  <div className="font-medium text-sm flex items-center justify-between">
                    <span>{w.name}</span>
                    <span className="text-xs text-slate-500">{members.length} member{members.length === 1 ? '' : 's'}</span>
                  </div>
                  {members.length === 0 ? (
                    <div className="text-xs text-slate-400 italic mt-1">No users assigned.</div>
                  ) : (
                    <ul className="mt-1.5 space-y-0.5 text-xs">
                      {members.slice(0, 6).map((u) => (
                        <li key={u.id} className="flex items-center justify-between gap-2">
                          <span className="truncate text-slate-700">{u.name || u.email}</span>
                          <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded">{u.role}</span>
                        </li>
                      ))}
                      {members.length > 6 && (
                        <li className="text-[11px] text-slate-500 italic">+ {members.length - 6} more</li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
