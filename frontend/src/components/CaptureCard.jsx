// v160.3.0-adjust-17b — Shared compact Capture card.
//
// One card component for all 6 Capture tabs (Pre-Starts, Hazards, Site
// Diary, Inspections, Incidents, Risk Assessments). Compact: ~96 px
// tall × ~280 px wide, so 4-5-6 fit per row on lg/xl/2xl breakpoints
// and the grid scales cleanly to thousands of records once we layer
// virtualised scrolling on top.
//
// Layout (colored left stripe + tight body):
//   ▌ Template name (bold, sm)
//     Operator · YYYY-MM-DD                LEGACY  📄  🗑
//
// Props:
//   record          — the submission (must expose id, template name,
//                     submitted_by_name, date, imported, source, …)
//   resourceKind    — permission key (e.g. "pre_starts", "hazards")
//   apiPath         — REST path segment (e.g. "pre-starts", "hazards")
//   subject / body  — email defaults (optional; sane defaults derived)
//   subtitle        — optional extra line rendered below operator (e.g.
//                     site address for Site Diary form-submissions)
//   badges          — array of extra <React node> pills (e.g. AI
//                     structured, high-risk indicator)
//   onDeleted       — id => void; parent evicts the row from state

import React from 'react';
import PdfActions from './PdfActions';
import DeleteRecordButton from './DeleteRecordButton';
import EmailButton from './EmailButton';
import { templateColor, templateShortLabel } from '../lib/templateColors';

export default function CaptureCard({
  record,
  resourceKind,
  apiPath,
  subject,
  body,
  subtitle,
  badges,
  onDeleted,
}) {
  const r = record || {};
  const title = r.template_name_snapshot || r.template_name || r.title || 'Submission';
  const operator = r.submitted_by_name || r.operator || r.created_by_name || '';
  const dateStr = r.date || (r.submitted_at || '').substring(0, 10) || '';
  const colour = templateColor(r);
  const short = templateShortLabel(title);

  const defaultSubject = subject || `${title} — ${dateStr}`;
  const defaultBody = body || `${title}\nOperator: ${operator || '—'}\nDate: ${dateStr || '—'}`;

  return (
    <div
      className="group relative rounded-lg bg-white border border-slate-200 overflow-hidden hover:shadow-md hover:border-slate-300 transition-shadow"
      data-testid={`capture-card-${r.id}`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${colour.stripe}`} aria-hidden />
      <div className="pl-2.5 pr-1.5 py-1.5">
        {/* Row 1 — chip/legacy pills + action icons on the SAME line */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0 flex items-center gap-1 flex-wrap">
            {short && (
              <span
                className={`inline-flex items-center px-1.5 py-[1px] rounded text-[9px] font-semibold uppercase tracking-wider ${colour.chipBg} ${colour.chipText}`}
                data-testid={`capture-type-${r.id}`}
              >
                {short}
              </span>
            )}
            {r.imported && (
              <span
                className="inline-flex items-center text-[9px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                title="Imported from legacy Simpro record"
                data-testid={`capture-legacy-${r.id}`}
              >
                Legacy
              </span>
            )}
            {Array.isArray(badges) && badges.map((b, i) => (
              <span key={i}>{b}</span>
            ))}
          </div>
          <div className="flex items-center gap-0 opacity-70 group-hover:opacity-100 transition-opacity -mr-1">
            <PdfActions
              resourceKind={resourceKind}
              recordId={r.id}
              source={r.source}
              title={title}
              size="sm"
              iconOnly
            />
            <DeleteRecordButton
              resourceKind={resourceKind}
              apiPath={apiPath}
              recordId={r.id}
              source={r.source}
              label={title}
              recordTitle={`${title} · ${dateStr}`}
              onDeleted={onDeleted}
              iconOnly
            />
            {false && (
              <EmailButton
                resourceKind={resourceKind}
                recordId={r.id}
                source={r.source}
                subject={defaultSubject}
                body={defaultBody}
                variant="row"
                size="sm"
                label=""
              />
            )}
          </div>
        </div>
        {/* Row 2 — template title */}
        <div
          className="mt-0.5 font-semibold text-[12.5px] text-slate-900 leading-[1.15] truncate"
          title={title}
          data-testid={`capture-title-${r.id}`}
        >
          {title}
        </div>
        {/* Row 3 — operator · date */}
        <div className="text-[10.5px] text-slate-500 leading-tight truncate" title={`${operator} · ${dateStr}`}>
          {operator || '—'} <span className="text-slate-300">·</span> {dateStr || '—'}
        </div>
        {subtitle && (
          <div className="text-[10.5px] text-slate-500 leading-tight line-clamp-1" title={typeof subtitle === 'string' ? subtitle : undefined}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Standard grid container to wrap a list of CaptureCards. Ensures the
 * card-per-row cadence stays consistent across all 6 Capture tabs.
 */
export function CaptureCardGrid({ children, testid }) {
  return (
    <div
      className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      data-testid={testid}
    >
      {children}
    </div>
  );
}

/**
 * v160.3.0-adjust-17d — Sticky-header wrapper for Capture tab pages.
 *
 * Keeps the page title, search + sort toolbar, and chip filters fixed
 * beneath the topbar while the card grid scrolls independently.
 *
 * Uses CSS sticky positioning (Pattern A). `top-16` clears the 64 px
 * topbar (`h-16` on <AppShell>'s <header>). `-mx-*` + `px-*` bleeds the
 * sticky background out to the main content edges so cards don't peek
 * out sideways as they scroll under.
 *
 * Sits at `z-20` — same as the sidebar (which is horizontally offset,
 * so no visual overlap) and one below the global topbar (`z-30`), so
 * the topbar always wins during overlap.
 */
export function CaptureSticky({ children, testid }) {
  return (
    <div
      className="sticky top-16 z-20 bg-white -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-1 pb-2 border-b border-slate-100"
      data-testid={testid}
    >
      {children}
    </div>
  );
}
