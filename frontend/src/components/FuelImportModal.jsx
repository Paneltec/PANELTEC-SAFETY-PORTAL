/**
 * v58.13.131c — SmartFill Fuel CSV Import modal (admin-only).
 *
 * Drag-drop or click-to-pick a SmartFill portal CSV export, POST it
 * to `/api/fleet/fuel/import-csv`, and render a compact results
 * card. Admin gate is enforced client-side via the parent
 * (`FleetRegister` only renders the "Import Fuel CSV" button when
 * `usePermissions().role === 'admin'`) and server-side by
 * `fleet_fuel.py::_require_admin` (403 for non-admin).
 *
 * Never emails or SMS-es. All side-effects are inbox-only.
 */
import React, { useRef, useState } from 'react';
import { X, Upload, Loader2, FileText, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';

const MAX_MB = 20;

export default function FuelImportModal({ open, onClose, onImported }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  if (!open) return null;

  const pickFile = () => inputRef.current?.click();

  const onFilePicked = (f) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) {
      toast.error('CSV files only (expected .csv extension)');
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error(`File too large — max ${MAX_MB}MB`);
      return;
    }
    setFile(f);
    setResult(null);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    onFilePicked(f);
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/fleet/fuel/import-csv', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(r.data);
      toast.success(
        `Imported ${r.data.rows_inserted} row${r.data.rows_inserted === 1 ? '' : 's'} · ` +
        `${r.data.rows_duplicate} duplicate · ${r.data.rows_rejected} rejected`,
      );
      onImported?.(r.data);
    } catch (e) {
      if (e?.response?.status === 403) {
        toast.error('Admin only — CSV imports require the admin role.');
      } else {
        toast.error(apiError(e) || 'Import failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-3"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose?.()}
      data-testid="fuel-import-modal"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">SmartFill importer</div>
            <h3 className="font-display text-lg font-bold text-slate-900">Import Fuel CSV</h3>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose?.()}
            data-testid="fuel-import-close"
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!result && (
            <>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 flex gap-2">
                <Info size={14} className="shrink-0 mt-0.5" />
                <div>
                  Export from the SmartFill Web Portal (Transactions → Export as CSV).
                  Required columns: <strong>Date/Time</strong>, <strong>Litres</strong>, and at least one of{' '}
                  <strong>Key/Code</strong>, <strong>Card Number</strong>, or <strong>Registration</strong>.
                  Duplicate rows (same Transaction Id) are skipped automatically.
                </div>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={pickFile}
                data-testid="fuel-import-dropzone"
                className={`rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-blue-500 bg-blue-50/60'
                    : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
                }`}
              >
                <Upload className="mx-auto text-slate-400 mb-2" size={32} />
                <div className="text-sm font-semibold text-slate-800">
                  {file ? file.name : 'Drop CSV here or click to browse'}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {file
                    ? `${(file.size / 1024).toFixed(1)} KB · ready to import`
                    : `CSV up to ${MAX_MB} MB · SmartFill Portal export`}
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  data-testid="fuel-import-file-input"
                  onChange={(e) => onFilePicked(e.target.files?.[0])}
                />
              </div>

              {file && (
                <button
                  type="button"
                  onClick={reset}
                  data-testid="fuel-import-clear-file"
                  className="text-xs text-slate-500 hover:text-slate-700 underline"
                >
                  Choose a different file
                </button>
              )}
            </>
          )}

          {result && (
            <div className="space-y-3" data-testid="fuel-import-results">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="text-emerald-600" size={18} />
                  <div className="text-sm font-bold text-emerald-900">Import complete</div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  <ResultChip
                    label="Rows total"
                    value={result.rows_total}
                    testid="fuel-import-total"
                  />
                  <ResultChip
                    label="Inserted"
                    value={result.rows_inserted}
                    tone="emerald"
                    testid="fuel-import-inserted"
                  />
                  <ResultChip
                    label="Duplicate"
                    value={result.rows_duplicate}
                    tone="slate"
                    testid="fuel-import-duplicate"
                  />
                  <ResultChip
                    label="Unmatched"
                    value={result.rows_unmatched}
                    tone={result.rows_unmatched > 0 ? 'amber' : 'slate'}
                    testid="fuel-import-unmatched"
                  />
                  <ResultChip
                    label="Anomalies"
                    value={result.rows_anomalous}
                    tone={result.rows_anomalous > 0 ? 'rose' : 'slate'}
                    testid="fuel-import-anomalies"
                  />
                  <ResultChip
                    label="Rejected"
                    value={result.rows_rejected}
                    tone={result.rows_rejected > 0 ? 'rose' : 'slate'}
                    testid="fuel-import-rejected"
                  />
                </div>
              </div>

              {(result.header_warnings?.length ?? 0) > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                  <div className="font-bold uppercase tracking-wider text-[10px] mb-1">
                    Header warnings
                  </div>
                  <ul className="list-disc ml-4 space-y-0.5">
                    {result.header_warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(result.unmatched_regos?.length ?? 0) > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                  <div className="font-bold uppercase tracking-wider text-[10px] mb-1">
                    Unmatched identifiers ({result.unmatched_regos.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {result.unmatched_regos.slice(0, 20).map((r) => (
                      <span
                        key={r}
                        className="px-1.5 py-0.5 rounded bg-white border border-amber-200 font-mono text-[11px]"
                      >
                        {r}
                      </span>
                    ))}
                    {result.unmatched_regos.length > 20 && (
                      <span className="text-amber-800">+{result.unmatched_regos.length - 20} more</span>
                    )}
                  </div>
                  <div className="mt-2 text-[11px]">
                    Manually attribute unmatched rows from the{' '}
                    <strong>Fuel anomalies inbox</strong>.
                  </div>
                </div>
              )}

              {(result.errors?.length ?? 0) > 0 && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-900">
                  <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] mb-1">
                    <AlertTriangle size={11} />
                    Rejected rows ({result.errors.length})
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-0.5 font-mono text-[11px]">
                    {result.errors.slice(0, 20).map((e, i) => (
                      <div key={i}>
                        Row {e.row}: {e.error}
                      </div>
                    ))}
                    {result.errors.length > 20 && (
                      <div className="text-rose-800">+{result.errors.length - 20} more</div>
                    )}
                  </div>
                </div>
              )}

          {(result.rules_suppressed?.length ?? 0) > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900"
                 data-testid="fuel-import-rules-suppressed">
              <div className="font-bold uppercase tracking-wider text-[10px] mb-1">
                Rules suppressed for this batch
              </div>
              {result.rules_suppressed.map((s, i) => (
                <div key={i}>· <strong>{s.rules?.join(', ')}</strong> — {s.reason}</div>
              ))}
            </div>
          )}
          {(result.columns_detected?.length ?? 0) > 0 && (
            <details className="text-xs text-slate-600" data-testid="fuel-import-columns-detected">
              <summary className="cursor-pointer font-semibold">Batch metadata · columns detected</summary>
              <div className="mt-1 font-mono text-[10px] bg-slate-50 rounded p-2 border border-slate-200">
                {result.columns_detected.join(' · ')}
              </div>
            </details>
          )}

              <div className="text-[11px] text-slate-500 flex items-start gap-1.5">
                <FileText size={12} className="shrink-0 mt-0.5" />
                Batch ID <span className="font-mono">{result.batch_id?.slice(0, 8)}…</span> — you can
                undo this import from Settings → Fuel batches.
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          {!result && (
            <>
              <button
                type="button"
                onClick={() => !busy && onClose?.()}
                disabled={busy}
                data-testid="fuel-import-cancel"
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!file || busy}
                data-testid="fuel-import-submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-40"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {busy ? 'Importing…' : 'Import CSV'}
              </button>
            </>
          )}
          {result && (
            <>
              <button
                type="button"
                onClick={reset}
                data-testid="fuel-import-again"
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-white"
              >
                Import another
              </button>
              <button
                type="button"
                onClick={onClose}
                data-testid="fuel-import-done"
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-slate-800"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const TONES = {
  slate:   'bg-white border-slate-200 text-slate-900',
  emerald: 'bg-white border-emerald-200 text-emerald-800',
  amber:   'bg-white border-amber-200 text-amber-800',
  rose:    'bg-white border-rose-200 text-rose-800',
};

function ResultChip({ label, value, tone = 'slate', testid }) {
  return (
    <div
      className={`rounded-lg border px-2 py-1.5 flex items-baseline justify-between ${TONES[tone]}`}
      data-testid={testid}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</span>
      <span className="text-base font-bold tabular-nums">{value ?? 0}</span>
    </div>
  );
}
