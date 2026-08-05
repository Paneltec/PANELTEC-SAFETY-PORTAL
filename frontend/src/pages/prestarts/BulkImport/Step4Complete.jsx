// v160.3.9.58.1 — Wizard Step 4: processing + result.
import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, ClipboardList, ShieldAlert, RotateCcw } from 'lucide-react';

export function Step4Complete({ job, jobId, onReset }) {
  const state = job?.state;
  const progress = job?.progress || {};
  const isProcessing = state === 'processing' || state === 'downloading'
                       || state === 'extracting' || state === 'dryrun';

  if (isProcessing) {
    return <ProcessingCard progress={progress} state={state} />;
  }

  if (state === 'failed') {
    return <FailedCard job={job} onReset={onReset} />;
  }

  // complete
  return <CompleteCard job={job} jobId={jobId} onReset={onReset} />;
}

function ProcessingCard({ progress, state }) {
  const extracted = progress.extracted || 0;
  const total = progress.total || 0;
  const failed = progress.failed || 0;
  const pct = total > 0 ? Math.min(100, (extracted / total) * 100) : 0;
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-8 shadow-sm"
         data-testid="wizard-step4-processing">
      <div className="flex items-center gap-3">
        <Loader2 className="w-6 h-6 text-blue-700 animate-spin" />
        <div className="text-lg font-semibold text-blue-900">
          {state === 'processing' ? 'Committing records…' : `Preparing (${state})…`}
        </div>
      </div>
      <div className="mt-4">
        <div className="h-2 rounded-full bg-white/60 overflow-hidden">
          <div className="h-full bg-blue-600" style={{ width: `${pct.toFixed(1)}%` }}
               data-testid="wizard-step4-progress-bar" />
        </div>
        <div className="mt-2 text-sm text-blue-900">
          Committed <b>{extracted}</b> / {total}
          {failed > 0 && <> · <span className="text-red-700">{failed} failed</span></>}
        </div>
      </div>
    </div>
  );
}

function CompleteCard({ job, jobId, onReset }) {
  const progress = job?.progress || {};
  const extracted = progress.extracted || 0;
  const needsReview = (job?.progress?.matched != null)
    ? Math.max(extracted - (progress.matched || 0), 0)
    : 0;
  const failed = progress.failed || 0;
  return (
    <div className="space-y-6" data-testid="wizard-step4-complete">
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-7 h-7 text-emerald-700 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xl font-semibold text-emerald-900">Import complete</div>
            <div className="mt-1 text-sm text-emerald-800">
              <b>{extracted}</b> record{extracted !== 1 ? 's' : ''} committed to Daily Pre-Starts.
              {needsReview > 0 && <> {needsReview} landed in the review queue for worker attach.</>}
              {failed > 0 && <> {failed} row{failed !== 1 ? 's were' : ' was'} skipped.</>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Link
          to={`/app/pre-starts?bulk_import_id=${encodeURIComponent(jobId)}`}
          className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition group"
          data-testid="wizard-step4-view-batch"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 grid place-items-center shrink-0">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-slate-900 group-hover:text-blue-700">View imported batch</div>
              <div className="text-sm text-slate-500 mt-1">Filtered list of records from this job.</div>
            </div>
          </div>
        </Link>
        {needsReview > 0 && (
          <Link
            to={`/app/pre-starts?needs_review=1&bulk_import_id=${encodeURIComponent(jobId)}`}
            className="rounded-2xl border border-amber-200 bg-white p-5 hover:border-amber-300 hover:shadow-sm transition group"
            data-testid="wizard-step4-view-review"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 grid place-items-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-slate-900 group-hover:text-amber-700">Review unmatched ({needsReview})</div>
                <div className="text-sm text-slate-500 mt-1">Attach workers to imported rows.</div>
              </div>
            </div>
          </Link>
        )}
      </div>

      <div className="flex items-center justify-end">
        <button onClick={onReset}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 transition text-sm"
                data-testid="wizard-step4-new-import">
          <RotateCcw className="w-4 h-4" />
          Start a new import
        </button>
      </div>
    </div>
  );
}

function FailedCard({ job, onReset }) {
  const progress = job?.progress || {};
  const extracted = progress.extracted || 0;
  return (
    <div className="space-y-6" data-testid="wizard-step4-failed">
      <div className="rounded-2xl border border-red-300 bg-red-50 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <XCircle className="w-7 h-7 text-red-700 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xl font-semibold text-red-900">
              Import failed at stage: {job?.error_step || 'unknown'}
            </div>
            <div className="mt-1 text-sm text-red-800 leading-relaxed break-words">
              {job?.error || 'Unknown error — check backend logs.'}
            </div>
            <div className="mt-3 text-sm text-red-800">
              {extracted > 0
                ? <>{extracted} record{extracted !== 1 ? 's' : ''} landed before the failure.</>
                : 'No records were committed.'}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onReset}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition text-sm"
                data-testid="wizard-step4-retry">
          <RotateCcw className="w-4 h-4" />
          Start over
        </button>
      </div>
    </div>
  );
}
