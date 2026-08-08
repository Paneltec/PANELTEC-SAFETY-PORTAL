// v160.3.9.58.1 — Wizard Step 2: live download & dry-run progress.
import React, { useMemo } from 'react';
import { Download, Package, Sparkles, CheckCircle2, XCircle, RotateCcw, Loader2 } from 'lucide-react';

const STAGES = [
  { key: 'download', label: 'Download', icon: Download, states: ['downloading'] },
  { key: 'extract',  label: 'Extract archive', icon: Package, states: ['extracting'] },
  { key: 'vision',   label: 'AI scan', icon: Sparkles, states: ['dryrun', 'processing'] },
  { key: 'ready',    label: 'Ready to review', icon: CheckCircle2, states: ['awaiting_approval', 'complete'] },
];

function stageIndexForState(state) {
  if (!state) return -1;
  if (['init', 'downloading'].includes(state)) return 0;
  if (state === 'extracting') return 1;
  if (['dryrun', 'processing'].includes(state)) return 2;
  if (['awaiting_approval', 'complete'].includes(state)) return 3;
  return -1;
}

export function Step2Progress({ job, error, onRetry }) {
  const state = job?.state || 'init';
  const isFailed = state === 'failed';
  const activeStage = stageIndexForState(state);

  const progress = job?.progress || {};
  const extracted = progress.extracted || 0;
  const total = progress.total || job?.total_pdfs_discovered || null;
  const cachedHits = progress.cached_hits || 0;
  const failed = progress.failed || 0;
  const estimatedCost = Number(progress.estimated_cost_usd || 0);
  // v58.2 — Show a friendly "this will take a while" banner once we
  // know the archive is big. Threshold matches the real-world backfill
  // scale (multi-thousand PDF archives).
  const isLargeImport = (total || 0) > 1000;

  // Simple rate-based ETA: extracted / (now - stage_started_at) seconds.
  const etaMinutes = useMemo(() => {
    if (!job?.stage_started_at || !total || !extracted) return null;
    const started = new Date(job.stage_started_at).getTime();
    const elapsedSec = Math.max((Date.now() - started) / 1000, 1);
    const rate = extracted / elapsedSec; // PDFs/sec
    if (rate <= 0) return null;
    const remaining = Math.max(total - extracted, 0);
    return Math.ceil(remaining / rate / 60);
  }, [job?.stage_started_at, total, extracted]);

  if (isFailed) {
    return <FailureCard job={job} onRetry={onRetry} />;
  }

  return (
    <div className="space-y-6" data-testid="wizard-step2-progress">
      {/* v58.2 — Large-import banner. Only renders once we know the
          archive is big; keeps the small-import UX clean. */}
      {isLargeImport && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 flex items-start gap-3"
             data-testid="wizard-large-import-banner">
          <Sparkles className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900 leading-relaxed">
            <b>Large import — this may take up to 90 minutes.</b> You can
            safely close this tab and return later; the import continues
            in the background. Track progress via the pill in the top
            bar or come back to this page any time.
          </div>
        </div>
      )}
      {/* Stage stepper */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-4 gap-3">
          {STAGES.map((s, idx) => {
            const Icon = s.icon;
            const isDone = idx < activeStage;
            const isActive = idx === activeStage;
            return (
              <div key={s.key}
                   data-testid={`wizard-stage-${s.key}`}
                   data-active={isActive || undefined}
                   className={`rounded-xl border p-4 flex items-center gap-3 transition ${
                     isActive ? 'border-blue-300 bg-blue-50' :
                     isDone   ? 'border-emerald-200 bg-emerald-50' :
                                'border-slate-200 bg-slate-50'
                   }`}>
                <div className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${
                  isActive ? 'bg-blue-100 text-blue-700' :
                  isDone   ? 'bg-emerald-100 text-emerald-700' :
                             'bg-white text-slate-400 border border-slate-200'
                }`}>
                  {isActive ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Icon className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Stage {idx + 1}
                  </div>
                  <div className="text-sm font-medium text-slate-900 truncate">{s.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live status line */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Current status</div>
            <div className="mt-1 text-lg font-semibold text-slate-900" data-testid="wizard-status-line">
              {statusLine(state, { extracted, total, cachedHits })}
            </div>
          </div>
          {etaMinutes !== null && total && (
            <div className="text-right shrink-0">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                Projected time remaining
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-900"
                   data-testid="wizard-eta">
                {etaMinutes < 1 ? '< 1 min' : `${etaMinutes} min`}
              </div>
            </div>
          )}
        </div>

        {/* Progress bar */}
        {total ? (
          <div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-blue-500 transition-all"
                   style={{ width: `${Math.min(100, (extracted / total) * 100).toFixed(1)}%` }}
                   data-testid="wizard-progress-bar" />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-slate-500">
              <span>{extracted} of {total} scanned</span>
              <span>${estimatedCost.toFixed(2)} spent on AI vision</span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            Waiting for the archive to reach the scanner…
          </div>
        )}

        {/* Small chips */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
          <Chip label="Cache hits" value={cachedHits} tone="violet"
                testid="wizard-chip-cache" />
          <Chip label="Failed" value={failed} tone={failed ? 'red' : 'slate'}
                testid="wizard-chip-failed" />
          <Chip label="Job ID" value={job?.id?.slice(0, 8) + '…'} tone="slate" mono
                testid="wizard-chip-jobid" />
        </div>

        {error && (
          <div className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Live update paused: {error}. Retrying in the background.
          </div>
        )}
      </div>

      <p className="text-sm text-slate-500 text-center">
        You can close this tab — the import keeps running in the background.
        Come back to this page any time to check progress.
      </p>
    </div>
  );
}

function statusLine(state, { extracted, total, cachedHits }) {
  switch (state) {
    case 'init':
    case 'downloading':
      return 'Downloading archive…';
    case 'extracting':
      return 'Enumerating archive contents…';
    case 'dryrun':
      return `${extracted}${total ? `/${total}` : ''} PDFs classified${cachedHits ? ` (${cachedHits} from cache)` : ''}`;
    case 'processing':
      return `${extracted}${total ? `/${total}` : ''} PDFs committed`;
    case 'awaiting_approval':
      return 'Scan complete — ready for review.';
    case 'complete':
      return 'Import complete.';
    default:
      return state;
  }
}

function Chip({ label, value, tone = 'slate', mono = false, testid }) {
  const toneCls = {
    slate:  'bg-slate-100 text-slate-700',
    violet: 'bg-violet-100 text-violet-700',
    red:    'bg-red-100 text-red-700',
    green:  'bg-emerald-100 text-emerald-700',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${toneCls}`}
          data-testid={testid}>
      <span className="opacity-70">{label}</span>
      <span className={`font-semibold ${mono ? 'font-mono' : ''}`}>{value}</span>
    </span>
  );
}

function FailureCard({ job, onRetry }) {
  const step = job?.error_step || 'unknown';
  return (
    <div className="rounded-2xl border border-red-300 bg-red-50 p-6 shadow-sm"
         data-testid="wizard-failure-card">
      <div className="flex items-start gap-3">
        <XCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold text-red-900">
            Import failed during: {step}
          </div>
          <div className="mt-1 text-sm text-red-800 leading-relaxed break-words">
            {job?.error || 'Unknown error — check backend logs.'}
          </div>
          <button
            onClick={onRetry}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-red-300 text-red-800 hover:bg-red-100 transition"
            data-testid="wizard-retry-btn"
          >
            <RotateCcw className="w-4 h-4" />
            Retry from Step 1
          </button>
        </div>
      </div>
    </div>
  );
}
