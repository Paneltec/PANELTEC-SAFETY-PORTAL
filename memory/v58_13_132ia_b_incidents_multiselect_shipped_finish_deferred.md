# v58.13.132ia-b — Incidents multi-select · Part 2 · SHIPPED (finish deferred)

**Ship phase:** `.132ia-b`
**Scope:** P0 — Row checkboxes on Incidents (Cards + Table views), "N selected" header bar, bulk Archive (per-row soft-delete, 30-day audit trail preserved) + bulk PDF export (zip download). No bulk delete. No bulk status change.
**Testing:** Pytest (`backend/tests/test_v58_13_132ia_b_incidents_multiselect.py`) — 10/10 green (source pins + behavioural zip round-trip). Live Playwright smoke — Incidents list loads with type filter chips + Upload PDF button + version pill `.132ia-b`.

## What shipped

### 1. Backend — `POST /api/incidents/bulk-pdf-export`

New module `backend/incidents_bulk.py`:
- Prefix `/incidents`, tags `["incidents"]`.
- Endpoint accepts `{ids: [...]}` (1..200 IDs).
- Loops through IDs (order preserved), renders each via `pdf_renderer.RENDERERS["incidents"]` (shared with the single-record `/api/incidents/{id}/pdf` endpoint) so PDF output stays consistent.
- Streams `application/zip` with header `Content-Disposition: attachment; filename="paneltec_incidents_<YYYYMMDD_HHMMSS>.zip"`.
- Response headers:
  - `X-Exported-Count` — number of PDFs zipped.
  - `X-Missing-Ids` — comma-separated list of IDs that didn't resolve (cross-org / soft-deleted / bad ID). FE surfaces these in a "skipped N" toast.
- Filename collisions inside the zip are auto-uniqued via `<name> (n).pdf`.
- `_safe_zip_member` strips characters that trip Windows/mac unzip clients.
- Permission gate: `require_permission("incidents", "view")`. Admin-only bulk archive is enforced on the frontend (each per-row `/{id}/archive` POST is already admin-gated in `crud.py`).
- Router mounted after `incidents_router` in `server.py`.

Deliberately **no** `/bulk-archive` endpoint — the frontend fans out per-item `POST /api/incidents/{id}/archive` calls so each record gets its own `archive_audit` row + `archive_batch_id`, preserving the 30-day recovery contract shipped in `.132ec`. A future `/bulk-archive` could batch this, but it would require duplicating the audit-writing logic.

### 2. Frontend — `frontend/src/pages/Incidents.jsx`

- New state:
  - `selected: Set<string>` — currently-selected incident IDs.
  - `bulkBusy: 'archive' | 'pdf' | null` — disables both buttons during an in-flight bulk action.
- Helpers: `toggleSelect(id)`, `toggleSelectAll(ids, checked)`, `clearSelection()`.
- `bulkArchive()`:
  - Top-level `window.confirm("Archive N incident(s)? Records remain recoverable for 30 days.")`.
  - Fans out `POST /api/incidents/{id}/archive` per selected ID (sequential to preserve audit ordering).
  - Single summary toast on completion (`Archived N` or `Archived N · M failed`).
  - Refetches to re-hydrate the list + counts.
- `bulkPdfExport()`:
  - POSTs `/incidents/bulk-pdf-export` with `responseType: 'blob'`.
  - Client-side blob download via a hidden `<a href download>`.
  - `URL.revokeObjectURL` cleanup after 5 s.
  - Surfaces `X-Missing-Ids` in a warning toast when non-empty.
- Selection bar (mounted inline, immediately above the status/category selects, only when `selected.size > 0`):
  - Testid `incidents-selection-bar`.
  - Renders `N selected` count (testid `incidents-selection-count`).
  - Admin-only `Archive` button (testid `incidents-bulk-archive-btn`).
  - `Download PDFs` button (testid `incidents-bulk-pdf-btn`).
  - `Clear` button (testid `incidents-bulk-clear-btn`).
- Cards view: each tile gets an absolute-positioned checkbox overlay at top-left (`incidents-card-select-<id>`, `z-10`, backdrop-blur pill container, `onClick={stopPropagation}` so it doesn't fight the tile's open-detail handler).

### 3. Frontend — `frontend/src/components/IncidentsTable.jsx`

- New optional props: `selected`, `onToggleSelect`, `onToggleSelectAll`.
- When `selected` is provided:
  - Renders a leading `<th>` + `<td>` checkbox column.
  - Header checkbox testid `incidents-table-select-all` (toggles all visible rows).
  - Row checkbox testid `incidents-table-select-<id>`.
  - Selected rows get a `ring-2 ring-inset ring-[#1e4a8c]` highlight.
- Empty-state colspan widened to account for the optional column.
- Parent controls the selection state; the table is a pure controlled component here.

## Version pin
- `RUNNING_VERSION`  → `paneltec-v160.3.9.58.13.132ia-b`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ia-b`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132ia-b`
- `MOBILE_BUNDLE_VERSION` unchanged.

## Pytest coverage (10 checks)
- `test_incidents_page_has_selection_state` — `selected` Set + toggle/clear helpers.
- `test_incidents_page_has_selection_bar_and_action_testids` — all 5 selection-bar testids.
- `test_incidents_page_bulk_archive_posts_per_item` — per-item `/incidents/{id}/archive` POST + single top-level confirm.
- `test_incidents_page_bulk_pdf_export_calls_zip_endpoint` — endpoint path + `responseType: 'blob'` + `X-Missing-Ids` handling.
- `test_incidents_page_checkbox_overlaid_on_capture_card` — overlay positioning class + card-select testid.
- `test_incidents_table_renders_select_column_when_selected_prop_present` — new props + testids + colspan.
- `test_bulk_pdf_export_router_wired_into_server` — server.py include_router.
- `test_bulk_pdf_export_router_prefix_and_methods` — prefix + method + permission + response headers.
- `test_bulk_pdf_export_behavioural_zip` — round-trip with mock renderer + fake DB:
  - Cross-org row (`c`) and missing ID land in `X-Missing-Ids`.
  - `X-Exported-Count` = 2.
  - Zip contains 2 members, each decodes to the fake PDF bytes.
- `test_version_pin_v132ia_b` — three-string lockstep.

## Live verification
- Incidents page loads at `.132ia-b` (verified via bottom-left version pill in Playwright screenshot `/app/memory/v58_13_132ia_b_01_page_load.png`).
- Type filter chip row + Upload PDF button + tab structure preserved from `.132ia`.
- Selection bar behaviour source-pinned + behaviourally tested (no incidents in the live preview org to exercise the checkbox overlay in Playwright).

## Deferred (next part)
- **`.132ia-c`** — AI-generated PDF fix:
  - Embed `evidence_photos` / `photo_urls` inline in the incident PDF (currently missing).
  - Verify signatures block is fully rendered (scaffolded but not always populated).
  - Same fix on SSRA AI PDFs — the `.132hz` audit surfaced this gap for the mobile SSRA capture path.
  - Regression test with a synthetic incident carrying 3 photos + 2 signatures.

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish` invocations.
- No `/app/mobile/` edits.
- Will commit with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Disk pre-check: 91%.

## Next action items
- Ship `.132ia-c` — Incident + SSRA AI-generated PDF photo/signature embed fix.
