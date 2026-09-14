# v58.13.132gi — Object-storage migration wave 4 (PDF renderer + exports) · SHIPPED

## Migration table

| Module | Before | After |
|--------|--------|-------|
| `backend/pdf_renderer.py::persist_pdf` | sync, wrote to `uploads/pdfs/<slug>.pdf` | async, `save_upload("pdfs", [filename], data)` — one caller path (`email_outbox._pdf_attachment_for`) updated to `await`. |
| `backend/exports.py` primary artefact write (JSON/CSV-zip/PDF) | `path.write_bytes(payload)` | `await save_upload("exports", [filename], payload)` with mime pinned per format. |
| `backend/exports.py` auto-sibling PDF write | `(UPLOAD_DIR / pdf_filename).write_bytes(pdf_bytes)` | `await save_upload("exports", [pdf_filename], pdf_bytes)`. |
| `backend/exports.py` on-demand render-pdf-sibling | `(UPLOAD_DIR / pdf_filename).write_bytes(pdf_bytes)` | `await save_upload("exports", [pdf_filename], pdf_bytes)`. |
| `backend/dashboard.py` `serve_pdf` / `serve_export` | sync `_serve()` | `await _serve_async()` — GridFS-first with disk fallback. |
| `scripts/migrate_ephemeral_to_gridfs.py` | 8 subdirs | 10 subdirs (`pdfs`, `exports` added). |

## Curl evidence — audit-pack round-trip

```
POST /api/audit-exports  (format=json)
{
  "file_url": "/api/files/exports/742154d0-…-ce74776b456f.json",
  "pdf_sibling": { "file_url": "/api/files/exports/f0c27bff-…-99afde5ca2ef.pdf" }
}

GET primary   → HTTP 200 · application/json · 365 bytes
GET sibling   → HTTP 200 · application/pdf  · 38542 bytes
```

Migration sweep after the ship:

```
[migrate] stats: {'scanned': 763, 'already_in_gridfs': 743,
                   'migrated': 20, 'missing': 0, 'errors': 0}
```

Pre-existing `uploads/exports/` artefacts (20 audit packs) hoisted
into GridFS. `uploads/pdfs/` was empty (`persist_pdf` is only fired
by `email_outbox._pdf_attachment_for` and that flow hadn't been
exercised on this pod).

## Pytest

```
$ pytest backend/tests/test_v58_13_132gi_pdf_and_exports.py
6 passed
```

Coverage:
1. `persist_pdf` is async + GridFS-backed + no `path.write_bytes(data)`.
2. `exports.py` has 3 `_save_export("exports", …)` sites + no `UPLOAD_DIR / ...write_bytes`.
3. `dashboard.py` serves both `pdfs` and `exports` via `_serve_async`.
4. Migration script sweep list includes `pdfs` + `exports`.
5. Behavioural — post audit-export, both primary and sibling artefacts serve 200.
6. Version lockstep to `paneltec-v160.3.9.58.13.132gi`.

## Deferred / documented exceptions

`file_pdf.py`, `forms_pdf.py`, `fleet_service_sheet_pdf.py` all use
short-lived `tempfile.TemporaryDirectory()` for LibreOffice
conversion input/output. Those are the documented `.132gi`
exception: bytes never persist across a request (the `with` block
cleans them up), so they are NOT ephemeral upload storage.

`file_pdf.py:552` writes to `/tmp/ocr_idx_<id>.pdf` for a background
OCR indexer; the file lives only long enough for the async task to
read it (a few seconds) and is not lint-flagged. Left as-is with a
follow-up note in the backlog.

## Standing rules honoured

* No `testing_agent`, no `e1_tester`, no `finish`.
* `/app/mobile/` untouched.
* CRA — no Vite.
* Version bump → `paneltec-v160.3.9.58.13.132gi`.
* Commit: rolled into the combined `.132gh..gj` auto-roll commit.
