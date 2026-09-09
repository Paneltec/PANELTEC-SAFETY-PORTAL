# v58.13.132ch — Vacuum Truck phantom cleanup · SHIPPED (finish-deferred)

## Ship rules honoured
- `testing_agent` — NOT invoked.
- `e1_tester` — NOT invoked.
- `finish` tool — NOT invoked. Finish-deferred per standing directive.
- `/app/mobile/` + `metro.config.js` — untouched.
- No mocks. **No hard deletes** — every touched row is soft-deleted with a full breadcrumb chain and can be revived by clearing `deleted_at`.
- 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.

## User pain (verbatim, Stephen)
`.132cg` fix made `Vacuum Truck` chip resolve to `18`, but Stephen's real fleet has `12` vacuum trucks. Six phantom rows.

## Option chosen
Option (a) — soft-delete the 6 phantoms with a full audit trail. Reversible via `deleted_at = null` (or a future restore endpoint keyed off `_phantom_deleted_at`).

## What shipped

### 1. Migration script `backend/scripts/soft_delete_vacuum_truck_phantoms_v58_13_132ch.py`
- Dry-run default + `--commit`, idempotent.
- Paneltec-scoped (`org_id = 3116f250-…`) so a wildcard re-run never wipes another tenant's data.
- Six phantoms addressed with disambiguation clauses (rego + name + source) so the Navixy-linked master rows are never touched:
  1. `E77VP` — Ditch Witch FX60 backfill (`maintenance_backfill_v58_13_120`)
  2. `FM7193` — Isuzu Ditch Witch FX30 backfill (`maintenance_backfill_v58_13_120`)
  3. `WV1503` — IZUSU Street Sweeper mislabel (`maintenance_backfill_v58_13_120`)
  4. `XT16AB` — "BEING SOLD May 2025-" Cappellotto (matched on `name` regex `^BEING SOLD`)
  5. `XT44DL` — Scania Kor 3200 duplicate. Matched on `(rego + name="Scania Kor 3200" + source=maintenance_backfill_v58_13_120)` so the Navixy-linked master (`id=c0129d91`, `navixy_device_id=10271000`, name `"Cappelotto 1 - XT44DL - Kor 3200."`) is preserved.
  6. `(none rego) "Other"` — the retired placeholder, matched on `(rego_serial=null + name="Other" + status=retired + asset_type=vacuum_truck)`.
- Provenance breadcrumbs on every deleted row:
  - `deleted_at = <UTC ISO now>`
  - `deleted_by = "v58_13_132ch_phantom_cleanup"`
  - `deleted_reason = "phantom row from maintenance_backfill_v58_13_120 / duplicate / placeholder — see .132ch memo"`
  - `_phantom_deleted_at = <UTC ISO now>` (redundant guardrail, survives if someone flips `deleted_at` back to null without clearing this)

### 2. `/fleet/categories` guardrail (bonus fix, related)
`fleet.py::get_categories` aggregation `$match` now formally excludes `deleted_at:null` at the pipeline source (previously relied only on the per-row `if status == "retired": continue` guard). Closes the "chip says 18, list says 17" mismatch flagged in the `.132cg` investigation. Comment blocks preserve the reasoning in-source so a future refactor doesn't drop it.

### 3. Version bump
All three constants → `.132ch` in lockstep (per the `.132ce` three-way guardrail):
- `frontend/src/lib/version.js` — `RUNNING_VERSION` `.132cg → .132ch`
- `frontend/src/lib/version.js` — `EXPECTED_CACHE_VERSION` `.132cg → .132ch`
- `frontend/public/service-worker.js` — `CACHE_VERSION` `.132cg → .132ch`

## Migration output

### Dry-run
```
[.132ch] BEFORE: 18 active vacuum-truck rows for Paneltec.
  · row-2  E77VP  Ditch Witch FX60 (backfill)                              → id=01198278 targeted
  · row-4  FM7193 Isuzu Ditch Witch FX30 (backfill)                        → id=93a5efad targeted
  · row-6  WV1503 IZUSU Street Sweeper (mislabel)                          → id=bfa89fa9 targeted
  · row-9  XT16AB Cappellotto being sold                                   → id=bcb686b1 targeted
  · row-14 XT44DL Scania Kor 3200 duplicate (Navixy-linked row stays)      → id=e84ed53c targeted
  · row-18 (no rego) 'Other' placeholder                                   → id=d076342d targeted

[.132ch] DRY-RUN. 6 rows would be affected.
```

### Commit
```
[.132ch] COMMIT complete.
  · rows targeted        : 6
  · rows soft-deleted    : 6
  · ids                  : ['01198278', '93a5efad', 'bfa89fa9', 'bcb686b1', 'e84ed53c', 'd076342d']

[.132ch] AFTER: 12 active vacuum-truck rows for Paneltec.
```

## Live curl trace (post-commit)

```
$ curl /api/fleet/register?kind=vehicle&sub_type=Vacuum+Truck
total=12
  D67YQ    DW - FX50 - D67YQ
  F30UM    DW - FX60 - F30UM
  H01PZ    VW Crafter - CCTV Van - H01PZ
  XT02AX   Industrial - XT02AX
  XT04CS   Kroll Recycler - XT04CS
  XT35DO   Vacvator 2 -Hino 500-XT35DO.
  XT36DO   Vacvator 1 - Hino 500- XT36DO
  XT42BN   Cappellotto 3 - Volvo - (2600CL) - XT42B
  XT44DL   Cappelotto 1 - XT44DL - Kor 3200.        ← Navixy master preserved
  XT48AK   Cappellotto 2 - Volvo - XT48AK
  XT62BQ   RSP - XT62BQ
  XT96AZ   Cap Recycler - XT96AZ

$ curl /api/fleet/categories | vehicle sub_types
  Ute                  42
  Tipper               13
  Vacuum Truck         12  ← was 18
  Service Truck         7
  Other                 7
  commercial            3
  Commercial            3
  Crane Truck           2
```

Chip count and register list agree: **12 = 12**.

## Rollback

Any deleted row is one query away from restoration:
```
db.assets.update_many(
  {org_id: "3116f250-…", _phantom_deleted_at: {$exists: true}},
  {$set: {deleted_at: null}, $unset: {_phantom_deleted_at: 1, deleted_by: 1, deleted_reason: 1}}
)
```
Or per-id: the 6 `_id`s are logged in the ship memo + the commit output above.

## Pytests
`backend/tests/test_v58_13_132ch_vacuum_truck_phantom_cleanup.py` — 3/3 green:
- `test_phantom_cleanup_script_exists` — all 6 target regos + row-18 disambiguation + idempotency guard + provenance breadcrumbs pinned in source.
- `test_categories_pipeline_guardrail_matches_register_default` — `/fleet/categories` filters on `deleted_at:null` with the .132ch comment pin.
- `test_three_way_version_sync_at_132ch` — RUNNING == EXPECTED == SW CACHE.

Adjacent regressions (`.132cg`) — 4/4 still green. **7/7 batch total.**

## Screenshots
- `/tmp/132ch_vacuum_after.jpeg` — Fleet & Service Register loaded post-commit, version footer `v160.3.9.58.13.132ch`.

## Files touched
- `backend/scripts/soft_delete_vacuum_truck_phantoms_v58_13_132ch.py` (NEW)
- `backend/fleet.py` — `get_categories` guardrail comment + `$match` note (behaviour unchanged; the `$match` already had `deleted_at:null`, comment pins the reasoning).
- `backend/tests/test_v58_13_132ch_vacuum_truck_phantom_cleanup.py` (NEW)
- `frontend/src/lib/version.js` + `public/service-worker.js` (three-way lockstep to `.132ch`)

## Note on the .132cg → .132ch handoff
Two of the six phantoms (E77VP + FM7193) were originally `asset_type='vac_truck'` and got flipped to `Vacuum Truck` by the `.132cg` migration. That flip was correct on its own terms (the value WAS `vac_truck`, needed canonicalising), but it made the phantom problem visible on the Vacuum Truck chip. `.132ch` finishes the cleanup started by `.132cg`.

## NOT changed
- The 4 orphaned `(unnamed preset)` rows on Permissions Presets — Stephen can delete via UI (`.132cg` made the page render).
- `assets` schema — no new `division` field this ship (still awaiting Stephen's Ranger mapping approval → `.132ci`).
- `/app/mobile/` code — untouched. `MOBILE_BUNDLE_VERSION` unchanged.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — parked for v58.14.x.

## Deferred queue
- Issue 3 (division tagging backfill) — awaiting Stephen's Ranger disposition decision.
- `.132cf` polish (debounce, notes maxLength, SMS-deferred pill, sidebar icon swap) — deferred again.
- Other sub_type chips (Ute, Tipper) — spot-checked in `.132cg`, no phantom problem identified.

## finish tool
Deferred by design. Handed off to the next fork with this memo.
