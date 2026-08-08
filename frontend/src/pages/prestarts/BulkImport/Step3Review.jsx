// v160.3.9.58.1 — Wizard Step 3: review & approve.
//
// Data comes from /api/pre-starts/bulk-import/{id}/report which returns
//   { job, dryrun_results: [row, row, ...] }
// where each row has:
//   status, filename, extracted (worker_name, site, date, …),
//   template_name, worker_match {id, confidence, needs_review}, cached,
//   mapped_count, template_field_count, reason, error_step (on failure)
//
// The wizard summarises + paginates + offers an "attach nothing" toggle
// so the user can hit Approve even when every row is `needs_review`.

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, ShieldAlert, ChevronLeft, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../../lib/api';

const PAGE_SIZE = 25;

export function Step3Review({ jobId, job, approving, setApproving, onApproved, onRetry }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  // v58.2 — default OFF ("import everything"). Failed-vision rows land
  // in the review queue with the raw PDF attached (via GridFS) so a
  // reviewer can triage them later. Operators can flip this ON to
  // skip failed rows entirely (legacy pre-v58.2 behaviour).
  const [skipFailedVision, setSkipFailedVision] = useState(false);
  const [attachNothing, setAttachNothing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/pre-starts/bulk-import/${jobId}/report`).then((r) => {
      if (cancelled) return;
      setRows(r.data?.dryrun_results || []);
    }).catch((e) => {
      toast.error(apiError(e, 'Failed to load review data'));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [jobId]);

  const counts = useMemo(() => summarise(rows || []), [rows]);
  const totalPages = Math.max(1, Math.ceil((rows?.length || 0) / PAGE_SIZE));
  const pageRows = rows ? rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : [];

  const doApprove = async () => {
    setApproving(true);
    try {
      await api.post(`/pre-starts/bulk-import/${jobId}/approve`, {
        approve: true,
        // v58.2 — when the operator LEAVES the skip toggle OFF (default),
        // we want failed-vision rows to also land in `form_submissions`
        // with `needs_review=True`. Backend defaults `include_failed_rows`
        // to True but we send it explicitly so behaviour is deterministic.
        include_failed_rows: !skipFailedVision,
      });
      toast.success('Import approved — committing records now.');
      onApproved?.();
    } catch (e) {
      toast.error(apiError(e, 'Approve failed'));
    } finally {
      setApproving(false);
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center"
           data-testid="wizard-step3-loading">
        <Loader2 className="w-6 h-6 mx-auto text-slate-400 animate-spin" />
        <div className="mt-3 text-sm text-slate-500">Loading review data…</div>
      </div>
    );
  }

  const willImport = countWillImport(rows || [], skipFailedVision);
  const needsReview = counts.workerNeedsReview + counts.workerFailed;

  return (
    <div className="space-y-6" data-testid="wizard-step3-review">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total PDFs" value={counts.total} tone="slate"
                     testid="summary-total" />
        <SummaryCard label="Worker matched" value={counts.workerMatched}
                     tone={counts.workerMatched > 0 ? 'green' : 'slate'}
                     testid="summary-worker-matched" />
        <SummaryCard label="Need worker review" value={needsReview}
                     tone={needsReview > 0 ? 'amber' : 'slate'}
                     testid="summary-worker-review" />
        <SummaryCard label="Vision failed" value={counts.visionFailed}
                     tone={counts.visionFailed > 0 ? 'red' : 'slate'}
                     testid="summary-vision-failed" />
      </div>

      {/* Callout — review-queue implications */}
      {needsReview > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3"
             data-testid="wizard-review-callout">
          <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 leading-relaxed">
            <b>{needsReview} record{needsReview !== 1 ? 's' : ''} will land in the Review Queue</b> without
            a linked worker. You can attach workers to those records
            after import via <b>Pre-Starts → Review</b>. This is expected
            when the extracted worker name doesn&rsquo;t match a
            registered worker.
          </div>
        </div>
      )}

      {/* Bulk-action controls */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <label className="flex items-start gap-3 text-sm text-slate-800 cursor-pointer">
          <input type="checkbox"
                 checked={skipFailedVision}
                 onChange={(e) => setSkipFailedVision(e.target.checked)}
                 data-testid="wizard-skip-failed-checkbox"
                 className="w-4 h-4 rounded border-slate-300 mt-0.5" />
          <span className="flex-1">
            <span>Skip <b>{counts.visionFailed}</b> vision-failed rows (won&rsquo;t be imported)</span>
            <span className="block text-xs text-slate-500 mt-1 font-normal leading-relaxed"
                  data-testid="wizard-skip-failed-subtext">
              By default, <b>all rows import</b> — including those where AI
              extraction failed. Failed rows land in the Review Queue with
              the raw PDF attached so a reviewer can open them. Toggle ON
              to skip them entirely.
            </span>
          </span>
        </label>
        <label className="flex items-center gap-3 text-sm text-slate-800 cursor-pointer">
          <input type="checkbox"
                 checked={attachNothing}
                 onChange={(e) => setAttachNothing(e.target.checked)}
                 data-testid="wizard-attach-nothing-checkbox"
                 className="w-4 h-4 rounded border-slate-300" />
          <span>Import all as review-queue-only — don&rsquo;t auto-attach any workers</span>
        </label>
        <div className="text-xs text-slate-500 pt-1 border-t border-slate-100">
          Vision extraction ran during Step 2 dry-run — approving here is
          <b className="text-slate-700"> free</b> (no additional AI calls).
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm text-slate-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"
                    data-testid="wizard-page-prev">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-slate-600">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"
                    data-testid="wizard-page-next">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="wizard-review-table">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Filename</th>
                <th className="text-left px-4 py-2.5">Template</th>
                <th className="text-left px-4 py-2.5">Worker (extracted)</th>
                <th className="text-left px-4 py-2.5">Match</th>
                <th className="text-right px-4 py-2.5">Fields</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => <ReviewRow key={row.filename} row={row} />)}
            </tbody>
          </table>
        </div>
      </div>

      {/* Approve bar */}
      <div className="sticky bottom-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg flex items-center justify-between gap-4"
           data-testid="wizard-approve-bar">
        <div className="text-sm">
          <div className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold">Ready to import</div>
          <div className="text-slate-900 font-semibold">
            {willImport} record{willImport !== 1 ? 's' : ''}
            <span className="text-slate-500 font-normal">
              {' · '}{needsReview} will need review
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRetry}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 transition text-sm"
                  data-testid="wizard-cancel-btn">
            <RotateCcw className="w-4 h-4" />
            Start over
          </button>
          <button onClick={() => setConfirming(true)}
                  disabled={approving || willImport === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-600 text-white font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  data-testid="wizard-approve-btn">
            {approving && <Loader2 className="w-4 h-4 animate-spin" />}
            Approve &amp; import
          </button>
        </div>
      </div>

      {/* Confirm modal */}
      {confirming && (
        <ConfirmDialog
          willImport={willImport}
          needsReview={needsReview}
          onCancel={() => setConfirming(false)}
          onConfirm={doApprove}
          working={approving}
        />
      )}
    </div>
  );
}

function ReviewRow({ row }) {
  const statusInfo = statusFor(row);
  const extracted = row.extracted || {};
  const wm = row.worker_match || {};
  const wmConf = typeof wm.confidence === 'number' ? Math.round(wm.confidence * 100) : null;
  const filename = (row.filename || '').split('::').pop().split('/').pop();
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50"
        data-testid="wizard-row"
        data-status={row.status}>
      <td className="px-4 py-3">
        <StatusPill info={statusInfo} />
      </td>
      <td className="px-4 py-3 max-w-[260px] truncate font-mono text-xs text-slate-700"
          title={row.filename}>
        {filename}
      </td>
      <td className="px-4 py-3 text-slate-700">{row.template_name || '—'}</td>
      <td className="px-4 py-3 text-slate-700">{extracted.worker_name || '—'}</td>
      <td className="px-4 py-3">
        {wm.id ? (
          <span className="text-emerald-700 text-xs font-medium">✓ {wmConf}%</span>
        ) : row.status === 'ok' ? (
          <span className="text-amber-700 text-xs font-medium">needs review</span>
        ) : (
          <span className="text-slate-400 text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right text-xs text-slate-500 font-mono">
        {row.mapped_count ?? 0}/{row.template_field_count ?? 0}
      </td>
    </tr>
  );
}

function statusFor(row) {
  if (row.status === 'failed') {
    return { tone: 'red', Icon: XCircle, label: row.error_step || 'failed' };
  }
  const wm = row.worker_match || {};
  if (wm.id) return { tone: 'green', Icon: CheckCircle2, label: 'ready' };
  return { tone: 'amber', Icon: AlertTriangle, label: 'review' };
}

function StatusPill({ info }) {
  const Icon = info.Icon;
  const tone = {
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red:   'bg-red-100 text-red-800',
  }[info.tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      <Icon className="w-3 h-3" />
      {info.label}
    </span>
  );
}

function SummaryCard({ label, value, tone, testid }) {
  const toneCls = {
    slate: 'border-slate-200 bg-white text-slate-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red:   'border-red-200 bg-red-50 text-red-900',
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${toneCls}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</div>
      <div className="text-3xl font-bold mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function summarise(rows) {
  const total = rows.length;
  let workerMatched = 0, workerNeedsReview = 0, workerFailed = 0, visionFailed = 0;
  for (const r of rows) {
    if (r.status !== 'ok') {
      visionFailed++;
      workerFailed++;
      continue;
    }
    const wm = r.worker_match || {};
    if (wm.id) workerMatched++;
    else workerNeedsReview++;
  }
  return { total, workerMatched, workerNeedsReview, workerFailed, visionFailed };
}

function countWillImport(rows, skipFailedVision) {
  if (skipFailedVision) return rows.filter((r) => r.status === 'ok').length;
  return rows.length;
}

function ConfirmDialog({ willImport, needsReview, onCancel, onConfirm, working }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 grid place-items-center p-4"
         data-testid="wizard-confirm-modal">
      <div className="max-w-lg w-full rounded-2xl bg-white shadow-xl border border-slate-200 p-6">
        <div className="text-lg font-semibold text-slate-900">Confirm import</div>
        <div className="mt-3 text-sm text-slate-700 leading-relaxed">
          You&rsquo;re about to import <b>{willImport}</b> pre-start
          record{willImport !== 1 ? 's' : ''} into Daily Pre-Starts.
          {' '}<b>{needsReview}</b> will land in the review queue
          without a linked worker. This action cannot be undone.
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onCancel}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                  data-testid="wizard-confirm-cancel">
            Cancel
          </button>
          <button onClick={onConfirm}
                  disabled={working}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-orange-600 text-white font-semibold hover:bg-orange-700 disabled:opacity-50"
                  data-testid="wizard-confirm-approve">
            {working && <Loader2 className="w-4 h-4 animate-spin" />}
            Yes, import
          </button>
        </div>
      </div>
    </div>
  );
}
