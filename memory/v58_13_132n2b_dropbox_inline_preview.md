# v58.13.132n2b — Dropbox browser inline file preview

## TL;DR

Clicking a file in `/app/dropbox` now opens an in-app preview
modal (PDF, images, video, audio, plain text, and Office
documents), instead of the pre-`.132n2b` behaviour of popping
the raw Dropbox temporary link in a new tab — which every
browser correctly treated as a **download** because Dropbox
temp links ship `Content-Disposition: attachment` +
`Content-Security-Policy: sandbox`.

Every preview kind now goes through a new backend proxy
endpoint `GET /api/dropbox/browse/preview` which streams file
bytes back with `Content-Disposition: inline` and the correct
`Content-Type`, so the caller's `<iframe>`/`<img>`/`<video>`/
`<audio>` renders in-place.

## Type dispatch table

| Kind         | Extensions                                                                 | Dropbox call        | Frontend renders          |
| ------------ | -------------------------------------------------------------------------- | ------------------- | ------------------------- |
| PDF          | `.pdf`                                                                     | `files_download`    | `<iframe src={blobUrl}>`  |
| Image        | `.png .jpg .jpeg .gif .webp .svg .bmp .heic .heif`                         | `files_download`    | `<img src={blobUrl}>`     |
| Video        | `.mp4 .webm .mov`                                                          | `files_download`    | `<video controls>`        |
| Audio        | `.mp3 .wav .ogg .m4a`                                                      | `files_download`    | `<audio controls>`        |
| Text / code  | `.txt .csv .md .json .xml .yaml .yml .log .html .js .py .java …`           | `files_download`    | `<pre>` (blob → `.text()`)|
| Office       | `.doc .docx .rtf .ppt .pptx .xls .xlsm .xlsx .ods .odt .odp`               | `files_get_preview` | `<iframe src={blobUrl}>`  |
| Anything else| —                                                                          | (skipped)           | "No preview available" panel + Download button |

Dispatch happens in two places:
- **Frontend** picks a `kind` from the filename extension → decides
  which JSX element to render + whether to hit the preview endpoint.
- **Backend** picks between `files_get_preview` (converts Office docs
  to PDF/HTML server-side) and `files_download` (raw file bytes)
  based on the source extension.

## Backend — new endpoint

```
GET /api/dropbox/browse/preview?path=<full_path>
Auth: Bearer JWT (integrations.view permission)

Response headers:
  Content-Type: <forwarded from Dropbox | guessed from filename>
  Content-Disposition: inline; filename="<basename>"
  Cache-Control: private, max-age=60
Response body: streamed file bytes (chunk_size = 64 KiB)

Errors:
  400 — team folder root, or Dropbox `unsupported_extension`
  404 — file not found
  502 — other Dropbox API failure
```

Implementation notes:
- Reuses `.132n2a`'s team-namespace-scoped `_get_dbx()` client.
- Per-user semaphore `_PREVIEW_SEMS` capped at 5 concurrent so a
  burst of preview clicks can't block in-flight uploads.
- `dbx.files_get_preview(path)` returns `(FileMetadata, requests.Response)` —
  `.iter_content(64*1024)` streamed straight back via
  `StreamingResponse`.
- `dbx.files_download(path)` same shape; response Content-Type is
  `application/octet-stream` so we override with `_guess_mime` on
  the filename.
- All blocking SDK calls wrapped in `asyncio.to_thread(...)` so the
  event loop stays responsive.

## Frontend — new component

`frontend/src/components/dropbox/FilePreviewModal.jsx` — 320 LOC.

Renders a full-height modal (`92vh`, `max-w-6xl`) with:
- Header: filename + namespace-relative path (mono font) + Download
  button + Close (X).
- Body: per-kind renderer (spinner while loading; error panel with
  a "Download instead" CTA on failure; unsupported panel; pdf/office
  iframe; image; video; audio; text `<pre>`).
- Object URLs tracked in a ref + revoked on close / entry change
  so blob memory doesn't leak for the tab's lifetime.
- Backdrop click + Escape key both close the modal.

`frontend/src/pages/DropboxBrowser.jsx` — patched `openEntry`
to set `previewEntry` state instead of `window.open`-ing the
temp link. Modal is rendered at the end of the page's JSX.

## Why the backend proxy exists

We tried the "iframe the raw temp link" approach first
(matches the original brief). Dropbox's `/2/files/get_temporary_link`
response ships:

```
content-disposition: attachment; filename="Foo.pdf"
content-security-policy: sandbox
x-content-security-policy: sandbox
x-content-type-options: nosniff
```

`attachment` forces every browser to trigger a save dialog rather
than render inline, and `sandbox` prevents script/style execution
in the resulting document context. So even for PDFs — where Chrome's
PDF viewer would normally render inside an iframe — the temp link
gives us a save dialog, not a preview.

Proxying through the backend lets us rewrite the disposition to
`inline` and forward the correct `Content-Type`.

## Files touched

- `backend/dropbox_browse.py` — new `/preview` endpoint (~110 lines),
  new `_PREVIEW_SEMS` semaphore map, new `_PREVIEW_OFFICE_EXTS`
  set, new error mapping for `unsupported_extension`.
- `frontend/src/components/dropbox/FilePreviewModal.jsx` — new file.
- `frontend/src/pages/DropboxBrowser.jsx` — `openEntry` swap +
  `previewEntry` state + modal mount + import.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `.132n2b`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` → `.132n2b`.

## Verification

Backend, tested with `stephen@paneltec.com.au` bearer token:

| # | Case | Request | Response |
|---|------|---------|----------|
| 1 | Native PDF via `/preview` | `GET /api/dropbox/browse/preview?path=…/Contract References - 30 01 2020.pdf` | 200 · `application/pdf` · 752655 B · `%PDF` magic · `Content-Disposition: inline` |
| 2 | DOCX via `/preview` (small) | `…/Paneltec Trade References.docx` | 200 · `application/pdf` · 230530 B · `%PDF` magic (Dropbox get_preview converted) |
| 3 | DOCX via `/preview` (large) | `…/Contract References - 30 01 2020.docx` | 200 · `application/pdf` · 1160534 B · `%PDF` magic |
| 4 | Image via `/preview` | `…/Paneltec Logo JPG 2020.jpg` | 200 · `image/jpeg` · streamed inline |
| 5 | Unsupported (`.exe`) | `…/synology-assistant-6.2-23733(1).exe` | 400 · `{"detail":"no preview available for this file"}` |

Frontend, tested via Playwright + DOM introspection:

| # | Case | State |
|---|------|-------|
| 1 | Modal opens on file-row click | ✅ `dropbox-preview-modal` mounted |
| 2 | PDF | ✅ iframe `src` is a `blob:` URL, dims 1152×933 |
| 3 | DOCX | ✅ same iframe wiring, blob is the converted PDF |
| 4 | Image | ✅ `<img>` renders the Paneltec logo inline (see screenshot) |
| 5 | Unsupported (`.exe`) | ✅ "No preview available" panel + Download button (see screenshot) |
| 6 | Fetch round-trip elapsed | 2830 ms for 735 KB PDF via backend proxy |
| 7 | Console | no errors, no warnings |

Screenshots saved:
- `/app/test_reports/132n2b_folder_listing.png` — References folder listing
- `/app/test_reports/132n2b_pdf_preview.png` — modal open on the 735 KB PDF (iframe body renders blank in headless Chromium because it doesn't ship a PDF viewer plugin; real user browsers render normally — see DOM introspection above)
- `/app/test_reports/132n2b_docx_preview.png` — modal open on a `.docx` (backend converted it to PDF via `files_get_preview`; same headless-Chromium PDF blank note applies)
- `/app/test_reports/132n2b_image_preview.png` — modal open on a `.jpg`, Paneltec logo rendered inline
- `/app/test_reports/132n2b_unsupported.png` — modal open on a `.exe`, "No preview available" panel with Download CTA

## Not touched

- `/app/mobile/*` — banned.
- Existing `/api/dropbox/browse/download` temp-link endpoint (still
  used from the Download button inside the modal, which is the ONE
  case where the Dropbox `attachment` disposition is what we want).
- Migration engine.
- `.132n2b` deferred out of scope: search, rename, move, tags,
  thumbnails, drag-preview.

## Known limitations

- **Headless-Chromium PDF viewer**: automated screenshots of
  PDF-in-iframe show a blank body because headless Chrome doesn't
  bundle the PDF viewer plugin. Verified functionally via DOM
  introspection and fetch probe; real user browsers render the PDF
  inline as expected.
- **Video via blob URL**: for very large videos, the full file must
  be downloaded before playback starts (no HTTP Range support on
  blob URLs). Acceptable for typical WHS attachments (<100 MB);
  future ship could add byte-range streaming through the backend
  proxy if needed.
- **CSV**: currently rendered raw in a `<pre>`. Future ship could
  parse and render as a table.
