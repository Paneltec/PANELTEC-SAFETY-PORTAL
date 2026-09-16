# v58.13.132hl — GridFS fallback + equipment_cert adapter

**Status:** Shipped on `main`. Additive; no data migration.
**Finish:** DEFERRED — user handles production verification.

## Root cause (Stephen's SDS + Antony's cert)

Both bugs traced to the SAME class of defect: preview / file
endpoints did `path.exists()` on the local disk copy and returned
`410 file_missing_on_disk` even though the bytes were intact in
the shared `upload_storage` GridFS bucket. The DocLib
`/download` endpoint already had a GridFS fallback (from `.132gg`);
the preview + file-serve siblings had never been ported.

## Backend fixes

Three code paths now try disk first, then fall through to
`read_upload("document_library", [folder_id, stored_name])` before
returning 410:

1. `file_pdf._resolve_file` — powers `GET /api/files/{id}/pdf`.
   Signature refactored from `(doc, Path)` to `(doc, bytes)` so the
   pipeline is source-agnostic; `_convert` now takes bytes.
2. `preview_sources._resolve_doc_file` — the `.132hj` adapter used
   by both `doc_file` and `cert_file` (delegates) sources.
3. `simpro_zip_import.stream_cert_file` — the `doc_files.id` branch
   of `GET /api/workers/{wid}/certifications/{cid}/file`. This is
   the exact endpoint Antony's cert icon hit; it now falls through
   to GridFS in the same shape as the DocLib download endpoint.

## New adapter: `equipment_cert`

Added to `PREVIEW_SOURCES` (registry is now 10 adapters, was 9).
Backs the Calibration Report / service cert flow on the Equipment
Register page. Same GridFS-only storage shape as
`equipment_document`; admin-only per the native
`GET /equipment/{eid}/certs/{cid}` role gate.

## Adapter audit (all 10)

Locked-in guardrail test (`test_audit_only_doc_file_had_bug`)
asserts that every adapter using `path.exists()` also has a
GridFS branch in the same function body — so a future adapter
can't quietly reintroduce this class of bug.

| Adapter | Storage | Correct? |
|---|---|---|
| `doc_file` | disk → **GridFS fallback** (fixed .132hl) | ✓ |
| `cert_file` | GridFS (Simpro) OR delegates to `doc_file` | ✓ |
| `hr_document` | GridFS only | ✓ |
| `unmatched_document` | GridFS only | ✓ |
| `equipment_document` | `read_upload` only, 410 otherwise | ✓ |
| `equipment_cert` **(new)** | `read_upload` only, 410 otherwise | ✓ |
| `schedule_attachment` | `read_upload` → disk fallback | ✓ |
| `submission_attachment` | `read_upload` → disk fallback | ✓ |
| `swms_source` | External URL fetch | ✓ |
| `insurance_cert` | Legacy GridFS bucket | ✓ |

Also audited the sibling native `/file` endpoints
(`document_library.py`, `asset_service.py`, `forms.py`) — all
already do GridFS-first with disk fallback. Only `simpro_zip_import`'s
doc_files-branch fell through the cracks.

## Frontend swap-outs

1. `pages/Workers.jsx` — cert file icon (line 899) was still
   `window.open` even after `.132hk`; missed in the earlier sweep.
   Swapped to `<OpenAsPdfButton variant="icon" source="cert_file" />`
   with the original `filesUrl(...)+window.open` preserved as
   `onDownloadOriginal` (the 415 fallback path).
2. `pages/EquipmentRegister.jsx` — certs cell (activeCerts.map)
   now renders `<OpenAsPdfButton source="equipment_cert" />` per
   cert, with the legacy `openCert(r, c)` handler preserved as the
   `onDownloadOriginal` fallback.

## Verification — pytest (42/42 across the three ships)

Live end-to-end tests in `test_v58_13_132hl_gridfs_fallback.py`:

```
test_resolve_file_signature_returns_bytes                 PASSED
test_convert_signature_takes_bytes                        PASSED
test_preview_sources_doc_file_has_gridfs_fallback         PASSED
test_audit_only_doc_file_had_bug                          PASSED  ← guardrail
test_version_lockstep_pinned_at_132hl                     PASSED
test_files_pdf_endpoint_serves_gridfs_only_doc            PASSED  ← the SDS bug
test_preview_doc_file_endpoint_serves_gridfs_only_doc     PASSED
test_genuinely_missing_doc_still_returns_410              PASSED  ← still correct
test_admin_orphan_scan_count_unchanged                    PASSED  ← 18 stays 18
test_cert_file_endpoint_serves_gridfs_only_doc            PASSED  ← Antony's bug
test_cert_file_endpoint_via_preview_adapter_also_works    PASSED
test_workers_jsx_cert_icon_uses_open_as_pdf               PASSED
test_equipment_cert_adapter_registered                    PASSED
test_equipment_register_jsx_certs_use_open_as_pdf         PASSED
test_equipment_cert_preview_endpoint_serves_pdf           PASSED  ← Calibration Report
```

Each fixture seeds real bytes into `upload_storage` GridFS with NO
disk copy, then round-trips through the actual HTTP endpoint —
exactly the shape of Stephen's + Antony's production bugs.

Combined suite (`.132hj` + `.132hk` + `.132hl`): **42/42 in 4.82 s**.

## Live curl proof (Stephen's SDS)

```
GET /api/files/e47d27b6-.../pdf                             → 200  394632 B  %PDF-1.5  (was 410)
GET /api/files/5c7a2faa-.../pdf                             → 200  394632 B  %PDF-1.5  (was 410)
GET /api/preview/doc_file/pdf?t=…&ref=…                     → 200  394632 B  %PDF-1.5  (was 410)
```

## Version lockstep

- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132hl`
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132hl`

## Files touched (7)

- `backend/file_pdf.py` — `_resolve_file` returns bytes + GridFS
  fallback; `_convert` accepts bytes; 2 call-sites updated.
- `backend/preview_sources.py` — `_resolve_doc_file` GridFS
  fallback; new `_resolve_equipment_cert` adapter; registry +1.
- `backend/simpro_zip_import.py` — `stream_cert_file` doc_files-branch
  GridFS fallback.
- `backend/tests/test_v58_13_132hl_gridfs_fallback.py` — new (15 tests).
- `backend/tests/test_v58_13_132hj_preview_sources.py` — registry
  expected-set updated to include `equipment_cert`.
- `frontend/src/pages/Workers.jsx` — cert icon swap.
- `frontend/src/pages/EquipmentRegister.jsx` — certs cell swap.
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js`
  — version lockstep bumps.

## Ban compliance

- No `finish` / `testing_agent` / `e1_tester` invoked.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
