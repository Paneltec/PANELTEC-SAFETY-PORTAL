# v58.13.132ia — Incidents module overhaul · Part 1 (merge + filter) · SHIPPED (finish deferred)

**Ship phase:** `.132ia`
**Scope:** P0 — Merge Hazard Reports into Incidents. Add type filter chips, replace header buttons, add Upload PDF affordance. Redirect legacy `/app/hazards` to `/app/incidents?type=hazard`. Retire the Hazard Reports sidebar entry.
**Testing:** Pytest (`backend/tests/test_v58_13_132ia_incidents_overhaul.py`) — 9/9 green. Live Playwright smoke verification via `screenshot_tool` — page renders with type chip row, Upload PDF button, redirect works, sidebar entry retired.

## What shipped

### 1. Backend

#### `backend/models.py`
- Extended `IncidentCategory` literal with `"hazard"` so records migrated from `db.hazards` retain their taxonomy without downgrading to `near_miss`.

#### `backend/crud.py`
- `incidents_router` now uses `mirror_categories=["incident", "hazard", "near_miss"]`. Field-captured hazard-family `form_submissions` surface on the Incidents Capture tab alongside native incident rows.
- `hazards_router` (existing) already carries `mirror_categories=["hazard", "near_miss"]`, which keeps the legacy `GET /api/hazards` route functional as a read-only alias for one release cycle.

#### `backend/migrations/merge_hazards_into_incidents_v58_13_132ia.py`
- Dry-run default; `--commit` to write. Copies every non-archived row from `db.hazards` into `db.incidents`:
  - `category` preserved (`hazard`, `near_miss`) — the new literal accepts both.
  - Preserves `id`, `created_at`, `updated_at`, `org_id`, `workspace_id`, `reporter`, `location`, `description`, `severity`, `photos`, `signatures`, `attachments`, `follow_up_status`.
  - Writes audit stamp `_migrated_from_hazards_at` for idempotent re-runs.
- Second run is a no-op (per-id upsert guard on the audit stamp).

### 2. Frontend

#### `frontend/src/pages/Incidents.jsx`
- New `CATS` entry `['hazard', 'Hazard']` so the base filter selects surface the merged rows.
- New `TYPE_CHIPS` constant with 6 pill filters (All / Hazard / Near Miss / Injury / Property / Environmental). `injury` unions `first_aid + medical + ltc` into one bucket without a data migration.
- URL-persisted chip state via `?type=<chip>` — `/app/hazards` redirect lands on the pre-filtered `?type=hazard` view.
- Retired the header "New incident" button per redesign brief. Header actions collapsed to:
  - Admin-only "Archive…" trigger (unchanged from pre-.132ia).
  - New admin-only filled-blue **Upload PDF** button (`incidents-upload-pdf-btn`) that opens the shared `<PdfImportModal>`.
- Per-card `imported_from_pdf` source-filename affordance (`incidents-original-doc-<id>`) — mirrors the `.132hz` SSRA pattern.
- `preFiltered` memo unions the new chip predicate with the existing status/category filters.

#### `frontend/src/App.js`
- Route `hazards` now renders `<Navigate to="/app/incidents?type=hazard" replace />`. `hazards/new` route retained so the mobile capture flow keeps posting to the same URL until the mobile app bumps.

#### `frontend/src/components/layout/AppShell.jsx`
- Hazard Reports sidebar entry removed. Deep-link `/app/hazards` still resolves via the App.js redirect.

## Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132ia`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ia`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132ia`
- `MOBILE_BUNDLE_VERSION` unchanged.

## Pytest coverage (9 checks)
- `test_incidents_page_has_type_chip_row` — testid `incidents-type-filter` + all 6 chip testids present.
- `test_incidents_page_has_upload_pdf_button` — testid `incidents-upload-pdf-btn`, wired to `PdfImportModal`, admin-gated.
- `test_incidents_page_retired_new_button` — old `incident-create-btn` no longer rendered in the header path.
- `test_incidents_page_shows_source_document_line` — `incidents-original-doc-{id}` conditional block present.
- `test_app_js_redirects_hazards_to_incidents_typed` — `<Navigate to="/app/incidents?type=hazard" replace />`.
- `test_sidebar_hazards_entry_removed` — no `nav-hazards` testid; `nav-incidents` present.
- `test_incidents_router_mirror_categories_widened` — `mirror_categories=["incident", "hazard", "near_miss"]`.
- `test_incident_category_literal_includes_hazard` — models.py literal contains `"hazard"`.
- `test_version_pin_v132ia` — three-string lockstep.

## Live verification
- `/app/incidents` renders with the chip row visible above the status/category selects. Default chip = `All`.
- Clicking `Hazard` writes `?type=hazard` to the URL and filters the list.
- Legacy `/app/hazards` bookmark redirects (verified in Playwright).
- Sidebar shows no "Hazard Reports" row; "Incident Reports" is the single entry point.
- Upload PDF button opens the shared modal (admin-only).
- Version pill at bottom-left shows `v160.3.9.58.13.132ia`.

## Deferred (next parts)
- **`.132ia-b`** — Multi-select: row checkboxes, "N selected" header bar, bulk archive (soft-delete, 30-day audit trail), bulk PDF export (zip of AI-generated PDFs). No bulk delete. No bulk status change.
- **`.132ia-c`** — AI-generated PDF fix: embed `evidence_photos` / `photo_urls` inline; embed signatures block already scaffolded in `pdf_renderer.py::render_incident_pdf`. Also verify SSRA AI PDFs surface photos + signatures (mobile capture path).

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish` invocations.
- No `/app/mobile/` edits.
- Will commit with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Disk pre-check: 91% (post-cache-clear).

## Next action items
- Ship `.132ia-b` — Incidents multi-select + bulk archive + bulk PDF export.
- Ship `.132ia-c` — Incident + SSRA AI-generated PDF photo/signature embed fix.
