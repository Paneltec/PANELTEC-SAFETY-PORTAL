// v58.13.132mb — Hard-delete confirmation modal.
//
// Wraps DELETE /document-library/files/{id}/hard and
// DELETE /document-library/folders/{id}/hard from Phase 1.
// Requires the user to type the target name to confirm — cheap guard
// against a mis-clicked "empty a folder" action. NOT a substitute for
// backup / audit trail (Phase 1 hard-delete removes GridFS bytes + the
// row + any active shares).
//
// Props:
//   · target: { kind: 'file' | 'folder', id, name, fileCount? }
//   · onClose(): void
//   · onDeleted(): void — parent should reload its listing
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import api, { apiError } from '../../lib/api';

export default function HardDeleteModal({ target, onClose, onDeleted }) {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const canDelete = confirmText.trim() === (target.name || '').trim() && !busy;

  const doDelete = async () => {
    setBusy(true);
    try {
      const url = target.kind === 'folder'
        ? `/document-library/folders/${target.id}/hard`
        : `/document-library/files/${target.id}/hard`;
      await api.delete(url);
      toast.success(`${target.kind === 'folder' ? 'Folder' : 'File'} permanently deleted.`);
      onDeleted?.();
      onClose?.();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[95] bg-slate-950/60 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="hard-delete-modal"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-rose-200 bg-rose-50 flex items-start gap-3">
          <div className="p-2 rounded-full bg-rose-100 text-rose-700">
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-rose-700">
              Hard delete — cannot be undone
            </div>
            <h3
              className="font-display font-bold text-slate-900 text-lg mt-0.5 truncate"
              data-testid="hard-delete-modal-name"
              title={target.name}
            >
              {target.name}
            </h3>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4 text-sm text-slate-700">
          {target.kind === 'folder' ? (
            <p>
              This will permanently delete the folder{' '}
              <span className="font-semibold">"{target.name}"</span>
              {typeof target.fileCount === 'number' && (
                <>{' '}and its <span className="font-semibold">{target.fileCount}</span> file{target.fileCount === 1 ? '' : 's'}</>
              )}{', '} including every subfolder. Bytes are removed from
              storage. Active shares are revoked.
            </p>
          ) : (
            <p>
              This will permanently delete{' '}
              <span className="font-semibold">"{target.name}"</span>. Bytes
              are removed from storage. Active shares are revoked. This
              bypasses the normal soft-delete + 30-day archive.
            </p>
          )}
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1.5">
              Type the {target.kind} name to confirm
            </label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              data-testid="hard-delete-confirm-input"
              placeholder={target.name}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/40"
            />
          </div>
        </div>

        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            data-testid="hard-delete-cancel"
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={doDelete}
            disabled={!canDelete}
            data-testid="hard-delete-confirm"
            className={`px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 ${
              canDelete
                ? 'bg-rose-600 text-white hover:bg-rose-700'
                : 'bg-rose-200 text-rose-400 cursor-not-allowed'
            }`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Permanently delete
          </button>
        </div>
      </div>
    </div>
  );
}
