import React, { useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from './ui/alert-dialog';
import { Can } from '../lib/permissions';
import api, { apiError } from '../lib/api';

/**
 * Soft-delete button + confirm dialog used on every capture list page.
 *
 * v160.2.9-delete — Capture sub-tabs (Pre-Starts, Site Diary, Hazards,
 * Incidents, Inspections) union `form_submissions` rows into their list
 * response (see `crud.py::build_router` mirror_categories, shipped in
 * v160.2.5a). Those mirrored rows carry `source: "form_submission"` and
 * their `id` field is the source submission id — which does NOT exist in
 * the legacy per-entity collection. Calling `DELETE /api/pre-starts/{id}`
 * on a mirrored row therefore 404'd silently, which is exactly the bug
 * reported ("clicking the delete button does nothing / shows error").
 *
 * Fix: when `source === "form_submission"` we route the DELETE to
 * `/api/forms/submissions/{id}` which soft-deletes the correct row and
 * makes it disappear from every mirroring Capture tab.
 *
 * Props:
 *   resourceKind  e.g. "swms", "pre_starts", "site_diary",
 *                       "hazards", "incidents", "inspections"
 *   apiPath       URL segment under /api (e.g. "swms", "pre-starts") —
 *                 used ONLY for the legacy path.
 *   recordId      UUID of the record (or submission id when mirrored).
 *   label         human-friendly label shown in the dialog title (e.g. "SWMS")
 *   recordTitle   optional title to mention in the dialog body
 *   source        v160.2.9-delete — "form_submission" for mirrored rows,
 *                 undefined/null for legacy rows.
 *   onDeleted     callback invoked on successful delete (page refreshes its list)
 */
export default function DeleteRecordButton({
  resourceKind, apiPath, recordId, label, recordTitle, source, onDeleted,
  // eslint-disable-next-line no-unused-vars
  iconOnly,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isMirrored = source === 'form_submission';

  const doDelete = async () => {
    setBusy(true);
    try {
      if (isMirrored) {
        // v160.2.9-delete — mirrored submissions live in `form_submissions`.
        await api.delete(`/forms/submissions/${recordId}`);
      } else {
        await api.delete(`/${apiPath}/${recordId}`);
      }
      toast.success('Record deleted');
      setOpen(false);
      onDeleted?.(recordId);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 403) toast.error("You don't have permission to delete this record");
      else if (status === 404) toast.error('This record has already been deleted or moved.');
      else toast.error(apiError(e) || 'Could not delete record');
    } finally { setBusy(false); }
  };

  return (
    <Can resource={resourceKind} action="edit">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            title="Delete"
            aria-label={`Delete ${label}`}
            data-testid={`delete-${resourceKind}-${recordId}`}
            className="inline-flex items-center justify-center w-6 h-6 rounded border border-rose-200 bg-white text-rose-500 hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent onClick={(e) => e.stopPropagation()} data-testid={`delete-dialog-${resourceKind}-${recordId}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {recordTitle && <span className="block font-medium text-slate-900 mb-2">{recordTitle}</span>}
              This will soft-delete the record. Records remain in the database for audit
              but are hidden from all lists and reports. This action can be reversed by an
              administrator.
              {isMirrored && (
                <span className="block mt-2 text-xs text-slate-500">
                  Submitted from the mobile app — this deletes the original submission.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid={`delete-cancel-${recordId}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              disabled={busy}
              data-testid={`delete-confirm-${recordId}`}
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
            >
              {busy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Trash2 size={14} className="mr-1.5" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Can>
  );
}
