// v160.3.9.58.1 — Persistent "import running" pill.
// v160.3.9.58.6.2 — Ghost-trap protection: symmetric to v58.6.1's
// FailedCard fix, the pill now polls the same
// `/pre-starts/bulk-import/last` endpoint every 15 s. When the pill's
// current job is in a terminal state (`failed` / `complete`) or is
// still loading, we silently swap `activeJobId` to any newer LIVE job
// the endpoint surfaces — no toast, just quiet reality alignment.
// When the pill's current job is itself LIVE (`processing`,
// `downloading`, `extracting`, `dryrun`) we deliberately DON'T
// hijack, because that could be a second concurrent import the user
// is intentionally tracking. `console.warn` in that branch so future
// debugging surfaces the split.
//
// Renders in the top-right of the AppShell whenever a bulk-import job
// is in flight (jobId in localStorage AND state is not
// {complete|failed|dismissed}). Clicking it navigates back to the
// wizard route so the user can pick up where they left off.
//
// Lives outside the wizard component tree so navigating away doesn't
// unmount the polling loop.

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, CheckCircle2, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { useBulkImportJob } from './useBulkImportJob';
import api from '../../../lib/api';

const LS_KEY = 'bulkImport.activeJobId';
const DISMISS_KEY = 'bulkImport.dismissedJobId';

function readJobId() {
  try { return localStorage.getItem(LS_KEY) || null; } catch { return null; }
}
function readDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) || null; } catch { return null; }
}

export function BulkImportPill() {
  const [jobId, setJobId] = useState(() => readJobId());
  const [dismissed, setDismissed] = useState(() => readDismissed());
  const navigate = useNavigate();

  // Keep localStorage in sync across tabs / after wizard reset.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === LS_KEY) setJobId(e.newValue || null);
      if (e.key === DISMISS_KEY) setDismissed(e.newValue || null);
    };
    // Also poll localStorage every 2s — the wizard writes it via the
    // same tab which doesn't fire `storage` events.
    const intv = setInterval(() => {
      const nj = readJobId();
      if (nj !== jobId) setJobId(nj);
      const nd = readDismissed();
      if (nd !== dismissed) setDismissed(nd);
    }, 2000);
    window.addEventListener('storage', onStorage);
    return () => {
      clearInterval(intv);
      window.removeEventListener('storage', onStorage);
    };
  }, [jobId, dismissed]);

  const shouldShow = jobId && jobId !== dismissed;
  const { job } = useBulkImportJob(shouldShow ? jobId : null, { active: shouldShow });

  // v58.6.2 — Newer-live-job detection. Runs regardless of `shouldShow`
  // so a dismissed-then-reopened tab can still discover a fresh live
  // job. Terminal / loading states → silent swap. Live-different-job →
  // deliberately don't hijack.
  const LIVE_STATES = ['processing', 'downloading', 'extracting', 'dryrun'];
  const currentState = job?.state;
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const resp = await api.get('/pre-starts/bulk-import/last', {
          params: {
            states: 'processing,downloading,extracting,awaiting_approval',
            within_days: 1,
          },
        });
        if (cancelled) return;
        const nj = resp.data;
        if (!nj || !nj.id || nj.id === jobId) return;
        // We have a candidate newer job. Decide swap vs preserve.
        // v58.6.2 fix — Only swap on EXPLICIT terminal states, or
        // when the pill is tracking nothing at all (no activeJobId).
        // A transient `undefined` `currentState` while the initial
        // status fetch is in flight must NOT trigger a swap — that
        // races against a live pill's own state load and would
        // incorrectly hijack a legitimate concurrent import.
        const isTerminal = currentState === 'failed' || currentState === 'complete';
        const isTrackingNothing = !jobId;
        if (isTerminal || isTrackingNothing) {
          // Silent swap — pill was misrepresenting reality.
          try { localStorage.setItem(LS_KEY, nj.id); } catch { /* noop */ }
          // If the user had dismissed the previous jobId, clear that
          // marker so the new live job actually renders.
          try { localStorage.removeItem(DISMISS_KEY); } catch { /* noop */ }
          setJobId(nj.id);
          setDismissed(null);
        } else if (LIVE_STATES.includes(currentState)) {
          // Concurrent live import — leave the pill alone.
          console.warn(
            '[BulkImportPill] newer live job detected but current pill is live; not hijacking',
            { current: jobId, currentState, newer: nj.id, newerState: nj.state });
        }
        // Any other state (loading / undefined / awaiting_approval) →
        // do nothing this tick; the next 15 s poll will re-evaluate
        // once the pill has settled into a definitive state.
      } catch {
        // Silent — a probe failure is not user-facing.
      }
    };
    probe();
    const t = setInterval(probe, 15_000);
    return () => { cancelled = true; clearInterval(t); };
    // Intentionally not depending on LIVE_STATES (module-const).
  }, [jobId, currentState]);

  const onDismiss = useCallback((e) => {
    e.stopPropagation();
    try { localStorage.setItem(DISMISS_KEY, jobId || ''); } catch { /* noop */ }
    setDismissed(jobId);
  }, [jobId]);

  const onClick = useCallback(() => {
    navigate('/app/pre-starts/bulk-import');
  }, [navigate]);

  if (!shouldShow) return null;

  const state = job?.state || 'loading';
  const meta = pillMetaFor(state, job?.progress);
  const isLive = LIVE_STATES.includes(state);
  // v58.6.2 — Hover tooltip: current stage + progress fraction so
  // users can gauge progress without opening the wizard.
  const p = job?.progress || {};
  const extractedN = p.extracted || 0;
  const totalN = p.total || 0;
  const pctStr = totalN > 0
    ? ` (${((extractedN / totalN) * 100).toFixed(1)}%)`
    : '';
  const title = isLive
    ? `${state.charAt(0).toUpperCase()}${state.slice(1)} · ${extractedN.toLocaleString()}${totalN ? '/' + totalN.toLocaleString() : ''}${pctStr} · click to open`
    : 'Bulk import — click to open';

  return (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center gap-2 pl-2 pr-1 py-1.5 rounded-full border ${meta.tone} shadow-sm text-xs font-medium transition hover:shadow`}
      data-testid="bulk-import-pill"
      data-state={state}
      data-job-id={jobId}
      title={title}
    >
      {isLive && (
        <span
          className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white animate-ping"
          aria-hidden
          data-testid="bulk-import-pill-live-dot"
        />
      )}
      <span className="w-6 h-6 rounded-full bg-white/70 grid place-items-center">
        {meta.Icon}
      </span>
      <span className="max-w-[240px] truncate">{meta.label}</span>
      <span onClick={onDismiss}
            className="w-6 h-6 rounded-full hover:bg-black/10 grid place-items-center opacity-70 hover:opacity-100 cursor-pointer"
            aria-label="Dismiss import pill"
            data-testid="bulk-import-pill-dismiss">
        <X className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

function pillMetaFor(state, progress) {
  const p = progress || {};
  const extracted = p.extracted || 0;
  const total = p.total;
  switch (state) {
    case 'downloading':
    case 'init':
      return { tone: 'bg-blue-50 border-blue-200 text-blue-900',
               Icon: <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />,
               label: 'Import — downloading' };
    case 'extracting':
      return { tone: 'bg-blue-50 border-blue-200 text-blue-900',
               Icon: <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />,
               label: 'Import — extracting archive' };
    case 'dryrun':
      return { tone: 'bg-violet-50 border-violet-200 text-violet-900',
               Icon: <Sparkles className="w-3.5 h-3.5 text-violet-700" />,
               label: `Import — AI scan ${extracted}${total ? `/${total}` : ''}` };
    case 'awaiting_approval':
      return { tone: 'bg-amber-50 border-amber-300 text-amber-900',
               Icon: <AlertCircle className="w-3.5 h-3.5 text-amber-700" />,
               label: `Import — ready to review (${extracted})` };
    case 'processing':
      return { tone: 'bg-blue-50 border-blue-200 text-blue-900',
               Icon: <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />,
               label: `Import — committing ${extracted}${total ? `/${total}` : ''}` };
    case 'complete':
      return { tone: 'bg-emerald-50 border-emerald-300 text-emerald-900',
               Icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />,
               label: `Import complete — ${extracted}` };
    case 'failed':
      return { tone: 'bg-red-50 border-red-300 text-red-900',
               Icon: <AlertCircle className="w-3.5 h-3.5 text-red-700" />,
               label: 'Import failed — open to retry' };
    default:
      return { tone: 'bg-slate-100 border-slate-300 text-slate-700',
               Icon: <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />,
               label: 'Import — loading…' };
  }
}
