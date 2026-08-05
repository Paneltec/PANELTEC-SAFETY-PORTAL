// v160.3.9.58.1 — Persistent "import running" pill.
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

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 pl-2 pr-1 py-1.5 rounded-full border ${meta.tone} shadow-sm text-xs font-medium transition hover:shadow`}
      data-testid="bulk-import-pill"
      data-state={state}
      title="Bulk import in progress — click to open"
    >
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
