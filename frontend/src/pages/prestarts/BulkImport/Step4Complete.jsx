// v160.3.9.58.1 — Wizard Step 4: processing + result.
// v160.3.9.58.6.1 — FailedCard: auto-detect a newer live job (closes
// the "stale UI ghost" trap where the wizard would keep displaying an
// old failed job even after a fresh import was underway in the
// background) and offer a one-click "Resume this import" from within
// the failure view itself.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, XCircle, Loader2, ClipboardList, ShieldAlert, RotateCcw,
  ArrowRightCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../../lib/api';

export function Step4Complete({ job, jobId, onReset, onSwitchToJob, onResumeCreated }) {
  const state = job?.state;
  const progress = job?.progress || {};
  const isProcessing = state === 'processing' || state === 'downloading'
                       || state === 'extracting' || state === 'dryrun';

  if (isProcessing) {
    return <ProcessingCard progress={progress} state={state} />;
  }

  if (state === 'failed') {
    return (
      <FailedCard
        job={job}
        jobId={jobId}
        onReset={onReset}
        onSwitchToJob={onSwitchToJob}
        onResumeCreated={onResumeCreated}
      />
    );
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
  // v58.2 — For big backfills, nudge the operator to schedule review as
  // a separate task rather than trying to triage 10 000 rows in one sit.
  const isLargeImport = extracted > 1000;
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

      {isLargeImport && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3"
             data-testid="wizard-step4-large-hint">
          <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 leading-relaxed">
            <b>Schedule review triage as a follow-up task.</b> Working
            through {needsReview.toLocaleString()} review-queue records
            in one sit is a lot — consider batching by worker or by
            week. The Review Queue link below preserves your filters.
          </div>
        </div>
      )}

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

function FailedCard({ job, jobId, onReset, onSwitchToJob, onResumeCreated }) {
  const progress = job?.progress || {};
  const extracted = progress.extracted || 0;
  const cachedHits = progress.cached_hits || 0;
  const [newerJob, setNewerJob] = useState(null);
  const [resuming, setResuming] = useState(false);
  const [switching, setSwitching] = useState(false);

  // v58.6.1 — Detect a newer LIVE job for this org. If one exists we
  // surface the switch banner: the failed job the user is looking at
  // is likely stale (they never left Step 4 after a first failure, so
  // subsequent job kick-offs in another tab / via API never updated
  // their local wizard). Polls every 15 s so a run kicked off in
  // another tab auto-appears here.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const resp = await api.get('/pre-starts/bulk-import/last', {
          params: {
            states: 'processing,downloading,extracting,awaiting_approval',
            within_days: 1,
          },
        });
        if (cancelled) return;
        const nj = resp.data;
        // Guard against comparing a job to itself — jobId here is the
        // failed job the user is stuck on. A `null` response is
        // normal (no newer live job), just clear the banner.
        if (nj && nj.id && nj.id !== jobId) setNewerJob(nj);
        else setNewerJob(null);
      } catch {
        // Silent — a probe failure just means "no banner this tick".
      }
    };
    check();
    const t = setInterval(check, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [jobId]);

  const handleSwitch = useCallback(() => {
    if (!newerJob || switching) return;
    setSwitching(true);
    onSwitchToJob?.(newerJob.id, newerJob.state);
    toast.success('Switched to current import');
  }, [newerJob, switching, onSwitchToJob]);

  const handleResume = useCallback(async () => {
    if (resuming) return;
    const srcUrl = job?.src_url || job?.url_input;
    if (!srcUrl) {
      toast.error('Cannot resume: previous job has no source URL.');
      return;
    }
    setResuming(true);
    try {
      const initResp = await api.post('/pre-starts/bulk-import/init', {
        source: 'url',
        url: srcUrl,
        filename: job?.filename || 'bulk-import',
      });
      const { job_id: newJobId } = initResp.data;
      await api.post(`/pre-starts/bulk-import/${newJobId}/start`);
      const skip = cachedHits + extracted;
      toast.success('Resuming previous import', {
        description: `Cache will skip ${skip.toLocaleString()} already-processed PDF${skip === 1 ? '' : 's'}.`,
      });
      onResumeCreated?.(newJobId);
    } catch (e) {
      toast.error(apiError(e, 'Failed to resume import'));
    } finally {
      setResuming(false);
    }
  }, [job, resuming, cachedHits, extracted, onResumeCreated]);

  return (
    <div className="space-y-6" data-testid="wizard-step4-failed">
      {newerJob && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm flex items-start gap-3"
             data-testid="wizard-step4-newer-banner"
             data-newer-job-id={newerJob.id}>
          <ArrowRightCircle className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-amber-900">
              A newer import is already in progress
            </div>
            <div className="mt-1 text-sm text-amber-800 leading-relaxed">
              {(newerJob.progress?.extracted || 0).toLocaleString()} PDF{(newerJob.progress?.extracted || 0) === 1 ? '' : 's'} processed so far — you're looking at an older failed job.
            </div>
          </div>
          <button
            onClick={handleSwitch}
            disabled={switching}
            data-testid="wizard-step4-switch-btn"
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 text-white hover:bg-amber-700 transition text-sm disabled:opacity-60"
          >
            Switch to current import
            <ArrowRightCircle className="w-4 h-4" />
          </button>
        </div>
      )}

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
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 transition text-sm"
                data-testid="wizard-step4-retry">
          <RotateCcw className="w-4 h-4" />
          Start over
        </button>
        <button onClick={handleResume}
                disabled={resuming || !(job?.src_url || job?.url_input)}
                data-testid="wizard-step4-resume"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition text-sm disabled:opacity-60 disabled:cursor-wait">
          <RotateCcw className="w-4 h-4" />
          {resuming ? 'Resuming…' : 'Resume this import'}
        </button>
      </div>
    </div>
  );
}
