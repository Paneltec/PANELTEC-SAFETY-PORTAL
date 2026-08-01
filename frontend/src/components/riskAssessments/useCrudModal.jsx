// v160.3.9.24 — Shared CRUD affordances hook for Risk Assessments tabs.
// Returns four things a tab renders:
//   AddButton   — admin-only primary button in the tab toolbar
//   RowActions  — icon-row (Edit + Delete) for each table row (admin-only)
//   Modals      — the form modal + delete confirmation, portalled into a single node
//   Anyone can wrap their `load()` and pass it as `onRefresh`.
import React, { useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import useLockBodyScroll from '../../lib/useLockBodyScroll';
import RecordFormModal from './RecordFormModal';
import { TAB_CONFIGS } from './schemas';
import {
  Add20Regular as Plus,
  Edit20Regular as EditIcon,
  Delete20Regular as DeleteIcon,
} from '@fluentui/react-icons';

export default function useCrudModal({ tabKey, isAdmin, onRefresh }) {
  const cfg = TAB_CONFIGS[tabKey];
  const [addOpen, setAddOpen]     = useState(false);
  const [editRow, setEditRow]     = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [busy, setBusy]           = useState(false);

  const AddButton = isAdmin && cfg ? (
    <button
      type="button"
      onClick={() => setAddOpen(true)}
      data-testid={`ra-add-${tabKey}`}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-blue-800 text-white hover:bg-blue-900 shadow-sm">
      <Plus /> Add
    </button>
  ) : null;

  const RowActions = (row) => {
    if (!isAdmin || !cfg) return null;
    return (
      <div className="flex items-center gap-1 shrink-0" data-testid={`ra-actions-${row.id}`}>
        <button type="button" title="Edit" onClick={() => setEditRow(row)}
          data-testid={`ra-edit-${row.id}`}
          className="p-1.5 rounded-md hover:bg-blue-100 text-slate-600 hover:text-blue-700">
          <EditIcon />
        </button>
        <button type="button" title="Delete" onClick={() => setDeleteRow(row)}
          data-testid={`ra-delete-${row.id}`}
          className="p-1.5 rounded-md hover:bg-rose-100 text-slate-600 hover:text-rose-700">
          <DeleteIcon />
        </button>
      </div>
    );
  };

  const confirmDelete = async () => {
    if (!deleteRow?.id) return;
    setBusy(true);
    try {
      await api.delete(`${cfg.resource}/${encodeURIComponent(deleteRow.id)}`);
      toast.success('Record deleted');
      setDeleteRow(null);
      onRefresh?.();
    } catch (e) {
      toast.error(apiError(e) || 'Delete failed');
    } finally { setBusy(false); }
  };

  const Modals = cfg ? (
    <>
      {addOpen && (
        <RecordFormModal mode="create" resource={cfg.resource} keyField={cfg.keyField}
          schema={cfg.schema} initialValues={{}}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); onRefresh?.(); }} />
      )}
      {editRow && (
        <RecordFormModal mode="edit" resource={cfg.resource} keyField={cfg.keyField}
          schema={cfg.schema} initialValues={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => { setEditRow(null); onRefresh?.(); }} />
      )}
      {deleteRow && (
        <DeleteConfirm row={deleteRow} busy={busy}
          onCancel={() => setDeleteRow(null)}
          onConfirm={confirmDelete} />
      )}
    </>
  ) : null;

  return { AddButton, RowActions, Modals };
}

function DeleteConfirm({ row, busy, onCancel, onConfirm }) {
  useLockBodyScroll();
  const label = row.name || row.risk_id || row.company_name || row.role_name
              || row.training_name || row.issue_number || row.id?.slice(0, 8);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
      data-testid="ra-delete-confirm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-display font-semibold text-slate-900">Delete this record?</h3>
        <p className="mt-2 text-sm text-slate-600">
          <span className="font-semibold">{label}</span> will be removed. This action writes an
          audit-log entry with your identity and cannot be undone from the UI.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-testid="ra-delete-cancel">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-rose-600 text-white font-semibold hover:bg-rose-700 disabled:opacity-50"
            data-testid="ra-delete-confirm-btn">{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>
    </div>
  );
}
