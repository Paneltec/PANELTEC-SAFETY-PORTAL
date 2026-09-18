/**
 * v58.13.132ig — Compliance question widget.
 *
 * First-class 3-state field for checklist / inspection forms
 * (Pre-Starts, SSRAs, Toolbox Talks, Inspections, Site Audits, JSEAs).
 *
 * UX contract (matches the mockup Stephen shared):
 *   · Question label on its own line, prefixed with the question
 *     number if provided.
 *   · Three buttons directly below the label:
 *       COMPLIANT (emerald-500 when active)
 *       AT RISK   (rose-500 when active — brand danger)
 *       N/A       (slate-400 when active)
 *   · Right-aligned in the same row: 3 utility icons:
 *       (i) info    — visible only when `help_text` is set on the
 *                     field. Click opens a small popover with the
 *                     help copy.
 *       📷 camera   — coming in .132ih (per-question photo attach).
 *                     For .132ig the button renders as disabled with
 *                     a "coming soon" tooltip so the layout matches
 *                     the mockup and the future ship becomes a
 *                     one-line wire-up.
 *       📝 notes    — coming in .132ii (per-question notes text
 *                     input). Same disabled-stub treatment.
 *
 * Value shape: `{status, photos, notes}` where status is one of
 * "compliant" | "at_risk" | "na" | null (null = un-answered).
 *
 * Callers pass:
 *   · field       — the FormField (label / help_text / required).
 *   · value       — current value dict OR null.
 *   · onChange(v) — commit a new value dict.
 *   · readOnly    — disable all interactions.
 *   · questionNumber — optional 1-based ordinal; when set, renders
 *                     "N. <label>".
 */
import React, { useState } from 'react';
import { Info, Camera, StickyNote } from 'lucide-react';

const STATUS_BUTTONS = [
  {
    key: 'compliant', label: 'COMPLIANT',
    activeCls: 'bg-emerald-500 text-white border-emerald-500',
    inactiveCls: 'bg-white text-slate-600 border-slate-300 hover:bg-emerald-50 hover:border-emerald-300',
  },
  {
    key: 'at_risk', label: 'AT RISK',
    activeCls: 'bg-rose-500 text-white border-rose-500',
    inactiveCls: 'bg-white text-slate-600 border-slate-300 hover:bg-rose-50 hover:border-rose-300',
  },
  {
    key: 'na', label: 'N/A',
    activeCls: 'bg-slate-400 text-white border-slate-400',
    inactiveCls: 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100 hover:border-slate-400',
  },
];

function _readStatus(value) {
  if (value && typeof value === 'object') return value.status || null;
  return null;
}

export default function ComplianceQuestion({
  field, value, onChange, readOnly = false, questionNumber = null,
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const status = _readStatus(value);
  const helpText = (field?.help_text || '').trim();
  const label = field?.label || 'Untitled';
  const prefix = questionNumber != null ? `${questionNumber}. ` : '';

  const commit = (nextStatus) => {
    if (readOnly || typeof onChange !== 'function') return;
    // Merge with existing photos/notes so we don't clobber .132ih/ii data.
    const prev = (value && typeof value === 'object') ? value : {};
    onChange({
      status: nextStatus,
      photos: Array.isArray(prev.photos) ? prev.photos : [],
      notes: typeof prev.notes === 'string' ? prev.notes : '',
    });
  };

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white p-3 space-y-2"
      data-testid={`compliance-question-${field?.id || 'unknown'}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 leading-snug break-words">
            {prefix}{label}
            {field?.required && <span className="text-rose-600 ml-1">*</span>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex flex-wrap gap-1.5">
          {STATUS_BUTTONS.map((btn) => {
            const active = status === btn.key;
            return (
              <button
                key={btn.key}
                type="button"
                disabled={readOnly}
                onClick={() => commit(btn.key)}
                data-testid={`compliance-btn-${btn.key}-${field?.id || 'unknown'}`}
                data-active={active ? 'true' : 'false'}
                className={
                  'inline-flex items-center px-3 py-1.5 min-h-[36px] rounded-full border ' +
                  'text-[11px] font-semibold uppercase tracking-wider transition-colors ' +
                  'disabled:opacity-60 disabled:cursor-not-allowed ' +
                  (active ? btn.activeCls : btn.inactiveCls)
                }
              >
                {btn.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto inline-flex items-center gap-1">
          {helpText ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setInfoOpen((v) => !v)}
                onBlur={() => setTimeout(() => setInfoOpen(false), 120)}
                data-testid={`compliance-info-${field?.id || 'unknown'}`}
                title={helpText}
                aria-label="Guidance for this question"
                className="p-1.5 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <Info size={14} />
              </button>
              {infoOpen && (
                <div
                  role="tooltip"
                  data-testid={`compliance-info-popover-${field?.id || 'unknown'}`}
                  className="absolute right-0 top-8 z-20 w-64 rounded-lg border border-slate-200 bg-white p-2.5 shadow-lg text-[11px] text-slate-700 leading-snug"
                >
                  {helpText}
                </div>
              )}
            </div>
          ) : null}
          <button
            type="button"
            disabled
            data-testid={`compliance-camera-${field?.id || 'unknown'}`}
            title="Photo attach — coming in v58.13.132ih"
            aria-label="Attach photo (coming soon)"
            className="p-1.5 rounded-full text-slate-300 cursor-not-allowed"
          >
            <Camera size={14} />
          </button>
          <button
            type="button"
            disabled
            data-testid={`compliance-notes-${field?.id || 'unknown'}`}
            title="Add note — coming in v58.13.132ii"
            aria-label="Add note (coming soon)"
            className="p-1.5 rounded-full text-slate-300 cursor-not-allowed"
          >
            <StickyNote size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
