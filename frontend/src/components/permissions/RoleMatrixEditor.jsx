// v160.3.9.31-4a — Phase 4a shared RoleMatrixEditor.
//
// A resource × action grid for viewing / editing a role's
// `permission_tokens[]`. System roles render read-only (checkboxes
// disabled). Custom roles are editable; Save calls back via
// `onSave(nextTokens)`.
//
// Grouping: `RESOURCE_GROUPS` (see `./groups.js`) buckets resources by
// sidebar folder. Advanced actions (`open`, `team_view`, `use`) hide
// behind a toggle. Cells for schema-invalid combos (e.g. `email` on
// `documents` where `email_supported=false`) render as a disabled dash.
//
// The Impact Preview panel calls `GET /api/admin/roles/{role_id}/assignees-count`
// so an admin editing a role can see how many users are currently
// affected before saving.

import React, { useEffect, useMemo, useState } from 'react';
import { X as XIcon, ShieldCheck, AlertTriangle, Users as UsersIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import {
  EMAIL_SUPPORTED,
  DELETE_SUPPORTED,
  TEAM_VIEW_SUPPORTED,
  RESOURCE_LABELS,
} from '../../lib/permissions';
import { RESOURCE_GROUPS, PRIMARY_ACTIONS, ADVANCED_ACTIONS, bucketResources } from './groups';
import RoleFormsPanel from './RoleFormsPanel';

// Some labels are missing from the FE mirror in `permissions.js` (older
// file). Backfill the ones the backend added post-v3.18 so rows read
// nicely without touching that legacy constant.
const EXTRA_LABELS = {
  risk_assessments: 'Risk Assessments',
  suppliers: 'Suppliers',
  ai: 'AI features',
  reference_library: 'Reference Library',
  notifications: 'Notifications',
  help: 'Help / User Manual',
  sites: 'Sites (QR sign-on)',
};
const labelFor = (r) => RESOURCE_LABELS[r] || EXTRA_LABELS[r] || r;

// Schema-derived "does this cell make sense?" helper. Mirrors
// `PERMISSIONS_SCHEMA` semantics from the backend.
function isCellSupported(resource, action) {
  if (action === 'delete') return DELETE_SUPPORTED[resource] !== false;
  if (action === 'email') return EMAIL_SUPPORTED[resource] === true;
  if (action === 'team_view') return TEAM_VIEW_SUPPORTED[resource] === true;
  // `approve` is only meaningful on flows with a review step; for now
  // we allow it on every resource — backend just treats unset as false.
  return true;
}

function tokensToSet(tokens) {
  return new Set(tokens || []);
}

export default function RoleMatrixEditor({ role, readOnly = false, onSave, onClose }) {
  const isSystem = Boolean(role?.is_system);
  const effectiveReadOnly = readOnly || isSystem;

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tokens, setTokens] = useState(() => tokensToSet(role?.permission_tokens));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assignees, setAssignees] = useState(null);
  const [openGroups, setOpenGroups] = useState({});
  // v160.3.9.31-4a — Tabs inside the drawer: 'matrix' (permissions grid)
  // and 'forms' (role_forms assignments). System roles still render both
  // tabs but the forms tab is read-only.
  const [activeTab, setActiveTab] = useState('matrix');

  // v160.3.9.31-4a — refresh Impact Preview count on open.
  useEffect(() => {
    let alive = true;
    if (!role?.role_id) return;
    (async () => {
      try {
        const { data } = await api.get(`/admin/roles/${role.role_id}/assignees-count`);
        if (alive) setAssignees(data?.count ?? 0);
      } catch {
        if (alive) setAssignees(null);
      }
    })();
    return () => { alive = false; };
  }, [role?.role_id]);

  // Reset tokens if the parent hands a new role.
  useEffect(() => {
    setTokens(tokensToSet(role?.permission_tokens));
    setDirty(false);
    // Auto-expand every group so the grid isn't a wall of collapsed rows.
    const init = {};
    RESOURCE_GROUPS.forEach((g) => { init[g.key] = true; });
    setOpenGroups(init);
  }, [role?.role_id, role?.permission_tokens]);

  const allResources = useMemo(() => Object.keys(RESOURCE_LABELS)
    .concat(Object.keys(EXTRA_LABELS))
    .filter((v, i, arr) => arr.indexOf(v) === i), []);
  const grouped = useMemo(() => bucketResources(allResources), [allResources]);
  const visibleActions = useMemo(
    () => showAdvanced ? [...PRIMARY_ACTIONS, ...ADVANCED_ACTIONS] : PRIMARY_ACTIONS,
    [showAdvanced],
  );

  const toggleToken = (resource, action) => {
    if (effectiveReadOnly) return;
    if (!isCellSupported(resource, action)) return;
    const key = `${resource}.${action}`;
    setTokens((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    if (effectiveReadOnly || !dirty) return;
    setSaving(true);
    try {
      const sorted = Array.from(tokens).sort();
      await onSave?.(sorted);
      setDirty(false);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!role) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" data-testid="role-matrix-editor">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-white shadow-2xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-semibold text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5" /> Role permissions
              {isSystem && (
                <span className="ml-1 rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[10px]">system · read-only</span>
              )}
              {!isSystem && (
                <span className="ml-1 rounded-full bg-violet-100 text-violet-700 px-2 py-0.5 text-[10px]">custom</span>
              )}
            </div>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900" data-testid="role-matrix-title">
              {role.name || role.role_id}
            </h2>
            {role.description && (
              <p className="mt-1 text-sm text-slate-600 max-w-2xl">{role.description}</p>
            )}
            <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <UsersIcon className="w-3.5 h-3.5" />
                Impact:{' '}
                <b className="text-slate-800" data-testid="role-matrix-assignees-count">
                  {assignees == null ? '—' : assignees}
                </b>
                {' '}user{assignees === 1 ? '' : 's'}
              </span>
              <span>·</span>
              <span>{tokens.size} tokens granted</span>
              {!effectiveReadOnly && assignees > 0 && dirty && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 text-amber-800 px-2 py-0.5 border border-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {assignees} users will be affected on save
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-md hover:bg-slate-100 text-slate-500"
            data-testid="role-matrix-close"
            aria-label="Close"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs — v160.3.9.31-4a */}
        <div className="px-6 border-b border-slate-200 bg-white flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('matrix')}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px ${activeTab === 'matrix' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            data-testid="role-matrix-tab-matrix"
          >
            Permissions matrix
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('forms')}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px ${activeTab === 'forms' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            data-testid="role-matrix-tab-forms"
          >
            Assigned Forms
          </button>
        </div>

        {activeTab === 'matrix' && (
        <>
        {/* Toolbar */}
        <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-3 bg-slate-50">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={(e) => setShowAdvanced(e.target.checked)}
              data-testid="role-matrix-show-advanced"
              className="rounded border-slate-300"
            />
            Show advanced actions (open · team_view · use)
          </label>
          <div className="ml-auto text-xs text-slate-500">
            Grey cell = action not supported by resource schema
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto px-6 py-4">
          <table className="w-full text-sm" data-testid="role-matrix-grid">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-left border-b border-slate-200">
                <th className="py-2 pr-2 font-medium text-slate-600 w-64">Resource</th>
                {visibleActions.map((a) => (
                  <th
                    key={a}
                    className="py-2 px-2 font-medium text-slate-600 text-center capitalize"
                    data-testid={`role-matrix-col-${a}`}
                  >
                    {a.replace('_', ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map((group) => {
                const isOpen = openGroups[group.key] !== false;
                return (
                  <React.Fragment key={group.key}>
                    <tr className="bg-slate-50">
                      <td colSpan={1 + visibleActions.length} className="py-1.5 px-2">
                        <button
                          type="button"
                          onClick={() => setOpenGroups((s) => ({ ...s, [group.key]: !isOpen }))}
                          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-semibold text-slate-500 hover:text-slate-800"
                          data-testid={`role-matrix-group-${group.key}`}
                        >
                          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          {group.label}
                          <span className="text-slate-400 font-normal normal-case tracking-normal">
                            · {group.resources.length}
                          </span>
                        </button>
                      </td>
                    </tr>
                    {isOpen && group.resources.map((r) => (
                      <tr key={r} className="border-b border-slate-100 hover:bg-slate-50/60">
                        <td className="py-1.5 pr-2 pl-6 text-slate-800" data-testid={`role-matrix-row-${r}`}>
                          {labelFor(r)}
                          <span className="ml-2 text-[11px] text-slate-400">{r}</span>
                        </td>
                        {visibleActions.map((a) => {
                          const supported = isCellSupported(r, a);
                          const granted = tokens.has(`${r}.${a}`);
                          if (!supported) {
                            return (
                              <td key={a} className="text-center text-slate-300 py-1.5 px-2" aria-label="not supported">
                                —
                              </td>
                            );
                          }
                          return (
                            <td key={a} className="text-center py-1.5 px-2">
                              <input
                                type="checkbox"
                                checked={granted}
                                disabled={effectiveReadOnly}
                                onChange={() => toggleToken(r, a)}
                                data-testid={`role-matrix-cell-${r}-${a}`}
                                className="rounded border-slate-300 h-4 w-4"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
        )}

        {activeTab === 'forms' && (
          <RoleFormsPanel role={role} readOnly={effectiveReadOnly} />
        )}

        {/* Footer — matrix tab has Save/Cancel; forms tab manages its own
            actions inline (per-row toggle + inline Assign/Remove) so we
            only show a plain Close on the forms tab. */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
            data-testid="role-matrix-cancel"
          >
            {effectiveReadOnly || activeTab !== 'matrix' ? 'Close' : 'Cancel'}
          </button>
          {activeTab === 'matrix' && !effectiveReadOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-40"
              data-testid="role-matrix-save"
            >
              {saving ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
