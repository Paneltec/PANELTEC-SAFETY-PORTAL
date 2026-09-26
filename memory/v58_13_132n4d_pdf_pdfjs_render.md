# v58.13.132n4d — Dropbox preview: PDF.js canvas rendering

## TL;DR

Emergency PDF-preview reliability fix.  Ships a full rewrite of
`FilePreviewModal.jsx` that swaps the browser's built-in PDF
plugin for **Mozilla PDF.js** via `react-pdf`.

The `<iframe>` (`.132n2b`) and `<object>` (`.132n4c`) approaches
both delegate PDF rendering to the browser's native viewer
plugin.  That plugin refuses to activate in two contexts the
user actually hits every day:

- **Nested iframes** — the Emergent preview shell renders the
  whole app inside an outer iframe.  Chromium's PDF viewer
  won't paint a PDF that's two iframe layers deep from the
  user's viewport.  The user sees the `<object>` child
  fallback ("PDF preview isn't supported by this browser") on
  perfectly-valid PDFs.
- **Firefox with certain PDF handling prefs** and **some
  hardened Chrome enterprise policies** — same root cause; the
  browser refuses to instantiate the plugin.

**PDF.js** is a pure-JavaScript re-implementation of the PDF
spec.  It runs entirely in the client's JS engine + a Web
Worker; no browser plugin involved.  This makes preview work in
**every** context that runs JavaScript.

## What changed

### Frontend

- **New deps**: `react-pdf@7.7.3` + `pdfjs-dist@3.11.174` via
  `yarn add`.  Pinned to the 7.x / 3.x line because CRA's
  webpack can't resolve the ESM-only `.mjs` builds shipped by
  `react-pdf@11` / `pdfjs-dist@6`.  When we eventually migrate
  to Vite this pin can bump.
- **`components/dropbox/FilePreviewModal.jsx`** — full rewrite.
  Native PDFs and office-converted PDFs both flow through
  `<Document file={blob} ...>` from `react-pdf`.  The
  `<Document>`'s `onLoadSuccess({numPages})` populates a
  scrollable column of `<Page pageNumber={n} width={W} />`
  entries; a resize-observer keeps `W` in sync with the modal
  width so pages render sharp.  An `IntersectionObserver`
  tracks which page is most-visible so the sticky footer's
  "Page N of M" indicator stays honest, and prev/next buttons
  `scrollIntoView` the neighbouring page.  All error and
  size-guard behaviour from `.132n4c` is preserved verbatim.
- **PDF.js Web Worker** — served from unpkg CDN pinned to
  `pdfjs.version` (bundled by react-pdf) so main-thread + worker
  never drift.  Loaded once at module import via
  `pdfjs.GlobalWorkerOptions.workerSrc = …`.
- **Blob MIME normalisation** — axios sometimes returns
  `application/octet-stream` blobs even when the response header
  was `application/pdf`.  We re-wrap into
  `new Blob([blob], {type: 'application/pdf'})` so PDF.js's
  internal fetch (which trusts the Blob's `type`) doesn't trip.

### Preserved from `.132n4c`

- 50 MB size guard (backend 413 + FE early-skip)
- Retry-once on 5xx / network with 1 s backoff
- `errorInfo` state with distinct per-kind panels
  (`too_big` / `unsupported` / `not_found` / `generic`) and a
  Download CTA
- Office types (`.docx`, `.xlsx`, `.pptx`, `.doc`, …) still ride
  through Dropbox `get_preview` server-side; the resulting PDF
  bytes are now rendered by PDF.js exactly like a native PDF
- Image / video / audio / text preview paths unchanged

## Backend

**Zero changes.**  The `/api/dropbox/browse/preview` endpoint
still returns `application/pdf` + inline disposition + streamed
bytes.  All the client-side work.

## Verified

Three screenshots in `test_reports/`:

1. **`132n4d_pdf_pdfjs_native.jpeg`** — the exact file from the
   user's broken report:
   `/Stormy's folder/Cooke & Dowsett Rosetta Plumbing/LST Airport/Plans & markups/J212020CL-HYDRAULIC-A.pdf`
   Page 1 rendered fully — Launceston Airport Hydraulic
   Services engineering drawing with all notes, symbols, and
   the drawing-list block visible.  Footer reads "Page 2 of 5"
   (IntersectionObserver saw page 2 during scroll).
2. **`132n4d_pdf_pdfjs_docx_converted.jpeg`** — the office →
   PDF flow:  `/Customers/TasWater/PROJECTS - TASWATER/2022/
   TASWTR-1002436 - Kindred Rd Water Main/Methodology- Old
   Kindred Road.docx`  Dropbox converted the docx to PDF; PDF.js
   rendered it inline with the full Paneltec letterhead,
   document title, "Methodology" heading, and the numbered
   pre-installation list.  Footer reads "Page 1 of 1".
3. **`132n4d_pdf_multi_page_scroll.jpeg`** — after clicking Next
   twice from Page 2 on the same hydraulic PDF, the view jumps
   to **Page 4 of 5** showing the roof-plan drawing with rain-
   water calculations and gutter/downpipe details.  Confirms
   prev/next controls + IntersectionObserver-driven page label
   are both working.

## Bundle size

`pdfjs-dist@3.11.174` adds ~1 MB gzipped to the client bundle.
Acceptable trade-off for reliability that no browser-plugin
approach can match.

## Deferred

- Text-layer + annotation-layer are disabled
  (`renderTextLayer={false}`, `renderAnnotationLayer={false}`).
  Enabling them adds search + hyperlink support inside the PDF
  but doubles render CPU per page.  Ship as a `.n4e` opt-in
  toggle if users ask.
- No zoom controls yet.  Pages render at the container width,
  which is fine for reading but not for detail work on
  engineering drawings.  Add zoom + fit-to-page in a follow-up
  if the hydraulic-drawing users need it.
- react-pdf 11 / pdfjs 6 migration is blocked by CRA's webpack
  `.mjs` resolution.  Track for after a Vite migration.
