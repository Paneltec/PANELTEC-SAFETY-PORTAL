// v160.3.9.31-4a — Phase 4a Role Forms panel.
//
// Second tab inside the RoleMatrixEditor drawer. Manages entries in the
// `role_forms` collection via the new endpoints under
// `/api/admin/roles/{role_id}/forms`. Read-only on system roles.

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, FileText, Search as SearchIcon, X as XIcon } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../ui/dialog';

export default function RoleFormsPanel({ role, readOnly }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [available, setAvailable] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerRequired, setPickerRequired] = useState(false);
  const [pickerSelected, setPickerSelected] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    if (!role?.role_id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/roles/${role.role_id}/forms`);
      setRows(data?.assigned || []);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }, [role?.role_id]);

  useEffect(() => { load(); }, [load]);

  const openPicker = async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    setPickerQuery('');
    setPickerSelected(null);
    setPickerRequired(false);
    try {
      const { data } = await api.get(`/admin/roles/${role.role_id}/forms/available`);
      setAvailable(data?.available || []);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setPickerLoading(false);
    }
  };

  const submitAssign = async () => {
    if (!pickerSelected) return;
    setBusy(true);
    try {
      await api.post(`/admin/roles/${role.role_id}/forms`, {
        form_id: pickerSelected.form_id,
        is_required: pickerRequired,
      });
      toast.success(`Assigned "${pickerSelected.name}"`);
      setPickerOpen(false);
      await load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleRequired = async (row) => {
    if (readOnly) return;
    try {
      await api.patch(`/admin/roles/${role.role_id}/forms/${row.form_id}`, {
        is_required: !row.is_required,
      });
      await load();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const doRemove = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.delete(`/admin/roles/${role.role_id}/forms/${confirmDelete.form_id}`);
      toast.success(`Removed "${confirmDelete.name}"`);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const filteredAvailable = pickerQuery
    ? available.filter((a) => (a.name || '').toLowerCase().includes(pickerQuery.toLowerCase()))
    : available;

  return (
    <div className="flex-1 overflow-auto px-6 py-4" data-testid="role-forms-panel">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest font-semibold text-slate-500">
            Forms assigned to this role
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {readOnly
              ? 'System roles are read-only. Create a custom role to manage assignments.'
              : `Tick "Required" to mark a form as mandatory. `}
            <span className="text-slate-400">
              (Runtime enforcement wires in Phase 5/6 — this is a catalogue for now.)
            </span>
          </div>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={openPicker}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
            data-testid="role-forms-assign-btn"
          >
            <Plus className="w-4 h-4" /> Assign a form
          </button>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm" data-testid="role-forms-table">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="py-2.5 px-4 font-medium text-slate-600">Form</th>
              <th className="py-2.5 px-4 font-medium text-slate-600 w-32">Category</th>
              <th className="py-2.5 px-4 font-medium text-slate-600 w-24 text-center">Required</th>
              <th className="py-2.5 px-4 font-medium text-slate-600 w-40">Assigned at</th>
              <th className="py-2.5 px-4 font-medium text-slate-600 w-16 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="text-center py-8 text-slate-500">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-slate-500">
                  <FileText className="w-6 h-6 mx-auto text-slate-300 mb-1" />
                  No forms assigned.
                  {!readOnly && ' Click "Assign a form" to add one.'}
                </td>
              </tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.form_id} className="border-t border-slate-100 hover:bg-slate-50/60" data-testid={`role-form-row-${r.form_id}`}>
                <td className="py-2 px-4 text-slate-800">{r.name}</td>
                <td className="py-2 px-4">
                  <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] border border-slate-200 capitalize">
                    {(r.category || 'general').replace('_', ' ')}
                  </span>
                </td>
                <td className="py-2 px-4 text-center">
                  <input
                    type="checkbox"
                    checked={Boolean(r.is_required)}
                    disabled={readOnly}
                    onChange={() => toggleRequired(r)}
                    className="rounded border-slate-300 h-4 w-4"
                    data-testid={`role-form-required-${r.form_id}`}
                  />
                </td>
                <td className="py-2 px-4 text-slate-500 text-xs">
                  {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                </td>
                <td className="py-2 px-4 text-right">
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(r)}
                      className="inline-flex items-center justify-center p-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50"
                      data-testid={`role-form-remove-${r.form_id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* + Assign a form picker */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl" data-testid="role-forms-picker-dialog">
          <DialogHeader>
            <DialogTitle>Assign a form to {role?.name}</DialogTitle>
            <DialogDescription>
              Pick a form template from your organisation. Only forms not already
              assigned to this role are shown.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <SearchIcon className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search available forms…"
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                data-testid="role-forms-picker-search"
                autoFocus
              />
            </div>
            <div className="max-h-72 overflow-auto border border-slate-200 rounded-lg">
              {pickerLoading && (
                <div className="text-center py-6 text-sm text-slate-500">Loading…</div>
              )}
              {!pickerLoading && filteredAvailable.length === 0 && (
                <div className="text-center py-6 text-sm text-slate-500">
                  {pickerQuery ? 'No forms match your search.' : 'All forms are already assigned.'}
                </div>
              )}
              {!pickerLoading && filteredAvailable.map((f) => (
                <button
                  key={f.form_id}
                  type="button"
                  onClick={() => setPickerSelected(f)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 flex items-center justify-between ${pickerSelected?.form_id === f.form_id ? 'bg-blue-50' : ''}`}
                  data-testid={`role-forms-picker-option-${f.form_id}`}
                >
                  <div>
                    <div className="text-sm text-slate-800">{f.name}</div>
                    <div className="text-[11px] text-slate-500 capitalize">{(f.category || 'general').replace('_', ' ')}</div>
                  </div>
                  {pickerSelected?.form_id === f.form_id && (
                    <span className="text-xs text-blue-700 font-medium">Selected</span>
                  )}
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={pickerRequired}
                onChange={(e) => setPickerRequired(e.target.checked)}
                className="rounded border-slate-300"
                data-testid="role-forms-picker-required"
              />
              Mark as required for this role
            </label>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitAssign}
              disabled={busy || !pickerSelected}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-40"
              data-testid="role-forms-picker-submit"
            >
              {busy ? 'Assigning…' : 'Assign form'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent data-testid="role-forms-remove-dialog">
          <DialogHeader>
            <DialogTitle>Remove “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription>
              This unassigns the form from this role. The form template itself is not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doRemove}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40"
              data-testid="role-forms-remove-confirm"
            >
              {busy ? 'Removing…' : 'Remove'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
