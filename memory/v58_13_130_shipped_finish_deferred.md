# v58.13.130 — Service-level presets on New Schedule modal + modal viewport-height fix — SHIPPED (finish deferred)

`finish` bypassed by the 20 pre-existing `ephemeral-upload-storage` warnings (still parked for v58.14.x per standing directive).

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — version-only bump.
- No comms.
- 20 deferred warnings still parked.

## Ship one-liner
Two-item punch:
1. **Preset row** — 5 pill buttons (Minor / Basic · Intermediate · Major · Heavy Overhaul · Custom) at the top of the New Schedule modal auto-fill Name + Interval value from the .122 SCHEDULE_TABLE (keyed off the current Interval kind — Hours vs Km — which is NEVER overwritten).
2. **Viewport fix** — modal card now `flex flex-col max-h-[90vh] overflow-hidden`, header + footer `shrink-0`, body `flex-1 overflow-y-auto`. Top no longer cut off; footer buttons always visible.

## User's verbatim pain
> "could you add these service options to New Schedule in the image. when i open the New schedule it is to tall to read and the top is cut off."

## Files touched (7)

| File | Change |
|---|---|
| `backend/fleet.py` | NEW `GET /fleet/service-schedule-presets` endpoint (54 lines added) |
| `frontend/src/components/AssetServiceTabs.jsx` | Preset row + fallback const + `applyPreset` + viewport fix (card / body / header / footer classes) |
| `frontend/src/lib/version.js` | RUNNING_VERSION → `.130` + `.130` block header |
| `frontend/public/service-worker.js` | CACHE_VERSION → `.130` |
| `mobile/src/lib/version.ts` | MOBILE_BUNDLE_VERSION → `.130` |
| `tests/backend_unit/test_v58_13_130_bundle.py` | NEW · 13 tests · all passing |
| `tests/backend_unit/test_fleet_endpoints_phase2_v58_13_120b.py` | Endpoint-count 10 → 11 (matched .130 addition) |
| `tests/backend_unit/test_v58_13_124_taxonomy_and_purge.py` | Widened version pin: match canonical constant only, `.13.124+` |
| `tests/backend_unit/test_v58_13_128_bundle.py` | Same forward-safe pin ratchet |
| `tests/backend_unit/test_v58_13_128a_divider.py` | Same forward-safe pin ratchet |
| `tests/backend_unit/test_v58_13_129_enrich.py` | Same forward-safe pin ratchet |

## Backend endpoint

```
GET /api/fleet/service-schedule-presets
```

Response (verified):
```json
{
  "presets": [
    {"level":"minor",          "label":"Minor / Basic",  "default_name":"Minor Service",        "hours":250,  "km":10000,  "tasks":["Engine Oil","Oil Filter"]},
    {"level":"intermediate",   "label":"Intermediate",   "default_name":"Intermediate Service", "hours":500,  "km":20000,  "tasks":["Engine Oil","Oil Filter","Cabin Filter","Air Filter","Brakes","Battery Condition"]},
    {"level":"major",          "label":"Major",          "default_name":"Major Service",        "hours":1000, "km":45000,  "tasks":["Engine Oil","Oil Filter","Cabin Filter","Air Filter","Brakes","Battery Condition","Fuel Filter","Coolant","Brake Fluid","Power Steering Fluid","Suspension","Steering"]},
    {"level":"heavy_overhaul", "label":"Heavy Overhaul", "default_name":"Heavy Overhaul",       "hours":2000, "km":100000, "tasks":["Engine Oil","Oil Filter","Cabin Filter","Air Filter","Fuel Filter","Coolant","Brake Fluid","Power Steering Fluid","Windscreen Washer Fluid","Auxiliary Belt","Battery Condition","Tyres","Brakes","Suspension","Steering","Exhaust","Lights","Wipers"]}
  ]
}
```

Source-of-truth: `SCHEDULE_TABLE` in `backend/fleet_service_schedules.py` (.122). `km` = `km_max` (matches user's spec: 10k / 20k / 45k / 100k).

Same feature-flag + permission gate (`FLEET_REGISTER_ENABLED` + `assets.view`) as every other Fleet Register endpoint.

## Frontend behaviour (preset click)
- `name` → overwritten with the preset's `default_name`.
- `interval_value` → picked from the matrix using the CURRENT `interval_kind` (Km → km column; anything else → hours column).
- `interval_kind` → **NEVER** overwritten (verified in pytest `test_apply_preset_behaviour`).
- `activePreset` state tracks the highlighted pill; Custom clears it.
- Each preset button carries a native `title=` tooltip listing its key tasks.
- Endpoint fetch falls back to `SCHEDULE_PRESETS_FALLBACK` const if `/fleet/service-schedule-presets` 404s or the network errors.

## Viewport-fit fix (Item 2)
- Modal card: `flex flex-col max-h-[90vh] overflow-hidden`
- Header (`px-5 py-3 border-b flex items-center shrink-0`) — pinned top
- Body (`px-5 py-4 space-y-3 text-sm flex-1 overflow-y-auto`, `data-testid="sch-body"`) — scrolls
- Footer (`px-5 py-3 border-t bg-slate-50 flex justify-end gap-2 shrink-0`, `data-testid="sch-footer"`) — pinned bottom

Same pattern already in place on `ServiceCheckSheetModal`, `AssetMapModal`, `AssetDrawer` — a quick grep confirmed those 3 were already viewport-safe, so **no other modal needed the fix**.

## Playwright screenshots (verified)
- `/app/memory/v58_13_130_new_schedule_before_preset.png` — modal open, preset row visible, Custom highlighted (default), header + footer both visible.
- `/app/memory/v58_13_130_new_schedule_after_minor.png` — after clicking Minor: Name = "Minor Service", Interval value = 250, Interval kind still Hours, Minor / Basic pill highlighted blue.
- `/app/memory/v58_13_130_new_schedule_viewport_fit.png` — after clicking Major + expanding "More details" + scrolling body to bottom: Name = "Major Service", Interval value = 1000, header + footer BOTH still visible.

Console verifications from the same Playwright run:
```
AFTER_MINOR: name='Minor Service', interval_value=250, interval_kind=hours
AFTER_MAJOR: name='Major Service', interval_value=1000
After scroll: footer_visible=True, header_visible=True
```

## Pytest tally
- `tests/backend_unit/test_v58_13_130_bundle.py` — **13 / 13 pass** (endpoint shape, values, router registration, feature-flag gate, fallback const shape, applyPreset behaviour, fetch effect, modal card / body / header / footer classes, preset testids, tooltip binding, version-sync forward-safe pin ≥ .130).
- Full backend unit suite: **1153 passed / 2 skipped / 2 pre-existing flakes** (`test_fleet_search_null_org_v58_13_120c2::test_search_finds_pm_rows_across_null_and_scoped_orgs` + `test_safe_mode_toggle_perm_v58_13_90::test_ensure_stephen_can_toggle_upserts_override` — both fail on clean `main` too, zero new regressions).
- Fixed 4 pre-existing forward-pin failures (`.124` / `.128` / `.128a` / `.129` version-bump tests) by ratcheting each to a canonical-constant regex ≥ its own version. Same forward-safe pattern the `.124` test already documented.

## Version bump
```
frontend/src/lib/version.js   RUNNING_VERSION       = 'paneltec-v160.3.9.58.13.130'
frontend/public/service-worker.js   CACHE_VERSION   = 'paneltec-v160.3.9.58.13.130'
mobile/src/lib/version.ts   MOBILE_BUNDLE_VERSION   = 'paneltec-v160.3.9.58.13.130'
```

## NOT changed
- `SCHEDULE_TABLE` numbers — same source of truth as .122.
- `compute_next_due` / the amber-at-85% engine.
- `ServiceCheckSheetModal`, `AssetMapModal`, `AssetDrawer` — already viewport-safe, untouched.
- Existing schedule fields (dual-track, contract dates, description, phone / reported_by / project / assigned worker / notes) or the More-details toggle.
- Any comms / scheduler / ephemeral-upload path.
- `/app/mobile/` code (only MOBILE_BUNDLE_VERSION bumped).
- The 20 pre-existing `ephemeral-upload-storage` warnings (still parked for v58.14.x).
