// v160.3.6t — Simpro ZIP staff import guide.
// v160.3.6u — Wired the "Upload reference image →" button to the new
// admin-only backend endpoint (POST /api/help/reference-images/upload).
// The two screenshot slots now render actual uploaded images when
// present, keep the placeholder card when empty, and give admins an
// inline "×" to revert without a code deploy.
//
// Slots:
//   simpro-employee     — Simpro Employee Profile view (screenshot 1)
//   simpro-attachments  — Simpro Attachments tab (screenshot 2, ring overlay)
//
// The pre-wired SVG red-ring + arrow overlay from v6t stays on the
// second slot — the moment a screenshot is uploaded, the ring lands
// on the top-right of the image (where Simpro renders the download-ZIP
// icon, just left of the blue CREATE FOLDER button).

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Info20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  Warning20Filled,
  ArrowDownload20Regular,
  Image20Regular,
  ArrowUpload20Regular,
  Dismiss20Regular,
} from '@fluentui/react-icons';
import api, { apiError, API_BASE } from '../../lib/api';
import { getUser } from '../../lib/auth';
import { useCan } from '../../lib/permissions';

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

/** Screenshot slot — renders the image if uploaded, otherwise the labelled
 *  placeholder + admin upload CTA. v160.3.6x — Compact thumbnail (~1/3 the
 *  previous size) that opens a lightbox on click. Overlay SVG uses
 *  `preserveAspectRatio="none"` so the red ring stays anchored to the
 *  top-right of the image at any thumbnail width. */
function ScreenshotSlot({
  slot,
  alt,
  caption,
  testid,
  overlay,
  uploaded,          // { url, uploaded_at } | null
  cacheKey,          // int — bumps ?v=... to bust <img> cache after re-upload
  isAdmin,
  onUpload,          // (file) => Promise
  onDelete,          // () => Promise
  onExpand,          // (payload) => void  · open the lightbox
  busy,
}) {
  const inputRef = useRef(null);
  const [imgErrored, setImgErrored] = useState(false);

  const openPicker = (e) => { e?.stopPropagation?.(); inputRef.current?.click(); };

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';  // allow re-selecting the same filename
    if (!file) return;
    setImgErrored(false);
    await onUpload(file);
  };

  const hasImage = Boolean(uploaded?.url) && !imgErrored;
  const src = uploaded?.url
    ? `${API_BASE}${uploaded.url.replace(/^\/api/, '')}?v=${cacheKey}`
    : null;

  const expand = () => onExpand?.({
    hasImage, src, alt, caption, overlay,
    uploadedAt: uploaded?.uploaded_at,
  });

  return (
    <figure
      data-testid={testid}
      data-uploaded={hasImage ? 'true' : 'false'}
      className="relative rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden block w-full my-3 cursor-zoom-in"
      onClick={expand}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expand(); } }}
      role="button"
      tabIndex={0}
      aria-label={hasImage ? `Expand ${alt}` : 'Expand screenshot placeholder'}
    >
      {hasImage ? (
        // v160.3.6z — Fixed reference image at full step-column width.
        // No Remove button (user decision: these are permanent onboarding
        // assets once placed). Admin can still hit the API directly to
        // swap; UI treats it as locked in.
        <div className="relative">
          <img
            src={src}
            alt={alt}
            loading="lazy"
            onError={() => setImgErrored(true)}
            data-testid={`${testid}-image`}
            className="block w-full h-auto"
          />
          {overlay}
        </div>
      ) : (
        // v160.3.6y — Clean empty state, no fake Simpro mockup styling.
        // v160.3.6z — Full-width to match the wording column; the Upload
        // button ONLY appears here (empty state), never on a placed image.
        <div
          data-testid={`${testid}-placeholder`}
          className="flex flex-col items-center justify-center gap-2 px-6 py-8 bg-slate-50 text-center border border-dashed border-slate-300 rounded-lg m-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-400">
            <Image20Regular />
          </span>
          <div className="text-xs font-semibold text-slate-600 leading-tight">
            Screenshot placeholder — admin to attach
          </div>
          <div className="text-[11px] text-slate-500 leading-snug max-w-2xl">
            {caption}
          </div>
          {isAdmin ? (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onFileChange}
                data-testid={`${testid}-file-input`}
                className="hidden"
              />
              <button
                type="button"
                onClick={openPicker}
                disabled={busy}
                data-testid={`${testid}-upload-btn`}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <ArrowUpload20Regular className="w-3.5 h-3.5" /> {busy ? 'Uploading…' : 'Upload →'}
              </button>
            </>
          ) : (
            <div className="text-[11px] text-slate-400">
              Ask an admin to attach this screenshot.
            </div>
          )}
        </div>
      )}
      {caption && hasImage && (
        <figcaption className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11px] italic text-slate-500 flex items-center justify-between gap-3">
          <span className="truncate">{caption}</span>
          {uploaded?.uploaded_at && (
            <span
              data-testid={`${testid}-uploaded-at`}
              className="text-slate-400 tabular-nums whitespace-nowrap">
              {new Date(uploaded.uploaded_at).toLocaleDateString()}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}

/** v160.3.6x — Lightbox modal. Click-to-expand for the compact ScreenshotSlot
 *  thumbnails. Supports both real-image and empty-placeholder states so
 *  QA can verify the pipeline in either case. */
function ScreenshotLightbox({ payload, onClose }) {
  useEffect(() => {
    if (!payload) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Freeze background scroll while open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [payload, onClose]);

  if (!payload) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={payload.alt || 'Screenshot preview'}
      data-testid="simpro-zip-guide-lightbox"
      onClick={onClose}
      className="fixed inset-0 z-[110] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8">
      <div
        className="relative max-w-5xl max-h-[90vh] w-full bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          data-testid="simpro-zip-guide-lightbox-close"
          aria-label="Close preview"
          className="absolute top-3 right-3 z-10 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/95 border border-slate-200 shadow text-slate-600 hover:bg-slate-50 hover:text-slate-900">
          <Dismiss20Regular />
        </button>
        {payload.hasImage ? (
          <div className="relative bg-slate-50">
            <img
              src={payload.src}
              alt={payload.alt}
              data-testid="simpro-zip-guide-lightbox-image"
              className="block w-full h-auto max-h-[85vh] object-contain"
            />
            {payload.overlay}
          </div>
        ) : (
          <div
            data-testid="simpro-zip-guide-lightbox-placeholder"
            className="flex flex-col items-center justify-center gap-3 px-8 py-16 bg-slate-50 text-center">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-white border border-dashed border-slate-300 text-slate-400">
              <Image20Regular />
            </span>
            <div className="text-base font-semibold text-slate-700">
              No screenshot uploaded yet
            </div>
            <div className="text-sm text-slate-500 max-w-lg">
              {payload.caption}
            </div>
          </div>
        )}
        {payload.caption && (
          <div className="border-t border-slate-100 bg-white px-4 py-2 text-xs italic text-slate-500 flex items-center justify-between gap-3">
            <span>{payload.caption}</span>
            {payload.uploadedAt && (
              <span className="text-slate-400 tabular-nums whitespace-nowrap">
                uploaded {new Date(payload.uploadedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
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

export default function SimproZipImportGuide() {
  const [open, setOpen] = useState(() => readStored(true));
  useEffect(() => { writeStored(open); }, [open]);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  const currentUser = getUser();
  // v160.3.9.29-2c — Migrated to integrations.edit token.
  const isAdmin = useCan()('integrations', 'edit');
  void currentUser;

  // slot -> { url, uploaded_at, size_bytes, content_type } | null
  const [slots, setSlots] = useState({
    'simpro-employee': null,
    'simpro-attachments': null,
  });
  const [cacheKey, setCacheKey] = useState(() => Date.now());
  const [busySlot, setBusySlot] = useState(null);
  // v160.3.6x — Lightbox payload for click-to-expand. Shared between
  // both ScreenshotSlot children so we only mount one modal at a time.
  const [lightbox, setLightbox] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/help/reference-images');
      const next = { 'simpro-employee': null, 'simpro-attachments': null };
      for (const row of data?.items || []) {
        next[row.slot] = row;
      }
      setSlots(next);
      setCacheKey(Date.now());
    } catch (_) {
      /* silent — the placeholders are already the correct empty state */
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleUpload = useCallback(async (slot, file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image too large (max 5 MB).');
      return;
    }
    setBusySlot(slot);
    const form = new FormData();
    form.append('slot', slot);
    form.append('file', file);
    try {
      await api.post('/help/reference-images/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Reference screenshot uploaded.');
      await refresh();
    } catch (e) {
      toast.error(apiError(e) || 'Upload failed');
    } finally {
      setBusySlot(null);
    }
  }, [refresh]);

  const handleDelete = useCallback(async (slot) => {
    setBusySlot(slot);
    try {
      await api.delete(`/help/reference-images/${slot}`);
      toast.success('Reference screenshot removed.');
      await refresh();
    } catch (e) {
      toast.error(apiError(e) || 'Remove failed');
    } finally {
      setBusySlot(null);
    }
  }, [refresh]);

  return (
    <section
      data-testid="simpro-zip-import-guide"
      data-open={open ? 'true' : 'false'}
      className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
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
          <p className="text-sm text-slate-700 max-w-3xl">
            Paneltec pulls certificates, inductions and licences straight out of Simpro via
            per-employee ZIP downloads. The download icon in Simpro is small and easy to
            miss — this guide walks a new admin through the exact clicks.
          </p>

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
              slot="simpro-employee"
              testid="simpro-zip-guide-screenshot-1"
              alt="Simpro Employee Profile view for Daniel Butler"
              caption="Screenshot 1 — Simpro Employee Profile (example worker: Daniel Butler)."
              uploaded={slots['simpro-employee']}
              cacheKey={cacheKey}
              isAdmin={isAdmin}
              busy={busySlot === 'simpro-employee'}
              onUpload={(file) => handleUpload('simpro-employee', file)}
              onDelete={() => handleDelete('simpro-employee')}
              onExpand={setLightbox}
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
              slot="simpro-attachments"
              testid="simpro-zip-guide-screenshot-2"
              alt="Simpro Attachments tab — red ring highlighting the tiny top-right download-ZIP icon"
              caption="Screenshot 2 — The red ring highlights the download-ZIP icon (top-right, just left of CREATE FOLDER)."
              uploaded={slots['simpro-attachments']}
              cacheKey={cacheKey}
              isAdmin={isAdmin}
              busy={busySlot === 'simpro-attachments'}
              onUpload={(file) => handleUpload('simpro-attachments', file)}
              onDelete={() => handleDelete('simpro-attachments')}
              onExpand={setLightbox}
              overlay={
                // v160.3.6y — Overlay recalibrated for a WIDE Simpro
                // Attachments screenshot (roughly 3-4:1 aspect). ViewBox is
                // 400×100 with preserveAspectRatio="none" so the ring +
                // arrow always sit in the top-right ~10 % of the image —
                // exactly where Simpro renders the download-ZIP icon,
                // immediately left of the blue CREATE FOLDER button.
                <svg
                  data-testid="simpro-zip-guide-arrow-overlay"
                  className="pointer-events-none absolute inset-0 w-full h-full"
                  viewBox="0 0 400 100"
                  preserveAspectRatio="none"
                  aria-hidden="true">
                  <circle
                    cx="360" cy="14" r="10"
                    fill="none" stroke="#EF4444" strokeWidth="1.6"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d="M300 45 Q335 30 352 18"
                    fill="none" stroke="#EF4444" strokeWidth="1.6"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polygon
                    points="352,18 346,23 348,15"
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

      {/* v160.3.6x — click-to-expand lightbox (rendered at section root so
          it escapes the collapsible content stacking context) */}
      <ScreenshotLightbox payload={lightbox} onClose={() => setLightbox(null)} />
    </section>
  );
}
