# v58.13.132hd — Missing-binary drill-down modal — SHIPPED

## What shipped
The amber "N missing binary" chip on the counts pill is now an admin-clickable button that opens a drill-down modal. Admins can list, replace, or archive orphaned files.

## Behaviour
- **Chip click (admin only)** → modal listing all orphans with filename, folder path, size, mime, uploaded_at, uploaded_by_name.
- **Re-upload** per row: opens native file picker, PATCHes GridFS under the SAME `metadata.key` so the existing `file_url` continues to resolve. `size`/`mime`/`updated_at` refreshed. Audit entry `binary_replaced`.
- **Mark gone** per row: browser confirm, then soft-deletes with reason `permanently_gone_missing_binary`. Audit entry `marked_permanently_gone`. File moves to Archive.
- **CSV export**: full orphan list, `paneltec-missing-binaries-YYYY-MM-DD.csv`, ready to hand off for offline recovery.
- **Non-admins**: chip is still visible but not clickable; existing tooltip retained.

## Files touched
- `backend/document_library.py`: three new endpoints
  - `GET /counts/missing-binary`
  - `POST /files/{file_id}/replace-binary`
  - `POST /files/{file_id}/mark-gone`
- `frontend/src/pages/DocumentLibrary.jsx`: `CountsPill` extended to open modal; new `MissingBinaryModal` + `MissingBinaryRow` components + CSV export.
- Version bump `.132hc` → `.132hd`.

## Testids (locked)
`missing-binary-modal`, `missing-binary-close`, `missing-binary-count`, `missing-binary-export-csv`, `missing-binary-row-<id>`, `missing-binary-replace-<id>`, `missing-binary-replace-input-<id>`, `missing-binary-mark-gone-<id>`.

## Verification
- `backend/tests/test_v58_13_132hd_missing_binary_modal.py`: 10 pytests green (admin gates, response shape, audit entries, multipart shape, CSV export, version lockstep).
- Live curl: 18 orphans returned with correct folder paths.

## Safety
- Every action is admin-gated backend AND frontend.
- Replace writes to the SAME GridFS key — orphan doc_files row is never mutated apart from size/mime/updated_at + audit trail.
- Mark-gone is soft-delete only; row moves to Archive (30-day recoverable per standing behaviour).
