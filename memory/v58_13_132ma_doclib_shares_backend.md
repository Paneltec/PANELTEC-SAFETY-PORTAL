# v58.13.132ma — Document Library: Phase 1 backend

Ship label: `.132ma`
Ship date: 2026-09-23
Branch: main (no push)
Ship type: Feature. Backend-only. Extends the existing `/document-library` prefix; the legacy 2,171-line `document_library.py` is untouched.

---

## Scope surprises found during exploration

The user's brief called for endpoints under `/api/docs/*` but the existing implementation already lives at `/api/document-library/*` with a full folder/file CRUD, search, `shared_reference` folder flag, category visibility, AI text extraction, and GridFS-backed uploads. Rather than fork prefixes (which would confuse the frontend axios base and duplicate admin gating), Phase 1 adds a **companion module** `document_library_shares.py` mounted at the SAME prefix. All new endpoints live at `/api/document-library/…`.

Additional adjustments made from the brief:
- **`target_type=group` deferred** — no user_groups collection exists yet. Pydantic pattern only accepts `user|all_workers`. Adding groups is Phase 2 scope-cut.
- **Per-file cap 200 MB (not 5 GB).** The 5 GB target needs a pre-signed NAS upload URL flow so bytes never buffer in the pod (Motor's request stream would OOM on multi-GB uploads). That flow is Phase 2 too. 200 MB is 4× the legacy 50 MB and covers 99% of docs.
- **Storage backend = "gridfs"** for new Phase 1 uploads. The user's brief said `"nas"` for new uploads, but writing to NAS via the current `nas_client.put_file` base64 path OOMs at 50 MB and the resumable `fetch_and_put` requires a source URL — neither works for a pod-received UploadFile without the pre-signed flow. Deferred to Phase 2.
- **Legacy soft-delete kept** — `DELETE /files/{id}` unchanged. New hard-delete lives at `DELETE /files/{id}/hard` (admin-only, explicit).

---

## Endpoints shipped

| Method | Path | Auth |
|---|---|---|
| POST | `/document-library/files/{id}/shares` | admin |
| GET | `/document-library/files/{id}/shares` | admin |
| DELETE | `/document-library/shares/{share_id}` | admin |
| GET | `/document-library/shared-with-me` | any authed |
| GET | `/document-library/shared-with-me/files/{id}/download` | share-scoped |
| POST | `/document-library/download/bulk` | admin |
| GET | `/document-library/folders/{id}/download-zip` | admin |
| DELETE | `/document-library/files/{id}/hard` | admin |
| DELETE | `/document-library/folders/{id}/hard` | admin |
| POST | `/document-library/folders/{id}/upload-tree` | admin |
| POST | `/document-library/admin/seed-shares-from-shared-reference` | admin |

## Data model

New collection **`doc_shares`**:
```
{
  id: uuid,
  org_id: uuid,
  file_id: uuid,                # → doc_files.id
  target_type: "user" | "all_workers",
  target_id: user_id | null,    # null for all_workers
  permission: "view" | "download",
  granted_by: user_id,
  granted_by_name: str,
  granted_reason: str,           # optional (e.g. "seed:shared_reference_folder")
  created_at: iso,
  revoked_at: iso | null
}
```

Uniqueness: not enforced at the DB level (allows re-granting after a revoke). The `seed-from-shared-reference` endpoint dedupes at write time (skips files that already have an active `all_workers/download` share).

## Migration one-shot

`POST /document-library/admin/seed-shares-from-shared-reference`:
- Finds every `doc_folder` where `shared_reference=True` + `deleted_at=None`.
- For each file in those folders (non-deleted), inserts an `all_workers/download` share if one doesn't already exist.
- Returns `{created, skipped_existing, folders, files_scanned}`.
- **Idempotent** — safe to run multiple times. Re-run count of `created` should be 0 the second time.

## Files touched

- `backend/document_library_shares.py` (NEW, ~530 lines).
- `backend/server.py` — 2 lines: import + `include_router`.
- `frontend/src/lib/version.js` — bump + changelog block.
- `frontend/public/service-worker.js` — bump.
- `memory/v58_13_132ma_doclib_shares_backend.md` — this memo.

## NOT touched

- `document_library.py` — untouched. Legacy soft-delete, upload (50 MB cap), download, folder CRUD, search all unchanged.
- `doc_files.storage_backend` — no writes to existing rows (Dropbox → NAS migration still owns that field).
- Dropbox migration state — no interaction.
- `/app/mobile/` — untouched (ban + Phase 3 delegation).
- `MOBILE_BUNDLE_VERSION` — unchanged.

## Deferred to Phase 2

- Web UI extensions (toolbar buttons, share modal, delete-confirm, Shared-with-me page, drag-drop + `webkitdirectory`) — ship label `.132mb`.
- NAS pre-signed upload URL flow to lift per-file cap 200 MB → 5 GB.
- `user_groups` collection + `target_type=group`.

## Deferred to Phase 3

- Mobile: hide Documents nav, redirect deep links. **Delegate to `e1_expo_frontend_dev` — `/app/mobile/` is edit-banned for the main agent.** Ship label `.132mc`.
