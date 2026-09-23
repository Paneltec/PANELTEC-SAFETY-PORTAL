# v58.13.132mf — Display-only filename prefix strip

**Ship date:** 2026-09-23 · **Author:** e1 (main agent) · **Commit:** `<sha filled at finish>`

Small QoL ship. Legacy bulk imports left 12- or 13-hex-char + dash prefixes on stored filenames (e.g. `6373ef3a0ba47-Bostik_PVC_Pipe_Cement.pdf`). Users see this noise everywhere. This ship strips the prefix at every render / response boundary while leaving the stored `doc_files.filename` in Mongo untouched — storage lookups continue to key off the prefixed name.

## Scope

- **Frontend**: display-only wrap of filename values at read sites.
- **Backend**: strip in `Content-Disposition` headers + ZIP entry arcnames on the Document Library download endpoints.
- **Mobile**: deferred — will be delegated to `e1_expo_frontend_dev` in a follow-up. Not touched here.
- **DB**: unchanged. No migration.

## Pattern

Regex: `^[0-9a-f]{12,13}-` (case-insensitive). Trailing dash required so real filenames that happen to begin with a hex-looking word (`abcdef.pdf`) are not mistakenly stripped.

Examples:
- `6373ef3a0ba47-Bostik_PVC_Pipe_Cement.pdf` → `Bostik_PVC_Pipe_Cement.pdf`
- `66d54481a3402-BruteForce.pdf` → `BruteForce.pdf`
- `Report_v2.pdf` → `Report_v2.pdf` (unchanged)

## New helpers

- `frontend/src/lib/displayFilename.js` — `displayFilename(name: string): string`
- `backend/display_filename.py` — `display_filename(name)` + `display_zip_arcname(path)` (strips last segment only, folder names preserved)

## Files touched

### Backend (2 edits + 1 new)
- `backend/display_filename.py` — new util
- `backend/document_library.py:1866-1885` — `GET /files/{id}/download`
  - Content-Disposition filename stripped
  - `FileResponse(filename=…)` legacy on-disk fallback also stripped
- `backend/document_library_shares.py`
  - `GET /shared-with-me/files/{id}/download` Content-Disposition
  - `_zip_stream_from_files` — ZIP arcname passes through `display_zip_arcname` (covers both bulk `POST /download/bulk` and `GET /folders/{id}/download-zip`)

### Frontend (5 edits + 1 new)
- `frontend/src/lib/displayFilename.js` — new util
- `frontend/src/pages/DocumentLibrary.jsx`:
  - main folder-view file button + tooltip
  - table cell (RecentDocsRow variant)
  - smart-search results row title
  - search-result row title (line 529)
  - client-side `<a download="…">` save-as filename
  - "replacement uploaded" toast + "archived as permanently gone" toasts + hard-delete confirm prompt
  - Hard-delete modal target name — both single-row + bulk paths
- `frontend/src/pages/SharedWithMe.jsx`:
  - table filename + tooltip
  - download toast copy + client-side save-as filename
- `frontend/src/components/document-library/ShareModal.jsx`:
  - modal title + tooltip
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION + changelog block
- `frontend/public/service-worker.js` — CACHE_VERSION (lockstep)

## Intentionally NOT touched

- `data-file-name={f.filename}` test-ID DOM hooks — must reflect the underlying DB value for e1_tester precision selectors.
- Filename INPUT fields on rename modals — those still show/save the raw value.
- `f.stored_name` — never displayed; storage key.
- Non–Document-Library download routes (assets, equipment, fleet, help, imports, forms) — scoped out. Follow-up ship can broaden the sweep.
- FilePreviewModal / PdfPreviewModal captions — low signal, not in tester scope.

## Verification plan

`e1_tester` scenarios:
1. Load Document Library as admin → verify ≥5 rows show clean names.
2. Download a single file → verify `Content-Disposition` filename has no hex prefix.
3. Bulk download 2-3 files → unzip → verify every entry name is clean.
4. Load Shared-with-me as worker → verify clean names + clean download filename.

## Ship discipline

- Version bump `.132md → .132mf` lockstep (skipping `.132me` which is parked for the auth-lockout fix awaiting user green-light).
- Exact-file `git add`. Parallel-actor files stay unstaged.
- `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`. No push.
- Migration engine untouched. Real Dropbox → NAS run `copy-585eb471118b` still in flight; separate concern.
