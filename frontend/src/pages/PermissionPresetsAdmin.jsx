// Phase 3.21 Item 4 — Permission Presets admin page.
//
// Two-pane layout:
//   LEFT  : list of every preset (6 built-in read-only + N custom). Click selects.
//   RIGHT : detail view (label, description, the full matrix grid) + edit /
//           delete (custom only) / "+ Create preset" button.
//
// Built-in presets cannot be renamed or deleted but their matrix is still
// rendered so admins can see exactly what each preset grants before applying
// it to a user. Custom presets show pencil + trash with delete-confirm modal.
//
// Permission gate: `users.edit` (matches every other preset endpoint).
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useCan } from '@/lib/permissions';
import { PageHeader } from '@/components/capture/Ui';
import MobileModulesSection from '@/components/settings/MobileModulesSection';
import {
  LockClosed20Regular as Lock20Regular,
  Sparkle20Filled,
  Add20Regular,
  Edit20Regular,
  Delete20Regular,
  Save20Regular,
  Checkmark16Filled,
  Dismiss16Regular,
  Phone20Regular,
  ShieldCheckmark20Regular,
} from '@fluentui/react-icons';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const ACTIONS = ['open', 'view', 'edit', 'delete', 'email'];

export default function PermissionPresetsAdmin() {
  const can = useCan();
  const [data, setData] = useState({ built_in: [], custom: [] });
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null); // {id, label, description, permissions}
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  // Phase 4.3 — extra tab for the per-role mobile module allocator.
  const [tab, setTab] = useState('presets');

  const allowed = can('users', 'view');
  const canEdit = can('users', 'edit');

  const load = async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get('/permission-presets');
      setData(d || { built_in: [], custom: [] });
      const list = [...(d?.built_in || []), ...(d?.custom || [])];
      if (list.length && !list.find((p) => p.key === selectedKey)) {
        setSelectedKey(list[0].key);
      }
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (allowed) load(); }, [allowed]);

  const flatList = useMemo(() => [...(data.built_in || []), ...(data.custom || [])], [data]);
  const selected = useMemo(() => flatList.find((p) => p.key === selectedKey) || flatList[0], [flatList, selectedKey]);
  const resources = useMemo(() => (selected?.permissions ? Object.keys(selected.permissions).sort() : []), [selected]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.delete(`/permission-presets/${confirmDelete.id}`);
      toast.success(`Deleted "${confirmDelete.label}"`);
      setConfirmDelete(null);
      setSelectedKey(null);
      await load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  if (!allowed) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500" data-testid="presets-denied">
        Access denied — you need users.view permission.
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto" data-testid="presets-admin-page">
      <PageHeader crumb="Settings / Permissions Matrix" title="Permissions Matrix"
        subtitle="Curate role presets and decide which modules show up on the mobile app."
        action={canEdit && tab === 'presets' && (
          <button onClick={() => setCreateOpen(true)} data-testid="preset-create-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600">
            <Add20Regular /> Create preset
          </button>
        )} />

      {/* Phase 4.3 — Tab strip between Permission Presets and Mobile Modules. */}
      <div className="flex items-center gap-1 mb-4 border-b border-slate-200" data-testid="permissions-tabs">
        <TabBtn active={tab === 'presets'} onClick={() => setTab('presets')}
          icon={<ShieldCheckmark20Regular />} label="Permission Presets" testid="tab-presets" />
        <TabBtn active={tab === 'mobile'} onClick={() => setTab('mobile')}
          icon={<Phone20Regular />} label="Mobile App Modules" testid="tab-mobile" />
      </div>

      {tab === 'mobile' ? (
        <MobileModulesSection canEdit={canEdit} />
      ) : loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          {/* LEFT — preset list */}
          <aside className="rounded-2xl border border-slate-200 bg-white p-3" data-testid="preset-list">
            <SectionTitle>Built-in <span className="text-slate-400 font-normal">(read-only)</span></SectionTitle>
            <ul className="space-y-1">
              {(data.built_in || []).map((p) => (
                <PresetListItem key={p.key} preset={p} selected={selectedKey === p.key}
                  onSelect={() => setSelectedKey(p.key)} testid={`preset-list-${p.key}`} />
              ))}
            </ul>
            <SectionTitle className="mt-4">Custom</SectionTitle>
            {(data.custom || []).length === 0 ? (
              <div className="text-[11px] italic text-slate-400 px-2 py-2">No custom presets yet.</div>
            ) : (
              <ul className="space-y-1">
                {(data.custom || []).map((p) => (
                  <PresetListItem key={p.key} preset={p} selected={selectedKey === p.key}
                    onSelect={() => setSelectedKey(p.key)} testid={`preset-list-${p.key}`} />
                ))}
              </ul>
            )}
          </aside>

          {/* RIGHT — detail */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="preset-detail">
            {!selected ? (
              <div className="text-sm text-slate-500">Pick a preset on the left to see its matrix.</div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-violet-700 mb-1 inline-flex items-center gap-1.5">
                      <Sparkle20Filled style={{ width: 12, height: 12 }} /> {selected.is_builtin ? 'Built-in' : 'Custom'} preset
                    </div>
                    <h2 className="font-display text-2xl font-semibold text-slate-900">{selected.label}</h2>
                    {selected.description && <p className="text-sm text-slate-600 mt-1 max-w-2xl">{selected.description}</p>}
                  </div>
                  {canEdit && !selected.is_builtin && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditing({
                          id: selected.id, label: selected.label, description: selected.description || '',
                          permissions: JSON.parse(JSON.stringify(selected.permissions || {})),
                        })} data-testid="preset-detail-edit"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
                        <Edit20Regular /> Edit
                      </button>
                      <button onClick={() => setConfirmDelete(selected)} data-testid="preset-detail-delete"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-300 text-rose-700 bg-white text-sm font-medium hover:bg-rose-50">
                        <Delete20Regular /> Delete
                      </button>
                    </div>
                  )}
                  {selected.is_builtin && (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 px-2.5 py-1 rounded-full bg-slate-100">
                      <Lock20Regular style={{ width: 12, height: 12 }} /> Read-only
                    </div>
                  )}
                </div>

                {/* Matrix grid */}
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="zebra-list w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Resource</th>
                        {ACTIONS.map((a) => <th key={a} className="text-center px-3 py-2 font-semibold">{a}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {resources.map((r) => (
                        <tr key={r} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-medium text-slate-700">{r}</td>
                          {ACTIONS.map((a) => {
                            const v = !!selected.permissions?.[r]?.[a];
                            return (
                              <td key={a} className="text-center px-3 py-2" data-testid={`preset-cell-${r}-${a}`}>
                                {v
                                  ? <Checkmark16Filled className="inline text-emerald-600" />
                                  : <Dismiss16Regular className="inline text-slate-300" />}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <PresetEditDialog
        open={createOpen || !!editing}
        initial={editing}
        templatePerms={selected?.permissions || null}
        onClose={() => { setCreateOpen(false); setEditing(null); }}
        onSaved={() => { setCreateOpen(false); setEditing(null); load(); }}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent data-testid="preset-delete-confirm">
          <DialogHeader>
            <DialogTitle className="font-display">Delete preset?</DialogTitle>
            <DialogDescription>
              {confirmDelete ? `"${confirmDelete.label}" will be removed for everyone in your org. Users who currently have this preset applied keep their permissions — only future "apply preset" loses this option.` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button onClick={() => setConfirmDelete(null)} className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700">Cancel</button>
            <button onClick={handleDelete} disabled={busy} data-testid="preset-delete-confirm-btn"
              className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-60">
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionTitle({ children, className = '' }) {
  return <div className={`px-2 mb-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-slate-400 ${className}`}>{children}</div>;
}

// Phase 4.3 — page-level tab pill. Active tab gets an orange underline
// (matches the new 2-colour brand) and a slate-900 label; inactive tabs
// stay muted slate so the strip reads as navigation, not a CTA.
function TabBtn({ active, onClick, icon, label, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      data-active={active}
      className={[
        'relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
        active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700',
      ].join(' ')}
    >
      <span className={active ? 'text-orange-600' : 'text-slate-400'}>{icon}</span>
      {label}
      {active && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-orange-500 rounded-full" />}
    </button>
  );
}

function PresetListItem({ preset, selected, onSelect, testid }) {
  return (
    <li>
      <button onClick={onSelect} data-testid={testid}
        className={`w-full text-left rounded-lg px-2.5 py-2 text-sm transition-colors border-l-4 ${
          selected
            ? 'border-orange-500 bg-orange-50 text-slate-900 font-semibold pl-1.5'
            : 'border-transparent text-slate-700 hover:bg-slate-50 pl-1.5'
        }`}>
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="truncate">{preset.label}</span>
          {preset.is_builtin && <Lock20Regular className="shrink-0 text-slate-400" style={{ width: 12, height: 12 }} />}
        </div>
      </button>
    </li>
  );
}

function PresetEditDialog({ open, initial, templatePerms, onClose, onSaved }) {
  const isEdit = !!initial;
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [perms, setPerms] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setLabel(initial.label || '');
      setDescription(initial.description || '');
      setPerms(JSON.parse(JSON.stringify(initial.permissions || {})));
    } else {
      setLabel(''); setDescription('');
      // Default: empty matrix using the resources present in the currently
      // selected preset (which always has the full schema after server
      // normalisation). Backend re-validates against PERMISSIONS_SCHEMA so
      // missing resources are coerced to all-false anyway.
      const empty = {};
      Object.keys(templatePerms || {}).forEach((r) => {
        empty[r] = {}; ACTIONS.forEach((a) => { empty[r][a] = false; });
      });
      setPerms(empty);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, initial]);

  const allResources = useMemo(() => Object.keys(perms || {}).sort(), [perms]);

  const toggleCell = (r, a) => setPerms((prev) => {
    const next = { ...(prev || {}) };
    next[r] = { ...(next[r] || {}) };
    next[r][a] = !next[r][a];
    return next;
  });

  const save = async () => {
    if (!label.trim()) { toast.error('Label is required'); return; }
    setSaving(true);
    try {
      const payload = { label: label.trim(), description: description.trim(), permissions: perms };
      if (isEdit) await api.put(`/permission-presets/${initial.id}`, payload);
      else await api.post('/permission-presets', payload);
      toast.success(isEdit ? 'Preset saved' : 'Preset created');
      onSaved?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="preset-edit-modal">
        <DialogHeader>
          <DialogTitle className="font-display">{isEdit ? 'Edit preset' : 'Create preset'}</DialogTitle>
          <DialogDescription>Tick the (resource × action) cells this preset should grant.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <label className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Label</div>
            <input value={label} onChange={(e) => setLabel(e.target.value)} data-testid="preset-edit-label"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></label>
          <label className="block"><div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Description</div>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="preset-edit-description"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" /></label>
          <div className="rounded-xl border border-slate-200 overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table className="zebra-list w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Resource</th>
                  {ACTIONS.map((a) => <th key={a} className="text-center px-3 py-2 font-semibold">{a}</th>)}
                </tr>
              </thead>
              <tbody>
                {allResources.map((r) => (
                  <tr key={r} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-medium text-slate-700">{r}</td>
                    {ACTIONS.map((a) => (
                      <td key={a} className="text-center px-3 py-1.5">
                        <input type="checkbox"
                          checked={!!perms?.[r]?.[a]}
                          onChange={() => toggleCell(r, a)}
                          data-testid={`preset-edit-cell-${r}-${a}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700">Cancel</button>
          <button onClick={save} disabled={saving} data-testid="preset-edit-save"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium disabled:opacity-60">
            <Save20Regular /> {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create preset')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
