# v58.13.132df — Provisional fuel price applies retroactively + prospectively — SHIPPED (finish deferred)

## Scope

Move the provisional fuel price from a **write-time** stamp (rows carried `total_price = litres × 2.25` baked-in) to a **read-time** evaluation model. When the admin bumps the price on the `.132de` Fuel Price card, every existing report immediately reflects the new price for provisional fills, and every new daily SmartFill import inherits it the moment the next report page loads. Real SmartFill-tagged prices remain protected.

Stephen's confirmation matched: *"we do need to apply the change to the SmartFill entries — Only applies to fills without a SmartFill-tagged real price."*

## Rules (locked by pytest)

1. **Provisional-marker rows** (`price_source ∈ {"provisional_static_2.25", "provisional_static_3.00", "provisional"}`) → re-priced at read time to `litres × current_provisional_price`.
2. **SmartFill rows without a real price** (`total_price` null or 0, `litres` > 0, any `price_source` outside the provisional set) → treated as provisional and re-priced.
3. **Real SmartFill-tagged rows** (`total_price > 0`, `price_source == "smartfill_actual"` or any non-provisional marker) → NEVER overwritten, stored value flows through unchanged.
4. **Manual/imported rows without a price** → same as rule 2.

## Files touched

### Backend

- `backend/fuel_price_settings.py`
  - New `PROVISIONAL_PRICE_SOURCES: frozenset[str]` — canonical set of provisional markers.
  - New `effective_total_price(tx, provisional_price) -> float` helper — 3-branch decision (marker / no-price+litres / real).
  - New `_bust_downstream_caches()` — flushes `fleet_fuel._FUEL_SUMMARY_CACHE` + `_CARD_SUMMARY_CACHE` on price PUT (lazy import to avoid cycle).
  - `put_price_settings` — calls `_bust_downstream_caches()` after a real price change.
  - Docstring rewritten with the retroactive/prospective rationale.

- `backend/fleet_fuel_reports.py`
  - `_aggregate()` — fetches `provisional_price = await get_org_provisional_price(org_id)` once, then rewrites `total_price` on every tx via `effective_total_price(...)` before the roll-up. Every downstream leaderboard, delta calc, per-period bucket, and totals sum reads the effective price.
  - `has_provisional` computed BEFORE the re-price loop; now reflects both marker-tagged rows AND imputed rows (SmartFill w/o real price).

- `backend/fleet_fuel.py`
  - `asset_fuel_summary` (`GET /fleet/assets/{id}/fuel-summary`) — YTD + rolling-30d Mongo aggregations split into two buckets:
      * `real_total_price` — `$sum $ifNull total_price` on rows NOT in the provisional set AND with `total_price > 0`
      * `provisional_litres` — `$sum $ifNull litres` on rows in the provisional set OR missing a real price
    Payload then computes `total_price = real_total_price + provisional_litres × current_provisional_price`. `last_fill.total_price` also runs through `effective_total_price(latest, provisional_price)`.
  - `card_summary` (`GET /fleet/fuel/cards/{card}/summary`) — same split-bucket rewrite for `all_time` + `ytd`. `avg_price_per_litre` reads the effective price.

### Frontend

- `frontend/src/pages/FuelReporting.jsx`
  - Fuel Price card info line updated:
    *"Only applies to fills without a SmartFill-tagged real price. **Applies to past and future fills — real prices are never overwritten.** Last edited by <name> on <YYYY-MM-DD>."*
  - `data-testid="fuel-price-info-line"` added for lock coverage.
  - Provisional banner interpolates the live setting (`priceSettings?.provisional_price_per_litre`) instead of the hardcoded `$2.25/L`. Copy now reads *"Applied to fills without a SmartFill-tagged real price — past and future. Real prices are never overwritten."*
  - New state `priceRefreshTick` — bumped on successful price save, added to `reload` useCallback deps so leaderboards + Admin Rollup totals refetch immediately after a save. Backend cache is already flushed by the PUT.

### Version sync (3 web files)

- `frontend/src/lib/version.js` → `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` = `paneltec-v160.3.9.58.13.132df`
- `frontend/public/service-worker.js` → `CACHE_VERSION` = `paneltec-v160.3.9.58.13.132df`
- Mobile bundle stays at `.132dc` (per standing directive; Expo specialist ships next mobile batch with `MOBILE_VERSION_SYNC_OPTIONAL=true` at commit time).

## Hardcoded fallbacks — audit + status

| Location | State | Action |
|---|---|---|
| `fleet_fuel.py:2262,2271,2306,2308` YTD + 30d `$sum $ifNull ["$total_price", 0]` | **REPLACED** | Split into `real_total_price` + `provisional_litres`; Python re-prices. |
| `fleet_fuel.py:2354` `latest.get("total_price")` on last_fill | **REPLACED** | Now `effective_total_price(latest, provisional_price)`. |
| `fleet_fuel.py:2425,2434,2470,2488` card summary `$sum $ifNull ["$total_price", 0]` | **REPLACED** | Same split-bucket pattern; Python re-prices. |
| `fleet_fuel_reports.py:200` `price = float(t.get("total_price") or 0)` in `_aggregate` | **REPLACED** | Fed by `effective_total_price` overwrite in the pre-loop. |
| `fleet_fuel_reports.py:_compute_delta_by_key` | **INDIRECTLY FIXED** | Called on the same `txs` list which is already re-priced. |
| `scripts/backfill_provisional_price_v58_13_132t.py:35` `PROVISIONAL_RATE = 2.25` | **LEFT** | Legacy one-shot backfill script. Never called at request time. Its written rows are re-priced at read-time by the new model, so its literal is inert. |
| `admin_console_pin.py:288-315` filter references `provisional_static_3.00` | **LEFT** | Manual admin backfill button — filter-only match. Not touched by read-time model. |
| `integrations_smartfill.py` (JSON-RPC client) | **CLEAN** | Never touches `fuel_transactions.total_price`. |
| `cron_smartfill_auto_sync.py` | **CLEAN** | Only orchestrates the CSV importer, no price logic. |
| `fleet_fuel.py:1181-1185` SmartFill CSV import path | **CLEAN** | Only stamps `price_source = "smartfill_actual"` when a real Total Price is present, else `None`. No provisional stamping at import time — matches the read-time model. |

## Cache invalidation

Two per-process TTL caches in `fleet_fuel.py` are cleared inside `put_price_settings` when the value actually changes (`|old − new| > 1e-6`):

- `_FUEL_SUMMARY_CACHE` — drives `/fleet/assets/{id}/fuel-summary` (asset detail drawer).
- `_CARD_SUMMARY_CACHE` — drives `/fleet/fuel/cards/{card}/summary` (SmartFill card drawer).

Lazy import inside the flush helper avoids the `fleet_fuel ↔ fuel_price_settings` circular-import trap. The flush is best-effort — a swallowed exception never breaks the PUT (aggregation is still correct; users just wait ≤60s for the TTL to expire naturally).

`/fleet/fuel/reports` has no in-process cache (it's on-demand only), so leaderboards + rollups pick up the new price on the very next request.

## Audit trail

The `.132de` `fuel_price_history` collection already records every change (`old_price → new_price` + `changed_by` + `changed_by_name` + `changed_at`). No schema change in `.132df`. Given the read-time model, this history now doubles as "which reports would have shown different numbers before this row" — the aggregation applied at any wall-clock time can be reconstructed by pointing at the last-preceding history row.

## Pytest lock — 9/9 passing

```
tests/test_v58_13_132df_fuel_price_retroactive.py::test_provisional_source_set_exported                    PASSED
tests/test_v58_13_132df_fuel_price_retroactive.py::test_effective_total_price_helper_exists               PASSED
tests/test_v58_13_132df_fuel_price_retroactive.py::test_reports_aggregate_uses_effective_price            PASSED
tests/test_v58_13_132df_fuel_price_retroactive.py::test_asset_and_card_summary_split_buckets              PASSED
tests/test_v58_13_132df_fuel_price_retroactive.py::test_put_price_flushes_downstream_caches               PASSED
tests/test_v58_13_132df_fuel_price_retroactive.py::test_frontend_copy_reflects_retroactive_intent         PASSED
tests/test_v58_13_132df_fuel_price_retroactive.py::test_leaderboard_totals_reprice_at_read_time           PASSED   ← END-TO-END
tests/test_v58_13_132df_fuel_price_retroactive.py::test_smartfill_real_price_never_overwritten            PASSED   ← END-TO-END
tests/test_v58_13_132df_fuel_price_retroactive.py::test_three_way_sync_at_132df_or_later                  PASSED
```

`.132de` re-check: **7/7 still green**. Combined: **16/16 green**.

### End-to-end pytest math

Seeded 3 fuel_transactions (synthetic asset `pytest-132df-<hex>` — cleaned up in fixture teardown):

| Row | Litres | Stored `total_price` | `price_source` | Behaviour |
|---|---:|---:|---|---|
| A | 40 | 90.00 (stale) | `provisional_static_2.25` | Re-priced at read time |
| B | 10 | null | `null` (SmartFill w/o real price) | Re-priced at read time |
| C | 20 | 36.00 | `smartfill_actual` | **NEVER touched** |

- Price @ 2.25 → per-vehicle row total = 40×2.25 + 10×2.25 + 36.00 = **$148.50** ✓
- Price @ 3.00 → per-vehicle row total = 40×3.00 + 10×3.00 + 36.00 = **$186.00** ✓
- Δ = **$37.50** = 50 provisional L × $0.75 price delta ✓
- Row C's stored `total_price` in DB still equals `36.00` after both bumps ✓
- `litres` field identical across both queries (physical quantity, unchanged) ✓

## Curl proof — live preview data

```
GET /price-settings                       → { "provisional_price_per_litre": 2.25, "updated_by_name": "Stephen Guy" }
PUT /price-settings  {price: 3.00}        → { "provisional_price_per_litre": 3.0 }
GET /reports  scope=admin period=monthly  → { "litres": 369571.48, "total_price": 1108714.44 }
PUT /price-settings  {price: 2.25}        → 2.25
GET /reports  scope=admin period=monthly  → { "litres": 369571.48, "total_price": 1108155.18 }

Δ total_price = $559.26  (~745 provisional L × $0.75)
Δ litres      = 0.00     (physical quantities unchanged)
Real-priced fills (~368,826 L @ real SmartFill prices) → not touched.
```

## Screenshots captured

1. **Fuel Price card** — new info line reads *"Only applies to fills without a SmartFill-tagged real price. **Applies to past and future fills — real prices are never overwritten.** Last edited by **Stephen Guy** on **2026-09-10**."* — `History (16)` toggle + green `Edit` button. Version pill in sidebar shows `v160.3.9.58.13.132df`.
2. **Provisional banner** on the Admin Rollup — now reads *"⚠ Fuel costs shown are provisional at **$2.25/L** pending supplier confirmation. Applied to fills without a SmartFill-tagged real price — past and future. Real prices are never overwritten."*

## Decisions

- **Read-time re-pricing (not write-time re-stamping)** — a price change should not mutate 369K historical `fuel_transactions` rows. Aggregations do the arithmetic in memory per request. Cheap, correct, and reversible (change the setting back and the reports snap back).
- **Split Mongo `$cond` buckets for asset/card summaries** — keeps the aggregation server-side (indexed) while still applying the read-time price in Python. Avoids pulling all rows into the API pod for a single asset drawer.
- **`has_provisional` includes imputed rows** — the FE banner now fires on any dataset where at least one fill was re-priced (marker OR imputed). Previously it only fired on marker-tagged rows, which under-counted.
- **Cache flush inside PUT** — 60s TTL is imperceptibly long for admins bumping the price; explicit flush makes the new number appear on the next request. Best-effort; swallowed exception never breaks the write.
- **Legacy `provisional_static_2.25` marker preserved** — safer than migrating existing rows. `PROVISIONAL_PRICE_SOURCES` set covers both `2.25` and `3.00` markers so historical backfills stay recognisable.
- **Outlier exclusion unchanged** — provisional rows are still excluded from `$/L` outliers (a uniform provisional rate isn't a real market signal). Real-priced rows drive the outlier panel exactly as before.

## Non-blockers left in place (per standing directives)

- 20 pre-existing `ephemeral-upload-storage` lints — v58.14.x scope, not touched.
- 4 pre-existing `fuel_cards` pytest failures (row-count / `first_seen_at` drift) — unrelated data-state drift.
- `.132t` write-time backfill scripts (`backfill_provisional_price_v58_13_132t.py`, `strip_provisional_prices_v58_13_132t.py`) — one-shot admin utilities; literals are inert under the new model but the files remain for archaeological reference.

## Ship checklist

- [x] Audit hardcoded fallbacks in `backend/fleet_fuel*.py` + `backend/fleet_fuel_reports.py` + SmartFill import path.
- [x] Read-time re-pricing helper (`effective_total_price`) + provisional-source constant.
- [x] `_aggregate` (leaderboards + rollup + delta) reprices at read time.
- [x] `asset_fuel_summary` + `card_summary` split-bucket aggregation with Python reprice.
- [x] Cache invalidation on PUT `/price-settings` (asset + card summaries).
- [x] FE Fuel Price card + provisional banner copy updated.
- [x] FE post-save leaderboard refetch wired via `priceRefreshTick`.
- [x] 3-way web version sync at `.132df`.
- [x] Pytest 9/9 green (unit + e2e).
- [x] `.132de` regression check 7/7 green.
- [x] Live curl proof — leaderboard totals move; real prices untouched.
- [x] UI screenshots captured (card + banner + version pill).
- [ ] `finish` tool — **deferred per standing directive**.
- [ ] Mobile bundle bump — **deferred to Expo specialist**.
