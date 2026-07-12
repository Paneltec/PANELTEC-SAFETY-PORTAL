import React, { useCallback, useState } from 'react';
import { Upload, Loader2, FileText, Image as ImageIcon, ShieldAlert, Check, X as XIcon, AlertCircle } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { toast } from 'sonner';

// v160.3.2 — Simpro ZIP Upload modal (worker-scoped).
// Two-step flow:
//   1. Drop ZIP → POST ?dry_run=1 → preview table
//   2. Confirm  → POST ?dry_run=0 → commit + toast
// Also supports individual file drag-drop (ZIP fallback path).
export function SimproZipUploadModal({ worker, onClose, onDone }) {
  const [phase, setPhase] = useState('idle'); // idle | planning | preview | running | done | error
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [rawFile, setRawFile] = useState(null);

  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    await handleUpload(files[0]);
  }, []);

  const handleUpload = async (file) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Only .zip files are supported');
      return;
    }
    setRawFile(file);
    setPhase('planning');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(
        `/workers/${worker.id}/simpro-zip-import?dry_run=1`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setPreview(data);
      setPhase('preview');
    } catch (e) {
      setError(apiError(e));
      setPhase('error');
    }
  };

  const commit = async () => {
    if (!rawFile) return;
    setPhase('running');
    try {
      const fd = new FormData();
      fd.append('file', rawFile);
      const { data } = await api.post(
        `/workers/${worker.id}/simpro-zip-import?dry_run=0`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setResult(data);
      setPhase('done');
      const c = data.result?.counts || {};
      toast.success(
        `ZIP applied — ${c.attached || 0} attached · ${c.created || 0} new · ${c.hr_docs || 0} HR docs`,
      );
      onDone?.();
    } catch (e) {
      setError(apiError(e));
      setPhase('error');
      toast.error('ZIP import failed');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={phase === 'running' || phase === 'planning' ? undefined : onClose}
      data-testid="simpro-zip-modal"
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-6 pt-6 pb-3 border-b border-slate-200">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <Upload size={18} />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-semibold text-slate-900">
              Upload Simpro ZIP — {worker.first_name} {worker.last_name}
            </h3>
            <p className="mt-0.5 text-sm text-slate-600">
              Drop the ZIP from Simpro's "Export Employee Documents" action.
              We'll route each file to the matching cert row.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            data-testid="simpro-zip-close-btn"
          >
            <XIcon size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {(phase === 'idle' || phase === 'error') && (
            <div
              className="rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center bg-slate-50 hover:bg-emerald-50 transition-colors"
              onDrop={onDrop}
              onDragOver={(e) => e.preventDefault()}
              data-testid="simpro-zip-drop"
            >
              <Upload size={32} className="mx-auto text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-700">Drag a ZIP file here</p>
              <p className="text-xs text-slate-500 mt-1">Or click to browse</p>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                className="mt-4 text-xs"
                data-testid="simpro-zip-file-input"
              />
              {phase === 'error' && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 text-left">
                  <div className="flex items-center gap-1.5 font-semibold mb-1">
                    <AlertCircle size={13} /> Import failed
                  </div>
                  {error}
                </div>
              )}
            </div>
          )}

          {phase === 'planning' && (
            <div className="py-12 flex items-center justify-center text-slate-500 text-sm gap-2">
              <Loader2 size={16} className="animate-spin" /> Parsing ZIP + matching filenames…
            </div>
          )}

          {phase === 'preview' && preview && (
            <div data-testid="simpro-zip-preview" className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <StatChip label="Attach to existing" value={preview.counts.attach} color="emerald" />
                <StatChip label="Create new" value={preview.counts.create} color="blue" />
                <StatChip label="HR (private)" value={preview.counts.hr_folder} color="amber" />
                <StatChip label="Unmatched" value={preview.counts.unmatched} color="rose" />
              </div>
              {preview.photo && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 flex items-center gap-2">
                  <ImageIcon size={13} /> Photo detected — <span className="font-mono">{preview.photo.filename}</span> will be set as this worker's profile picture.
                </div>
              )}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2">File</th>
                      <th className="text-left px-3 py-2">Folder</th>
                      <th className="text-left px-3 py-2">Action</th>
                      <th className="text-left px-3 py-2">Match / attach</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.files.map((f, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 font-medium text-slate-900 truncate max-w-[180px]" title={f.filename}>
                          <FileText size={11} className="inline mr-1 text-slate-400" />
                          {f.filename}
                        </td>
                        <td className="px-3 py-1.5 uppercase text-[10px] tracking-wider text-slate-600">
                          {f.folder || '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          <ActionPill action={f.action} />
                        </td>
                        <td className="px-3 py-1.5 text-slate-700">
                          {f.action === 'attach' && (
                            <span className="text-emerald-700">→ {f.attach_to_name || f.matched_slug}</span>
                          )}
                          {f.action === 'create' && (
                            <span className="text-blue-700">+ new · <span className="font-mono">{f.matched_slug}</span></span>
                          )}
                          {f.action === 'hr_folder' && (
                            <span className="text-amber-800 inline-flex items-center gap-1">
                              <ShieldAlert size={11} /> HR-only
                            </span>
                          )}
                          {f.action === 'unmatched' && (
                            <span className="text-rose-700">score {f.match_score || '0'}</span>
                          )}
                          {f.action === 'skip_unsupported' && (
                            <span className="text-slate-400">skip</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">
                Unmatched files land in a triage list on the worker profile for manual reclassification.
                No existing certification rows are overwritten.
              </p>
            </div>
          )}

          {phase === 'running' && (
            <div className="py-12 flex items-center justify-center text-slate-500 text-sm gap-2">
              <Loader2 size={16} className="animate-spin" /> Uploading files to storage…
            </div>
          )}

          {phase === 'done' && result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm" data-testid="simpro-zip-done">
              <div className="font-semibold text-emerald-900 flex items-center gap-1.5 mb-2">
                <Check size={15} /> ZIP import complete
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-xs text-emerald-800">
                <div>Attached to existing certs:</div><div className="text-right font-semibold">{result.result?.counts?.attached ?? 0}</div>
                <div>New certifications created:</div><div className="text-right font-semibold">{result.result?.counts?.created ?? 0}</div>
                <div>HR documents (private):</div><div className="text-right font-semibold">{result.result?.counts?.hr_docs ?? 0}</div>
                <div>Photo:</div><div className="text-right font-semibold">{result.result?.counts?.photo ?? 0}</div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
          <button
            onClick={onClose}
            disabled={phase === 'running' || phase === 'planning'}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50"
            data-testid="simpro-zip-cancel-btn"
          >
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          {phase === 'preview' && (
            <button
              onClick={commit}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 shadow-sm"
              data-testid="simpro-zip-commit-btn"
            >
              <Upload size={13} /> Apply {preview?.counts?.total_files || 0} files
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatChip({ label, value, color }) {
  const bg = {
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    blue: 'bg-blue-50 text-blue-800 border-blue-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    rose: 'bg-rose-50 text-rose-800 border-rose-200',
  }[color] || 'bg-slate-50 text-slate-800 border-slate-200';
  return (
    <div className={`rounded-lg border px-3 py-2 ${bg}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</div>
      <div className="mt-0.5 text-lg font-bold">{value ?? 0}</div>
    </div>
  );
}

function ActionPill({ action }) {
  const styles = {
    attach: 'bg-emerald-100 text-emerald-800',
    create: 'bg-blue-100 text-blue-800',
    hr_folder: 'bg-amber-100 text-amber-800',
    unmatched: 'bg-rose-100 text-rose-800',
    skip_unsupported: 'bg-slate-100 text-slate-500',
  };
  const label = { attach: 'ATTACH', create: 'CREATE', hr_folder: 'HR', unmatched: 'UNMATCHED', skip_unsupported: 'SKIP' };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider ${styles[action] || 'bg-slate-100 text-slate-500'}`}>
      {label[action] || action}
    </span>
  );
}
