# v58.13.132if — Archived subfolder Part 2 · SHIPPED (finish deferred)

**Ship phase:** `.132if`
**Scope:** Extends the `.132ie` cert-family archive pattern to three additional document collections that were deferred during .132ie scoping:
  · **HR Documents** (Private & Confidential) — `worker_hr_documents`
  · **Discovered Documents** — `worker_unmatched_documents`
  · **Compliance folders** (Doc Library) — `doc_files`

## Endpoint audit (Stephen's default 1a)
Reused the generic archive-endpoint shape (matches `.132ie` `POST /workers/certifications/{id}/archive|restore`). Two per-collection groups landed under their existing routers to preserve the URL semantics each surface already advertised:

- `POST /api/workers/{wid}/hr-documents/{doc_id}/archive`
- `POST /api/workers/{wid}/hr-documents/{doc_id}/restore`
- `POST /api/workers/{wid}/unmatched-documents/{doc_id}/archive`
- `POST /api/workers/{wid}/unmatched-documents/{doc_id}/restore`
- `POST /api/document-library/files/{file_id}/archive`
- `POST /api/document-library/files/{file_id}/restore`

## Auto-sweep rule (Stephen's default 2a)
- **HR docs**: manual archive only. Collection has no `expiry_date` field.
- **Discovered docs**: manual archive only. The whole surface is already a holding-area for triage; auto-sweep would misfire.
- **Doc library files**: auto-archive-on-fetch inside `list_files` when `expiry_date < today AND archived_at IS NULL AND deleted_at IS NULL`. Idempotent per-folder `update_many` (bounded write blast radius). Mirrors the `.132ie` sweep pattern on `worker_certifications`.

## What shipped

### 1. Backend

- **`backend/simpro_zip_import.py`** — added 4 endpoints (archive + restore × 2 collections). All go through the same `require_roles(...)` gate as the existing CRUD on those collections. Restore clears `archived_at` / `archived_reason` / `archived_by` back to `None`.
- **`backend/document_library.py`**:
  - `list_files` — auto-archive sweep block at the top of the handler (before the primary find query). Uses per-folder scope + `expiry_date < today` filter.
  - `_serialise_file` — now emits `archived_at` + `archived_reason` so the FE can partition rows without an extra fetch.
  - New `POST /library/files/{file_id}/archive` + `/restore` endpoints, both gated by `require_permission("documents", "edit")`.

### 2. Frontend

- **`frontend/src/lib/docArchiveHelpers.js`** — new shared helper (mirrors `certArchiveHelpers.js`):
  - `splitDocsByArchived(rows) → { active, archived }` — order-preserving partition.
  - `useDocArchivedOpen(panel, scopeId)` — localStorage-persisted `[open, toggle]` under `paneltec:archive:open:<panel>:<scopeId>`. **Default: closed** — Archived is a bottom drawer.
  - `archiveDoc({archiveUrl, label, onDone})` / `restoreDoc({restoreUrl, label, onDone})` — generic single-shot POST wrappers with shared toast + error path.

- **`frontend/src/components/workers/PrivateConfidentialPanel.jsx`**:
  - Splits rows into `activeRows` + `archivedRows`.
  - Main table renders active only.
  - New per-row Archive button (`data-testid="pnc-archive-<id>"`).
  - New collapsible Archived accordion below the table with per-row Restore + Delete actions (`section-private-confidential-archived`, `pnc-restore-<id>`).
  - Header count pill now reflects the ACTIVE count (matches the .132ie contract).

- **`frontend/src/components/workers/WorkerViewModal.jsx::UnmatchedDocsTab`**:
  - Splits rows into `activeRows` + `archivedRows`.
  - Main table renders active only; the "N unmatched documents" banner suppresses when zero active rows remain.
  - New Archive action per active row (`unmatched-archive-<id>`).
  - New Archived accordion (`section-unmatched-documents-archived`) with per-row Restore (`unmatched-restore-<id>`) + Delete.

- **`frontend/src/pages/DocumentLibrary.jsx`** (folder detail):
  - Main grouped rendering now consumes `splitDocsByArchived(files).active` — the group palette / expiry-tint chrome is untouched.
  - New Archive icon-button per row (`file-archive-<id>`), between Rename/Set-expiry and Delete.
  - New `<DocLibraryArchivedSection>` component rendered below the grouped table — collapsible accordion with the same "expired compliance documents kept for audit" chip. Restore button on each row (`file-restore-<id>`).

## Semantic separation (unchanged from .132ie)
- `deleted_at` → soft-delete, 30-day audit trail, hidden by default.
- `archived_at` → kept-but-hidden-from-active-list, restored in-place. Set either by the auto-expiry sweep (Doc Library only) or manually via the per-row Archive button (all three surfaces).

## Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132if`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132if`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132if`

## Pytest coverage — `tests/test_v58_13_132if_archived_subfolder_part2.py` — 11 checks
- 5 backend source-pins (HR + Unmatched + Doc Library × archive/restore; Doc Library auto-sweep block; `_serialise_file` archived_at exposure).
- 4 frontend source-pins (helpers, all 3 surfaces wire the split + action testids, main tables filter archived out).
- 1 version lockstep (all 3 strings on `.132if`).
- 1 **behavioural** round-trip (`live_db_writes` marked): seeds 3 `doc_files` rows (fresh / expired / already-archived) → runs the sweep → expired-unarchived row gets `archived_at` set with `archived_reason=auto_expired`; fresh row untouched; already-archived row keeps its manual reason.

### Full suite (.132ie + .132if): 19/19 green.

Also refactored `test_version_pin_v132ie` to a forward-safe regex (accepts `.132i<letter>` and later) so subsequent ships don't need to touch that pin per phase.

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish`.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Disk `/app` at 83% pre-ship — ran cache purge, no space-related crashes.

## Next action items
- **Ship `.132ig`** — Compliant / At Risk / N/A question widget for checklist / inspection forms (Pre-Starts, SSRA, Toolbox, Inspections, Site Audits, JSEAs). Includes template `help_text` field + legacy status migration (yes/no/na → compliant/at_risk/na with `_legacy_status` preserved). Natural split fallback into `.132ih` (per-question photo attach) and `.132ii` (per-question notes) if scope exceeds ~1000 LOC.
- **Issue 3** — Photos in imported PDFs (deferred from `.132id` — needs PyMuPDF-based source PDF stash + preview adapter).
- **Mobile parity backlog** — none yet for HR/Discovered/Compliance archives (mobile surface doesn't expose those tabs).
