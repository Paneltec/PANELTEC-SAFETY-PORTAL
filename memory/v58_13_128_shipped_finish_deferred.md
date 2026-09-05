# v58.13.128 — Retired/Sold segregation + "Added Manually" rename — SHIPPED (finish deferred)

`finish` bypassed by 20 pre-existing `ephemeral-upload-storage` warnings.

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — `MOBILE_BUNDLE_VERSION` bumped only.
- No comms.
- 20 deferred warnings still parked.

## Ship one-liner
- Item 1: Retired/Sold as its own synthetic KIND heading at the bottom of the filter tree. Default view now excludes `status=retired` from active KIND buckets (vehicle 97→95, plant 12→7, all 130→123). Clicking Retired/Sold flips a `retired_only` filter and shows mixed retired rows with rose "Retired" pill + 60% opacity. Expanded, a nested breakdown surfaces the original kind (Plant 5, Vehicle 2).
- Item 2: Data-source radio label "Manual" → "Added Manually". Backend key `source_counts.manual` unchanged (internal).

## Pre-flight audit
```
status=retired count per kind:
  plant:    5
  vehicle:  2
  ─── all retired: 7
```

## Files touched (5)
- `backend/fleet.py` — `retired_only` query param on `/register`, `retired` roll-up on `/categories`
- `frontend/src/pages/FleetRegister.jsx` — filter state, Retired/Sold row, rose pill + muted rows, "Added Manually" copy, Archive icon import
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js` + `mobile/src/lib/version.ts` → `.128`
- `tests/backend_unit/test_v58_13_128_bundle.py` — NEW 7 tests, all pass

## Curl proofs

`/api/fleet/categories`:
```json
{ "total": 123,
  "source_counts": {"total": 123, "navixy": 72, "manual": 51},
  "retired": {
    "total": 7,
    "by_kind": {"plant": 5, "vehicle": 2},
    "source_counts": {"total": 7, "navixy": 0, "manual": 7}
  },
  "kinds": [
    {"kind": "vehicle", "total": 95, ...},
    {"kind": "trailer", "total": 21, ...},
    {"kind": "plant",   "total": 7,  ...}
  ]}
```

`/api/fleet/register?retired_only=true` → 7 rows, all `status=retired`,
kind mix `plant×5 + vehicle×2` — verified via curl.

## Pytest tally
- Full: `1133 passed, 2 pre-existing env flakes, 6 skipped` in 10.06s (up from 1126 at `.127a`)
- `.128` suite alone: 7/7 pass
- Ratchets: `.127` + `.127a` version pins moved to `>= 127` accept-anything-newer

## Screenshot (embedded in ship report)
- Data source: All 123 · Navixy 72 · **Added Manually 51** ✅
- Active KINDs: Vehicle 95 · Trailer 21 · Plant 7 (dropped 7 retired from previous 130)
- **Retired / Sold 7** row at bottom (Archive icon), selected/black state
- Breakdown under it: Plant 5, Vehicle 2 ✅
- Register table shows 7 rows all with rose "Retired" pill next to rego, muted opacity, kind badge showing original kind (PLANT/VEHICLE)
- Version footer `paneltec-v160.3.9.58.13.128`

## Data mutations
None — pure filter/segregation change.

## Deferred behind `.128` (unchanged queue)
- `.129` — DB-level normalize enforcement + Navixy re-drift trace (still)
- `.122b` — historic pm back-fill (~689 rows)
- `.122c` — trailer date-anchor scheduling
- v58.14.x — object-storage migration to clear the 20 lint warnings
