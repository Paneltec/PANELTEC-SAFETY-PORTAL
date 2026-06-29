// Phase 3.17 — Edit Certification modal.
//
// Backs the ✏️ row action on the global Certifications page.
// Edits the four user-facing fields (name, issuer, issue_date, expiry_date)
// via `PATCH /api/workers/certifications/{id}`. The backend recomputes
// `doc_seed_folder` automatically when `name` changes, so we don't surface
// that field here.
//
// Modal shell mirrors the spacing/elevation pattern used by InductionCardModal
// (small rounded-2xl card centred over a slate-900/70 backdrop, ESC closes).
import { useEffect, useState } from 'react';
import { X, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';

export default function CertEditModal({ cert, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!cert) return;
    setName(cert.name || '');
    setIssuer(cert.issuer || '');
    setIssueDate(cert.issue_date || '');
    setExpiryDate(cert.expiry_date || '');
  }, [cert]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!cert) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required.'); return;
    }
    setSaving(true);
    try {
      const { data } = await api.patch(`/workers/certifications/${cert.id}`, {
        name: name.trim(),
        issuer: issuer.trim(),
        issue_date: issueDate || null,
        expiry_date: expiryDate || null,
      });
      toast.success('Certification updated.');
      onSaved?.(data);
      onClose?.();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      data-testid="cert-edit-modal"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-200 bg-slate-50">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-blue-600">
              Edit certification
            </div>
            <div className="font-semibold text-slate-900 truncate">
              {cert.worker_first_name} {cert.worker_last_name}
            </div>
          </div>
          <button
            type="button" onClick={onClose} data-testid="cert-edit-close"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-200"
          ><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3">
          <Field label="Name" required>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              data-testid="cert-edit-name" maxLength={160} autoFocus
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </Field>
          <Field label="Issuer">
            <input
              type="text" value={issuer} onChange={(e) => setIssuer(e.target.value)}
              data-testid="cert-edit-issuer" maxLength={160}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issue date">
              <input
                type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)}
                data-testid="cert-edit-issue-date"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg" />
            </Field>
            <Field label="Expiry date">
              <input
                type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)}
                data-testid="cert-edit-expiry-date"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg" />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-200 bg-slate-50">
          <button
            type="button" onClick={onClose} disabled={saving}
            data-testid="cert-edit-cancel"
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >Cancel</button>
          <button
            type="submit" disabled={saving}
            data-testid="cert-edit-save"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-700">
        {label} {required && <span className="text-rose-600">*</span>}
      </span>
      <span className="block mt-1">{children}</span>
    </label>
  );
}
