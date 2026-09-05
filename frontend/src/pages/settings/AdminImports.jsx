/**
 * v58.13.120e — Admin XLSX imports page.
 *
 * Migrated out of the retired `PlantVehicles.jsx` on Phase 5 of the
 * Fleet & Service Register rebuild. Wraps the existing
 * `POST /api/plant-maintenance/reimport` endpoint (unchanged) so
 * bulk historic-data upload is still available — just no longer
 * cluttering the daily operator surface.
 */
import React, { useState } from 'react';
import { Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import { Can } from '../../lib/permissions';

export default function AdminImports() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    if (!file) { toast.error('Choose an XLSX file first'); return; }
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/plant-maintenance/reimport', fd,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(r.data);
      toast.success('Import complete');
    } catch (e) {
      toast.error(apiError(e) || 'Import failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 max-w-3xl" data-testid="admin-imports-page">
      <header className="mb-6">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Settings</div>
        <h1 className="text-xl font-semibold text-slate-900 mt-0.5">Imports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Bulk upload historic data. XLSX only. Used for one-time backfills;
          day-to-day service logging happens on the{' '}
          <a href="/app/fleet" className="text-blue-600 hover:underline">Fleet &amp; Service Register</a>.
        </p>
      </header>

      <Can resource="assets" action="edit" fallback={
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">
          You don't have permission to run imports. Contact an admin.
        </div>
      }>
        <section className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="admin-imports-plant-maintenance">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Plant Maintenance history
              </div>
              <h2 className="text-base font-semibold text-slate-900 mt-0.5">Reimport XLSX</h2>
            </div>
            <a
              href="/app/fleet"
              data-testid="admin-imports-back-to-fleet"
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              ← Back to Fleet Register
            </a>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            Uploads replace maintenance records in-place using <code>maintenance_id</code>
            as the merge key. New rows are inserted; existing rows are updated;
            unchanged rows are skipped. Regos that don't yet map to an asset are
            auto-created on the register.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              data-testid="admin-imports-file-input"
              className="text-sm"
            />
            <button
              onClick={submit}
              disabled={busy || !file}
              data-testid="admin-imports-submit"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {busy ? 'Uploading…' : 'Upload & import'}
            </button>
          </div>
          {result && (
            <div className="mt-4 rounded-md bg-emerald-50 border border-emerald-200 text-sm px-4 py-3 text-emerald-900"
                 data-testid="admin-imports-result">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 size={14} /> Import complete
              </div>
              <div className="mt-1 text-xs tabular-nums">
                new: {result.inserted} · updated: {result.updated} ·
                unchanged: {result.unchanged} · total records: {result.live_total}
              </div>
            </div>
          )}
        </section>
      </Can>
    </div>
  );
}
