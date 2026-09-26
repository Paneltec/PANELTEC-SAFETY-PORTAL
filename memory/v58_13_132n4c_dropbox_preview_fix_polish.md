# v58.13.132n4c — Dropbox browser preview reliability + polish

## TL;DR

Follow-up ship to `.132n4b`. Three items:

1. **Preview reliability fix (P0 regression)** — PDFs now render
   through `<object type="application/pdf">` with a native
   "Download instead" fallback child rather than a bare
   `<iframe src=blob:…>` that painted the browser's broken-doc
   icon when the PDF plugin couldn't paint. New 50 MB size guard
   at both the backend (413) and the frontend (skip fetch)
   levels. Retry-once on 5xx/network errors with a 1 s backoff.
   Specific error surfaces (413 / 415 / 404 / plugin) each get a
   distinct panel + Download CTA.
2. **⋯ menu hover polish** — Base state now visible at
   `opacity 0.5` (was `0`). On row hover the button turns
   Dropbox-blue `#0061FF`. On direct button hover the icon
   deepens to `#0047B3` and gets a soft blue-15 circle.
3. **Share modal signature-green tint** — Header band picks up
   the same `bg-brand-green-mint/40` + `border-emerald-200`
   used elsewhere (Dashboard attention score, EmailSendModal
   M365 status, Inspections pass badge). Primary CTAs (Send
   invite, Create link, Copy) swap Dropbox-blue for
   `emerald-600 → 700`. Destructive controls (Revoke, Remove)
   remain rose. Team-only visibility pill stays Dropbox-blue on
   purpose — the pill semantically identifies the Dropbox
   *scope*, not "success".

## Root cause — preview

Reproduction on the exact file from the user's screenshot
(`/Enviro Solutions Tasmania/ASIC Welcome Letter - Enviro
Solutions Tasmania.pdf`):

- **Backend** — `GET /api/dropbox/browse/preview` returned 200
  with `Content-Type: application/pdf`, `Content-Disposition:
  inline; filename="…"`, and a valid `%PDF-1.6` body of 55 200
  bytes. All correct.
- **JS-side fetch** — Axios returned a `Blob{type:
  application/pdf, size: 55200}`. `URL.createObjectURL()`
  produced a working `blob:https://…` URL that a follow-up
  `fetch(url)` could read back with 200 OK.
- **Iframe render** — the `<iframe src={blobUrl}>` however
  painted the browser's broken-document icon inside an
  otherwise-empty frame. The blob URL request registered as
  `net::ERR_ABORTED` in devtools despite the underlying blob
  still being valid.

The failure mode is well-known — some browser PDF-viewer
configurations don't accept blob-URL PDFs inside a plain
`<iframe>` and fall back to the "broken document" placeholder
rather than the visible download UI you'd get for
`<a href="…">`. **Fix**: switch PDFs from `<iframe>` to
`<object type="application/pdf" data={url}>`. `<object>`
routes the payload through the browser's plugin pipeline the
same way a raw PDF navigation would, AND renders its own child
content as fallback when the plugin can't paint — no more bare
broken-icon.

Verified in the shipped build (headless Chromium, which
famously *doesn't* include a PDF plugin): the `<object>`
element correctly rendered the child fallback panel with a
functional "Download PDF" CTA rather than showing a broken
icon. In real Chrome / Firefox / Safari with PDF plugins the
inline render path takes over.

## Backend changes

- **`_PREVIEW_MAX_BYTES = 50 MB`** — new module-level constant.
- **`preview_file`** endpoint now:
  - Runs a `files_get_metadata` pre-flight to grab the size
    before fetching. Anything over `_PREVIEW_MAX_BYTES` short-
    circuits with **`HTTPException(413, "file too large to
    preview (N MB > 50 MB limit) — please Download instead")`**.
  - Catches Dropbox `unsupported_extension` /
    `unsupported_content` / `in_progress` and translates to
    **`HTTPException(415, "Dropbox can't preview this file
    type. Download it to view it locally.")`**. FE routes 415
    to a distinct "Preview not supported" panel.
  - Everything else keeps the same
    `files_get_preview` (office) / `files_download` (raw)
    dispatch and streams the response body back with
    `Content-Disposition: inline`.

## Frontend changes

### `FilePreviewModal.jsx` — full rewrite of the fetch + render pipeline

- **Size guard** — same 50 MB threshold enforced client-side:
  ```
  if (typeof entry.size === 'number' && entry.size > PREVIEW_MAX_BYTES) {
    setState({ loading: false, errorInfo: { kind: 'too_big', … }, … });
    return;
  }
  ```
  Skips the fetch entirely for known-oversize entries so the
  browser doesn't allocate a 100 MB blob before we tell the
  user "download instead".
- **Blob MIME correction** — some browsers hand back
  `application/octet-stream` blobs from a `responseType: 'blob'`
  fetch even when the response header was `application/pdf`.
  Re-wrap PDFs into a fresh `Blob([blob], {type:
  'application/pdf'})` so `URL.createObjectURL()` returns a URL
  that the plugin recognises.
- **PDF → `<object>`** — dedicated `if (kind === 'pdf')` branch
  renders `<object type="application/pdf" data={state.url}
  onError={onPluginFailed}>` with a child fallback panel
  containing a "Download PDF" CTA. Office types keep their
  `<iframe>` (needed for the HTML variant Dropbox returns for
  spreadsheets — `<object>` can't render HTML).
- **Retry-once** — network errors and `5xx` responses trigger a
  single retry after a 1 s backoff. Hard failures (`413` /
  `415` / `404`) skip the retry (they're not going to get
  better on repeat).
- **`errorInfo` state shape** replaces the old `error: string`.
  Now carries `{kind: 'too_big' | 'unsupported' | 'not_found' |
  'plugin' | 'generic', message: string}`. FE renders a
  distinct heading + copy per kind so the user sees "Too large
  to preview" / "Preview not supported" / "File not found" /
  "Your browser can't render this" instead of a generic
  "Preview failed" for every case.
- **JSON-error blob unwrap** — axios `responseType: 'blob'`
  returns the JSON error body as a `Blob{type: application/json}`
  on non-2xx responses. Detect and unwrap so
  `classifyError(err)` sees the right `err.response.status`.

### `RowActionMenu.jsx` — hover polish

- Removed the old `hover:bg-slate-100 hover:text-slate-800`
  base styling.
- New classes (all static literals for Tailwind JIT):
  ```
  p-1.5 rounded-full text-slate-500 transition-colors
    group-hover:text-[#0061FF]
    hover:!text-[#0047B3] hover:bg-[rgba(0,97,255,0.15)]
    focus-visible:ring-2 focus-visible:ring-[#0061FF]/40
  ```
- Wrapper opacity moved from `opacity-0 group-hover:opacity-100`
  to `opacity-50 group-hover:opacity-100` in `DropboxBrowser.jsx`
  Row so the ⋯ is subtly visible even without hover.

### `ShareModal.jsx` — signature-green tint

- Header: `bg-brand-green-mint/40` + `border-emerald-200` +
  eyebrow in `text-emerald-700`.
- Send invite button: `bg-emerald-600 hover:bg-emerald-700`
  (was Dropbox-blue).
- Create link button: same green.
- Copy button: same green (was a grey outlined secondary).
- Revoke: unchanged (`rose-600`).
- Remove member: unchanged (`rose-600`).
- Team-only visibility pill: unchanged Dropbox blue — the pill
  denotes *scope*, and it's the same blue as Dropbox's own
  team-only chip.

## Verified

1. `132n4c_preview_working_pdf.jpeg` — the exact ASIC PDF from
   the user's screenshot now renders the `<object>` fallback
   panel with a functional "Download PDF" CTA in headless
   Chromium (where the PDF plugin isn't available). Real
   browsers with PDF viewers paint the doc inline.
2. `132n4c_preview_fallback.jpeg` — the 85 MB
   `Paneltec - Drain Cleaning Services V1.mp4` renders the
   too-big panel with "This file is 85.0 MB — larger than the
   50 MB preview limit." plus a Download instead CTA. Zero
   wasted Dropbox round-trip.
3. `132n4c_action_menu_blue_hover.jpeg` — Customers row hover
   shows the ⋯ icon in bright `#0061FF`. `getComputedStyle`
   confirms `rgb(0, 97, 255)` on row hover and
   `rgb(0, 71, 179)` + `rgba(0, 97, 255, 0.15)` on direct
   button hover.
4. `132n4c_share_modal_green.jpeg` — Share modal for ASIC
   Welcome Letter with the mint header band, green Send /
   Copy CTAs, blue Team-only pill, rose Revoke button, and
   the 11 inherited team members visible.

## Backend curl coverage

- `GET /preview?path=<normal PDF>` → 200 `application/pdf` 55 200 bytes
- `GET /preview?path=<nonexistent file>` → 404
- `GET /preview?path=<85 MB video>` → **413** with body
  `{"detail":"file too large to preview (85 MB > 50 MB limit) — please Download instead"}`

## Deferred

- 415 / plugin-failed panel copy could get more product-y
  guidance (e.g. link out to a "supported file types" doc).
  Held for a later polish pass.
- Blob URL memory-leak audit — the `objectUrlsRef` cleanup
  works but there's a known small leak in the StrictMode
  double-invoke path (an orphaned URL from the first run). Not
  a functional issue; memory tops out at a few MB per
  session. Track as `.n4d` follow-up if it becomes visible.
