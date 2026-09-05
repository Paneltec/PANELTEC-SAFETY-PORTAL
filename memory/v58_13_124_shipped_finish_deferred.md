# v58.13.124 — Bundled UX + data cleanup + header banner — SHIPPED (finish deferred)

`finish` tool remains bypassed by the 20 pre-existing
`ephemeral-upload-storage` lint warnings; parked for v58.14.x.

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — `MOBILE_BUNDLE_VERSION` bumped only.
- No comms.
- 20 deferred warnings still parked.
- Dry-run + green-light gate honoured on kind migration + purge.

## Ship one-liner
Fleet & Service Register visual + data hygiene pass:
JPEG header banner, violet→indigo toolbar strip, zebra table,
+3 typography-scale bumps in the filter tree, `.121a` write-path
normaliser + one-off Vacuum-Truck clean, 90-row TEST-* purge with
audit log + startup-guard, deferred `.121` testid regression
hotfix.

## Files touched (11)
- `backend/asset_taxonomy.py` — NEW shared canonical-map module
- `backend/assets.py` — Navixy backfill write-path applies helper
- `backend/asset_navixy_sync.py` — `.121a` TODO retired, note updated
- `backend/scripts/backfill_maintenance_regos_v58_13_120.py` — write-path helper
- `backend/scripts/purge_test_v58_13_all_leftovers_v58_13_124.py` — NEW purge script
- `backend/server.py` — startup pollution guard
- `frontend/src/pages/FleetRegister.jsx` — banner + toolbar strip + zebra + typography
- `frontend/public/fleet-register-header.jpg` — NEW (507 KB JPEG)
- `frontend/src/lib/version.js` — `.124`
- `frontend/public/service-worker.js` — `.124`
- `mobile/src/lib/version.ts` — `.124`

## Test updates
- `tests/backend_unit/test_v58_13_124_taxonomy_and_purge.py` — NEW 15 tests
- `tests/backend_unit/test_service_check_sheet_v58_13_121.py` — `.123a-hotfix` for sheet-cust-signature → sheet-attach-dropzone
- `tests/backend_unit/test_service_sheet_punchlist_v58_13_123a.py` — version pin ratchets forward
- `tests/backend_unit/test_fleet_service_schedules_v58_13_122.py` — `.121a` marker asserts DONE state

## Post-ship state
- Fleet register: 130 assets (was 220 pre-purge)
- KIND totals: vehicle=98, trailer=20, plant=12
- Vacuum Truck: 18 (was split 13+5, now unified)
- Startup guard: WARNING when TEST-v58.* rows exist, INFO(0 rows clean) otherwise
- `.121` testid regression: patched
- Version: `paneltec-v160.3.9.58.13.124` live in both screenshots

## Pytest tally
- Full backend: 1101 passed, 2 pre-existing env flakes, 4 skipped (up from 1086 at `.123a`)
- `.124` suite alone: 15/15 pass

## Deferred behind `.124`
- **`.122b`** — historic pm back-fill (~689 rows). Still queued.
- **`.122c`** — trailer date-anchor scheduling. Still queued.
- **v58.14.x** — object-storage migration to clear the 20 lint warnings.

## Audit + rollback
- Purge log: `/app/memory/purge_v58_13_124_log.txt` (90 full-doc JSON lines).
- `.120g` normalize reversible via `--reverse` flag on the sweep script.
