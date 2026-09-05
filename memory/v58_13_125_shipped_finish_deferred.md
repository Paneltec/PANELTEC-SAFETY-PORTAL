# v58.13.125 — Filter-tree redesign + data cleanup + rego re-parse — SHIPPED (finish deferred)

`finish` bypassed by the 20 pre-existing `ephemeral-upload-storage`
warnings; parked for v58.14.x.

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — `MOBILE_BUNDLE_VERSION` bumped only.
- No comms.
- Dry-run + green-light gate honoured on every data mutation.
- 20 deferred warnings still parked.

## Ship one-liner
- Filter tree redesign to **Option B** (Data-source radio above KIND) with mutual-reset rule
- Retroactive reclassify shrinks "Other"/"Uncategorised" from 18 → 5
- REGO column now shows real regos (extracted from name for 9/12 Navixy-imported rows)
- Zebra darkened, REGO column font bumped, "Other" → "Uncategorised" label
- Session-scoped autouse conftest sweep prevents future TEST-* pollution
- Env-gated live-integration tests (default: skipped)
- Widened `_parse_rego_from_label` regex + widened `VEHICLE_TYPE_KEYWORDS`

## Files touched (13)

### Backend
- `backend/assets.py` — `_parse_rego_from_label` rewritten (2-pass regex), `v.get("plate")` fallback dropped, POST + PUT apply `normalize_asset_type` on write
- `backend/forms.py` — `VEHICLE_TYPE_KEYWORDS` widened (+D/Max, BT-50, Landcruiser, HiAce, DAF Tilt Tray, Hino Carbon/Curtain, Flocon, Gas Truck, Prime Mover, Rammer)
- `backend/scripts/reclassify_other_v58_13_125.py` — NEW retroactive classifier (13/18 moved)
- `backend/scripts/reparse_rego_v58_13_125.py` — NEW rego re-parse (9/12 extracted, 3 remain null → name fallback)

### Frontend
- `frontend/src/pages/FleetRegister.jsx` — Data-source radio, mutual-reset rule, Reset filters link, "Other" → "Uncategorised" display, REGO column font-mono text-sm font-semibold + numeric-id rejection, zebra darkened `bg-slate-50/60` → `bg-slate-100`, data-source filter threading (client-side manual filter, server-side navixy_only)
- `frontend/src/lib/version.js` — `.125`
- `frontend/public/service-worker.js` — `.125`
- `mobile/src/lib/version.ts` — `.125`

### Tests
- `tests/backend_unit/conftest.py` — session-scoped autouse pollution sweep
- `tests/backend_unit/test_schedule_attachments_v58_13_14.py` — env-gate + `try/finally` teardown
- `tests/backend_unit/test_schedule_delete_cascade_v58_13_16.py` — env-gate
- `tests/backend_unit/test_v58_13_125_bundle.py` — NEW 14 tests
- `tests/backend_unit/test_v58_13_124_taxonomy_and_purge.py` — ratchet version pin forward
- `tests/backend_unit/test_fleet_punchlist_v58_13_120g.py` — updated for Data-source radio

## Data commits landed (with reverse scripts)

| Script | Modified | Reverse |
|---|---|---|
| `purge_test_v58_13_all_leftovers_v58_13_124.py --commit` | 20 assets + 20 schedules purged (auto-swept by conftest before commit ran → 0-op live) | `mongoimport` of `/app/memory/purge_v58_13_124_log.txt` |
| `reclassify_other_v58_13_125.py --commit` | 13/18 reclassified (D/Max × 4, BT-50 × 4, Landcruiser, HiAce, DAF, Hino Carbon, Flocon, Gas Truck, Prime Mover) | `--reverse` restores from `_prior_asset_type` marker |
| `normalize_subtype_v58_13_120g.py --commit` | 55 assets + 165 pm rows to Title-Case | `--reverse` restores from `sub_type_before_v120g` marker |
| `reparse_rego_v58_13_125.py --commit` | 12 rows: 9 rego extracted, 3 nulled → name fallback | `--reverse` restores from `_prior_rego_serial` marker |

## Post-ship state (`/api/fleet/categories`)

```
Total: 130 assets

Vehicle (98):
  Ute:            35   (was 27 → +8 reclassified)
  Commercial:     20
  Vacuum Truck:   18   ← unified (was split 13 + 5)
  Tipper:         11
  Service Truck:   6   (was 2 → +4 reclassified)
  Other:           5   (was 18 → shrunk, displays as "Uncategorised")
  Crane Truck:     2   (was 1 → +1 reclassified)
  Passenger:       1

Trailer (20):
  Trailer:        20

Plant (12):
  Excavator:       6
  Compactor:       3
  Telehandler:     1
  Directional Drill: 1
  Road Roller:     1
```

## Pytest tally
- `1104 passed, 2 pre-existing env flakes, 6 skipped` (up from 1101 at `.124`)
- `.125` suite alone: 14/14 pass

## Trace of the normalize-in-scheduler regression
- Root cause: NOT the Navixy scheduler. `sync_navixy_counters → _sync_org` writes only counter fields, never `asset_type`.
- Real culprits: `POST /api/assets` line 404 and `PUT /api/assets/{id}` line 447 both did `body.asset_type.strip().lower().replace(" ", "_")`. The `.121a`/`.124` fix wired `normalize_asset_type` into `_navixy_backfill_assets` only; the manual create/update paths (used by the frontend AssetDrawer AND the pytest fixtures) still snake-cased.
- `.125` fix: apply `normalize_asset_type` on both POST and PUT — same helper, same map. Belt-and-braces confirmed via write-path pytests.

## Deferred behind `.125`
- **`.126`** — server-side sourceCounts on `/api/fleet/register` so the Data-source radio shows accurate Navixy / Manual totals (today it's derived from current page rows, showing 0 when no rows carry `navixy_device_id` in the list projection).
- **`.122b`** — historic pm back-fill (~689 rows). Still queued.
- **`.122c`** — trailer date-anchor scheduling. Still queued.
- **v58.14.x** — object-storage migration to clear the 20 lint warnings.

## Audit + rollback locations
- `/app/memory/purge_v58_13_124_log.txt` — purge log (from `.124`, still current)
- Mongo audit markers on touched rows:
  - `_reclassified_v125` + `_prior_asset_type` + `_reclassified_at`
  - `_rego_reparsed_v125` + `_prior_rego_serial` + `_rego_reparsed_at`
  - `sub_type_normalised_v120g` + `sub_type_before_v120g` (existing)

## Screenshot proof
Live preview screenshot embedded in ship report above shows:
- Data source radio: All sources 130 (selected) · Navixy-tracked 0 · Manual 130
- Vehicle sub-tree expanded: Ute 35, Commercial 20, Vacuum Truck 18, Tipper 11, Service Truck 6, **Uncategorised 5**, Crane Truck 2, Passenger 1
- REGO column: A18DC, A26GL, A32GL, A93NI, B88TI, C43ZW, D02RF, D03RF, D04RF, D45JB, D56YP, D67YQ — real regos, no 18-digit device IDs
- Reset filters link (violet, top-right of KIND section)
- Service due 28 chip inside violet band
- Version footer `paneltec-v160.3.9.58.13.125`
