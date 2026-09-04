# v58.13.109b — Legacy site-signin retired (finish deferred)

**Status**: SHIPPED. `finish` tool deferred under standing user directive.
**Date**: 2026-09-04.

## Record count (drives the backfill decision)
- `db.form_submissions.count({template_id:'e8873f7e-6fd4-…'}) = 1` on preview.
- Well below the 1000-row deferral threshold → migration script written and shipped (manual invocation).

## Files touched / deleted
| Path | Change |
|---|---|
| `frontend/src/pages/SiteSigninList.jsx` | **DELETED** |
| `frontend/src/App.js` | `/site-signin` route + `/site-signin/*` wildcard sibling both replaced with `<Navigate to="/app/admin/visitors" replace/>`. `import SiteSigninList` commented out as a `git log -S` breadcrumb. |
| `frontend/src/components/layout/AppShell.jsx` | .109a merge comment collapsed to a 5-line provenance note. |
| `backend/scripts/migrate_legacy_signins_v58_13_109b.py` | **NEW** — one-shot idempotent migration. Manual invocation. |
| `tests/backend_unit/test_retire_site_signin_v58_13_109b.py` | **NEW** — 9 pytests. |
| `tests/frontend_smoke/conftest.py` | **NEW** — auto-skip hook: any test with `site_signin` / `SiteSigninList` fingerprint auto-skips when the deleted component's file is missing. Restores automatically if a future ship re-creates the component. |
| `tests/frontend_smoke/test_capture_wiring_v58_13_40.py` | Removed the `(SITESIGNIN, "site-signin")` entry from the grouped-pages iteration. |
| `tests/frontend_smoke/test_capture_wiring_v58_13_41.py`, `_42.py`, `test_tile_size_colour_parity_v58_13_38.py` | Stripped `SiteSigninList.jsx` from PAGES lists / removed two orphaned `test_site_signin_*` test functions. |
| Version bumps | `.109a` → `.109b` in `frontend/src/lib/version.js` (with new changelog block), `frontend/public/service-worker.js`, `mobile/src/lib/version.ts` (constant only). |

## Migration script status
**WRITTEN** — 1 record on preview at ship day, below the 1000-row deferral bar per your brief.

- One-shot idempotent (`legacy_form_submission_id` provenance stamp prevents duplicates).
- MANUAL invocation only — NO startup wiring, NO comms, NO scheduler hooks.
- Field mapping documented in the module docstring; every LOSSY field flagged (signature blob, emergency_contact_*, id_sighted, photo, vehicle_type — none of these have a home in the `site_visitors` schema today; `gps` is preserved when a fix was captured).
- Rerun cost: O(#legacy rows) — 1 tiny cursor scan.
- **Not auto-run** — admin should trigger `python -m backend.scripts.migrate_legacy_signins_v58_13_109b` when ready.

## Screenshot proof (Playwright)
- Direct visit `/app/site-signin` (authed) → final URL `/app/admin/visitors`, page renders `<h1>Site Visitors</h1>` + real visitor table (Stephen Guy, E2E Testing Agent, RL Test 1-9, etc.).
- `/app/site-signin/deep/path` (wildcard child) → same redirect.
- Sidebar shows "Site Visitors" as the sole visitor-related entry, footer version `paneltec-v160.3.9.58.13.109b`.

## Pytests
### NEW `test_retire_site_signin_v58_13_109b.py` — 9 tests
1. `test_site_signin_list_component_deleted` — file existence pin (asserts DELETED).
2. `test_app_js_redirects_site_signin_to_admin_visitors` — regex-anchored source pin.
3. `test_migration_script_exists_and_module_loads` — module import + exposed helpers.
4. `test_map_row_produces_expected_shape` — pure-fn: full field mapping, ppe→induction, time_in→signed_in_at composition, GPS mapping.
5. `test_map_row_falls_back_to_submitted_by_name_when_picker_empty` — resilience.
6. `test_migration_backfills_three_seeded_rows_idempotently` — seed 3 `TESTSIGNIN109b-*` rows, run migration twice, verify inserted=3 on first pass, inserted=0 on second, all rows carry `source="legacy_signin_migration"` + `induction_acknowledged=True`.
7. `test_running_version_ge_109b`
8. `test_mobile_bundle_version_ge_109b`
9. `test_service_worker_cache_version_ge_109b`

### Legacy tests updated
- 7 legacy tests referencing the deleted `SiteSigninList.jsx` handled two ways:
  - Auto-skip via new `conftest.py` for tests whose id / name carries the `site_signin` fingerprint.
  - PAGES / iteration lists stripped in `test_capture_wiring_v58_13_40/41/42.py` + `test_tile_size_colour_parity_v58_13_38.py` (surgical entry removal, no other test semantics changed).

## Full test-suite state
**975 passed / 17 skipped / 3 pre-existing failures + 10 pre-existing collection errors**:
- 15 of the 17 skips are the `conftest.py` auto-skip for the retired-flow legacy tests (working as intended).
- 3 failures are all pre-existing (2 mobile-palette on the untouchable `/app/mobile/colors.ts`, 1 openapi test flaking under the 5/min login rate limit — bug parked for `.106c`).
- 10 collection errors are the same pre-existing rate-limit-affected HTTP tests on `test_schedule_delete_cascade_v58_13_16.py` and `test_schedule_attachments_v58_13_14.py`.
- Zero regressions introduced by this ship.

## Version bumps confirmed
```
frontend/src/lib/version.js:       RUNNING_VERSION        = 'paneltec-v160.3.9.58.13.109b'
mobile/src/lib/version.ts:         MOBILE_BUNDLE_VERSION  = 'paneltec-v160.3.9.58.13.109b'
frontend/public/service-worker.js: CACHE_VERSION          = 'paneltec-v160.3.9.58.13.109b'
```

## NOT changed
- No backend endpoint edits (route retirement + one-shot script only).
- `sites_visitors` permission schema / role defaults.
- `/app/mobile/` code (only MOBILE_BUNDLE_VERSION bumped).
- The 20 pre-existing `ephemeral-upload-storage` lint warnings (still parked for v58.14.x).

## Next action items
- **Run the migration on preview** (manual, admin-triggered): `python -m backend.scripts.migrate_legacy_signins_v58_13_109b` — will import the 1 legacy row into `site_visitors`.
- **v58.13.106c** (still queued): `TEST_MODE_BYPASS_RATE_LIMIT` in test env → unblocks the 10 rate-limit-affected HTTP tests.
- **v58.14.x**: object-storage migration to clear the 20 ephemeral-upload lint warnings.
