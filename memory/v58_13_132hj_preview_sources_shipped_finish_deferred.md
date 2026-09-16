# v58.13.132hj — Backend generalization: universal PDF-preview registry

**Status:** Shipped on `main`. Additive; no existing routes touched.
**Finish:** DEFERRED — user handles production verification.

## Goal

Ground-truth for the two-ship `.132hj` + `.132hk` push: make PDF
preview work on every file surface in the app, not just Doc Library.

This ship is **backend only**. It exposes a universal
`/api/preview/{source}/…` route family plus a per-source adapter
registry so the frontend ship (`.132hk`) can point one modal at any
file in the system.

## Design

Minimally invasive — the DocLib PDF pipeline stays untouched. New
code lives in one new module + three new public helpers on
`file_pdf.py`:

- `file_pdf.convert_bytes_to_pdf(blob, mime, filename, *, cache_namespace, cache_key)`
  — parallel to `_convert(doc, path)` but works on raw bytes and
  writes to a **new** cache collection `preview_pdf_cache` (keyed by
  `ns + key + sha1 + pipeline`). DocLib keeps writing to
  `doc_files_pdf_cache`; zero data migration.
- `file_pdf.pdf_response_bytes(pdf, filename, dl, pipeline)` — public
  alias for the internal `_pdf_response` (same CSP + inline headers).
- `file_pdf.preview_secret_bytes()` — public accessor for the HMAC
  secret so parallel token families can be minted.

New module `backend/preview_sources.py` contains:

- `PREVIEW_SOURCES` registry with 9 adapters:
  `doc_file`, `cert_file`, `hr_document`, `unmatched_document`,
  `equipment_document`, `schedule_attachment`,
  `submission_attachment`, `swms_source`, `insurance_cert`.
- Each adapter returns `ResolvedFile(blob, mime, filename, cache_key)`
  after re-checking the native surface's role gate.
- Its own token minter/verifier using payload key `s` (subject) so
  it can't be cross-verified against the DocLib token family (which
  uses `f` for file_id).
- `subject = sha256({"s": source, "r": ref})` binds each token to a
  specific `(source, ref)` pair — replay across refs is impossible.
- SWMS source `.docx` adapter fetches the external URL server-side
  once, then convert-cache handles subsequent hits.

Two routes registered under `/api/preview`:

- `POST /api/preview/{source}/token`
  body: `{"ref": {…adapter fields…}}` →
  `{"token": "<sig>", "expires_in": 300, "ref_b64": "<b64json>"}`
  Rehearses the adapter's auth step so a bad ref surfaces as
  403/404/415 immediately (iframe doesn't have to render broken URL).
- `GET  /api/preview/{source}/pdf?t=<token>&ref=<b64json>&dl=0|1`
  Verifies token (or Bearer header) → adapter → `convert_bytes_to_pdf`
  → `pdf_response_bytes`. Same CSP + inline-Disposition as DocLib.

## Backend changes (3 files)

- `backend/file_pdf.py` — +115 LOC appended (new public helpers +
  v2 cache lookup/store). No existing symbols renamed or removed.
- `backend/preview_sources.py` — new file, 411 LOC.
- `backend/server.py` — +6 LOC (router include).

## Verification

### Pytest — `test_v58_13_132hj_preview_sources.py` — **14/14 PASS**

```
test_module_imports_and_registry_shape           PASSED
test_server_registers_preview_router             PASSED
test_file_pdf_exposes_public_helpers             PASSED
test_stable_ref_hash_is_deterministic            PASSED
test_token_binding_rejects_wrong_subject         PASSED
test_ref_b64_decode_rejects_bad_input            PASSED
test_version_lockstep_pinned_at_132hj            PASSED
test_unknown_source_returns_400                  PASSED
test_bad_ref_shape_returns_400                   PASSED
test_missing_file_returns_404_not_500            PASSED
test_doc_file_mint_and_fetch_via_token           PASSED   ← real PDF returned
test_doc_file_bearer_only_fetch_also_works       PASSED
test_token_refuses_different_ref                 PASSED   ← subject binding
test_second_fetch_is_cached                      PASSED   ← preview_pdf_cache
```

Total runtime: **2.32 s**.

The end-to-end tests seed a real 1-page PDF on disk under
`backend/uploads/document_library/<folder>/`, insert a `doc_files`
row pointing at it, exercise the full mint→fetch→cache flow, and
tear down the fixture (`live_db_writes` marker per conftest.py).

### Live backend curl smoke

Confirmed after the supervisor restart:
```
POST /api/preview/doc_file/token       {ref:{file_id:"nope"}}  → 404
POST /api/preview/never_heard_of/token {ref:{}}                → 400
```

## Version lockstep

- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132hj`
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132hj`

## Files touched

- `backend/file_pdf.py` — additive helpers appended.
- `backend/preview_sources.py` — new (411 LOC).
- `backend/server.py` — +6 LOC router include.
- `backend/tests/test_v58_13_132hj_preview_sources.py` — new (14).
- `frontend/src/lib/version.js` — bump ×2.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bump.

## Not in this ship

- Frontend has NOT been updated yet — that's `.132hk`.
- Photo attachments (row 8 of the recon inventory) — user requested
  they keep native `<img>` rendering; adapter is available but
  frontend won't route photos through it.
- Backup snapshots / mobile APK — excluded by design.

## Rollback

Delete `backend/preview_sources.py` + the 6 LOC in `server.py` +
revert the 3 helpers appended to `file_pdf.py`. No collection
migration to undo — `preview_pdf_cache` is a fresh collection that
existed only after this ship.

## Ban compliance

- No `finish` / `testing_agent` / `e1_tester` invoked.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
