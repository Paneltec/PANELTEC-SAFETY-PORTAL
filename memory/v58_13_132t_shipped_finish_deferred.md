# v58.13.132t — SHIPPED (fuel display fixes + provisional $3.00 back-fill)

Status: **shipped, all writes committed, 8/8 pytest passing, user
visually confirmed** (*"i can see the have the equasions right now
thanks"*).

## Executive summary

- **F-A** — `AssetFuelTab.jsx` recent-transactions table now has a
  per-row `$/L` column. Provisional rows render in amber italic with
  an asterisk (`$3.000*`) + tooltip. Real rows render plain slate.
  Null → em-dash.
- **F-B** — `FuelReporting.jsx` `Total cost` Stat renders `—` when
  the sum is 0 (was `$0.00`). When provisional rows are present the
  total is suffixed with `*`.
- **F-D — 547 rows back-filled @ $3.00/L (provisional).** Marker
  `price_source="provisional_static_3.00"` + `price_provisional_at=<iso>`.
  Upsert-merge path patched so a real Total Price from a CSV
  re-upload replaces the placeholder AND clears both markers.
- API surface: `totals.has_provisional: bool` on `/fleet/fuel/reports`
  so the FE banner has a single-flag trigger. `/fleet/assets/{id}/fuel`
  returns `price_source` per transaction naturally (`_id`-only exclude).
- Version bumps: `RUNNING_VERSION` + `MOBILE_BUNDLE_VERSION` `.132s → .132t`.
  **CACHE_VERSION NOT bumped** (policy).

> ⚠ **F-D writes provisional $3.00 to 547 rows.** Real prices supersede
> automatically via the `.131n` upsert-on-duplicate merge path when the
> user re-uploads the SmartFill CSV with Total Price column enabled.
> `strip_provisional_prices_v58_13_132t.py` provided for emergency
> back-out only — **NOT RUN.**

## Writes

| Path | Writer | Rows / bytes |
|---|---|---:|
| `db.fuel_transactions` | `scripts/backfill_provisional_price_v58_13_132t.py --commit` | 547 |
| `db.fuel_transactions` | 2 test fixtures (created + deleted in same test) | 0 net |

## Idempotency

Confirmed by running the back-fill script twice:

```
$ python scripts/backfill_provisional_price_v58_13_132t.py --commit
matched rows: 547  commit=True
modified: 547

$ python scripts/backfill_provisional_price_v58_13_132t.py --commit
matched rows: 0    commit=True
modified: 0
```

The filter is `total_price IS None AND litres > 0 AND price_source !=
'provisional_static_3.00'`. Rows already tagged are excluded.

## Files touched

| File | Change |
|---|---|
| `backend/scripts/backfill_provisional_price_v58_13_132t.py` | **NEW** — 547-row back-fill (executed) |
| `backend/scripts/strip_provisional_prices_v58_13_132t.py` | **NEW** — emergency back-out (NOT run) |
| `backend/fleet_fuel.py:898-919` | Upsert clear-flag branch |
| `backend/fleet_fuel_reports.py` | `price_source` projection + `has_provisional` on totals |
| `backend/tests/test_v58_13_132t_provisional_price.py` | **NEW** — 8 tests, all passing |
| `frontend/src/components/AssetFuelTab.jsx` | Per-row $/L column + provisional banner |
| `frontend/src/pages/FuelReporting.jsx` | Amber banner + Total cost em-dash |
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132s → .132t` + ship note block |
| `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` | `.132s → .132t` |

## Pytest suite

- File: `backend/tests/test_v58_13_132t_provisional_price.py`
- Result: **8 passed, 0 failed.**
- Coverage:
    - Back-fill idempotency (`test_backfill_no_ghost_matches`).
    - 547-row completeness (`test_all_547_rows_have_provisional_price`).
    - Marker presence (`test_provisional_marker_present`).
    - `computed_price_per_litre == 3.00` on flagged rows.
    - `total_price == round(litres * 3.00, 2)` per-row formula check.
    - `totals.has_provisional == True` from live aggregation
      (`test_reports_totals_expose_has_provisional`).
    - Upsert-merge clears flag when real total_price arrives
      (`test_upsert_merge_clears_provisional_flag` — `live_db_writes` opt-in).
    - Upsert-merge does NOT add spurious clear-fields on a
      non-provisional row (`test_upsert_no_provisional_does_not_clear_missing_flag`).

## Live verification

```
GET /api/fleet/fuel/reports?scope=vehicle&period=monthly →
  totals: {
    litres: 44836.06,
    total_price: 134508.18,     # ← 44836.06 × 3.00 = correct
    fills: 547,
    unique_keys: 66,
    has_provisional: True
  }
  first row: {
    label: 'XT02AX', litres: 3968.82,
    total_price: 11906.46, fills: 28, dpl: 3.0
  }
```

User feedback: *"i can see the have the equasions right now thanks"* ✓

## Rollback

### Emergency back-out (strips all 547 provisional rows)

```bash
python /app/backend/scripts/strip_provisional_prices_v58_13_132t.py --commit
```

Sets `total_price = None`, `computed_price_per_litre = None`,
`price_source = None`, `price_provisional_at = None` on every row
tagged `provisional_static_3.00`. Frontend UI immediately reverts
to the "no cost data" state.

### Normal replacement (via CSV re-upload)

Just re-upload the SmartFill CSV with Total Price column enabled.
The `.131n` upsert-merge path handles the rest — no admin action
needed. `fleet_fuel.py:898-919` clears both provisional markers
whenever a real `total_price` arrives via the merge branch.

## Follow-ups (deferred)

- **F-C.** Optionally strip `unit_price` from the stored doc entirely
  (belt-and-braces so future refactors can't accidentally render it).
  Optional — the current audit path already prevents it from reaching
  UI. Effort: **M**.
- **User action (F1).** Re-upload SmartFill CSV with Total Price
  column to replace the 547 provisional prices with real values.
- **User action.** Confirm with fuel supplier whether the $3.000/L
  figure they're seeing on the SmartFill portal is a Pricing Module
  stale-config issue or a genuine annual contract rate. If genuine,
  a `price_source="supplier_confirmed_3.00"` variant could persist
  the value non-provisionally.
