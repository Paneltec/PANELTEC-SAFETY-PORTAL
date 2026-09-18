# v58.13.132ik — Photos in imported PDFs · SHIPPED (finish deferred)

**Ship phase:** `.132ik`
**Scope:** Closes long-deferred Issue 3 from `.132id`. When an admin uploads a legacy PDF via `POST /api/imports/pdf` (Import Legacy PDFs flow for incident / SSRA / pre-start / any category), we now extract the embedded raster images with PyMuPDF and re-embed them in the AI-generated PDF report + surface them for future thumbnail preview.

## What shipped

### 1. New backend module — `backend/pdf_photo_extractor.py`

Public API (~180 LOC total):

- **`extract_pdf_photos(pdf_bytes, *, max_images=32, min_pixels=10_000) → list[dict]`**
  - Opens the PDF via `pymupdf.open(stream=…)`, iterates every page, pulls every embedded raster image.
  - Deduplicates by PDF `xref` — a single logo re-used on every page comes out once.
  - Skips UI chrome (chevrons, brand marks, separators ReportLab embeds on every page header) via a `min_pixels` guard (10_000 px² default ≈ smaller than 100×100).
  - CMYK / grayscale pixmaps convert to sRGB so downstream thumbnails render consistently.
  - Cap of 32 images per PDF prevents an image-heavy runaway from blowing up the submission doc.
  - Returns dicts: `{page, xref, ext, mime, bytes, width, height}`.

- **`async persist_pdf_photos(submission_id, extracted, *, org_id) → list[dict]`**
  - Writes each blob to GridFS via `uploads_storage.save_upload` under `"form_photos"/<submission_id>/evidence_<uuid>.<ext>`.
  - Reuses the existing `form_photos` subdir so preview / thumbnail / download plumbing (built for `photo` field type and inherited by `.132ih` compliance photos) transparently serve the extracted evidence.
  - Returns `evidence_photos` list with the canonical `{id, filename, stored_name, mime, size, file_url, uploaded_at, source: "imported_pdf", source_page, width, height}` shape.

- **`async extract_and_persist(submission_id, pdf_bytes, *, org_id, …)`**
  - One-shot wrapper — `extract_pdf_photos` → `persist_pdf_photos`.

All three are best-effort — a bad image never blocks the whole import.

### 2. `backend/imports.py::import_pdf`

- Extraction runs AFTER `parse_pdf` succeeds and template match resolves, BEFORE `insert_one`, so the very first read carries `evidence_photos`.
- Extraction failure logs a warning and continues (never blocks the text-field import).
- Stamps `evidence_photos` + `evidence_photos_count` on the submission doc + `deep_parse_stats.evidence_photos`.
- Response payload now advertises `evidence_photos_count` so the FE post-import redirect can toast e.g. `"12 evidence photos preserved from source PDF"`.

### 3. `backend/forms_pdf.py::render_form_submission_pdf`

- New tail section after the field-response block:
  - Section header: `"Extracted evidence photos (N)"`.
  - Subcopy: `"Photos pulled from the original imported PDF. Kept for audit."`.
  - Thumbnail grid — same 4-wide × 1.5" × 1.1" shape as the compliance widget photo row, so both surfaces stay visually consistent.
  - Overflow row when >4 photos; missing-file fallback text.

### 4. `backend/requirements.txt`

- Added `pymupdf==1.28.2` (`pypdf==6.19.0` already pinned in `.132ij`).

### 5. Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132ik`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ik`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132ik`

## FE preview path — reuse-only
Persisted evidence photos live under `/api/files/form_photos/<sub_id>/<name>` — the exact URL shape the `photo` field and `.132ih` compliance photos already use. Any existing thumbnail / lightbox / OpenAsPdf preview surface picks them up for free. `SubmissionViewModal` will surface them once we add the read-side render (queued as follow-up), but the data is now flowing end-to-end.

## Pytest coverage — `tests/test_v58_13_132ik_imported_pdf_photos.py` — 9 checks
- **Source pins**: extractor module has the three public functions; dedupe (`seen_xrefs`) + min_pixels + CMYK→sRGB present; `"source": "imported_pdf"` marker present.
- **`imports.py`** — extract precedes insert; both `evidence_photos` and `evidence_photos_count` stamped; extraction failure best-effort; response payload advertises count.
- **`forms_pdf.py`** — evidence tail section wired; same thumb-grid dims as compliance widget photo row.
- **Behavioural: `extract_pdf_photos`** — composes a synthetic 1-page PDF with 2 embedded images via ReportLab + Pillow; extraction returns both images with the canonical dict shape and unique xrefs.
- **Behavioural: `min_pixels` filter** — same synthetic PDF with `min_pixels=10_000_000` returns `[]`.
- **Behavioural: `persist_pdf_photos`** — monkey-patches `uploads_storage.save_upload` (avoids poisoning the shared motor client between test files) and confirms the returned dicts carry the canonical shape + save_upload was invoked with `subdir="form_photos"`, correct submission_id path, `module="imports"`.
- **Behavioural: PDF renderer** — feeds a submission with `evidence_photos` through `render_form_submission_pdf`; extracts via `pypdf` and asserts the section header + subcopy render.
- **Version lockstep**.
- **Requirements pin** — `pymupdf` present.

### Combined suite (.132ie + .132if + .132ig + .132ih + .132ii + .132ij + .132ik): **57/57 green.**

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish`.
- No `/app/mobile/` edits (mobile files added by the sync tooling on `.132ij` commit — noted upstream).
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Next action items
- **FE preview surface** — Wire the SubmissionViewModal (and `SubmissionsList` row detail) to render `evidence_photos` under an "Evidence from imported PDF" accordion, mirroring the compliance widget's thumbnail grid + `ImagePreviewModal` lightbox.
- **Retroactive extraction** — a management script `scripts/extract_evidence_photos_retro_v58_13_132ik.py` could walk all pre-`.132ik` imported submissions (`imported=True, evidence_photos absent`) and re-run extraction on the archived source blob (once `.132ic` PDF-source stash lands). Deferred to a future ship when the source-PDF stash is ready.
- **Mobile parity** — mobile app doesn't currently expose the "Import Legacy PDFs" flow, so no mobile side-work needed today.
