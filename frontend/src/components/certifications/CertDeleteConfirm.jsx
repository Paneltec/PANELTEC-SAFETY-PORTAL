// Phase 3.17 — Delete confirmation modal for the Certifications page.
//
// Replaces window.confirm() with a proper, accessible modal that names the
// worker + cert and surfaces the irreversibility of a soft-delete. Same
// rounded-2xl shell pattern as CertEditModal so the page feels consistent.
import { useEffect, useState } from 'react';
import { X, Loader2, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';

export default function CertDeleteConfirm({ cert, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  if (!cert) return null;

  const submit = async () => {
    setBusy(true);
    try {
      await api.delete(`/workers/certifications/${cert.id}`);
      toast.success('Certification deleted.');
      onDeleted?.(cert.id);
      onClose?.();
    } catch (err) {
      toast.error(apiError(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 grid place-items-center p-4"
      onClick={(e) => !busy && e.target === e.currentTarget && onClose?.()}
      data-testid="cert-delete-modal"
    >
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 px-5 pt-5">
          <div className="rounded-xl bg-rose-100 p-2 text-rose-700"><ShieldAlert size={18} /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-rose-700">
              Delete certification
            </div>
            <h3 className="font-display font-bold text-slate-900 mt-0.5">
              Remove “{cert.name}”?
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Belongs to <b>{cert.worker_first_name} {cert.worker_last_name}</b>.
              This soft-deletes the record and detaches its uploaded file if no
              other cert references it. Audit history is preserved.
            </p>
          </div>
          <button
            type="button" onClick={onClose} disabled={busy}
            data-testid="cert-delete-close"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-50"
          ><X size={16} /></button>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 mt-5 border-t border-slate-200 bg-slate-50">
          <button
            type="button" onClick={onClose} disabled={busy}
            data-testid="cert-delete-cancel"
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >Cancel</button>
          <button
            type="button" onClick={submit} disabled={busy}
            data-testid="cert-delete-confirm"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-60"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
          </button>
        </div>
      </div>
    </div>
  );
}
