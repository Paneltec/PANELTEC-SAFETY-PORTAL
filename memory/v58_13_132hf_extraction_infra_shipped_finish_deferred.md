# v58.13.132hf — Text-extraction infra + backfill — SHIPPED

## What shipped
Extracts text from every doc_files upload and back-fills the existing library so `.132hg` can add content-search. Text-native engines (pdfplumber / python-docx / openpyxl / plain) with Tesseract fallback for scanned PDFs and image files. On-pod, $0.

## Behaviour
- **On upload**: `POST /folders/{id}/files` fires `_extract_and_persist` as an asyncio background task using the buffer already in memory. Upload response is never blocked. Failures increment `extraction_failed_count` for the admin backfill to retry later.
- **Backfill**:
  - `POST /admin/backfill-extracted-text?scope_org=true|false` — admin-only, idempotent (returns current state if a run is in progress).
  - `GET /admin/backfill-extracted-text/status` — live progress: running / total / done / ok / failed / engines / current_id.
  - `POST /admin/backfill-extracted-text/cancel` — sets a flag; the loop stops after the current row.
- **Boot trigger**: server startup schedules the org-wide backfill 5 minutes after boot so the app is responsive first.
- **Mongo text index**: `doc_files_fulltext` on `filename` (weight 10) + `ai_tags` (5) + `extracted_text` (1), created idempotently at boot.
- **Schema additions on doc_files**: `extracted_text`, `extracted_text_at`, `extraction_engine`, `extraction_status` (`ok` / `failed`), `extracted_chars`, `extraction_failed_count`.
- **Safety caps**: 200k char cap per file, 40-page OCR cap. Extraction never raises — always returns status. All CPU-bound extractions dispatch through `asyncio.to_thread` so they don't block the event loop.

## Files touched
- `backend/text_extraction.py` (new, 220 lines): mime dispatch, per-engine functions, hard caps.
- `backend/document_library.py`: `_extract_and_persist`, `_load_binary_for_file`, `_run_backfill`, three admin endpoints, `schedule_boot_backfill`, upload-hook.
- `backend/server.py`: startup hook — creates text index + schedules backfill.
- `backend/requirements.txt`: pdfplumber, pdfminer.six, pdf2image, pypdfium2, pytesseract (Tesseract binary + poppler-utils already on pod).
- `frontend/src/lib/version.js` + service-worker: `.132he` → `.132hf`.

## Verification
- `backend/tests/test_v58_13_132hf_extraction_infra.py`: 14 pytests green — module dispatch for all 5 mime families, MAX_EXTRACTED_CHARS cap, upload-hook wiring, admin-only gates, schema fields, boot hook + text index, version lockstep.
- Live backfill against Stephen's org completed successfully (see ship notes for samples + engine distribution).

## `.132hg` prerequisites
- `extracted_text` populated on 100% of extractable rows ✓ (18 orphans surface as `missing-binary` engine + `failed` status — Stephen handles via existing `.132hd` modal).
- Mongo text index built at boot ✓.
- Ready for FE search-panel extension.
