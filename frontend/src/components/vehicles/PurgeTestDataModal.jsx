// v58.13.116 — In-context test-data purge modal for Plant & Vehicles.
//
// Replaces the .101 `<Link to="/app/settings/system#purge-test-data">`
// hop with a proper destructive-action modal that:
//   1. Re-queries the purge dry-run on open so the visible count is
//      always current (a 5-minute-stale banner shouldn't be able to
//      talk the admin into a purge).
//   2. Renders the audit summary (grand_total + cascade note) so the
//      admin sees exactly what will disappear.
//   3. Gates the destructive button behind a type-to-confirm input:
//      admin must type literally `PURGE` (case-sensitive) before the
//      rose "Purge N records" button becomes clickable.
//   4. On confirm → POST /admin/purge-test-data?dry_run=0 →
//      toast the deleted count → invoke onPurged() so the parent can
//      refresh the asset list + hide the banner.
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';

const REQUIRED_PHRASE = 'PURGE';

export default function PurgeTestDataModal({ open, onClose, onPurged }) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');

  // Re-query on every open so the count reflects live state.
  useEffect(() => {
    if (!open) {
      setConfirmText('');
      setError('');
      return;
    }
    let alive = true;
    setLoading(true);
    setDryRun(null);
    api.post('/admin/purge-test-data?dry_run=1')
      .then((r) => { if (alive) setDryRun(r.data); })
      .catch((e) => { if (alive) setError(apiError(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const grandTotal = dryRun?.grand_total ?? 0;
  const canConfirm = !busy && !loading && grandTotal > 0
    && confirmText === REQUIRED_PHRASE;

  const doPurge = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/admin/purge-test-data?dry_run=0');
      const deleted = data?.deleted || {};
      const total = data?.grand_total ?? 0;
      const cascade = deleted.asset_service_schedules_cascade || 0;
      toast.success(
        `Purged ${total} test record${total === 1 ? '' : 's'}`
        + (cascade > 0 ? ` (+${cascade} orphan service schedule${cascade === 1 ? '' : 's'} cascaded)` : ''),
      );
      onPurged?.();
      onClose();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      data-testid="purge-test-data-modal"
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-rose-100 text-rose-700 shrink-0">
            <AlertTriangle size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900">
              Purge {loading ? '…' : grandTotal} test record{grandTotal === 1 ? '' : 's'}?
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Destructive action — cannot be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            data-testid="purge-modal-close"
            className="p-1 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-40"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm">
          {loading && (
            <div className="text-xs text-slate-500 flex items-center gap-2" data-testid="purge-modal-loading">
              <Loader2 size={12} className="animate-spin" /> Re-checking live count…
            </div>
          )}
          {!loading && grandTotal === 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 text-xs" data-testid="purge-modal-empty">
              No test-pattern rows remain — the register is clean.
            </div>
          )}
          {!loading && grandTotal > 0 && (
            <>
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 space-y-1"
                data-testid="purge-modal-summary">
                <div>
                  <span className="font-bold">{grandTotal}</span> row{grandTotal === 1 ? '' : 's'} across{' '}
                  <span className="font-bold">{(dryRun?.matches || []).length}</span> collection{(dryRun?.matches || []).length === 1 ? '' : 's'} will be deleted.
                </div>
                <ul className="space-y-0.5 pl-3">
                  {(dryRun?.matches || []).map((m) => (
                    <li key={m.collection}>
                      · <span className="font-mono text-[11px]">{m.collection}</span>:{' '}
                      <span className="font-bold">{m.count}</span>
                      {m.samples?.length > 0 && (
                        <span className="text-rose-700/70">
                          {' '}— e.g. <span className="font-mono">{m.samples[0]}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="text-[11px] text-rose-800/80 pt-1">
                  Simpro-imported rows are excluded server-side. Linked{' '}
                  <span className="font-mono">asset_service_schedules</span> will be cascaded automatically.
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Type <span className="font-mono text-rose-700">{REQUIRED_PHRASE}</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoFocus
                  disabled={busy}
                  data-testid="purge-modal-confirm-input"
                  placeholder={REQUIRED_PHRASE}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none disabled:opacity-60"
                />
              </div>
            </>
          )}
          {error && (
            <div className="rounded-lg border border-rose-300 bg-rose-100 px-3 py-2 text-xs text-rose-900"
              data-testid="purge-modal-error">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            data-testid="purge-modal-cancel"
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={doPurge}
            disabled={!canConfirm}
            data-testid="purge-modal-confirm-btn"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <><Loader2 size={12} className="animate-spin" /> Purging…</> : `Purge ${grandTotal} record${grandTotal === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
