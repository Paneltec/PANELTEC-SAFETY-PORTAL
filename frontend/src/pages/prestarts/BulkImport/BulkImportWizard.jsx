// v160.3.9.58.1 — Bulk-Import Wizard shell.
//
// Owns the 4-step machine + persistent "minimized" pill via
// localStorage. The pill lives in `BulkImportPillMount` so a user who
// navigates away from `/app/pre-starts/bulk-import` still sees import
// progress in the top-right corner of every route.
//
// Steps:
//   1 · Source URL           — /app/pre-starts/bulk-import
//   2 · Downloading & dry-run — auto-drives from Step 1
//   3 · Review & approve      — auto-advances when state=awaiting_approval
//   4 · Processing & result   — auto-advances after approve
//
// The route always renders `Step 1` unless a job is already in flight
// (persisted in localStorage under `bulkImport.activeJobId`).

import React, { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '../../../components/capture/Ui';
import { Step1SourceUrl } from './Step1SourceUrl';
import { Step2Progress } from './Step2Progress';
import { Step3Review } from './Step3Review';
import { Step4Complete } from './Step4Complete';
import { useBulkImportJob } from './useBulkImportJob';

const LS_KEY = 'bulkImport.activeJobId';

function loadActiveJobId() {
  try { return localStorage.getItem(LS_KEY) || null; } catch { return null; }
}
function saveActiveJobId(id) {
  try {
    if (id) localStorage.setItem(LS_KEY, id);
    else localStorage.removeItem(LS_KEY);
  } catch { /* noop */ }
}

const STEP_LABELS = ['Source URL', 'Download & scan', 'Review & approve', 'Import result'];

export default function BulkImportWizard() {
  const [step, setStep] = useState(1);
  const [jobId, setJobId] = useState(() => loadActiveJobId());
  const [approving, setApproving] = useState(false);

  // Poll the active job (if any) so we can auto-advance between steps.
  const { job, error, refresh } = useBulkImportJob(jobId, { active: Boolean(jobId) });

  // Auto-advance state machine.
  useEffect(() => {
    if (!job) return;
    if (job.state === 'awaiting_approval' && step < 3) setStep(3);
    else if (job.state === 'processing' && step < 4) setStep(4);
    else if (job.state === 'complete' && step < 4) setStep(4);
    else if (job.state === 'failed' && step < 4) setStep(4);
    else if (['downloading', 'extracting', 'dryrun'].includes(job.state) && step < 2) setStep(2);
  }, [job, step]);

  const onJobCreated = useCallback((newJobId) => {
    setJobId(newJobId);
    saveActiveJobId(newJobId);
    setStep(2);
  }, []);

  const onReset = useCallback(() => {
    setJobId(null);
    saveActiveJobId(null);
    setStep(1);
  }, []);

  return (
    <div className="max-w-6xl mx-auto pb-16" data-testid="bulk-import-wizard">
      <PageHeader
        crumb="Capture / Daily Pre-Starts / Bulk import from URL"
        title="Bulk import from URL"
        subtitle="Import a shared ZIP of daily pre-start PDFs. Nested archives supported. Dropbox links auto-correct."
      />

      <Stepper current={step} labels={STEP_LABELS} />

      <div className="mt-6">
        {step === 1 && (
          <Step1SourceUrl onCreated={onJobCreated} />
        )}
        {step === 2 && jobId && (
          <Step2Progress
            job={job}
            error={error}
            onRetry={onReset}
          />
        )}
        {step === 3 && jobId && (
          <Step3Review
            jobId={jobId}
            job={job}
            approving={approving}
            setApproving={setApproving}
            onApproved={() => { setStep(4); refresh(); }}
            onRetry={onReset}
          />
        )}
        {step === 4 && jobId && (
          <Step4Complete
            job={job}
            jobId={jobId}
            onReset={onReset}
          />
        )}
      </div>
    </div>
  );
}

function Stepper({ current, labels }) {
  return (
    <ol className="flex items-center gap-2 mt-4" data-testid="wizard-stepper">
      {labels.map((label, i) => {
        const stepIdx = i + 1;
        const isDone = stepIdx < current;
        const isActive = stepIdx === current;
        return (
          <li key={label}
              className="flex-1 min-w-0"
              data-testid={`wizard-step-${stepIdx}`}
              data-active={isActive || undefined}
              data-done={isDone || undefined}>
            <div className={`
              rounded-2xl px-4 py-3 border transition
              ${isActive ? 'bg-blue-50 border-blue-300 text-blue-900 shadow-sm' :
                isDone ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                'bg-white border-slate-200 text-slate-500'}
            `}>
              <div className="text-[10px] uppercase tracking-wider opacity-70">Step {stepIdx}</div>
              <div className="text-sm font-medium truncate">{label}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
