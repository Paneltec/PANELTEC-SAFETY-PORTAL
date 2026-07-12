// v160.3.6w — Renewal Links onboarding guide.
// Collapsible slate-outlined card that explains WHAT Renewal Links are and
// HOW to use them end-to-end. Follows the SimproZipImportGuide pattern
// (v6t) — default OPEN on first load, localStorage-persistent, no admin
// upload wiring (this guide is copy-only).

import React, { useState, useEffect, useCallback } from 'react';
import {
  Info20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  Link20Regular,
  Warning20Filled,
} from '@fluentui/react-icons';

const STORAGE_KEY = 'howThisWorks:renewal_links_guide';

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

export default function RenewalLinksGuide() {
  const [open, setOpen] = useState(() => readStored(true));
  useEffect(() => { writeStored(open); }, [open]);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <section
      data-testid="renewal-links-guide"
      data-open={open ? 'true' : 'false'}
      className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden print:break-inside-avoid">
      <button
        type="button"
        onClick={toggle}
        data-testid="renewal-links-guide-toggle"
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-slate-50">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-blue-50 text-blue-700 shrink-0">
          <Link20Regular />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-slate-900">
            How Renewal Links work
          </span>
          <span className="block mt-0.5 text-xs text-slate-500">
            5 steps · Send a no-login upload URL to a contractor so they can renew their compliance documents in one click.
          </span>
        </span>
        <span className="text-slate-400">
          {open ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 sm:px-6 py-5 bg-slate-50/40 space-y-6">
          {/* Purpose */}
          <p className="text-sm text-slate-700 max-w-3xl leading-relaxed">
            Renewal Links are single-use, no-login URLs that let external
            contractors upload their renewed compliance documents (Public
            Liability, Workers Comp, ABN certificates, insurances, etc.)
            directly into your Paneltec Civil records. Send the link via
            email, the contractor uploads the fresh document, and it&apos;s
            automatically filed against the correct supplier/subject in your
            compliance archive.
          </p>

          {/* Steps */}
          <ol className="space-y-4">
            <Step n={1} testid="renewal-guide-step-1" title="Create a link">
              Click{' '}
              <span className="inline-flex items-center gap-1 align-middle rounded-md bg-brand-blue text-white text-[11px] font-semibold px-2 py-0.5">
                + Create renewal link
              </span>{' '}
              (top-right). Pick the contractor, subject (e.g.{' '}
              <em>Public Liability Insurance</em>) and expiry policy. Save —
              Paneltec generates a signed URL bound to that contractor and
              subject.
            </Step>

            <Step n={2} testid="renewal-guide-step-2" title="Send the link">
              On the row, click the blue <strong>Email link</strong> icon —
              this sends the URL to the contractor&apos;s email on file.
              Their email must be set first; if the amber &ldquo;<em>N
              contractors missing an email</em>&rdquo; banner is showing,
              use <strong>Fix now →</strong> to add the missing addresses.
              You can also click the <strong>Copy</strong> icon to grab the
              URL and paste it into your own email or messaging tool.
            </Step>

            <Step n={3} testid="renewal-guide-step-3" title="Contractor uploads">
              The contractor opens the link — no login required — and sees
              a branded upload form scoped to just their doc type. They
              drop the file. Paneltec verifies the upload, hashes it for
              dedupe, and files it under their supplier record automatically.
            </Step>

            <Step n={4} testid="renewal-guide-step-4" title="Verify">
              The row&apos;s status flips from <strong>PENDING</strong> to{' '}
              <strong>USED</strong> (green). The uploaded document is now
              visible in the supplier&apos;s compliance folder — you can
              open it, download it, or reference it in any audit export.
            </Step>

            <Step n={5} testid="renewal-guide-step-5" title="Revoke / expire">
              If a link was sent by mistake or shouldn&apos;t be used, click
              the rose <strong>Revoke</strong> button on the row — the URL
              is invalidated immediately. Links also auto-expire per the
              policy set at creation (default 14 days).
            </Step>
          </ol>

          {/* ⚠ Tip */}
          <div
            data-testid="renewal-links-guide-tip"
            className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="text-amber-600 shrink-0 mt-0.5"><Warning20Filled /></span>
            <div className="text-sm text-amber-900">
              <span className="font-semibold">Tip · Bulk operations.</span>{' '}
              Tick multiple rows in the list to bring up the floating
              &ldquo;<em>N selected</em>&rdquo; action bar — you can bulk
              delete, or clear an entire failed Simpro sync in one shot.
              Individual per-row actions (Email · Copy · Edit · Revoke ·
              Delete) still work as before.
            </div>
          </div>

          {/* Troubleshooting */}
          <div
            data-testid="renewal-links-guide-troubleshooting"
            className="rounded-xl border border-slate-200 bg-white px-4 py-4">
            <div className="text-sm font-semibold text-slate-900 mb-2">Troubleshooting</div>
            <ul className="space-y-2 text-sm text-slate-600 list-disc pl-5">
              <li>
                <span className="font-medium text-slate-800">Contractor says the link doesn&apos;t work.</span>{' '}
                Check the STATUS column. If <strong>USED</strong> they
                already uploaded — check the supplier folder. If{' '}
                <strong>REVOKED</strong> or <strong>EXPIRED</strong>, hit{' '}
                <strong>+ Create renewal link</strong> to issue a fresh one.
              </li>
              <li>
                <span className="font-medium text-slate-800">Contractor has no email on file.</span>{' '}
                Click the <strong>Fix now →</strong> button on the amber
                banner (or edit the supplier record) to add an address before
                sending.
              </li>
              <li>
                <span className="font-medium text-slate-800">Uploaded file didn&apos;t appear.</span>{' '}
                Ambiguous or unmatched uploads land in the{' '}
                <strong>Unmatched Documents</strong> triage tab — an admin
                can drag them into the right supplier folder from there.
              </li>
              <li>
                <span className="font-medium text-slate-800">Wrong doc type was requested.</span>{' '}
                Click the pencil <strong>Edit</strong> icon on the row while
                its status is still <em>PENDING</em>. The URL stays the
                same but the requested doc type updates.
              </li>
            </ul>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <Info20Regular />
            </span>
            <span className="text-xs text-slate-500">
              Renewal Links never require a Paneltec login for the contractor — the URL is the credential.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
