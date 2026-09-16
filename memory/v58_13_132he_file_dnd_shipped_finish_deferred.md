# v58.13.132he — File drag-and-drop between folders — SHIPPED

## What shipped
Files can now be dragged from the folder-detail file list onto:
- **Subfolder cards** shown on the same page (move DOWN)
- **Breadcrumb ancestor segments** (move UP the tree)

The existing `PATCH /api/document-library/files/{id}` endpoint now accepts `folder_id` and audits every move as `file_moved` with old/new IDs.

## Behaviour
- `<tr>` file rows: `draggable={canEdit}` — non-editors don't get the drag affordance.
- Payload: `dataTransfer['text/paneltec-file'] = file_id`.
- Subfolder cards + breadcrumb segments only activate as drop targets while a file drag is in-flight (`draggingFileId`).
- Highlight: subfolder card shows `border-brand-blue ring-2 ring-brand-blue/30 bg-brand-blue-soft/40`; breadcrumb shows `ring-2 ring-brand-blue`.
- Same-folder drops are no-ops (no request).
- Errors bubble as toasts; on success the file list refreshes.

## Backend contract
- `FilePatch` gains `folder_id: Optional[str]` (validated: same org, not soft-deleted, non-empty).
- Target validated with a Mongo `find_one` before `find_one_and_update`.
- Audit entry `file_moved` records `old_folder_id`, `new_folder_id`, actor, filename, timestamp.

## Role gating
- Still gated by `require_permission("documents", "edit")` + `WRITE_ROLES` — admin/editor only, no viewer widening.

## Files touched
- `backend/document_library.py` — `FilePatch.folder_id`, target-validation block, audit emit.
- `frontend/src/pages/DocumentLibrary.jsx` — `draggingFileId` state, `moveFile` handler, `SubfolderCard` extended props + drop wiring, file `<tr>` draggable, breadcrumb ancestor drop wiring.
- Version bump `.132hd` → `.132he`.

## Testids (locked)
Existing `file-row-<id>`, `subfolder-<id>`, `folder-breadcrumb-<id>` reused; `data-file-drop-target` attr added to subfolder cards for Playwright targeting.

## Verification
- `backend/tests/test_v58_13_132he_file_dnd.py` — 8 pytests green.
- Live curl: moved a real file to Uncategorised and back; both moves audited; invalid folder returns 404.
