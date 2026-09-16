# v58.13.132ha — Doc Library counts pill — SHIPPED

`finish` tool deliberately deferred per Stephen's standing directive.

## What shipped

A small header pill on `/app/document-library` that answers the
"how many folders / files do we have?" question at a glance. Direct
response to Stephen's `.132gy` scare where his "over 1000 files"
estimate was actually 692. Now the answer is visible on the page —
no need to guess.

## User-facing behaviour

Pill renders directly under the `PageHeader`, showing:

- `65 folders` — active (all depths, includes per-worker leaves)
- `692 files` — active (non-deleted)
- `66 archived` — soft-deleted folder+file total (only shown when >0)
- `18 missing binary` — legacy .132gh migration tail (amber,
  only shown when >0, tooltipped "contact admin to reconcile")

All numbers come from a single fetch of `/api/document-library/counts`
on mount. Silent-fail on error (pill just doesn't render).

## Files touched

- `backend/document_library.py` — new `GET /counts` endpoint
  (authenticated, no admin gate; counts scoped to caller's org).
  Missing-binary probe joins `upload_storage.files.metadata.key`
  against every active `doc_files.file_url`. Batched — one query
  per collection.
- `frontend/src/pages/DocumentLibrary.jsx` — new `CountsPill`
  component, mounted between `PageHeader` and the AI Smart Search
  panel. Fetches once on mount, no polling.
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js`
  — version bump `.132gz` → `.132ha` in lockstep.

## Testids (locked)

- `doclib-counts-pill` — outer container
- `doclib-counts-folders` — folder total
- `doclib-counts-files` — file total
- `doclib-counts-deleted` — archived total (conditional)
- `doclib-counts-missing` — missing-binary total (conditional)

## Verification

- `backend/tests/test_v58_13_132ha_counts_pill.py` — 10 checks,
  all green. Locks endpoint shape, no-admin-gate, missing-binary
  join contract, pill mount point, all testids, conditional-render
  gates, version lockstep.
- Live curl smoke against Stephen's org:
  ```
  GET /api/document-library/counts
  → {"folders_active":65,"folders_deleted":26,
     "files_active":692,"files_deleted":40,
     "files_missing_binary":18}
  ```
  Numbers match the forensic audit performed just before this ship.

## NOT in this ship

- Per-folder drill-down inside the pill (would need a modal — kept
  scope tight; users can already drill via the tree).
- Deleted-files recovery UI (existing admin flow lives elsewhere).
- Recent-uploads velocity strip (nice-to-have; deferred).
