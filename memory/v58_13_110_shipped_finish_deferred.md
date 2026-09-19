# v58.13.110 — Site Visitors: delete + detail drawer + declutter (finish deferred)

**Status**: SHIPPED. `finish` tool deferred under standing user directive.
**Date**: 2026-09-04.

## Files touched
| Path | Change |
|---|---|
| `backend/visitor_signins.py` | +3 endpoints (`DELETE /admin/visitors/{id}`, `POST /admin/visitors/bulk-delete`, `include_deleted` param on list). `admin_list_visitors` + `admin_get_visitor` now enrich with `site_name`/`site_address` via a per-window join on `simpro_sites`. |
| `frontend/src/pages/AdminVisitors.jsx` | Full page rewrite. Slim table (7 cols), row selection with persistent black toolbar, `DetailDrawer` component (Contact/Visit/Safety/Timeline/Provenance), `BulkDeleteModal`, `Include deleted` filter toggle. |
| `frontend/src/lib/version.js` | RUNNING_VERSION bump + full changelog block. |
| `frontend/public/service-worker.js` | CACHE_VERSION bump. |
| `mobile/src/lib/version.ts` | MOBILE_BUNDLE_VERSION bump (constant only). |
| `tests/backend_unit/test_admin_visitors_delete_v58_13_110.py` | **NEW** — 16 pytests. |

## Curl proofs (all live on preview)
- **GET list (default)**: `count=14, include_deleted=False, items with site_name=14` — enrichment working.
- **GET detail**: `name=E2E Testing Agent, site_name=Paneltec Depot, address=19 Connector Park Drive, 23 fields returned`.
- **DELETE single**: `{visitor_id, deleted_at: "2026-09-04T09:45:23…", already: false}`.
- **DELETE again (idempotent)**: `{…, already: true}` with identical `deleted_at`.
- **List default after delete**: deleted row excluded ✓.
- **List `?include_deleted=true`**: deleted row visible ✓.
- **Bulk delete (2 real + 1 fake)**: `{deleted:2, skipped:[{id:"does-not-exist-id", reason:"not_found"}], requested:3}` ✓.
- **Bulk delete re-fire**: `{deleted:0, skipped:[3× {already_deleted / not_found}], requested:3}` — idempotent ✓.
- **Bulk 501 ids**: `422 pydantic too_long, max_length=500` — payload cap enforced structurally, no per-request guard needed ✓.
- **Unauth DELETE**: `401 Not authenticated` ✓.

## Playwright screenshot proof
Uploaded inline in the ship conversation. Key observations from the DOM inspection:
- **Slim table headers**: `['', 'Name', 'Company', 'Site', 'Signed in', 'Status', 'Actions']` — exactly 7 columns, matches the brief.
- **Detail drawer** rendered with header (name + site subtitle), CONTACT (Phone as `tel:` anchor + Company), VISIT (Purpose/Visiting person/Vehicle rego), SAFETY (Induction ack YES badge), TIMELINE (signed_in / signed_out / duration), PROVENANCE (site name + address + source IP + user agent). Footer shows the Delete button.
- **Bulk selection**: ticking two row checkboxes surfaces the black toolbar with `"2 selected"` count + Delete/Clear buttons.
- **Bulk confirm modal**: opens with the two selected names listed, red Delete button.
- **Version footer**: `paneltec-v160.3.9.58.13.110` ✓.

## Pytests — 16 new, all green
1. `test_delete_endpoint_is_permission_gated_and_safe_wrapped` — regex-anchors the decorator ordering + `sites_visitors.delete` gate.
2. `test_bulk_delete_endpoint_declares_min_and_max_length` — pydantic `min_length=1, max_length=500` on `BulkDeleteIn.ids`.
3. `test_bulk_delete_endpoint_permission_gated_and_safe_wrapped` — decorator order.
4. `test_bulk_delete_reports_deleted_skipped_requested` — response shape pin including both skipped reasons.
5. `test_list_endpoint_carries_include_deleted_param` — default False + $or filter applied.
6. `test_list_and_get_enrich_with_site_name` — Mongo-join enrichment pin.
7. `test_delete_endpoint_stamps_deleted_at_and_deleted_by`.
8. `test_frontend_uses_bulk_delete_endpoint` + `test_frontend_uses_single_delete_endpoint` — call-site pins.
9. `test_frontend_declutters_main_table_columns` — 6 main-table headers pinned; 7 drawer-only fields (Phone / Purpose / Visiting person / Vehicle rego / Induction ack / Source IP / User agent) pinned to the drawer.
10. `test_frontend_selection_toolbar_present` — 8 data-testids (`bulk-toolbar`, `bulk-selected-count`, `bulk-delete-open`, `bulk-clear`, `bulk-delete-confirm`, `visitor-detail-drawer`, `visitor-detail-delete`, `admin-visitors-include-deleted`).
11. **`test_single_delete_soft_deletes_and_is_idempotent`** — behavioural: seed 3 `TESTV110_*` rows, invoke inner `admin_delete_visitor` twice, assert `already=false → already=true`, verify `deleted_at` + `deleted_by` persist in Mongo. Uses `__wrapped__` to bypass `@safe_admin_endpoint` FastAPI plumbing; motor client bound to a fresh event loop per test.
12. **`test_bulk_delete_reports_deleted_and_not_found`** — seed 3 real rows + 1 fake, assert `deleted=3, skipped=[{'fake-id-xyz': 'not_found'}], requested=4`.
13-15. Version-sync forward pins ≥ .110.
Cleanup fixture wipes any `TESTV110_*` rows created during the run.

## Full-suite state
**992 passed / 15 skipped / 2 pre-existing failures** (the two mobile-palette failures on `/app/mobile/colors.ts` — untouchable per rule, same baseline as .107 → .109b). Zero regressions from this ship.

## Version bumps confirmed
```
frontend/src/lib/version.js:       RUNNING_VERSION        = 'paneltec-v160.3.9.58.13.110'
mobile/src/lib/version.ts:         MOBILE_BUNDLE_VERSION  = 'paneltec-v160.3.9.58.13.110'
frontend/public/service-worker.js: CACHE_VERSION          = 'paneltec-v160.3.9.58.13.110'
```

## Compliance rails (unchanged)
- No `testing_agent` invocation.
- No new email / SMS / notification / scheduler paths.
- No new ephemeral-upload endpoints.
- 20 pre-existing `ephemeral-upload-storage` lint warnings deferred to v58.14.x.
- `/app/mobile/` code untouched (only version constant).

## Next action items
- **v58.13.107 Expo hand-off**: still queued — Mobile Create-Site screen.
- **v58.13.106c**: `TEST_MODE_BYPASS_RATE_LIMIT` env toggle to unblock the 10 rate-limit-flaky HTTP tests (still errors on collection).
- **v58.14.x**: object-storage migration to clear the 20 ephemeral-upload warnings.
- **v58.13.111 (potential)**: hard-delete + audit-restore endpoint for the soft-deleted visitor rows. Currently `include_deleted=true` surfaces them but there's no restore path. If auditors want a full round-trip, ship as a follow-up.
