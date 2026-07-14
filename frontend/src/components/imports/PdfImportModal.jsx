// v160.3.0-adjust-19 — Drag-drop PDF import modal.
//
// Opens from the sidebar "Import PDFs" button. User drops/browses one
// or more PDF files; each is uploaded to `POST /api/imports/pdf` and
// the result streams into the file list as
//   queued → uploading → done | failed | duplicate | unmatched
//
// Batch summary at the bottom + per-row "View" link that navigates to
// the target Capture tab.
import React, { useCallback, useRef, useState } from 'react';
import { Upload, CheckCircle2, XCircle, AlertCircle, Loader2, ExternalLink, X, Info, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import api, { apiError } from '../../lib/api';
// v160.3.7k — Inoculation sweep: lock body scroll while this modal is open.
import useLockBodyScroll from '../../lib/useLockBodyScroll';

const STATUS_MAP = {
  queued:     { label: 'Queued',      icon: Loader2,        cls: 'text-slate-400' },
  uploading:  { label: 'Uploading',   icon: Loader2,        cls: 'text-blue-500 animate-spin' },
  done:       { label: 'Imported',    icon: CheckCircle2,   cls: 'text-emerald-500' },
  duplicate:  { label: 'Already imported', icon: AlertCircle, cls: 'text-amber-500' },
  unmatched:  { label: 'Unmatched template', icon: AlertCircle, cls: 'text-amber-600' },
  failed:     { label: 'Failed',      icon: XCircle,        cls: 'text-rose-500' },
};

export default function PdfImportModal({ open, onClose, onImported }) {
  useLockBodyScroll(open);
  const [files, setFiles] = useState([]); // {id, name, size, status, resp, error}
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const addFiles = useCallback((fileList) => {
    const arr = Array.from(fileList).filter((f) => {
      if (!f.name.toLowerCase().endsWith('.pdf')) {
        toast.error(`Skipped: ${f.name} — not a PDF`);
        return false;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`Skipped: ${f.name} — over 10 MB`);
        return false;
      }
      return true;
    }).map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      file: f,
      name: f.name,
      size: f.size,
      status: 'queued',
      resp: null,
      error: null,
    }));
    if (arr.length === 0) return;
    setFiles((prev) => [...prev, ...arr]);
    processQueue(arr);
  }, []);

  async function processQueue(newItems) {
    setBusy(true);
    for (const item of newItems) {
      // Mark uploading.
      setFiles((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'uploading' } : x));
      const fd = new FormData();
      fd.append('file', item.file);
      try {
        const r = await api.post('/imports/pdf', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        setFiles((prev) => prev.map((x) => x.id === item.id
          ? { ...x, status: 'done', resp: r.data } : x));
        onImported && onImported(r.data);
      } catch (e) {
        const status = e?.response?.status;
        const detail = e?.response?.data?.detail;
        if (status === 409) {
          setFiles((prev) => prev.map((x) => x.id === item.id
            ? { ...x, status: 'duplicate', resp: typeof detail === 'object' ? detail : null } : x));
        } else if (status === 422) {
          setFiles((prev) => prev.map((x) => x.id === item.id
            ? { ...x, status: 'unmatched', error: typeof detail === 'object' ? detail.message : String(detail || 'Unmatched') } : x));
        } else {
          setFiles((prev) => prev.map((x) => x.id === item.id
            ? { ...x, status: 'failed', error: apiError(e) } : x));
        }
      }
    }
    setBusy(false);
  }

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };
  const onDragOver = (e) => { e.preventDefault(); setDrag(true); };
  const onDragLeave = () => setDrag(false);

  const counts = {
    total: files.length,
    done: files.filter((f) => f.status === 'done').length,
    dup: files.filter((f) => f.status === 'duplicate').length,
    unmatched: files.filter((f) => f.status === 'unmatched').length,
    failed: files.filter((f) => f.status === 'failed').length,
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
         onClick={(e) => e.target === e.currentTarget && onClose()}
         data-testid="pdf-import-modal">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">Import</div>
            <h2 className="font-display text-lg font-bold text-slate-900">Import legacy PDFs</h2>
          </div>
          <button onClick={onClose} className="p-2 -m-1 rounded-lg hover:bg-slate-100" data-testid="pdf-import-close">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* v160.3.7b — Purpose + collapsible how-it-works / when-to-use */}
          <div
            data-testid="pdf-import-intro"
            className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
            <div className="flex gap-2.5">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-blue-100 text-blue-700 shrink-0">
                <Info size={14} />
              </span>
              <p className="text-xs text-slate-700 leading-relaxed">
                Bulk-imports historical filled-in PDF forms (pre-starts, SSRAs,
                hazard reports, inspections, incidents, etc.) that were captured
                on paper or in older systems, and turns them back into structured
                Paneltec form submissions. Use this when migrating archived
                compliance records into your compliance archive OR when catching
                up after a period of offline paper-based capture.
              </p>
            </div>

            <details className="group rounded-lg border border-slate-200 bg-white" data-testid="pdf-import-howitworks">
              <summary className="list-none cursor-pointer select-none flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-700 hover:bg-slate-50">
                <ChevronRight size={12} className="transition-transform group-open:rotate-90 text-slate-500" />
                How it works
              </summary>
              <ol className="px-4 pb-3 pt-1 text-xs text-slate-600 leading-relaxed list-decimal ml-4 space-y-1">
                <li><strong>Drop or browse</strong> — select one or more legacy PDF files (10&nbsp;MB per file max, multi-file OK).</li>
                <li><strong>Automatic classification</strong> — each PDF is matched to its Paneltec form template by looking at document headers and known field patterns.</li>
                <li><strong>Deep-parser extraction</strong> — checkbox / radio strings, dates, worker names, site names, plant IDs and form-specific fields are pulled out and mapped to the target template&apos;s field schema (currently up to ~90 % coverage on the standard Paneltec templates).</li>
                <li><strong>Filed into the archive</strong> — each PDF becomes a <code className="px-1 py-0.5 rounded bg-slate-100 text-[10px]">form_submissions</code> row viewable under the Capture tab for that form type, alongside your day-to-day mobile submissions. The original PDF is preserved as an attachment.</li>
                <li><strong>Review anything unmatched</strong> — anything the parser couldn&apos;t confidently classify lands in the &ldquo;Unmatched captures&rdquo; triage list for admin review.</li>
              </ol>
            </details>

            <details className="group rounded-lg border border-slate-200 bg-white" data-testid="pdf-import-whentouse">
              <summary className="list-none cursor-pointer select-none flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-700 hover:bg-slate-50">
                <ChevronRight size={12} className="transition-transform group-open:rotate-90 text-slate-500" />
                When to use
              </summary>
              <ul className="px-4 pb-3 pt-1 text-xs text-slate-600 leading-relaxed list-disc ml-4 space-y-1">
                <li>Migrating an archive of paper-filled forms into Paneltec for the first time</li>
                <li>Catching up after a Simpro sync gap</li>
                <li>Auditor prep — bringing older submissions into the digital record before an audit</li>
              </ul>
            </details>

            <div
              data-testid="pdf-import-tips"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 leading-snug">
              <div className="font-semibold mb-0.5">Tips</div>
              <ul className="list-disc ml-4 space-y-0.5">
                <li><strong>File names help</strong> — a PDF named <code className="px-1 py-0.5 rounded bg-white/70 text-[10px]">2024-08-12 Pre-Start CVT.pdf</code> gives the classifier a head start.</li>
                <li><strong>Safe to re-run</strong> — the parser dedupes by file hash, so re-importing the same PDFs won&apos;t duplicate submissions.</li>
                <li><strong>Not for renewing certs</strong> — for individual certification / insurance renewals, use the <em>Renewal Links</em> feature instead.</li>
              </ul>
            </div>
          </div>

          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${drag ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}
            data-testid="pdf-import-dropzone"
          >
            <Upload size={28} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm text-slate-700 font-medium">Drop PDFs here to import</p>
            <p className="text-xs text-slate-500 mt-1">Multi-file drag or click to browse · max 10 MB each</p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-blue-500 text-sm"
              data-testid="pdf-import-browse"
            >
              Browse files
            </button>
            <input
              ref={inputRef} type="file" accept=".pdf,application/pdf" multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
              data-testid="pdf-import-input"
            />
          </div>

          {files.length > 0 && (
            <div className="space-y-1.5">
              {files.map((f) => {
                const s = STATUS_MAP[f.status] || STATUS_MAP.queued;
                const Ico = s.icon;
                const target = f.resp?.target_route;
                return (
                  <div key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Ico size={14} className={s.cls} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-800 truncate" title={f.name}>{f.name}</div>
                        <div className="text-slate-500 truncate">
                          {s.label}
                          {f.resp?.template_name && ` · ${f.resp.template_name}`}
                          {f.resp?.fields_extracted != null && ` · ${f.resp.fields_extracted}/${f.resp.fields_total} fields`}
                          {f.error && ` · ${f.error}`}
                        </div>
                      </div>
                    </div>
                    {target && (
                      <Link to={target} onClick={onClose} className="inline-flex items-center gap-1 text-blue-600 hover:underline px-2">
                        View <ExternalLink size={11} />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {counts.total > 0 && (
            <div className="text-xs text-slate-600 border-t border-slate-100 pt-3">
              <b>{counts.done}</b> imported · <b>{counts.dup}</b> duplicates
              {counts.unmatched > 0 && <> · <b>{counts.unmatched}</b> unmatched</>}
              {counts.failed > 0 && <> · <b className="text-rose-600">{counts.failed}</b> failed</>}
              {' '}of <b>{counts.total}</b>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {busy ? 'Uploading…' : 'Idle'}
          </div>
          <div className="flex items-center gap-2">
            {files.length > 0 && !busy && (
              <button
                onClick={() => setFiles([])}
                className="text-sm px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-100"
                data-testid="pdf-import-reset"
              >
                Import more
              </button>
            )}
            <button
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
              data-testid="pdf-import-done"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
