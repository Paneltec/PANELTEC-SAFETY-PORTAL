# v58.13.131e — AssetDrawer SmartFill editor fields — SHIPPED (finish deferred)

`finish` bypassed per standing rule (20 pre-existing `ephemeral-upload-storage` warnings still parked for v58.14.x).

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — version-only bump.
- No comms.
- 20 deferred warnings still parked.
- `plant_maintenance` back-fill (Issue 2) still parked.

## Ship one-liner
Added admin UI + backend wiring for the three SmartFill-importer fields on assets: `fuel_tank_capacity_l` (unlocks R2 anomaly), `smartfill_key_code` (primary CSV match key), `smartfill_card_number` (secondary CSV match key). New collapsible "Fuel & SmartFill" section in `AssetDrawer` with a green/grey status pill.

## Files touched (5)

| File | Change |
|---|---|
| `backend/assets.py` | `AssetIn` model + `create_asset` + `update_asset` now accept + persist `fuel_tank_capacity_l`, `smartfill_key_code` (`.strip().upper() or None`), `smartfill_card_number` (`.strip() or None`). SmartFill fields placed **above** any Navixy-lock branch so Navixy-linked vehicles can still get SmartFill keys set. |
| `frontend/src/components/AssetDrawer.jsx` | Extended `emptyForm` + PATCH payload builder; new "Fuel & SmartFill" section with 3 inputs (number + 2 text) + green `CSV-matchable` / grey `Not matched` pill; auto-uppercase on `smartfill_key_code` blur mirrored client-side |
| `tests/backend_unit/test_v58_13_131e_smartfill_fields.py` | NEW · 9 tests all passing |
| `frontend/src/lib/version.js` · `frontend/public/service-worker.js` · `mobile/src/lib/version.ts` | `.131e` bump |
| `/app/memory/smartfill_discovery_v58_13_131.md` | Appended `.131d reporting spec (confirmed by user)` — weekly/monthly per-employee + per-vehicle + admin rollup, `$/L` primary metric, top-5 highest `$/L` procurement outliers, CSV export per report |

## Backend contract
- `AssetIn` model — 3 new optional fields with Pydantic bounds (`fuel_tank_capacity_l: ge=0, le=100000`, both string fields `max_length=80`).
- `create_asset` — persists all three; `smartfill_key_code` uppercased+trimmed+blank-to-null; `smartfill_card_number` trimmed+blank-to-null.
- `update_asset` — same normalisation; positioned before any Navixy identity-lock branch so admins can always edit SmartFill fields.
- Existing endpoints (`assets.list`, `assets.get`) auto-project the fields; no change needed.

## Curl transcript (K82KU asset)

```
=== 1) GET current state ===
  fuel_tank_capacity_l=None
  smartfill_key_code=None
  smartfill_card_number=None

=== 2) PUT fuel_tank_capacity_l=80.5, smartfill_key_code='100000000536b' (lowercase),
       smartfill_card_number='  21355  ' (whitespace) ===
  fuel_tank_capacity_l=80.5           (unchanged)
  smartfill_key_code=100000000536B    (uppercased server-side)
  smartfill_card_number=21355         (whitespace trimmed)

=== 3) PUT null on all three ===
  fuel_tank_capacity_l=None  smartfill_key_code=None  smartfill_card_number=None

=== 4) PUT final populated values ===
  cap=80.0L  key=100000000536B  card=21355
```

All 3 cases pass: PATCH each field individually (implicit — model accepts partial updates), PATCH all three at once, PATCH null clears.

## UI screenshots (verified live)
- `/app/memory/v58_13_131e_fuel_section_green_pill.png` — filled state: `Fuel tank capacity=80 L`, `SmartFill Key / Code=100000000536B` (uppercased by onBlur handler after typing `100000000536b`), `SmartFill Card Number=21355`, **green "CSV-MATCHABLE" pill** in top-right of the section
- `/app/memory/v58_13_131e_fuel_section_grey.png` — empty state: all 3 inputs blank, **grey "NOT MATCHED" pill**
- Section positioned inside the Details tab, below Status, above the Save/Cancel footer. Playwright verified pill count transitions `unmatched=1, matched=0` → `unmatched=0, matched=1` after filling inputs, and that `onBlur` uppercased the key_code correctly.

## Pytest tally
- **`test_v58_13_131e_smartfill_fields.py`: 9 / 9 pass** — AssetIn model has all 3 fields · create_asset persists all 3 with key_code `.strip().upper() or None` · update_asset persists all 3 · SmartFill fields ordered before any Navixy-lock branch · drawer emptyForm has all 3 · payload builder includes `toUpperCase()` + `|| null` coercion · 6 testids present (`asset-fuel-section`, `-tank-capacity`, `-smartfill-key-code`, `-smartfill-card-number`, `-pill-matched`, `-pill-unmatched`) · helper text `flag anomalous fills` / `Primary match` / `Secondary match` present · version pin ≥ .131e.
- **Fuel importer regression**: `test_fuel_csv_import.py`: 24/24 still pass — combined 33/33 across the two fuel test files.
- Full backend suite: 1194 pass / 6 skipped / 24 pre-existing failures (same set as before ship — zero new regressions).

## Version bump ✅
```
frontend/src/lib/version.js       RUNNING_VERSION       = 'paneltec-v160.3.9.58.13.131e'
frontend/public/service-worker.js CACHE_VERSION         = 'paneltec-v160.3.9.58.13.131e'
mobile/src/lib/version.ts         MOBILE_BUNDLE_VERSION = 'paneltec-v160.3.9.58.13.131e'
```

## NOT in .131e (deferred)
- `.131c` — Frontend CSV import modal + anomaly inbox + AssetDrawer Fuel tab (transaction feed)
- `.131d` — Reporting page `/app/fleet/fuel` — spec now written into discovery memo (weekly/monthly per-employee + per-vehicle + admin rollup, `$/L` metric, top-5 outliers, CSV export)
- `.131f` (optional) — Live SmartFill API sync if subscription upgrades to enable `Tank:Deliveries`
- Any email/SMS wiring
