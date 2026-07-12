// v160.3.6t — Simpro ZIP staff import guide.
// Renders above the User Permissions tabs so a new admin can't miss it.
//
// Collapsible slate-outlined card (matches HowThisWorks pattern). Default
// state is OPEN because this is onboarding material; state is persisted
// per-user in localStorage so once dismissed it stays collapsed.
//
// Two screenshot slots are supported:
//   /img/help/simpro-employee.png       — Simpro Employee Profile (Daniel Butler)
//   /img/help/simpro-attachments.png    — Simpro Attachments tab (folders + tiny top-right ZIP button)
// If either file is missing we fall back to a labelled empty state card
// so the guide never looks broken.
//
// The second screenshot is overlaid with an SVG red-ring + arrow that
// points at the tiny download-ZIP icon top-right (just left of the blue
// CREATE FOLDER button) — that's the whole point of the guide.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Info20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  Warning20Filled,
  ArrowDownload20Regular,
  Image20Regular,
  ArrowUpload20Regular,
} from '@fluentui/react-icons';

const STORAGE_KEY = 'howThisWorks:simpro_zip_import_guide';

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

/** Screenshot slot — renders the image, or a labelled placeholder if missing. */
function ScreenshotSlot({ src, alt, caption, testid, overlay }) {
  const [errored, setErrored] = useState(false);

  return (
    <figure
      data-testid={testid}
      className="relative rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {!errored ? (
        <div className="relative">
          <img
            src={src}
            alt={alt}
            loading="lazy"
            onError={() => setErrored(true)}
            data-testid={`${testid}-image`}
            className="block w-full h-auto"
          />
          {overlay}
        </div>
      ) : (
        <div
          data-testid={`${testid}-placeholder`}
          className="flex flex-col items-center justify-center gap-2 px-6 py-10 bg-slate-50 text-center">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-white border border-dashed border-slate-300 text-slate-400">
            <Image20Regular />
          </span>
          <div className="text-sm font-semibold text-slate-700">
            Screenshot placeholder — admin to attach
          </div>
          <div className="text-xs text-slate-500 max-w-md">
            {caption}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Drop at <code className="px-1 py-0.5 rounded bg-white border border-slate-200">{src}</code>
          </div>
          <button
            type="button"
            data-testid={`${testid}-upload-btn`}
            title="Reference image upload will be wired to admin storage in a future release."
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50">
            <ArrowUpload20Regular /> Upload reference image →
          </button>
        </div>
      )}
      {caption && !errored && (
        <figcaption className="border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px] italic text-slate-500">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/** Numbered step row with an inline body. */
function Step({ n, title, children, testid }) {
  return (
    <li data-testid={testid} className="flex gap-3">
      <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-blue text-white text-xs font-bold tabular-nums shadow-sm">
        {n}
      </span>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="mt-1 text-sm leading-relaxed text-slate-600">{children}</div>
      </div>
    </li>
  );
}

export default function SimproZipImportGuide() {
  const [open, setOpen] = useState(() => readStored(true));
  useEffect(() => { writeStored(open); }, [open]);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <section
      data-testid="simpro-zip-import-guide"
      data-open={open ? 'true' : 'false'}
      className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header / toggle */}
      <button
        type="button"
        onClick={toggle}
        data-testid="simpro-zip-import-guide-toggle"
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-slate-50">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-orange-50 text-orange-600 shrink-0">
          <ArrowDownload20Regular />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-slate-900">
            How to download Simpro worker attachments (staff guide)
          </span>
          <span className="block mt-0.5 text-xs text-slate-500">
            7 steps · Locate the tiny top-right ZIP icon in the Attachments tab, then bulk-upload into Paneltec.
          </span>
        </span>
        <span className="text-slate-400">
          {open ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 sm:px-6 py-5 bg-slate-50/40 space-y-6">
          {/* Intro */}
          <p className="text-sm text-slate-700 max-w-3xl">
            Paneltec pulls certificates, inductions and licences straight out of Simpro via
            per-employee ZIP downloads. The download icon in Simpro is small and easy to
            miss — this guide walks a new admin through the exact clicks.
          </p>

          {/* ⚠ TIP callout — the whole reason this guide exists */}
          <div
            data-testid="simpro-zip-import-guide-tip"
            className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="text-amber-600 shrink-0 mt-0.5"><Warning20Filled /></span>
            <div className="text-sm text-amber-900">
              <span className="font-semibold">⚠ The download button is on the top-right — and it&apos;s tiny.</span>{' '}
              Look for the small cloud/arrow icon <em>immediately to the left of the blue
              &ldquo;CREATE FOLDER&rdquo; button</em>. It&apos;s the whole reason this guide exists —
              most staff scroll straight past it.
            </div>
          </div>

          {/* Steps */}
          <ol className="space-y-4">
            <Step n={1} testid="simpro-zip-step-1" title="Log into Simpro">
              Open <span className="font-medium text-slate-800">paneltec.simprosuite.com</span>{' '}
              and sign in with your normal Simpro credentials. If you can&apos;t log in, ask
              your workshop supervisor to add you to the <em>People</em> module.
            </Step>

            <Step n={2} testid="simpro-zip-step-2" title="Navigate to Staff → Employees">
              From the top menu choose <span className="font-medium text-slate-800">People → Employees</span>.
              You&apos;ll land on the full staff list.
            </Step>

            <Step n={3} testid="simpro-zip-step-3" title="Open the employee record">
              Search for the worker (e.g. <em>Daniel Butler</em>) and click their name.
              You&apos;ll see the Employee Profile view shown below.
            </Step>

            <ScreenshotSlot
              testid="simpro-zip-guide-screenshot-1"
              src="/img/help/simpro-employee.png"
              alt="Simpro Employee Profile view for Daniel Butler"
              caption="Screenshot 1 — Simpro Employee Profile (example worker: Daniel Butler)."
            />

            <Step n={4} testid="simpro-zip-step-4" title="Click the Attachments tab">
              Along the top of the profile you&apos;ll see tabs like <em>Overview · Details ·
              Timesheets · Attachments</em>. Click <span className="font-medium text-slate-800">Attachments</span>.
              You should see six folders: <span className="font-medium">CERTIFICATES</span>,{' '}
              <span className="font-medium">EXPIRED / OOD</span>,{' '}
              <span className="font-medium">INDUCTIONS</span>,{' '}
              <span className="font-medium">LICENCES</span>,{' '}
              <span className="font-medium">PRIVATE &amp; CONFIDENTIAL</span>, plus the loose
              <span className="font-medium"> AA-Photo.jpg</span> file.
            </Step>

            <Step n={5} testid="simpro-zip-step-5" title="Locate the tiny ZIP download icon (top-right)">
              <span className="font-medium text-amber-800">This is the step everyone gets stuck on.</span>{' '}
              In the top-right of the Attachments panel — <em>immediately to the left of
              the blue CREATE FOLDER button</em> — there is a small cloud-with-arrow icon.
              That&apos;s the &ldquo;Download all as ZIP&rdquo; button. The red circle in the
              screenshot below points straight at it.
            </Step>

            <ScreenshotSlot
              testid="simpro-zip-guide-screenshot-2"
              src="/img/help/simpro-attachments.png"
              alt="Simpro Attachments tab — red ring highlighting the tiny top-right download-ZIP icon"
              caption="Screenshot 2 — The red ring highlights the download-ZIP icon (top-right, just left of CREATE FOLDER)."
              overlay={
                // Red highlight ring + arrow — anchored to the top-right where
                // Simpro renders the download-ZIP icon. Percentages keep it
                // reasonable across responsive widths.
                <svg
                  data-testid="simpro-zip-guide-arrow-overlay"
                  className="pointer-events-none absolute inset-0 w-full h-full"
                  viewBox="0 0 100 60"
                  preserveAspectRatio="none"
                  aria-hidden="true">
                  <circle
                    cx="86" cy="8" r="3.2"
                    fill="none" stroke="#EF4444" strokeWidth="0.9"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d="M70 22 Q78 16 84 10"
                    fill="none" stroke="#EF4444" strokeWidth="0.9"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polygon
                    points="84,10 82.2,11.6 82.4,9.2"
                    fill="#EF4444"
                  />
                </svg>
              }
            />

            <Step n={6} testid="simpro-zip-step-6" title="Save the ZIP file">
              Simpro will bundle every attachment into a single ZIP named something like
              <code className="mx-1 px-1 py-0.5 rounded bg-white border border-slate-200 text-[12px]">
                Daniel_Butler_Attachments.zip
              </code>. Save it somewhere obvious (e.g. Downloads) — you don&apos;t need to
              extract it.
            </Step>

            <Step n={7} testid="simpro-zip-step-7" title="Upload into Paneltec">
              Come back to this page and click the green{' '}
              <span className="inline-flex items-center gap-1 align-middle rounded-md bg-emerald-700 text-white text-[11px] font-semibold px-2 py-0.5">
                <ArrowDownload20Regular className="w-3 h-3" /> Bulk import ZIPs
              </span>{' '}
              button at the top of Users &amp; Workers. You can drop multiple worker ZIPs
              in at once — Paneltec will match each ZIP to the correct employee by name
              and file every certificate into the right slot.
            </Step>
          </ol>

          {/* Troubleshooting */}
          <div
            data-testid="simpro-zip-import-guide-troubleshooting"
            className="rounded-xl border border-slate-200 bg-white px-4 py-4">
            <div className="text-sm font-semibold text-slate-900 mb-2">Troubleshooting</div>
            <ul className="space-y-2 text-sm text-slate-600 list-disc pl-5">
              <li>
                <span className="font-medium text-slate-800">I can&apos;t see the download icon.</span>{' '}
                Your Simpro role may not have <em>Attachments · Read</em> permission — ask
                a workshop admin to grant it. The icon only appears if you have read
                access on all six folders.
              </li>
              <li>
                <span className="font-medium text-slate-800">The ZIP downloaded empty.</span>{' '}
                The employee has no attachments in any folder yet. Confirm at least one
                certificate has been uploaded on the Simpro side first.
              </li>
              <li>
                <span className="font-medium text-slate-800">Paneltec says &ldquo;worker not matched&rdquo;.</span>{' '}
                The ZIP filename must contain the worker&apos;s name exactly as it appears in
                Paneltec. Rename the file if Simpro exported it as a generic{' '}
                <code className="px-1 py-0.5 rounded bg-slate-100 text-[12px]">attachments.zip</code>.
              </li>
              <li>
                <span className="font-medium text-slate-800">A certificate landed in the wrong slot.</span>{' '}
                Open the worker&apos;s Edit modal → Certifications tab and drag the file into
                the correct kind. Paneltec learns from each correction.
              </li>
            </ul>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <Info20Regular />
            </span>
            <span className="text-xs text-slate-500">
              Prefer a video walkthrough? Ask HSEQ to record one — this guide will embed it here.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
