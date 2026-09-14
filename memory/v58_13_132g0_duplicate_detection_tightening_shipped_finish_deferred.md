# v58.13.132g0 — Duplicate detection tightening · SHIPPED (finish deferred)

## Scope
Replace the `filename OR sha256` dedupe check on
`POST /api/imports/pdf` with a proper content fingerprint:
`sha256(all) AND size AND sha256(first 512 bytes)`. Filename plays
no role in the new dedupe query — an admin can rename a genuinely
new PDF and it lands as a new row; a duplicate content upload is
still caught 100% of the time regardless of filename.

## Before / after

### Before (pre-.132g0)
```python
sha = hashlib.sha256(data).hexdigest()
existing = await db.form_submissions.find_one(
    {"org_id": org_id, "imported": True, "deleted_at": None,
     "$or": [{"imported_from_pdf": filename}, {"import_sha256": sha}]},
    ...
)
```
False-positive on: two genuinely different PDFs that share a
filename (which Simpro exports do all the time — "Pre-Start.pdf",
"SWMS.pdf", etc). Real content submitted second is rejected as a
duplicate of the first.

### After (.132g0)
```python
sha       = hashlib.sha256(data).hexdigest()
file_size = len(data)
head_sha  = hashlib.sha256(data[:512]).hexdigest()

existing = await db.form_submissions.find_one(
    {"org_id": org_id, "imported": True, "deleted_at": None,
     "import_sha256": sha,
     "$and": [
         {"$or": [{"import_file_size": file_size},
                  {"import_file_size": {"$exists": False}}]},
         {"$or": [{"import_head_sha256": head_sha},
                  {"import_head_sha256": {"$exists": False}}]},
     ]},
    ...
)
```
Three-signal fingerprint — sha256 collision is astronomically
improbable, and the size + head-hash catch it defensively anyway.
Legacy rows lacking the two new fields still match on sha256
alone via the `$exists: false` back-compat clause.

## Files touched
- `backend/imports.py`
  - `import_pdf` now computes `file_size` + `head_sha` alongside
    `sha`.
  - Dedupe query switched to the three-signal fingerprint above.
  - New `import_file_size` + `import_head_sha256` fields stamped
    on every newly-persisted submission.
  - Module docstring rewritten to describe the new semantics.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132g0`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132g0`.

## Pytest (`tests/test_v58_13_132g0_duplicate_detection_tightening.py`)
7 checks — all green:
```
tests/test_v58_13_132g0_duplicate_detection_tightening.py::test_filename_no_longer_in_dedupe_query        PASSED
tests/test_v58_13_132g0_duplicate_detection_tightening.py::test_fingerprint_fields_computed              PASSED
tests/test_v58_13_132g0_duplicate_detection_tightening.py::test_fingerprint_used_in_dedupe_query         PASSED
tests/test_v58_13_132g0_duplicate_detection_tightening.py::test_new_fields_stamped_on_insert             PASSED
tests/test_v58_13_132g0_duplicate_detection_tightening.py::test_head_slice_boundary                      PASSED
tests/test_v58_13_132g0_duplicate_detection_tightening.py::test_docstring_updated                        PASSED
tests/test_v58_13_132g0_duplicate_detection_tightening.py::test_version_bumped_to_132g0                  PASSED

============================== 7 passed in 0.04s ===============================
```
Pins cover:
- filename is no longer in the dedupe query
- all three fingerprint values are computed
- all three are used in the query with back-compat `$exists: false`
- all three are persisted on new rows
- head slice is exactly `[:512]` (boundary check)
- docstring reflects new semantics
- version-file lockstep

## NOT changed
- Persisted `imported_from_pdf` field on the submission — kept as
  display/audit metadata (used by the imports history endpoint
  at `imports.py:212`). Only its role in the DEDUPE query changed.
- Bulk-import path (`bulk_import_prestarts.py`) — already uses
  `pdf_hash` for dedupe. No change needed.
- Frontend surface — no user-visible change. The 409 error path
  still surfaces the same way in the drag-drop importer modal.
- `/app/mobile/` — untouched. `MOBILE_BUNDLE_VERSION` unchanged.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still
  parked for `v58.14.x`.
- `finish` / `testing_agent` / `e1_tester` — none used, per standing
  directive.

## Queue status after .132g0
- `.132fy` (P0) — ✅ SHIPPED
- `.132fz` (P1) — ✅ SHIPPED
- `.132g0` (P1) — ✅ SHIPPED
- Next-priority queue is now empty apart from parked items:
  - `.132fr` (P2) — Tile PIN protection + 3-dots menu + drag-to-reorder
  - `v58.14.x` (Parked) — 20 `ephemeral-upload-storage` warnings +
    object storage migration
  Awaiting next user directive.
