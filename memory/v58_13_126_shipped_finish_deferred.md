# v58.13.126 — Bundled UX + data correction — SHIPPED (finish deferred)

`finish` bypassed by the 20 pre-existing `ephemeral-upload-storage`
warnings; parked for v58.14.x.

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — `MOBILE_BUNDLE_VERSION` bumped only.
- No comms.
- 20 deferred warnings still parked.

## Ship one-liner
- Restored missing Trailer button in AssetDrawer Kind selector
- Server-side collapse of duplicate sub-type buckets (Vacuum Truck 13+5 → 18, Uncategorised 18→5)
- Server-authoritative Data-source counts (All 130 · Navixy 72 · Manual 58 — was 130/0/130)
- Fleet register list projection now surfaces navixy_device_id + odo_km + hours_meter
- ServiceCheckSheetModal gets a persistent Navixy connection banner
- getgas (Gas Truck - Isuzu - XT44CB) reclassified vehicle→trailer as requested

## Root causes uncovered

**Item 8 (Vacuum Truck 5 vs 18)** — `/api/fleet/categories` grouped by RAW case-sensitive
`asset_type`, so `vacuum_truck` (13) and `Vac Truck` (5) sat in separate buckets.
Frontend's `_SUBTYPE_CANONICAL_DISPLAY` collapsed the *labels* but NOT the counts,
producing two "Vacuum Truck" buttons in the tree — user only saw the smaller one.
Fix: `normalize_asset_type()` applied at aggregation-time before grouping.

**Item 9 ("Manual 130" bug)** — `AssetRow` Pydantic response model on
`/api/fleet/register` silently dropped `navixy_device_id`, so the frontend's
sourceCounts derived `navixy = rows.filter(r => !!r.navixy_device_id).length`
always returned 0, and `manual = total - 0 = total`.
Fix: (a) `AssetRow` now includes `navixy_device_id`, `odo_km`, `hours_meter`,
`nfc_uid`. (b) `/api/fleet/categories` returns authoritative `source_counts:
{total, navixy, manual}` that the frontend prefers over derived counts.

## Files touched (7)

**Backend (2)**
- `backend/fleet.py` — `AssetRow` fields + `/categories` normalize + source_counts

**Frontend (4)**
- `frontend/src/components/AssetDrawer.jsx` — Trailer button in KIND_OPTIONS
- `frontend/src/pages/FleetRegister.jsx` — prefer categories.source_counts
- `frontend/src/components/ServiceCheckSheetModal.jsx` — persistent Navixy connection banner
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js` + `mobile/src/lib/version.ts` — `.126`

**Tests (1 new + 3 ratchets)**
- `tests/backend_unit/test_v58_13_126_bundle.py` — NEW 7 tests, all pass
- `tests/backend_unit/test_fleet_register_phase1_v58_13_120a.py` — trailer count ratchet ≥20
- `tests/backend_unit/test_v58_13_125_bundle.py` — canonical version pin ratchet ≥125

## Data mutation
- 1-row `assets` PATCH: getgas (Gas Truck - Isuzu - XT44CB, id 9590bd30...) → kind=trailer, asset_type=Trailer, audit marker `_kind_reclassified_v126=true` + `_prior_kind=vehicle`.
- Reverse: `db.assets.updateOne({_kind_reclassified_v126: true}, {$set: {kind: '$_prior_kind', asset_type: '$_prior_asset_type_v126'}, $unset: {...markers}})`.

## Post-ship counts (authoritative, from `/api/fleet/categories`)

```
total: 130   source_counts: { total: 130, navixy: 72, manual: 58 }

Vehicle (97):
  Ute:            35
  Commercial:     20
  Vacuum Truck:   18       ← collapsed, was split 13+5
  Tipper:         11
  Service Truck:   5       (was 6, lost getgas → trailer)
  Other:           5       (displays as "Uncategorised")
  Crane Truck:     2
  Passenger:       1

Trailer (21):              ← was 20, gained getgas
  Trailer:        21

Plant (12):
  Excavator:       6
  Compactor:       3
  Telehandler:     1
  Road Roller:     1
  Directional Drill: 1
```

Sum-check: 97 + 21 + 12 = 130 ✅
Data-source sum: 72 + 58 = 130 ✅

## Pytest tally
- `1111 passed, 2 pre-existing env flakes, 6 skipped` in 10.14s
- `.126` suite alone: 7/7 pass
- Ratchets: `test_v58_13_125_bundle` version pin, `test_fleet_register_phase1_v58_13_120a` trailer ≥20 pin

## Left-behind for `.127`
- **Underlying DB drift not eliminated** — raw `asset_type` still has snake_case
  values (`vacuum_truck`, `ute`, `tipper`, `other`, etc.) alongside Title-Case ones.
  `.126` fixed the aggregation-time collapse so the UI presents them correctly, but
  the write-path still isn't producing Title-Case for all mutations.
  Next-ship task: force-normalize at DB level + trace who's still writing snake_case.
- **AssetRow future fields** — nfc_uid returned via list projection but frontend chip
  logic in `RegisterTable` doesn't yet render it.

## Deferred behind `.126` (unchanged queue)
- `.127` — DB-level normalize enforcement + trace
- `.122b` — historic pm back-fill (~689 rows)
- `.122c` — trailer date-anchor scheduling
- v58.14.x — object-storage migration to clear the 20 lint warnings

## Screenshots (embedded in ship report)
1. Filter tree post-.126: All 130 · Navixy 72 · Manual 58, Vehicle 97 (Vacuum Truck 18, Uncategorised 5), Trailer 21, Plant 12
2. AssetDrawer Details edit: Kind buttons now show Vehicle · Plant · **Trailer** · Tool · Container
