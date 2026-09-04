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

import React, { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import PdfActions from './PdfActions';
import DeleteRecordButton from './DeleteRecordButton';
import EmailButton from './EmailButton';
import SubmissionViewer from './SubmissionViewer';
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
  // v160.3.9.58.10.2 — Pre-Starts UX opt-ins. Both default to the
  // pre-existing behaviour so the other 5 Capture tabs are untouched.
  //   · `hideOperator`  – suppress the row-3 operator name (Pre-Starts
  //     tiles hide worker names per user request).
  //   · `stripeStyle`   – inline style object that OVERRIDES the
  //     Tailwind `colour.stripe` class. Used to paint the 4-px left
  //     accent from a runtime palette (Pre-Starts colours by template
  //     type from `preStartsPalette.js`).
  //   · `titleNode`     – optional ReactNode replacing the plain-text
  //     title so callers can inject `<mark>` highlights.
  hideOperator = false,
  stripeStyle,
  titleNode,
  // v160.3.9.58.13.38 — Optional external viewer override.
  onView,
  // v160.3.9.58.13.40 — Density hooks. `minH` (px string) sets a
  // uniform card floor; `subtitleLines` clamps the subtitle
  // (0 → hidden, 1 → line-clamp-1, 2 → line-clamp-2).
  minH,
  subtitleLines = 1,
  // v160.3.9.58.13.46 — Opt out of the PDF-open action. Defaults to
  // `true` so every existing Capture callsite keeps its file icon.
  // CS Incidents (and other `reference_library` DB-row entities that
  // don't have a PDF representation) pass `showPdf={false}` — the
  // backend's `POST /api/pdf-token` rejects unknown resource kinds
  // with a 400, which was surfacing as the "file icon flashes and
  // disappears" bug because `PdfActions.open` popped a window, hit
  // the 400, and immediately closed it.
  // v160.3.9.58.13.48 — CS Incidents now HAS a PDF backend renderer;
  // it passes `showPdf={true}` (default) + `pdfResourceKind=
  // "cs_incidents"` to override the permission-scoped `resourceKind`
  // ("reference_library") for the pdf-token POST body.
  // v160.3.9.58.13.50 — `pdfMirrored` opt-in forces the mirrored
  // `/forms/submissions/pdf-token` branch when the record's
  // `.source` field is falsy (e.g. Site Sign-In records loaded
  // straight from the form_submissions collection).
  showPdf = true,
  pdfResourceKind,
  pdfMirrored = false,
  // v58.13.119 — Ask Intelligence deep-link support. When truthy on
  // first render, the card auto-opens its SubmissionViewer once so
  // `?open=<id>` on the list page lands on the record. The prop is
  // a one-shot: after the initial open the card behaves normally
  // (subsequent renders don't re-trigger even if the prop stays true).
  openInitially = false,
}) {
  const r = record || {};
  const title = r.template_name_snapshot || r.template_name || r.title || 'Submission';
  const operator = r.submitted_by_name || r.operator || r.created_by_name || '';
  const dateStr = r.date || (r.submitted_at || '').substring(0, 10) || '';
  const colour = templateColor(r);
  const short = templateShortLabel(title);

  const defaultSubject = subject || `${title} — ${dateStr}`;
  const defaultBody = body || `${title}\nOperator: ${operator || '—'}\nDate: ${dateStr || '—'}`;

  // v160.3.9.10 — In-app submission viewer for the "unable to just review" bug.
  const [viewerOpen, setViewerOpen] = useState(false);

  // v58.13.119 — One-shot auto-open on mount when `openInitially` is
  // truthy (Ask Intelligence deep-link path). Empty deps ensures a
  // parent re-render can't re-trigger it after the user has closed
  // the viewer.
  useEffect(() => {
    if (openInitially) setViewerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="group relative rounded-lg bg-white border border-slate-200 overflow-hidden hover:shadow-md hover:border-slate-300 transition-shadow"
      style={minH ? { minHeight: minH } : undefined}
      data-testid={`capture-card-${r.id}`}
    >
      <div
        className={stripeStyle ? 'absolute left-0 top-0 bottom-0 w-1' : `absolute left-0 top-0 bottom-0 w-1 ${colour.stripe}`}
        style={stripeStyle}
        aria-hidden
      />
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
            {/* v160.3.9.10 — View submission inline */}
            <button
              type="button"
              onClick={() => { if (onView) { onView(r); } else { setViewerOpen(true); } }}
              title="View submission"
              aria-label="View submission"
              data-testid={`capture-view-${r.id}`}
              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100">
              <Eye size={13} />
            </button>
            <PdfActions
              resourceKind={resourceKind}
              pdfResourceKind={pdfResourceKind}
              pdfMirrored={pdfMirrored}
              recordId={r.id}
              source={r.source}
              title={title}
              size="sm"
              iconOnly
              enabled={showPdf}
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
          {titleNode || title}
        </div>
        {/* Row 3 — operator · date (operator hidden on Pre-Starts) */}
        <div
          className="text-[10.5px] text-slate-500 leading-tight truncate"
          title={hideOperator ? dateStr : `${operator} · ${dateStr}`}
          data-testid={`capture-meta-${r.id}`}
        >
          {hideOperator ? (dateStr || '—') : (
            <>{operator || '—'} <span className="text-slate-300">·</span> {dateStr || '—'}</>
          )}
        </div>
        {subtitle && subtitleLines > 0 && (
          <div className={`text-[10.5px] text-slate-500 leading-tight line-clamp-${subtitleLines}`} title={typeof subtitle === 'string' ? subtitle : undefined}>
            {subtitle}
          </div>
        )}
      </div>
      {viewerOpen && (
        <SubmissionViewer
          record={r}
          resourceKind={resourceKind}
          apiPath={apiPath}
          onClose={() => setViewerOpen(false)}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}

/**
 * Standard grid container to wrap a list of CaptureCards. Ensures the
 * card-per-row cadence stays consistent across all 6 Capture tabs.
 *
 * v58.13.41 — Accepts optional `gridClass`. When supplied, overrides
 * the default 5-col grid so callers can drive density via
 * `useCaptureDensity().gridClass`. Legacy call-sites that don't pass
 * it keep their pre-v58.13.41 layout.
 */
export function CaptureCardGrid({ children, testid, gridClass }) {
  return (
    <div
      className={gridClass || 'grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'}
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
