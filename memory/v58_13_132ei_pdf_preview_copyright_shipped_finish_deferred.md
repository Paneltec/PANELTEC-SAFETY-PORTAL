# v58.13.132ei — PDF preview UX polish + login page copyright

**Ship status**: shipped. `finish` tool deferred per standing directive.

## Item 1 — PDF preview "sad-file" root cause

### Diagnostic

Live curl against the exact file in Stephen's screenshot
(`6373ef1f167fc-ABCSDS012_Monarch_Coloured_Caulk_Acrylic_Sealant_Light_Grey_SDS_May_2019_v2.0Exp24.5.24.pdf`,
doc id `e47d27b6-d49e-4d04-95ad-c9c95301de81`):

```
HTTP/1.1 200 OK
content-type: application/pdf
content-disposition: inline; filename="6373ef1f167fc-ABCSDS012_...pdf"
x-pipeline: passthrough
x-frame-options: SAMEORIGIN
content-security-policy: frame-ancestors 'self' https://*.emergentagent.com
                          https://*.preview.emergentagent.com
cross-origin-resource-policy: same-site
size: 394,632 bytes, magic bytes = %PDF ✓
```

**Backend was fine.** Headers, disposition, CORS, CSP, magic bytes —
all correct. The specific ABCSDS012 file renders correctly.

Sweeping the collection for stubbed / truncated files revealed why
the "sad-file" screen exists at all:

```
db.doc_files.find_one({'id':'b7a2e41c-2e53-4ecb-ac64-6bd3d94b186f'})
  → filename='First_Aid_Cert.pdf', mime='application/pdf'
GET /api/files/b7a2e41c-2e53-4ecb-ac64-6bd3d94b186f/pdf
  → HTTP 415
    {"detail": "File is text (20 bytes), not a valid PDF.
     Preview unavailable — please re-upload."}
```

Root cause of the "sad-file" UX: the FE `PdfPreviewModal` on the
pdfjs branch fetched the /pdf URL with `fetch()`, threw a bare
`new Error('HTTP 415')`, flipped `pdfError=true`, and then fell
back to the legacy `<iframe src={url}>` path. That iframe ALSO
415'd and rendered whatever error page the browser produces
inline — the "sad-file" icon Stephen sees is either that or the
`iframeBlocked` fallback's `<FileWarning>` amber triangle.

Either way: no route to the underlying data, and no clear action
for the user.

### Fix

`PdfPreviewModal.jsx` on the pdfjs effect now:

1. **Reads the JSON detail from a non-2xx response** before deciding
   what to render. `if (!resp.ok)` → parse `resp.json().detail` →
   `setErr(detail)`. This surfaces the backend's helpful message
   ("File is text (20 bytes), not a valid PDF") on the modal
   instead of a bare `HTTP 415`.
2. **Error state renders a prominent "Download original file"
   button** so users get the raw upload bytes back even when the
   preview conversion can't produce a PDF.
3. **`downloadPdf` gains an error-branch** that hits
   `/api/document-library/files/{id}/download?download=1` instead
   of the failing `/api/files/{id}/pdf?dl=1`. The download endpoint
   streams the raw upload with `Content-Disposition: attachment`
   regardless of MIME.

For the happy path (Stephen's ABCSDS012 PDF, and 99% of the
library), nothing changes — pdfjs canvas render on the same
signed-token URL as `.132eh`.

## Item 2 — Login page copyright + logo

`Cover.jsx` (single sign-in surface at `/` and the target of
`LoginRedirect` from `/login`) now renders a copyright block
bottom-right of the hero column, opposite the pre-existing
`AS/NZS 4801 · ISO 45001 · Comcare ready` trust line:

```
AS/NZS 4801 · ISO 45001 · COMCARE READY              © 2026 Stephen Guy · Paneltec Civil
                                                             All rights reserved
```

Live screenshot verification (Playwright DOM read):
```
copyright block visible: 1
copyright text: "© 2026 Stephen Guy · Paneltec Civil | All rights reserved"
trust text:     "AS/NZS 4801 · ISO 45001 · COMCARE READY"
hero image visible: 1
Paneltec Civil wordmark still in top-left corner.
```

Preserved:
- `[data-testid="cover-hero-img"]` — hero image unchanged.
- `PaneltecHero` — tagline and feature chips unchanged.
- `<span class="civil-label-inverse">PANELTEC CIVIL</span>` — logo
  wordmark still renders twice (mobile compact + desktop).

## Files touched

### Backend
- (No backend changes — endpoint headers already correct.)

### Frontend
- `frontend/src/components/PdfPreviewModal.jsx`:
  - pdfjs effect parses non-2xx JSON detail into `err`.
  - Error state renders `pdf-modal-error-download` button.
  - `downloadPdf` falls back to `/document-library/files/{id}/download`
    when `err` is set.
- `frontend/src/pages/Cover.jsx`:
  - New `[data-testid="cover-copyright"]` block bottom-right of the
    hero, subtle white/55 opacity so it never distracts from the
    Sign-in card.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `.132ei`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` → `.132ei`.

### Tests
- `backend/tests/test_v58_13_132ei_pdf_preview_copyright.py` —
  **8 checks**:
  - Behavioural: `/api/files/{seed_pdf_id}/pdf` returns
    `application/pdf` + `Content-Disposition: inline` + `%PDF`
    magic bytes on a live valid file.
  - Behavioural: response emits `frame-ancestors` CSP + `same-site`
    CORP so the iframe can embed.
  - FE lock: modal `pdf-modal-error` branch renders a Download
    button (`pdf-modal-error-download`).
  - FE lock: pdfjs effect calls `setErr(detail)` on non-2xx.
  - FE lock: download fallback uses
    `/document-library/files/${file.id}/download`.
  - FE lock: Cover renders `© 2026 Stephen Guy` + `Paneltec Civil`
    + `All rights reserved` under a `cover-copyright` testid.
  - FE lock: Cover keeps hero img + `PANELTEC CIVIL` wordmark +
    `PaneltecHero` — the copyright edit didn't touch anything
    else.
  - Version pin ≥ `.132ei`.

Full `.132e*` regression: **155 passed, 43 skipped** (skips = login
rate-limit; source-pins all green).

## Live UI verification

Cover:
```
Left  hero column, bottom row:
  AS/NZS 4801 · ISO 45001 · COMCARE READY          © 2026 Stephen Guy · Paneltec Civil
                                                       All rights reserved
Top-left of hero column:  ▲ PANELTEC CIVIL  wordmark preserved.
Right column: Sign-in card unchanged.
```

PDF preview:
- Happy path (`ABCSDS012` SDS): backend returns 200 + inline PDF;
  pdfjs canvas renders normally.
- Error path (stubbed 20-byte file): backend returns 415 with a
  useful `detail`; FE now surfaces the detail on the error card
  + a blue **"Download original file"** button that fetches
  the raw upload via `/document-library/files/{id}/download`.

## Not changed
- Backend `/files/{id}/pdf` endpoint — headers, CSP, CORP, disposition
  all unchanged.
- pdfjs happy-path render — unchanged.
- Iframe fallback path (`pdfError → <iframe/>`) — unchanged.
- `iframeBlocked` watchdog and its blocked-preview UI — unchanged.
- Preview-token flow — unchanged.
- Mobile bundle: `.132di` (unchanged).
- `/app/mobile/` — untouched.
- `finish` / `testing_agent` / `e1_tester` — not invoked.

## Version state
- `frontend/src/lib/version.js` : `paneltec-v160.3.9.58.13.132ei`
- `frontend/public/service-worker.js` : `paneltec-v160.3.9.58.13.132ei`
- Mobile bundle : `.132di` (unchanged, mobile untouched)
