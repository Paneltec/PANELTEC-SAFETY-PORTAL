// v160.3.9.58.1 — Wizard Step 1: source URL entry.
// v160.3.9.58.6 — Adds "Resume last import" affordance above the form
// when a recent failed/awaiting-approval job exists.
import React, { useState } from 'react';
import { Link as LinkIcon, PlayCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../../lib/api';
import { inputClass } from '../../../components/capture/Ui';
import { useLastFailedJob } from './useLastFailedJob';
import { ResumeLastJobCard } from './ResumeLastJobCard';

const HELPER_TEXT = (
  <>
    Paste a link to one PDF pre-start, <b>or</b> a shared ZIP of PDFs
    (nested zips are supported). Dropbox <code>?dl=0</code> links are
    auto-corrected. Supported: Dropbox, Google Drive, SharePoint direct
    links, or any HTTPS URL.
  </>
);

export function Step1SourceUrl({ onCreated, onContinueAwaitingApproval }) {
  const [url, setUrl] = useState('');
  const [batchLabel, setBatchLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState(null);
  const { job: lastJob } = useLastFailedJob();

  const start = async (e) => {
    e?.preventDefault?.();
    if (!url.trim() || !/^https?:\/\//i.test(url.trim())) {
      setFieldError('Please paste a valid HTTPS URL.');
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      const initResp = await api.post('/pre-starts/bulk-import/init', {
        source: 'url',
        url: url.trim(),
        filename: batchLabel.trim() || 'bulk-import',
      });
      const { job_id: jobId } = initResp.data;
      // Note: batch_label + notes are captured as the job's `filename`
      // field (audit trail). A dedicated PATCH endpoint for richer
      // metadata is a Phase 2 nice-to-have.
      // Kick off the worker.
      await api.post(`/pre-starts/bulk-import/${jobId}/start`);
      toast.success('Import started', {
        description: `Job ${jobId.slice(0, 8)}… is downloading and scanning.`,
      });
      onCreated?.(jobId);
    } catch (e2) {
      const msg = apiError(e2, 'Failed to start import');
      setFieldError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={start} className="space-y-6" data-testid="wizard-step1-form">
      {lastJob && (
        <ResumeLastJobCard
          job={lastJob}
          onContinueAwaitingApproval={onContinueAwaitingApproval}
          onResumeCreated={onCreated}
        />
      )}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label htmlFor="source-url"
               className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
          Source URL
        </label>
        <div className="mt-2 relative">
          <LinkIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="source-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.dropbox.com/scl/…?dl=0"
            className={`${inputClass} pl-9`}
            autoComplete="off"
            data-testid="wizard-source-url-input"
            required
          />
        </div>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          {HELPER_TEXT}
        </p>
        {fieldError && (
          <div className="mt-3 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
               data-testid="wizard-source-url-error">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{fieldError}</span>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4 mt-6">
          <div>
            <label htmlFor="batch-label"
                   className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
              Batch label <span className="text-slate-400 normal-case">(optional)</span>
            </label>
            <input
              id="batch-label"
              value={batchLabel}
              onChange={(e) => setBatchLabel(e.target.value)}
              placeholder="e.g. A. Barbari July 2026"
              className={`${inputClass} mt-2`}
              data-testid="wizard-batch-label-input"
            />
          </div>
          <div>
            <label htmlFor="notes"
                   className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
              Notes <span className="text-slate-400 normal-case">(optional)</span>
            </label>
            <input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any context for the audit trail"
              className={`${inputClass} mt-2`}
              data-testid="wizard-notes-input"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={submitting}
            data-testid="wizard-start-btn"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlayCircle className="w-5 h-5" />
            {submitting ? 'Starting…' : 'Start import'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600 leading-relaxed">
        <b className="text-slate-800">What happens next:</b> we&rsquo;ll
        download the archive, scan the first-page images with Claude
        Vision (dry-run only — no records committed yet), and show you a
        review table before anything lands in Daily Pre-Starts. You can
        approve, drop bad rows, or start over.
      </div>
    </form>
  );
}
