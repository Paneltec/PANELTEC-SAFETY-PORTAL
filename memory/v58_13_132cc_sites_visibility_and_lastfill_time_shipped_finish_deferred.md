# v58.13.132cc — Sites visibility + LAST FILL time · SHIPPED (finish-deferred)

## Ship rules honoured
- `testing_agent` — NOT invoked.
- `e1_tester` — NOT invoked.
- `finish` tool — NOT invoked. Finish-deferred per standing directive.
- `/app/mobile/` + `metro.config.js` — untouched.
- 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.
- No mocks. No hard deletes.

## Two Stephen asks bundled

### Issue 1 — "i dont see any changes to (sites) i workspaces has gone so where is its data"
After `.132cb` Phase A, the `sites` collection was populated with 27 rows (11 promoted workspaces + 17 simpro sites − 1 dedupe), but the visible **Compliance → Sites** page still showed the same 2 rows. Diagnosis: `SitesAdmin.jsx` reads `GET /api/sites` from `sites_qr.py::list_sites`, which only queried `db.simpro_sites`. The promoted "Work Admin" row lived in `db.sites` and was never surfaced.

**Endpoint before / after:**
- Before: `GET /api/sites` → `db.simpro_sites` only. Paneltec: 2 rows.
- After (`.132cc`): `GET /api/sites` → `db.simpro_sites` UNION `db.sites WHERE source="workspace_promoted"`. Paneltec: **3 rows**, every row carries a `source` field (`simpro` | `workspace_promoted` | `manual`).

**Fix files:**
- `backend/sites_qr.py::list_sites` — tag every simpro row with `source="simpro"`, then union in workspace-promoted rows from `db.sites` (aliased under `simpro_site_id` for FE compat, deduped against `seen_ids`), projecting `default_for_org` and `_workspace_migrated_at`.
- `frontend/src/pages/SitesAdmin.jsx` —
  - New violet explainer banner ("Depots and workspaces have been merged into one Sites register.") dismissible via a "Got it" button; ack persisted per admin via `localStorage['paneltec_sites_merge_ack_132cc']`; only shown when `promotedCount > 0`.
  - New **Source** column in the sites table with a per-row testid `site-source-chip-{simpro_site_id}` and colour scheme:
    - `simpro` → slate chip.
    - `workspace_promoted` → violet chip (matches the explainer).
    - `manual` → blue chip.
  - Tooltip on each chip explains its meaning.

**Live verified:**
```
$ curl /api/sites (stephen@paneltec.com.au token)
total rows: 3
by source: {'simpro': 2, 'workspace_promoted': 1}
  · simpro                 New Paneltec Depot
  · simpro                 Paneltec Depot
  · workspace_promoted     Work Admin
```

### Issue 2 — Add LAST FILL time (12-hour) to Per Employee + Per Vehicle
The rows-table LAST FILL cell was showing `DD/MM/YYYY` only. Regression from `.132ak` when `Fills` was swapped for `Last fill`. Backend already emits `latest_fill_timestamp` (ISO 8601) alongside `latest_fill_date_iso` — no backend change needed.

**Fix files:**
- `frontend/src/pages/FuelReporting.jsx` —
  - New helper `fmtAusDateTime12h(iso)` → `DD/MM/YYYY hh:mm A` (12h + AM/PM), co-located with the existing `fmtAusDate` / `fmtAusDateTime`.
  - Rows-table LAST FILL cell now renders `fmtAusDateTime12h(r.latest_fill_timestamp)` with a graceful fallback to `fmtAusDate(r.latest_fill_date_iso)` for any legacy row that only carries the date.
  - `data-testid={`fuel-reporting-row-last-fill-${r.key}`}` unchanged for pytest continuity.

**Live verified (Per-Vehicle scope):**
```
cell#0 text: '09/09/2026 06:37 AM'
cell#1 text: '08/09/2026 08:34 PM'
```

Applies to all three tabs (Per-Employee / Per-Vehicle / Admin Rollup) because they all render the same rows-table.

## Files touched
- `backend/sites_qr.py`
- `frontend/src/pages/SitesAdmin.jsx`
- `frontend/src/pages/FuelReporting.jsx`
- `frontend/src/lib/version.js` (RUNNING_VERSION bump)
- `frontend/public/service-worker.js` (CACHE_VERSION bump)
- `backend/tests/test_v58_13_132cc_sites_visibility_and_lastfill.py` (NEW)

## Pytests (`backend/tests/test_v58_13_132cc_sites_visibility_and_lastfill.py`)
9 checks, all green. Adjacent `.132cb` regressions — 13/13 still green.

- `test_sites_qr_list_sites_unions_workspace_promoted` — backend union path present.
- `test_sites_qr_list_sites_dedupes_by_simpro_site_id` — `seen_ids` guard.
- `test_sites_admin_renders_source_chip` — new column header + per-row chip testid.
- `test_sites_admin_merge_explainer_and_ack` — explainer + Got-it testids + localStorage key.
- `test_fuel_reporting_has_12h_helper` — helper defined, uses `% 12` + AM/PM.
- `test_fuel_reporting_row_uses_12h_timestamp` — regex-locks the row cell to prefer timestamp with a fallback.
- `test_fuel_reports_backend_still_emits_timestamp` — guardrail: backend keeps emitting `latest_fill_timestamp`.
- `test_version_js_bumped_to_at_least_132cc`.
- `test_service_worker_bumped_to_at_least_132cc`.

## Version bump
- `frontend/src/lib/version.js` — `RUNNING_VERSION` `.132cb` → `.132cc`, with a header block documenting the diagnosis + fix + Phase B carry-forward.
- `frontend/public/service-worker.js` — `CACHE_VERSION` `.132cb` → `.132cc`.
- `mobile/src/lib/version.ts` — untouched (`MOBILE_BUNDLE_VERSION` unchanged).

## Screenshots
- `/tmp/132cc_sites_page.jpeg` — Compliance → Sites shows 3 Paneltec rows; violet explainer banner visible above the table; Source column populated with the three chips (`simpro`, `simpro`, `workspace_promoted`).
- `/tmp/132cc_pervehicle_last_fill.jpeg` — Fuel reports Per-Vehicle tab loaded (cells verified via Playwright as `09/09/2026 06:37 AM` / `08/09/2026 08:34 PM`).

## Decisions on visual ambiguity
- Violet chip for `workspace_promoted` matches the explainer banner, distinguishing it from the neutral slate used for Simpro-imported rows. Blue reserved for future `manual` (Add site) rows.
- Explainer banner is dismissed permanently per admin (not per session) — matches how Stephen tolerates other "one-time notice" banners across the app.
- The Source column sits between `Kind` and `On-site` so the operational columns (sign-on count + questions) stay adjacent to the actions.

## NOT changed
- Backend field renames `workspace_id` → `site_id` — still Phase B (`.132cb-b`).
- `/api/workspaces` router — still live for backward compat.
- Site detail page (`SiteDetail`) — reads through the same list endpoint via `loadSite`, so it inherits the fix automatically; no direct changes.
- Fuel reports CSV export — the aggregated `Last fill` column stays date-only in the CSV (matches legacy export contracts).
- 20 pre-existing `ephemeral-upload-storage` lint warnings — parked for v58.14.x.

## Test credentials
`/app/memory/test_credentials.md` — no changes; existing admin credentials still valid (`stephen@paneltec.com.au` / `Mcgstephen50#`).

## finish tool
Deferred by design. Handed off to the next fork with this memo.
