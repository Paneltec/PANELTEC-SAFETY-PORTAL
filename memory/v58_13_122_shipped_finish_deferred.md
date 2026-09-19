# v58.13.122 — Service Schedule Module — SHIPPED (finish deferred)

`finish` tool remains bypassed by the 20 pre-existing
`ephemeral-upload-storage` lint warnings; parked for v58.14.x.

## Rules obeyed
- No `testing_agent` used.
- No `/app/mobile/` code touched — only `MOBILE_BUNDLE_VERSION`.
- No comms.
- 20 deferred warnings still parked.
- `.122b` back-fill + `.121a` Navixy write-path normalisation
  deliberately deferred to their own ships (TODO markers on disk).

## Feature summary

Canonical PM (preventative maintenance) schedule engine with the
"Whichever Comes First" rule (km vs engine-hours). Front-of-house
surfaces:
- Coloured **Status pill** on every register row (green / amber /
  red / grey — pulsing dot only on red per your directive).
- Sidebar **Service due** filter chip with a workload count badge.
- **Service Level dropdown** in the Service Check Sheet modal that
  pre-populates the checklist per level.
- **`ⓘ` info icon** on the Service column header explaining the
  85 % / 100 % thresholds.

## Files touched (5)

### Backend
- `backend/fleet_service_schedules.py` — NEW (~230 lines). Public
  `SCHEDULE_TABLE` const (Option A hardcoded), `SUB_TYPE_METRIC_MAP`,
  `LEVEL_ORDER`, `AMBER_THRESHOLD = 0.85`, `CACHE_TTL_SECONDS = 300`.
  `compute_next_due(asset, last_pm)` returns `{status, level, ratio,
  km_ratio, hours_ratio, due_in_km, due_in_hours,
  next_service_due_km, next_service_due_hours, primary_metric,
  hint}`. In-memory cache keyed by asset id.
  `invalidate_cache(asset_id)` for post-insert freshness.
- `backend/fleet.py`
  · `LogServiceIn` gains `service_level` (optional).
  · `log_service` calls `invalidate_cache(asset_id)` after every
    pm insert.
  · NEW `GET /fleet/assets/{id}/next-service` → single-asset
    compute.
  · NEW `GET /fleet/service-status-rollup?ids=…` → batched status
    (used by the register table + workload badge in one call).
- `backend/asset_navixy_sync.py` — TODO comment pointing at `.121a`
  (write-path normalisation of `asset_type` into the canonical
  `.120g` map — deferred as decided).

### Frontend
- `frontend/src/components/ServiceCheckSheetModal.jsx`
  · `SERVICE_LEVEL_PRESETS` const with 5 entries (Custom / Minor /
    Intermediate / Major / Heavy Overhaul) — checked-items array +
    per-item note hints per your matrix.
  · `serviceLevel` state + `applyPreset(levelKey)` — one-click
    pre-populates the 18-row checklist.
  · Effect on mount: `GET /fleet/assets/{id}/next-service`; when
    it returns km/hours, populates the "Next Service Due" block.
  · Payload gains `service_level`.
- `frontend/src/pages/FleetRegister.jsx`
  · `ServiceStatusPill` component — 4-state pill; red carries the
    pulsing dot, everything else static.
  · Register table gains a new **Service** column between Status
    and Signals, with an `ⓘ` info marker on the header.
  · Rollup effect: `GET /service-status-rollup?ids=…` fires after
    every rows change; results keyed into `statuses`.
  · FilterTree gains a **Service due** chip with a count badge
    (`amber + red` on the current page). Chip filters the row set
    client-side to AMBER + RED.

### Versions
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.122`.
- `frontend/public/service-worker.js` → same.
- `mobile/src/lib/version.ts` → same (string only).

## Endpoints — 2 new, 1 field extended

| Endpoint | Verb | Change | Permission |
|---|---|---|---|
| `/api/fleet/assets/{id}/next-service` | GET | **NEW** — single-asset compute | `assets.view` |
| `/api/fleet/service-status-rollup` | GET | **NEW** — batched, optional `ids=csv` | `assets.view` |
| `/api/fleet/assets/{id}/services` | POST | Field extension: `service_level` | `assets.edit` |

## Live backend curl proof

```
=== GET /fleet/service-status-rollup (org-wide) ===
  total statuses: 190
  counts: {'green': 9, 'amber': 1, 'red': 60, 'grey': 120}
  14e6e094…  red   lvl=major  metric=hours  hint=Major service overdue by 690 hrs · secondary km: -33,543 km
  9ecf92a8…  grey  lvl=None   metric=hours  hint=No counter data — enter reading via Service Check Sheet to enable schedule tracking
  …

=== GET /fleet/assets/{navixy_asset}/next-service ===
{
  "primary_metric": "km",
  "level": "major",
  "status": "red",
  "ratio": 10.048,        km_ratio: 8.234    hours_ratio: 10.048
  "due_in_km": -36174,    "due_in_hours": -2262,
  "next_service_due_km": 5000.0,
  "hint": "Major service overdue by 36,174 km · secondary hours: -2,262 hrs"
}
```

The 60 red statuses across the org reflect no historic-pm
back-fill (all `mileage_at_service` baselines still null). The
`.122b` back-fill migration will parse `latest_usage_reading` on
689 pre-.121 pm rows and hydrate those baselines — expected to
move the counts substantially toward green.

## Playwright screenshots (4)

- `/app/memory/v58_13_122_register_status_column.png` —
  Fleet Register with the new **Service** column populated per row:
  `OVERDUE` pills (rose, pulsing dot), `ON SCHEDULE` (emerald),
  `NO DATA` (grey). Sidebar shows the **Service due** chip with
  count `26`.
- `/app/memory/v58_13_122_service_due_filter.png` —
  Service-due chip activated. Register drops to 26 amber/red rows.
- `/app/memory/v58_13_122_sheet_intermediate_preset.png` —
  Service Check Sheet modal with Service Level = Intermediate.
  Engine Oil / Oil Filter / Air Filter / Cabin Filter / Brakes /
  Battery Condition auto-checked (tinted emerald); Fuel Filter
  still unchecked.
- `/app/memory/v58_13_122_sheet_heavy_overhaul_preset.png` —
  Service Level = Heavy Overhaul. **All 18 items auto-checked**;
  key rows carry the pre-filled note hints
  (e.g. "Timing belt/chain — 100k service replace" on Auxiliary
  Belt, "Inspect bushings for wear" on Suspension).

## Pytest tally

- `test_fleet_service_schedules_v58_13_122.py` — **31/31 pass**
  covering: schedule-table matches user matrix, thresholds at
  85 %/100 %, worst-ratio wins, grey when no counters, trailer
  date-only path, last-pm reduces since-last-reading, cache
  round-trip + invalidation, endpoints registered, cache-invalidate
  hooked in `log_service`, `service_level` field, frontend
  Service-Level dropdown with all 5 presets, next-service auto-fill,
  register `ⓘ` header + Status pill (red-only pulse), Navixy
  `.121a` TODO marker on disk, version pins.
- Total fleet-suite: **160 pass** (up from 129 at `.121`).
- Full backend: **1048 pass**, 4 skip, 2 pre-existing flakes
  (unchanged from `.121` baseline). Tally moved 1017 → 1048
  (+31 new locks).
- `.120b` endpoint-count test updated `7 → 9` for the two new
  guarded endpoints. All fleet endpoints still gated by
  `require_fleet_register_enabled`.

## Version bump confirmation

```
frontend/src/lib/version.js        RUNNING_VERSION      = 'paneltec-v160.3.9.58.13.122'
frontend/public/service-worker.js  CACHE_VERSION        = 'paneltec-v160.3.9.58.13.122'
mobile/src/lib/version.ts          MOBILE_BUNDLE_VERSION = 'paneltec-v160.3.9.58.13.122'
```

## Notes / open items for future ships

- **`.122b` — historic pm back-fill** (deferred). `scripts/backfill_pm_reading_v58_13_122b.py`
  will parse the 689 rows carrying `latest_usage_reading` as string
  ("116,758.00", "24,040.00", etc.), cast to float, and stamp
  `mileage_at_service` (for vehicles) or `hours_at_service` (for
  plant) with `.120g`-style audit markers (`reading_backfilled_v122b`,
  `reading_backfill_source_field`). Reversible.
- **`.121a` — Navixy write-path normalisation** (deferred). Move
  the `.120g` canonical-mapping into `asset_navixy_sync.py`'s
  write path so newly-ingested Navixy trackers store `asset_type`
  in canonical Title Case at rest. Frontend `displaySubtype()`
  mask + `.120g` normalize script remain the interim defence.
- **`.122c` — Trailer date-anchor**: today trailers all render
  grey. A per-org `trailer_service_anchor_date` field + rule-based
  compute would light them up. Small ship (~50 lines) if requested.
- **Org-wide "Service due" total in the badge**: today the badge
  reads counts from the visible-page rollup. If admins want the
  org-wide total, add `?count_only=true` to the rollup endpoint
  and fire a second request. Deferred until asked.
