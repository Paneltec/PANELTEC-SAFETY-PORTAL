# v58.13.129 — Enrich empty asset names from pm history — SHIPPED (finish deferred)

`finish` bypassed by 20 pre-existing `ephemeral-upload-storage` warnings.

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — version-only bump.
- No comms.
- Dry-run + green-light gate honoured.
- 20 deferred warnings still parked.

## Ship one-liner
Enriched 28 empty-name assets (20 trailers + 7 vehicles + 1 plant)
with `name` copied from their `plant_maintenance` history's
`description`. Selection: latest `date_completed` DESC, tie-break
longest description. 3 rows also had `asset_type` canonicalised
`"Vac Truck"` → `"Vacuum Truck"` (in-place, matches the sub_type
that was already normalising to the same canonical bucket).

## Q-rules respected
- Q1: Kept freehand notes verbatim (e.g. `TU3144` = "Drill trailer??? Craig took to Vic").
- Q2: Never overwrote a more-specific existing asset_type — only filled empty or normalise-collapsible.

## Files touched (5)
- `backend/scripts/enrich_asset_names_v58_13_129.py` — NEW 130 lines (dry-run default, `--commit`, `--reverse`)
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js` + `mobile/src/lib/version.ts` → `.129`
- `tests/backend_unit/test_v58_13_129_enrich.py` — NEW 5 tests, all pass

## Data mutation summary
- **28 assets** updated with `name` from pm.description
- **3 assets** also updated `asset_type` (in-place canonicalisation: `Vac Truck` → `Vacuum Truck` for WV1503, XT16AB, XT44DL)
- **25 assets** kept existing asset_type unchanged (already canonical or more-specific)
- Audit markers on every touched row: `name_enriched_v129=true`,
  `name_before_v129`, `asset_type_before_v129`, `name_enriched_at`
- Reverse: `python /app/backend/scripts/enrich_asset_names_v58_13_129.py --reverse`

## Full 28-row before/after

```
rego       before_at      after_at       name (all before='', all after=description below)
K82KU      Commercial     Commercial     Ranger - Service Utility            ← flagship
NIL        Excavator      Excavator      Kobelco 13.5T - SK135SR-5
RT4506     Trailer        Trailer        520 Drill Trailer Small
TU3144     Trailer        Trailer        Drill trailer??? Craig took to Vic
WV1503     Vac Truck   →  Vacuum Truck   IZUSU Street Sweeper
XT16AB     Vac Truck   →  Vacuum Truck   BEING SOLD May 2025- Cappellotto ...
XT29DK     Commercial     Commercial     ISUZU TIPPER F SERIES FRR 110-240
XT30DK     Commercial     Commercial     ISUZU Tipper F Series FRR 110-240
XT44DL     Vac Truck   →  Vacuum Truck   Scania Kor 3200
XT5606     Trailer        Trailer        Telstra Cable Drum Trailer
Y24FE      Trailer        Trailer        TDM Axle 8 x 5 Galvanised Box Tilting Plant
Y39QO      Trailer        Trailer        TDM Axle 8 x 5 Box with Racks
Y42GM      Trailer        Trailer        Single Axle 6 x 4 Box with Ramp
Y55KL      Trailer        Trailer        Single Axle 6 x 4 Box Traffic Lights
Y60WX      Trailer        Trailer        New Alloy Plant Trailer
Y73BT      Trailer        Trailer        Single Axle 6 x 4 Box Mounted Easement Reel
Y78HW      Trailer        Trailer        TDM 1.8t Excavator trailer
Y93LQ      Trailer        Trailer        TDM 1.8t Excavator trailer
YT85AF     Trailer        Trailer        Tri-Axle Flatbed Plant
Z25NT      Trailer        Trailer        TDM Axle 8 x 5 Box with Cage
Z27SP      Trailer        Trailer        TDM Axle Flatbed Plant
Z38HF      Trailer        Trailer        TDM 1.8t Excavator trailer
Z44LR      Trailer        Trailer        Single Axle Flatbed Plant
Z45KE      Trailer        Trailer        Long Pipe Trailer - Mercedes
Z46GZ      Trailer        Trailer        Trailer
Z53KZ      Trailer        Trailer        TDM Bore Pipe Trailer - Large
Z74QU      Commercial     Commercial     Vermeer Vacuum Trailer - V100G
Z87SX      Trailer        Trailer        TDM Bore Pipe Trailer - Large
```

## K82KU verification

Post-commit DB probe:
```
rego_serial                = 'K82KU'
kind                       = 'vehicle'
asset_type                 = 'Commercial'
asset_type_before_v129     = 'Commercial'
name                       = 'Ranger - Service Utility'    ← enriched ✅
name_before_v129           = ''
name_enriched_v129         = True
```

Global search screenshot proof: typing `K82KU` in the top nav now
returns "Ranger - Service Utility" as the top ASSET result (was
previously blank/fallback). Two service history entries also show
the same enriched label.

## Pytest tally
- `.129` suite alone: 5/5 pass
- Full: unchanged from `.128a` baseline (2 pre-existing env flakes)

## Deferred behind `.129` (rescheduled queue per user directive)
- `.130` — DB-level normalize enforcement + Navixy re-drift trace (bumped from `.129`)
- `.122b` — historic pm back-fill (~689 rows)
- `.122c` — trailer date-anchor scheduling
- v58.14.x — object-storage migration to clear the 20 lint warnings
