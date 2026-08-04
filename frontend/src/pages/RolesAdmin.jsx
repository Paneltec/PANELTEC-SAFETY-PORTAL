// v160.3.9.31-4a — Phase 4a RolesAdmin page.
// v160.3.9.33 — Phase 4d: `source` chips (Seeded / Custom / Auto),
// "needs permissions configured" banner for empty auto-created roles,
// and a "Sync roles from Simpro positions" header button that hits
// POST /api/admin/roles/sync-from-simpro-positions.
//
// Sits under Settings › Users & Permissions › Roles Admin.
// Gated by `users.edit` (matches decision #3 — coarse admin identity).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Eye, Pencil, Trash2, Plus, Shield, RefreshCw, Sparkles, ChevronRight, Lock } from 'lucide-react';
import api, { apiError } from '../lib/api';
import { useCan } from '../lib/permissions';
import { PageHeader } from '../components/capture/Ui';
import RoleMatrixEditor from '../components/permissions/RoleMatrixEditor';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../components/ui/dialog';

// ─── source chip ───────────────────────────────────────────────
function SourceChip({ source }) {
  const map = {
    seed: {
      label: 'Seeded',
      cls: 'bg-blue-50 text-blue-700 border-blue-200',
      testid: 'role-source-seed',
    },
    admin_created: {
      label: 'Custom',
      cls: 'bg-violet-50 text-violet-700 border-violet-200',
      testid: 'role-source-admin_created',
    },
    simpro_position_auto: {
      label: 'Auto',
      cls: 'bg-amber-50 text-amber-700 border-amber-200',
      testid: 'role-source-simpro_position_auto',
    },
  };
  const cfg = map[source] || { label: source || '—',
    cls: 'bg-slate-100 text-slate-600 border-slate-200', testid: 'role-source-unknown' };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider border font-semibold ${cfg.cls}`}
      data-testid={cfg.testid}
    >
      {cfg.label}
    </span>
  );
}

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
  // v160.3.9.33 — Phase 4d
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  // v160.3.9.33 — Phase 4d Option C: position/role drift banner.
  const [drift, setDrift] = useState({ count: 0, drift: [] });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, { data: dr }] = await Promise.all([
        api.get('/admin/roles'),
        api.get('/users/role-lock-drift').catch(() => ({ data: { count: 0, drift: [] } })),
      ]);
      setRoles(data?.roles || []);
      setDrift(dr || { count: 0, drift: [] });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const [systemRoles, customRoles, autoRoles, autoWithoutTokens] = useMemo(() => {
    const seed = [], custom = [], auto = [];
    for (const r of roles) {
      const src = r.source || (r.is_system ? 'seed' : 'admin_created');
      if (src === 'seed') seed.push(r);
      else if (src === 'simpro_position_auto') auto.push(r);
      else custom.push(r);
    }
    const emptyAuto = auto.filter((r) => (r.permission_tokens || []).length === 0
      && r.is_active !== false);
    return [seed, custom, auto, emptyAuto];
  }, [roles]);

  const openMatrix = (role) => setSelected(role);

  const handleSaveMatrix = async (nextTokens) => {
    if (!selected || selected.is_system) return;
    await api.patch(`/admin/roles/${selected.role_id}`, { permission_tokens: nextTokens });
    toast.success(`Updated ${selected.name}`);
    await load();
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
      setSelected(data);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const doSync = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/admin/roles/sync-from-simpro-positions');
      setSyncResult(data);
      if ((data.created || []).length) {
        toast.success(`Synced — created ${data.created.length} new position role${data.created.length === 1 ? '' : 's'}`);
      } else {
        toast.success('Synced — no new position roles needed');
      }
      await load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSyncing(false);
    }
  };

  const openFirstEmptyAuto = () => {
    if (autoWithoutTokens.length === 0) return;
    setSelected(autoWithoutTokens[0]);
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
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={doSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0093D0] text-white text-sm font-semibold border border-[#0093D0] hover:bg-[#0079AB] hover:border-[#0079AB] focus:outline-none focus:ring-2 focus:ring-[#0093D0]/40 disabled:opacity-60 shadow-sm"
              data-testid="roles-admin-sync-btn"
              title="Roles are canonical in Simpro. This pulls every unique Simpro employee position and mirrors it as a role here."
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync from Simpro'}
            </button>
            {/* v55.4 — "+ Create custom role" button removed per user
                instruction: roles are canonical in Simpro; the local DB
                mirrors Simpro via the Sync from Simpro button above.
                Backend `POST /api/admin/roles/custom` remains intact so
                existing custom roles and any scripted migrations still
                function — only the UI affordance is hidden. */}
          </div>
        }
      />

      {/* v160.3.9.33 — Phase 4d Option C drift banner */}
      {drift.count > 0 && (
        <div
          className="mt-4 flex items-center gap-3 rounded-2xl border-2 border-orange-300 bg-orange-50 px-4 py-3 shadow-sm"
          data-testid="roles-admin-drift-banner"
        >
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-orange-100 text-orange-700 flex-shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-orange-900">
              {drift.count} user{drift.count === 1 ? ' has' : 's have'} position/role drift.
            </div>
            <div className="text-xs text-orange-800/80 mt-0.5">
              Their Simpro position no longer matches their locked role. Review each user&apos;s drawer to unlock (Simpro sync will re-match) or keep the override.
            </div>
          </div>
          <a
            href="/app/settings/users?filter=role_locked_drift"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold"
            data-testid="roles-admin-drift-review-link"
          >
            Review →
          </a>
        </div>
      )}

      {/* v160.3.9.33 — Phase 4d banner: auto-roles that need permissions configured */}
      {autoWithoutTokens.length > 0 && (
        <div
          className="mt-4 flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 shadow-sm"
          data-testid="roles-admin-empty-auto-banner"
        >
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-amber-900">
              {autoWithoutTokens.length} auto-created role{autoWithoutTokens.length === 1 ? ' needs' : 's need'} permissions configured.
            </div>
            <div className="text-xs text-amber-800/80 mt-0.5">
              Users assigned to these roles have <strong>no access</strong> yet — click below to open the first one and grant permissions.
            </div>
          </div>
          <button
            type="button"
            onClick={openFirstEmptyAuto}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
            data-testid="roles-admin-open-first-empty-auto"
          >
            Configure “{autoWithoutTokens[0]?.name}”
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
          empty="No custom roles yet. Roles are created in Simpro and mirrored here via the Sync from Simpro button above."
        />
      </div>

      <div className="mt-8">
        <RoleSection
          title="Auto-created (from Simpro positions)"
          subtitle="One role per unique Simpro employee position. Start with zero tokens — configure permissions per role below."
          roles={autoRoles}
          onOpen={openMatrix}
          onDelete={setConfirmDelete}
          loading={loading}
          testid="roles-auto"
          empty="None yet — run “Sync from Simpro” above."
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

      {/* v55.4 — Create-role modal removed. Roles are canonical in
          Simpro; local DB mirrors Simpro via "Sync from Simpro". */}

      {/* v160.3.9.33 — Phase 4d Sync result modal */}
      <Dialog open={!!syncResult} onOpenChange={(o) => !o && setSyncResult(null)}>
        <DialogContent data-testid="roles-admin-sync-result-dialog">
          <DialogHeader>
            <DialogTitle>
              <Sparkles className="inline w-4 h-4 mr-1.5 text-amber-500" />
              Sync complete
            </DialogTitle>
            <DialogDescription>{syncResult?.summary}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {(syncResult?.created || []).length > 0 && (
              <div data-testid="roles-admin-sync-created">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-700 mb-1.5">
                  Created ({syncResult.created.length})
                </div>
                <ul className="space-y-1 max-h-40 overflow-y-auto rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2">
                  {syncResult.created.map((rid) => (
                    <li key={rid} className="flex justify-between text-xs">
                      <code className="text-slate-700">{rid}</code>
                      <span className="text-slate-500">
                        {syncResult.user_count_per_role?.[rid] || 0} user{(syncResult.user_count_per_role?.[rid] || 0) === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(syncResult?.skipped || []).length > 0 && (
              <div data-testid="roles-admin-sync-skipped">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Skipped — already existed ({syncResult.skipped.length})
                </div>
                <ul className="space-y-1 max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  {syncResult.skipped.map((rid) => (
                    <li key={rid} className="flex justify-between text-xs">
                      <code className="text-slate-600">{rid}</code>
                      <span className="text-slate-500">
                        {syncResult.user_count_per_role?.[rid] || 0} user{(syncResult.user_count_per_role?.[rid] || 0) === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setSyncResult(null)}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
              data-testid="roles-admin-sync-close"
            >
              Done
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleSection({ title, subtitle, roles, onOpen, onDelete, loading, testid, empty }) {
  return (
    <div data-testid={testid} className="mt-6">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <Shield className="w-4 h-4 text-slate-500" /> {title}
          <span className="text-xs font-normal text-slate-500">({roles.length})</span>
        </h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="py-2.5 px-4 font-medium text-slate-600">Role</th>
              <th className="py-2.5 px-4 font-medium text-slate-600 w-24">Source</th>
              <th className="py-2.5 px-4 font-medium text-slate-600">Description</th>
              <th className="py-2.5 px-4 font-medium text-slate-600 w-24">Status</th>
              <th className="py-2.5 px-4 font-medium text-slate-600 w-24 text-right">Tokens</th>
              <th className="py-2.5 px-4 font-medium text-slate-600 w-48 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center py-8 text-slate-500">Loading…</td></tr>
            )}
            {!loading && roles.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-slate-500">{empty || 'None.'}</td></tr>
            )}
            {!loading && roles.map((r) => {
              const tokenCount = (r.permission_tokens || []).length;
              const isEmptyAuto = (r.source === 'simpro_position_auto') && tokenCount === 0;
              return (
                <tr key={r.role_id} className={`border-t border-slate-100 hover:bg-slate-50/60 ${isEmptyAuto ? 'bg-amber-50/30' : ''}`} data-testid={`role-row-${r.role_id}`}>
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-slate-900">{r.name}</div>
                    <div className="text-[11px] text-slate-400">{r.role_id}</div>
                  </td>
                  <td className="py-2.5 px-4">
                    <SourceChip source={r.source || (r.is_system ? 'seed' : 'admin_created')} />
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
                  <td className="py-2.5 px-4 text-right text-slate-700">
                    <span className={isEmptyAuto ? 'text-amber-700 font-bold' : ''} data-testid={`role-token-count-${r.role_id}`}>
                      {tokenCount}
                    </span>
                    {isEmptyAuto && <span className="ml-1 text-[9px] text-amber-700">needs config</span>}
                  </td>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
