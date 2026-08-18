// v160.3.9.58.6 — Resume-last-failed-job affordance for the Bulk Import
// Wizard's Step 1. Rendered above the URL form when a recent job
// (< 30d) is in `failed` or `awaiting_approval`. Two click behaviours:
//   · state=awaiting_approval → deep-link the caller into Step 3 for
//     that SAME job (no new download / no new Claude calls).
//   · state=failed             → prefill Step 1 fields with the previous
//     job's URL + batch label, then auto-advance to Step 2 via a fresh
//     init+start. Cache hits skip already-processed PDFs.

import React, { useState } from 'react';
import { RotateCcw, ChevronRight, Clock, AlertOctagon } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../../lib/api';

function relativeTime(iso) {
  if (!iso) return 'recently';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'recently';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function buildSubtitle(job) {
  const p = job.progress || {};
  const extracted = Number(p.extracted || 0);
  const total = Number(p.total || job.total_pdfs_discovered || 0);
  const when = relativeTime(job.updated_at);
  if (job.state === 'awaiting_approval') {
    const cached = Number(p.cached_hits || 0);
    return `Awaiting your review · ${extracted || cached} PDF${extracted === 1 ? '' : 's'} scanned · ${when}`;
  }
  // failed
  if (extracted === 0) {
    return `Failed at extract stage · will restart from scratch · ${when}`;
  }
  if (total > 0) {
    return `Failed at ${extracted.toLocaleString()}/${total.toLocaleString()} · ${when}`;
  }
  return `Failed after ${extracted.toLocaleString()} PDF${extracted === 1 ? '' : 's'} · ${when}`;
}

export function ResumeLastJobCard({ job, onContinueAwaitingApproval, onResumeCreated }) {
  const [busy, setBusy] = useState(false);
  if (!job) return null;

  const isAwaiting = job.state === 'awaiting_approval';
  const isFailed = job.state === 'failed';
  const extracted = Number(job.progress?.extracted || 0);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isAwaiting) {
        // Deep-link the caller into Step 3 for the existing job.
        toast.success('Continuing existing import', {
          description: `${extracted.toLocaleString()} PDF${extracted === 1 ? '' : 's'} ready to review.`,
        });
        onContinueAwaitingApproval?.(job.id);
        return;
      }
      // Failed → create a fresh init+start with the previous URL.
      const srcUrl = job.src_url || job.url_input;
      if (!srcUrl) {
        toast.error('Cannot resume: previous job has no source URL.');
        return;
      }
      const initResp = await api.post('/pre-starts/bulk-import/init', {
        source: 'url',
        url: srcUrl,
        filename: job.batch_label || job.filename || 'bulk-import',
      });
      const { job_id: newJobId } = initResp.data;
      await api.post(`/pre-starts/bulk-import/${newJobId}/start`);
      const skip = Number(job.progress?.cached_hits || 0) + extracted;
      toast.success('Resuming previous import', {
        description: `Cache will skip ${skip.toLocaleString()} already-processed PDF${skip === 1 ? '' : 's'}.`,
      });
      onResumeCreated?.(newJobId);
    } catch (e) {
      toast.error(apiError(e, 'Failed to resume import'));
    } finally {
      setBusy(false);
    }
  };

  const Icon = isAwaiting ? Clock : AlertOctagon;
  const tone = isAwaiting
    ? 'border-amber-200 bg-amber-50/60 hover:bg-amber-50'
    : 'border-slate-200 bg-slate-50 hover:bg-slate-100';
  const iconTone = isAwaiting ? 'text-amber-700' : 'text-slate-600';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      data-testid="wizard-resume-last-btn"
      data-state={job.state}
      className={`
        w-full flex items-center gap-3 text-left px-4 py-3 rounded-2xl border
        transition disabled:opacity-60 disabled:cursor-wait ${tone}
      `}
    >
      <span className={`shrink-0 rounded-full p-2 bg-white border border-slate-200 ${iconTone}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-slate-900">
          {isAwaiting ? 'Continue awaiting-approval import' : 'Resume last import'}
        </span>
        <span className="block text-xs text-slate-600 truncate mt-0.5"
              data-testid="wizard-resume-last-subtitle">
          {buildSubtitle(job)}
        </span>
      </span>
      <span className="shrink-0 inline-flex items-center gap-1 text-xs text-slate-500">
        {isFailed && <RotateCcw className="w-3.5 h-3.5" />}
        <ChevronRight className="w-4 h-4" />
      </span>
    </button>
  );
}
