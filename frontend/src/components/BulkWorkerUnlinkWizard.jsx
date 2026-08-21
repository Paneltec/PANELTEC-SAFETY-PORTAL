// v58.13.29 — BulkWorkerUnlinkWizard. Destructive companion to the
// v58.13.26 BulkWorkerLinkWizard. Kept as a separate file rather
// than a third step of the link wizard because the confirm/destructive
// UX (red styling, explicit confirmation step) reads more clearly
// on its own than as a mode-switched branch.
//
// Flow:
//   1. Load — GET /hr/employees/linked → all currently-linked rows.
//   2. Review — table of linked employees with worker chip + checkbox.
//      Select all / Deselect all controls.
//   3. Confirm — click "Unlink N employees" (red) → modal:
//        "This will remove N worker links. Continue?"
//   4. Fire — POST /hr/employees/unlink-worker/bulk.
//   5. Toast per-employee result. Refetch employee list on completion.
//
// v58.13.10 flash-bug guardrail: every button handler calls
// e.stopPropagation() + e.preventDefault() before mutating state.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertTriangle, Unlink2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import useLockBodyScroll from '../lib/useLockBodyScroll';

export default function BulkWorkerUnlinkWizard({ onClose, onCompleted }) {
  useLockBodyScroll();
  const [loading, setLoading] = useState(true);
  const [linked, setLinked] = useState([]);
  const [selected, setSelected] = useState({}); // { employee_id: bool }
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/hr/employees/linked');
        if (cancelled) return;
        setLinked(data.items || []);
      } catch (e) {
        if (!cancelled) toast.error(apiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected],
  );

  const toggleOne = useCallback((e, employee_id) => {
    e.stopPropagation(); e.preventDefault();
    setSelected((prev) => ({ ...prev, [employee_id]: !prev[employee_id] }));
  }, []);

  const selectAll = useCallback((e) => {
    e.stopPropagation(); e.preventDefault();
    const next = {};
    for (const row of linked) next[row.employee_id] = true;
    setSelected(next);
  }, [linked]);

  const deselectAll = useCallback((e) => {
    e.stopPropagation(); e.preventDefault();
    setSelected({});
  }, []);

  const requestConfirm = useCallback((e) => {
    e.stopPropagation(); e.preventDefault();
    if (selectedCount === 0) {
      toast.info('No employees selected.');
      return;
    }
    setConfirming(true);
  }, [selectedCount]);

  const cancelConfirm = useCallback((e) => {
    e?.stopPropagation?.(); e?.preventDefault?.();
    setConfirming(false);
  }, []);

  const fireUnlink = useCallback(async (e) => {
    e.stopPropagation(); e.preventDefault();
    const employee_ids = linked
      .filter((row) => selected[row.employee_id])
      .map((row) => row.employee_id);
    if (employee_ids.length === 0) return;
    setSubmitting(true);
    try {
      const { data } = await api.post('/hr/employees/unlink-worker/bulk',
        { employee_ids });
      const succeeded = data.succeeded ?? 0;
      const failed = (data.failed || []).length;
      if (failed === 0) {
        toast.success(`Unlinked ${succeeded} employee${succeeded === 1 ? '' : 's'}.`);
      } else {
        toast.error(`${succeeded} unlinked · ${failed} failed.`);
        for (const f of (data.failed || [])) {
          toast.error(`Employee ${f.employee_id}: ${f.error}`);
        }
      }
      onCompleted?.();
      onClose();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  }, [linked, selected, onCompleted, onClose]);

  const closeSelf = useCallback((e) => {
    e?.stopPropagation?.(); e?.preventDefault?.();
    if (confirming) { setConfirming(false); return; }
    onClose();
  }, [confirming, onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-3"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="bulk-worker-unlink-wizard"
    >
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <Unlink2 size={16} className="text-rose-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-slate-900 text-base">
              Bulk unlink worker links
            </h3>
            <p className="text-[11px] text-slate-500">
              {loading ? 'Loading…' : `${linked.length} currently-linked employee${linked.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <button
            onClick={closeSelf}
            data-testid="bulk-unlink-close"
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {loading && (
          <div className="p-8 text-center text-sm text-slate-500" data-testid="bulk-unlink-loading">
            <Loader2 size={16} className="inline animate-spin mr-2" />
            Loading linked employees…
          </div>
        )}

        {!loading && linked.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500" data-testid="bulk-unlink-empty">
            No employees are currently linked to a worker. Nothing to unlink.
          </div>
        )}

        {!loading && linked.length > 0 && (
          <>
            <div className="px-5 py-2 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center gap-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-2">
                Selection:
              </div>
              <button
                type="button"
                onClick={selectAll}
                data-testid="bulk-unlink-select-all"
                className="px-3 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Select all ({linked.length})
              </button>
              <button
                type="button"
                onClick={deselectAll}
                data-testid="bulk-unlink-deselect-all"
                className="px-3 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Deselect all
              </button>
              <div className="ml-auto text-xs text-slate-600" data-testid="bulk-unlink-selected-count">
                <b>{selectedCount}</b> of {linked.length} selected
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="min-w-full text-sm" data-testid="bulk-unlink-table">
                <thead className="bg-white sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold w-12">Select</th>
                    <th className="px-3 py-2 text-left font-semibold">Employee</th>
                    <th className="px-3 py-2 text-left font-semibold">Currently linked to worker</th>
                  </tr>
                </thead>
                <tbody>
                  {linked.map((row) => {
                    const on = !!selected[row.employee_id];
                    return (
                      <tr key={row.employee_id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) => toggleOne(e, row.employee_id)}
                            data-testid={`bulk-unlink-select-${row.employee_id}`}
                            className="h-4 w-4 rounded border-slate-400 text-rose-600 focus:ring-rose-500"
                          />
                        </td>
                        <td className="px-3 py-2 text-slate-800">{row.employee_name}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold">
                            <span aria-hidden>👤</span>
                            {row.worker_name}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2">
          <div className="text-xs text-slate-500">
            Unlinking preserves each link in the audit trail — nothing is deleted, only the pointer is cleared.
          </div>
          <button
            type="button"
            onClick={closeSelf}
            className="ml-auto px-3 py-1.5 rounded border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            data-testid="bulk-unlink-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={requestConfirm}
            disabled={loading || selectedCount === 0 || submitting}
            data-testid="bulk-unlink-request-confirm"
            className="px-4 py-1.5 rounded bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
          >
            <Unlink2 size={12} className="inline mr-1" />
            Unlink {selectedCount} employee{selectedCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>

      {/* Confirmation modal — destructive action confirmation step */}
      {confirming && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4"
          onClick={(e) => e.target === e.currentTarget && cancelConfirm(e)}
          data-testid="bulk-unlink-confirm-dialog"
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-3">
              <div className="p-2 rounded-full bg-rose-100 text-rose-600">
                <AlertTriangle size={20} />
              </div>
              <div className="flex-1">
                <div className="text-lg font-bold text-slate-900">
                  Confirm bulk unlink
                </div>
                <div className="text-sm text-slate-600 mt-1">
                  This will remove <b>{selectedCount}</b> worker link{selectedCount === 1 ? '' : 's'}.
                  {' '}Each unlink is written to the audit trail. Continue?
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelConfirm}
                disabled={submitting}
                data-testid="bulk-unlink-confirm-cancel"
                className="px-4 py-1.5 rounded border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={fireUnlink}
                disabled={submitting}
                data-testid="bulk-unlink-confirm-fire"
                className="px-4 py-1.5 rounded bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                {submitting ? (
                  <><Loader2 size={12} className="inline animate-spin mr-1" />Unlinking…</>
                ) : (
                  <>Yes, unlink {selectedCount}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
