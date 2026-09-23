# v58.13.132lc — Persist NODE_OPTIONS + swap heavy doc tools for lightweight libs

Shipped: 2026-09-23
Scope: backend (file_pdf.py, text_extraction.py, swms_phase45.py, bulk_import_prestarts.py, document_library.py, server.py) + frontend config (package.json, .env) + version bumps
Author: agent
Preview URL = production URL (`whs-compliance.preview.emergentagent.com`) — treated all conversions as production-critical.

---

## Emergent support context (verbatim intent)

> Root cause of the 5–8 min pod restart cycle was a document-tool
> reinstall firing on every restart (LibreOffice / Poppler / Tesseract
> getting reinstalled), plus a fixed shared-CPU allowance being maxed
> by web + mobile preview running together. We've paused the reinstall
> and tuned memory ceilings on our side → pod is stable now.
>
> Two persistent fixes we want on YOUR side to keep it stable across
> environment rebuilds:
>  1. Persist NODE_OPTIONS in more than one place.
>  2. Replace LibreOffice/Poppler-based document conversion with the
>     lightweight libraries already installed: python-docx + reportlab
>     for .docx, openpyxl for .xlsx, pymupdf in place of every
>     pdftoppm/pdftotext call. Keep Tesseract for OCR but lazy-load it.

## Frontend heap persistence — three layers

| Layer | File | Change |
|-------|------|--------|
| 1 | `frontend/package.json` | `start` / `build` / `test` scripts prefixed with `NODE_OPTIONS=--max-old-space-size=4096` |
| 2 | `frontend/.env` | Appended `NODE_OPTIONS=--max-old-space-size=4096` |
| 3 | `supervisord.conf` | Retained `.132kz` `environment=…NODE_OPTIONS="--max-old-space-size=4096"` on `[program:frontend]` |

**Verification** (`.132lc` grep sweep):

```
=== Layer 1: package.json ===
    "start": "node scripts/prestart-hygiene.js && NODE_OPTIONS=--max-old-space-size=4096 craco start",
    "build": "NODE_OPTIONS=--max-old-space-size=4096 craco build",
    "test": "NODE_OPTIONS=--max-old-space-size=4096 craco test",
=== Layer 2: frontend/.env ===
NODE_OPTIONS=--max-old-space-size=4096
=== Layer 3: supervisord.conf ===
environment=HOST="0.0.0.0",PORT="3000",NODE_OPTIONS="--max-old-space-size=4096",
```

## Backend doc-tool audit — call sites removed

| File | Before                                      | After                                        |
|------|---------------------------------------------|----------------------------------------------|
| `file_pdf.py::_docx_to_pdf` | LibreOffice `soffice --headless` → docx2pdf → python-docx text fallback | python-docx paragraph/table walk → reportlab (never blank) |
| `file_pdf.py::_office_to_pdf_or_415` | LibreOffice `soffice --headless` for .xlsx / .pptx / .odt / .rtf | .xlsx → new `_xlsx_to_pdf` (openpyxl → reportlab.Table landscape A4). Others → 415 "download original" |
| `file_pdf.py::ocr_pdf_to_text` | `pdftotext` → `pdftoppm` → `tesseract` subprocess chain | pymupdf `page.get_text()` → pymupdf `page.get_pixmap()` → pytesseract-lazy |
| `file_pdf.py::_libreoffice_binary` + `_libreoffice_to_pdf` + `_office_to_pdf_via_lo` | subprocess wrappers | **removed** |
| `file_pdf.py::_run_apt_install` + `ensure_server_tools_or_install_bg` | bg apt-get install for LO/tesseract/poppler | `_run_apt_install` **removed**; `ensure_server_tools_or_install_bg` downgraded to probe-only shim |
| `file_pdf.py::POST /admin/install-libreoffice` | 202 Accepted + kick off apt bg install | **410 Gone** with hint pointing at the new lightweight pipeline |
| `file_pdf.py::GET /admin/system-tools` + `/admin/server-tools/health` | reported `soffice` / `tesseract` / `pdftotext` binary status | Legacy keys retained for FE compat; now report python-docx / openpyxl / pymupdf / reportlab status. `libreoffice` key maps to python-docx replacement (ok:true); `poppler` key maps to pymupdf (ok:true) |
| `text_extraction.py::_extract_pdf_ocr` | `pdf2image.convert_from_bytes` (Poppler subprocess) → pytesseract | pymupdf `page.get_pixmap` → pytesseract-lazy; empty return + `status: failed` when Tesseract missing |
| `text_extraction.py::_extract_image` | direct pytesseract | pytesseract with `_ensure_tesseract()` guard |
| `swms_phase45.py::_ocr_image` | `subprocess.run(["tesseract", …])` | pytesseract with lazy binary check |
| `swms_phase45.py::_count_pdf_pages` | `subprocess.run(["pdfinfo", …])` | pymupdf `doc.page_count` |
| `bulk_import_prestarts.py::_pdf_pages_png_b64` | `subprocess.run(["pdftoppm", …])` | pymupdf `page.get_pixmap(matrix=fitz.Matrix(110/72, 110/72))` |
| `document_library.py` AI-retry rasterisation | PDFs via `pdf2image`, everything else via `libreoffice --convert-to pdf` subprocess | PDFs + xlsx + docx all via pymupdf + `file_pdf._docx_to_pdf` / `_xlsx_to_pdf` |
| `server.py::health` | Probed `soffice` / `tesseract` / `pdftotext`; each added to `degraded` when missing | Probes only `tesseract` (soft dep). LibreOffice + Poppler removed from `checks` and `degraded` |

**Diff stat:**

```
backend/bulk_import_prestarts.py |  54 +--
backend/document_library.py      |  67 ++--
backend/file_pdf.py              | 763 +++++++++++++++++++--------------------
backend/server.py                |  22 +-
backend/swms_phase45.py          |  32 +-
backend/text_extraction.py       |  49 ++-
6 files changed, 511 insertions(+), 476 deletions(-)
```

**Zero subprocess.run() calls to `libreoffice` / `soffice` / `pdftoppm` /
`pdftotext` / `pdfinfo` remain** in `backend/*.py` (excluding
`scripts/` — legacy migration scripts still shell out, but they're not
in the request path).

## Tesseract lazy-load contract

**`_ensure_tesseract()`** — in `file_pdf.py`, `text_extraction.py`,
`swms_phase45.py`. Returns `bool(shutil.which("tesseract"))`. Never
attempts to install.

**Caller contract**: when it returns False, callers must return an
empty string / `{status: failed, engine: tesseract, chars: 0}` /
`ocr_available: false`-style payload rather than crashing. Verified
in the smoke test — a scanned PDF (no text layer) run through
`text_extraction.extract_text` on this pod (Tesseract not installed)
returns `{status: failed, engine: tesseract}` cleanly.

**Deliberately** not attempting on-demand `apt-get install` under an
idle-check. Per Emergent's guidance, we do NOT want the pod to
apt-install anything at runtime — that's what caused the SIGTERM
cycle. If we later want on-demand OCR for scanned PDFs, we'll bake
Tesseract into the pod's base image via Emergent's image-config path,
not shell it in from the request handler.

## Startup hygiene

- `server.py::on_startup` — confirmed the `ensure_server_tools_or_install_bg`
  call is still commented out (was disabled under ticket #261441).
  The function itself is retained but downgraded to a probe-only
  shim so any older caller that re-enables it gets `action=noop`.
- No other `apt-get`, `dpkg`, or `subprocess` shellout in any
  `on_startup` hook.

## Live verification

**Smoke test artifact** (`/app/backend/scripts/smoke_v58_13_132lc_lightweight_doc_conversion.py`):

```json
{
  "docx_to_pdf": {
    "label": "docx_python",
    "bytes": 1868,
    "valid": true
  },
  "xlsx_to_pdf": {
    "bytes": 3312,
    "valid": true,
    "sheet_titles_found": true
  },
  "pdf_text_extract": {
    "chars": 103,
    "found_content": true
  },
  "pdf_ocr_lazy_degradation": {
    "returned_empty_no_crash": true
  },
  "text_extraction_pdf_scanned": {
    "status": "failed",
    "engine": "tesseract"
  }
}
```

All 5 checks pass: real .docx and .xlsx produce valid multi-page
PDFs, text-layer PDF extract sub-second via pymupdf, scanned PDF
with missing Tesseract degrades gracefully to empty string / `failed`
without crashing.

**`GET /api/health`** (external ingress, unauthenticated):

```json
{
  "ok": true,
  "checks": {
    "mongo": {"ok": true, "ms": 0},
    "gridfs": {"ok": true},
    "disk": {"ok": true, "free_gb": 73.7, ...},
    "disk_app": {"ok": true, "free_pct": 26.0, ...},
    "tesseract": {"ok": false, "reason": "tesseract not on PATH (OCR fallback disabled)"},
    "backup_lock": {"ok": true, ...}
  },
  "degraded": ["tesseract", "backup_lock_reclaims_seen"]
}
```

`libreoffice` and `poppler` keys are **absent** from both `checks`
and `degraded` — the goal of the ship.

**`GET /api/admin/server-tools/health`** (admin auth):

Legacy `libreoffice` key → `{ok: true, version: "1.2.0", path: "python-docx (in-process)"}`.
Legacy `poppler` key → `{ok: true, version: "1.28.2", path: "pymupdf (in-process)"}`.
New `libs` map surfaces the full pure-Python toolchain (python-docx,
openpyxl, pymupdf, reportlab, tesseract).

**`GET /api/dropbox/health`** — `.132lb` unaffected. `connected: true`,
`phase: 0-audit`.

## Follow-ups for you (Stephen)

1. **Regression sweep on the preview URL** (which is also production):
   - Open a Document Library `.docx` preview → confirm PDF renders.
   - Open a Document Library `.xlsx` preview → confirm each sheet
     appears as a labelled table.
   - Preview a PDF that's known to be scanned/image-only → expect a
     "OCR unavailable, no text layer" experience (empty search text,
     no crash). If you want scanned-PDF search to work in prod,
     that's a separate ship to bake Tesseract into the pod image.
3. **Bulk-import PDF pipeline** (from `.132kh`) — still works, but the
   rasterisation now goes through pymupdf. If the extract quality
   drops on any specific PDF, ping me — pymupdf DPI is dialled to
   110 (same as the prior pdftoppm invocation) but different
   rasterisers can render antialiased text slightly differently.
4. **Dropbox `.132lb`** — still blocked on you granting
   `files.metadata.read` scope in the App Console + regenerating
   the token. Not affected by this ship.

## Files touched

```
backend/file_pdf.py                                    (major rewrite)
backend/text_extraction.py                             (lazy tesseract guard + pymupdf OCR)
backend/swms_phase45.py                                (pytesseract + pymupdf)
backend/bulk_import_prestarts.py                       (pymupdf rasterisation)
backend/document_library.py                            (AI-retry via lightweight libs)
backend/server.py                                      (health drops libreoffice/poppler)
backend/scripts/smoke_v58_13_132lc_lightweight_doc_conversion.py  (new — smoke test)
frontend/package.json                                  (NODE_OPTIONS in scripts)
frontend/.env                                          (NODE_OPTIONS env var)
frontend/src/lib/version.js                            (.132lb → .132lc)
frontend/public/service-worker.js                      (.132lb → .132lc)
memory/v58_13_132lc_lightweight_doc_conversion.md      (this memo)
```

## NOT changed

- `/app/mobile/` — untouched (edit ban).
- `MOBILE_BUNDLE_VERSION` — unchanged.
- Dropbox `.132lb` work — untouched.
- Bulk-import PDF matching pipeline logic (`.132kh`) — untouched;
  only the underlying rasterisation swapped.
- Form template rendering — untouched.
- Any auth surface — untouched.
- `supervisord.conf` — retained the `.132kz` NODE_OPTIONS setting;
  no change to the entrypoint script.
