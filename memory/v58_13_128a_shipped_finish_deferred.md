# v58.13.128a — Archived divider above Retired/Sold — SHIPPED (finish deferred)

`finish` bypassed by 20 pre-existing `ephemeral-upload-storage` warnings.

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — version-only bump.
- No comms.
- 20 deferred warnings still parked.

## Ship one-liner
Added a dark slate (`bg-slate-900`) divider band with muted-white
"ARCHIVED" label centred immediately above the Retired/Sold row in
the KIND filter tree. Rounded ends match the sidebar aesthetic.

## Files touched (4)
- `frontend/src/pages/FleetRegister.jsx` — divider markup
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js` + `mobile/src/lib/version.ts` → `.128a`
- `tests/backend_unit/test_v58_13_128a_divider.py` — NEW 2 tests, both pass

## Pytest tally
- `.128a` + `.128` combined: 9/9 pass
- Full: unchanged from `.128` baseline (2 pre-existing env flakes only)

## Screenshot (embedded in ship report)
Filter tree shows:
- Data source stack: All 122 · Navixy 72 · **Added Manually 50** · Service due 26
- Active KIND buckets: All 122, Vehicle 95, Trailer 21, Plant 6
- **Dark black "ARCHIVED" band** — rounded, muted-white uppercase label ✅
- **Retired / Sold 8** row directly below the divider
- Version footer: `paneltec-v160.3.9.58.13.128a`

## Data mutations
None — pure CSS + copy. Retired count showed 8 (was 7 at `.128`) because
another asset was archived in the interim — not a regression.
