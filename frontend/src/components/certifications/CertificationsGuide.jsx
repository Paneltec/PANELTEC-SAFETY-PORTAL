// v160.3.7 — Certifications page onboarding guide.
// Collapsible slate-outlined card that explains WHAT the Certifications page
// is and HOW to use it. Follows the RenewalLinksGuide / SimproZipImportGuide
// pattern — default OPEN on first load, localStorage-persistent.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Info20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  DocumentBulletList20Regular,
  Warning20Filled,
} from '@fluentui/react-icons';

const STORAGE_KEY = 'howThisWorks:certifications_guide';

function readStored(fallback) {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (_) { /* iframe / private mode */ }
  return fallback;
}

function writeStored(open) {
  try { window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); }
  catch (_) { /* noop */ }
}

function Section({ title, children, testid }) {
  return (
    <section data-testid={testid} className="print:break-inside-avoid">
      <div className="text-[11px] font-bold uppercase tracking-wider text-[#1e4a8c] mb-1.5">
        {title}
      </div>
      <div className="text-sm leading-relaxed text-slate-700 space-y-1.5">
        {children}
      </div>
    </section>
  );
}

export default function CertificationsGuide() {
  const [open, setOpen] = useState(() => readStored(true));
  useEffect(() => { writeStored(open); }, [open]);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <section
      data-testid="certifications-guide"
      data-open={open ? 'true' : 'false'}
      className="mb-4 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden print:break-inside-avoid">
      <button
        type="button"
        onClick={toggle}
        data-testid="certifications-guide-toggle"
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-slate-50">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-amber-50 text-amber-700 shrink-0">
          <DocumentBulletList20Regular />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-slate-900">
            Certifications — compliance status for every worker
          </span>
          <span className="block mt-0.5 text-xs text-slate-500">
            Purpose · What you&apos;re looking at · Filters · Sort · Row breakdown · Where the data comes from · Troubleshooting.
          </span>
        </span>
        <span className="text-slate-400">
          {open ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 sm:px-6 py-5 bg-slate-50/40 space-y-5">
          {/* Purpose */}
          <p className="text-sm leading-relaxed text-slate-700 max-w-4xl">
            This page is your single source of truth for every certification,
            licence and induction held by your field crew. It shows what each
            worker has on file, when their tickets expire, whether the physical
            file is uploaded, and what needs your attention today. Use it for
            daily compliance triage, audit prep, and expiry chasing.
          </p>

          {/* What you're looking at */}
          <Section testid="cert-guide-overview" title="What you're looking at">
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>List view</strong> (default) — one row per worker with a summary of all their certs.</li>
              <li><strong>Dashboard view</strong> — aggregate charts (available via the tiny <em>Dashboard</em> link at the top-right of the tab).</li>
              <li><strong>Compliance attention queue</strong> banner — the amber row directly below this guide calls out any expired, expiring-soon or missing-file certs — those workers are surfaced first.</li>
            </ul>
          </Section>

          {/* Filter chips */}
          <Section testid="cert-guide-filters" title="Filter chips (top row)">
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>All</strong> — every worker</li>
              <li><strong>Expired</strong> — workers with ≥ 1 cert past its expiry date</li>
              <li><strong>Expiring soon</strong> — workers with ≥ 1 cert expiring in the next 30 days</li>
              <li><strong>Missing file</strong> — workers with ≥ 1 cert that has no PDF uploaded yet (metadata only)</li>
              <li><strong>Valid</strong> — workers with only current certs</li>
              <li><strong>No expiry</strong> — workers with only never-expires-type certs (competencies)</li>
            </ul>
            <p className="text-xs text-slate-500 mt-1">
              Click a filter chip to scope the list. The counts on each chip tell you how many workers match.
            </p>
          </Section>

          {/* Search + Sort */}
          <div className="grid gap-5 md:grid-cols-2">
            <Section testid="cert-guide-search" title="Search box">
              <p>Type any worker name, cert name, or issuer to filter live.</p>
            </Section>
            <Section testid="cert-guide-sort" title="Sort options (row headers)">
              <ul className="list-disc pl-5 space-y-0.5">
                <li><strong>Worker</strong> — alphabetical (default)</li>
                <li><strong>Attention</strong> — most-urgent first (expired × 100 + expiring × 10 + missing weight)</li>
                <li><strong>Total</strong> — most certs first</li>
                <li><strong>Missing</strong> — most missing-file rows first</li>
                <li><strong>Expired</strong> — most expired first</li>
                <li><strong>Updated</strong> — most recently changed first</li>
              </ul>
              <p className="text-xs text-slate-500 mt-1">
                Click a header to sort ascending; click again to flip descending.
              </p>
            </Section>
          </div>

          {/* Row breakdown */}
          <Section testid="cert-guide-row" title="Per-worker row breakdown">
            <div>Each row shows:</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Worker name + total cert count + Simpro / Manual source split</li>
              <li>Attention sub-chips:{' '}
                <span className="inline-block mx-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">N NO FILE</span>
                <span className="inline-block mx-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">N VALID</span>
                <span className="inline-block mx-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800">N EXPIRED</span>
                <span className="inline-block mx-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">N EXPIRING SOON</span>
                <span className="inline-block mx-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800">N NO EXPIRY</span>
              </li>
              <li>Latest updated date on the right</li>
              <li><strong>VIEW CERTS</strong> link on the far right → expands the row inline to show every individual cert</li>
            </ul>
          </Section>

          {/* Expanded row */}
          <Section testid="cert-guide-expanded" title="Expanded row (click the chevron)">
            <div>For each individual cert:</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Cert name + issuer + expiry date + relative-days chip</li>
              <li>Status pill (Missing file / Expired / Valid / No expiry)</li>
              <li>Source (Simpro / Manual)</li>
              <li>File chip (📄 File — clickable to open, or ⚠ No file)</li>
              <li>Actions: <em>View · Edit · Delete · Remind</em></li>
            </ul>
          </Section>

          {/* Bulk actions */}
          <Section testid="cert-guide-bulk" title="Bulk actions">
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Export CSV</strong> (top-right of filter row) — downloads a flat spreadsheet of every cert matching the current filter, ready for auditor hand-off.</li>
              <li>Individual <strong>Remind</strong> on any expiring/missing cert fires an email to the worker (see the Compliance attention queue banner for the auto-reminder cadence too).</li>
            </ul>
          </Section>

          {/* Zero-cert workers callout */}
          <div
            data-testid="cert-guide-zero-callout"
            className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="text-amber-600 shrink-0 mt-0.5"><Warning20Filled /></span>
            <div className="text-sm text-amber-900">
              <span className="font-semibold">Zero-cert workers.</span>{' '}
              If a worker has no certifications on file, they&apos;ll appear with a{' '}
              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">NO CERTS</span>{' '}
              chip and a &ldquo;<em>No certifications on file</em>&rdquo; subtitle.
              These are usually the most important workers to review — either a
              fresh hire not yet inducted, or a Simpro ZIP that hasn&apos;t been
              imported yet (see the Simpro ZIP guide on Settings → Users &amp;
              Permissions).
            </div>
          </div>

          {/* Data sources */}
          <Section testid="cert-guide-sources" title="Where the data comes from">
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Simpro-sourced certs</strong> — imported via the per-worker ZIP upload flow or the nightly Simpro sync</li>
              <li><strong>Manual certs</strong> — added directly by an admin via the worker&apos;s Edit modal</li>
              <li><strong>PDFs</strong> — either bundled inside the Simpro ZIP OR uploaded ad-hoc against a metadata-only row</li>
            </ul>
          </Section>

          {/* Troubleshooting */}
          <div
            data-testid="cert-guide-troubleshooting"
            className="rounded-xl border border-slate-200 bg-white px-4 py-4">
            <div className="text-sm font-semibold text-slate-900 mb-2">Troubleshooting</div>
            <ul className="space-y-2 text-sm text-slate-600 list-disc pl-5">
              <li>
                <span className="font-medium text-slate-800">&ldquo;I imported a ZIP but the certs don&apos;t show here.&rdquo;</span>{' '}
                Hard-refresh (Ctrl+Shift+R) once; the Certifications view
                fetches on load. If still missing, check the worker&apos;s
                Edit modal → Certifications section for confirmation the
                import landed.
              </li>
              <li>
                <span className="font-medium text-slate-800">&ldquo;A cert shows NO FILE but I know it exists.&rdquo;</span>{' '}
                The metadata was imported (from Simpro) but the PDF wasn&apos;t.
                Either re-run the ZIP import or manually attach the PDF via
                <em> Edit → Upload document</em>.
              </li>
              <li>
                <span className="font-medium text-slate-800">&ldquo;Expiry looks wrong.&rdquo;</span>{' '}
                Click Edit on that cert row and correct the date; audit trail
                is preserved.
              </li>
              <li>
                <span className="font-medium text-slate-800">&ldquo;How do I bulk-remind everyone with a missing cert?&rdquo;</span>{' '}
                Filter to <strong>MISSING FILE</strong>, then use the per-row
                Remind icon; a bulk-remind endpoint is on the roadmap.
              </li>
            </ul>
          </div>

          {/* When to use */}
          <Section testid="cert-guide-when" title="When to use this page">
            <ul className="list-disc pl-5 space-y-1">
              <li>Daily / weekly compliance triage</li>
              <li>Pre-mobilisation checks (do all workers on the crew have current tickets?)</li>
              <li>Audit prep (Export CSV gives you the full evidence sheet)</li>
              <li>Fresh-hire onboarding verification</li>
              <li>Chasing renewals before they expire</li>
            </ul>
          </Section>

          <div className="flex items-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <Info20Regular />
            </span>
            <span className="text-xs text-slate-500">
              This guide stays collapsed after you dismiss it — your preference is remembered per browser.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
