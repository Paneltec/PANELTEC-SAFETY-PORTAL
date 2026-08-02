// v160.3.9.31-4a — Phase 4a RolesAdmin page.
//
// Sits under Settings › Users & Permissions › Roles Admin.
// Gated by `users.edit` (matches decision #3 — coarse admin identity).
//
// Table of every role in `roles` collection (11 system + N custom).
// Click "View grid" or "Edit" to open <RoleMatrixEditor/> as a right-side
// drawer. System roles render read-only. Custom roles show Edit + Delete.
// A "+ Create custom role" button opens a lightweight naming modal.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Eye, Pencil, Trash2, Plus, Shield, X as XIcon } from 'lucide-react';
import api, { apiError } from '../lib/api';
import { useCan } from '../lib/permissions';
import { PageHeader } from '../components/capture/Ui';
import RoleMatrixEditor from '../components/permissions/RoleMatrixEditor';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../components/ui/dialog';

export default function RolesAdmin() {
  const can = useCan();
  const allowed = can('users', 'edit');

  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/roles');
      setRoles(data?.roles || []);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const [systemRoles, customRoles] = useMemo(() => {
    const s = [], c = [];
    for (const r of roles) (r.is_system ? s : c).push(r);
    return [s, c];
  }, [roles]);

  const openMatrix = (role) => setSelected(role);

  const handleSaveMatrix = async (nextTokens) => {
    if (!selected || selected.is_system) return;
    await api.patch(`/admin/roles/${selected.role_id}`, { permission_tokens: nextTokens });
    toast.success(`Updated ${selected.name}`);
    await load();
    // Refresh the selected object with the new tokens so the drawer's
    // "No changes" state reflects the persisted set.
    setSelected((cur) => cur ? { ...cur, permission_tokens: nextTokens } : cur);
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.delete(`/admin/roles/${confirmDelete.role_id}`);
      toast.success(`Deleted ${confirmDelete.name}`);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const doCreate = async () => {
    if (!createName.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.post('/admin/roles', {
        name: createName.trim(),
        description: createDesc.trim(),
        permission_tokens: [],
      });
      toast.success(`Created ${data?.name || 'role'}`);
      setCreateOpen(false);
      setCreateName('');
      setCreateDesc('');
      await load();
      // Open the matrix editor right away so the admin can populate it.
      setSelected(data);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) {
    return (
      <div className="p-6">
        <PageHeader crumb="Settings / Roles Admin" title="Roles Admin"
          subtitle="You do not have permission to view this page." />
      </div>
    );
  }

  return (
    <div className="p-6" data-testid="roles-admin-page">
      <PageHeader
        crumb="Settings / Roles Admin"
        title="Roles Admin"
        subtitle="View system role permission matrices and manage custom roles for your organisation."
        action={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
            data-testid="roles-admin-create-btn"
          >
            <Plus className="w-4 h-4" /> Create custom role
          </button>
        }
      />

      <RoleSection
        title="System roles"
        subtitle="Shipped with Paneltec Civil. Read-only — activation can be toggled but tokens cannot."
        roles={systemRoles}
        onOpen={openMatrix}
        onDelete={null}
        loading={loading}
        testid="roles-system"
      />

      <div className="mt-8">
        <RoleSection
          title="Custom roles"
          subtitle="Bespoke roles created by your organisation."
          roles={customRoles}
          onOpen={openMatrix}
          onDelete={setConfirmDelete}
          loading={loading}
          testid="roles-custom"
          empty="No custom roles yet — click “Create custom role” to add one."
        />
      </div>

      {selected && (
        <RoleMatrixEditor
          role={selected}
          readOnly={Boolean(selected.is_system)}
          onSave={handleSaveMatrix}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent data-testid="roles-admin-delete-dialog">
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription>
              This soft-deletes the role. Users currently assigned this role will block the
              delete with a 409. Deletion is reversible from the audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
              data-testid="roles-admin-delete-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doDelete}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40"
              data-testid="roles-admin-delete-confirm"
            >
              {busy ? 'Deleting…' : 'Delete role'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="roles-admin-create-dialog">
          <DialogHeader>
            <DialogTitle>Create custom role</DialogTitle>
            <DialogDescription>
              Give the role a name and short description. You’ll pick its permissions
              on the next screen. The role starts with zero tokens — no user gets access
              until you grant it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block">
              <div className="text-xs font-medium text-slate-600 mb-1">Role name</div>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Site Auditor"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                data-testid="roles-admin-create-name"
                autoFocus
              />
            </label>
            <label className="block">
              <div className="text-xs font-medium text-slate-600 mb-1">Description</div>
              <textarea
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                rows={2}
                placeholder="What is this role for?"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                data-testid="roles-admin-create-desc"
              />
            </label>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doCreate}
              disabled={busy || !createName.trim()}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-40"
              data-testid="roles-admin-create-submit"
            >
              {busy ? 'Creating…' : 'Create & edit permissions'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleSection({ title, subtitle, roles, onOpen, onDelete, loading, testid, empty }) {
  return (
    <div data-testid={testid}>
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <Shield className="w-4 h-4 text-slate-500" /> {title}
        </h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="py-2.5 px-4 font-medium text-slate-600">Role</th>
              <th className="py-2.5 px-4 font-medium text-slate-600">Description</th>
              <th className="py-2.5 px-4 font-medium text-slate-600 w-24">Status</th>
              <th className="py-2.5 px-4 font-medium text-slate-600 w-24 text-right">Tokens</th>
              <th className="py-2.5 px-4 font-medium text-slate-600 w-48 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="text-center py-8 text-slate-500">Loading…</td></tr>
            )}
            {!loading && roles.length === 0 && (
              <tr><td colSpan={5} className="text-center py-8 text-slate-500">{empty || 'None.'}</td></tr>
            )}
            {!loading && roles.map((r) => (
              <tr key={r.role_id} className="border-t border-slate-100 hover:bg-slate-50/60" data-testid={`role-row-${r.role_id}`}>
                <td className="py-2.5 px-4">
                  <div className="font-medium text-slate-900">{r.name}</div>
                  <div className="text-[11px] text-slate-400">{r.role_id}</div>
                </td>
                <td className="py-2.5 px-4 text-slate-600 max-w-md truncate" title={r.description || ''}>
                  {r.description || <span className="text-slate-400">—</span>}
                </td>
                <td className="py-2.5 px-4">
                  {r.is_active
                    ? <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] border border-emerald-200">Active</span>
                    : <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px] border border-slate-200">Inactive</span>
                  }
                </td>
                <td className="py-2.5 px-4 text-right text-slate-700">{(r.permission_tokens || []).length}</td>
                <td className="py-2.5 px-4 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onOpen(r)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-xs text-slate-700"
                      data-testid={`role-view-${r.role_id}`}
                    >
                      {r.is_system ? <><Eye className="w-3.5 h-3.5" /> View grid</> : <><Pencil className="w-3.5 h-3.5" /> Edit</>}
                    </button>
                    {onDelete && !r.is_system && (
                      <button
                        type="button"
                        onClick={() => onDelete(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 text-xs"
                        data-testid={`role-delete-${r.role_id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
