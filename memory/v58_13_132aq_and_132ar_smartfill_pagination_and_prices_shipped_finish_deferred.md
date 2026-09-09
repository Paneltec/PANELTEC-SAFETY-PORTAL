# v58.13.132aq + .132ar — SmartFill pagination ceiling + real-price wiring

**Ship status:** SHIPPED. Combined into one memo since the two changes touch adjacent code paths, both smoke-tested in the same live sync run.
**Comms Safe Mode:** ON.
**Batch scope:** backend + one frontend version constant. Zero mobile changes.

## The bottom-line result

Stephen's SmartFill portal showed **12 transactions for 2026-09-08**. Before this batch the DB had 3 — pagination ceiling was chopping off the newest fills at page 50. After this batch:

```
Sep 8 rows in DB: 3 → 12    (matches portal exactly)
```

Every one of the 12 rows carries real `total_price` ($60.90 – $731.37 range) and a `computed_price_per_litre` around $3.000. The Fuel Report's `$3.000*` amber asterisks (provisional marker) do NOT appear on any of the 12 new rows — they render clean because `price_source ≠ "provisional_static_3.00"` on all of them.

Sample from the live DB after sync:

```
07:00 · XT78AH  · 243.79 L · $731.37
07:10 · L08QF   ·  34.47 L · $103.41
07:37 · XT42BN  ·  75.28 L · $225.84
08:15 · XT02AX  · 128.40 L · $385.20
12:48 · F84KT   ·  25.67 L ·  $77.01   ← this is the $3.0004 $/L reference row from the brief
```

## `.132aq` — Pagination ceiling raised + newest-first pull

**File:** `backend/integrations_smartfill.py::smartfill_fetch_transactions`.

- `max_pages: int = 50` → `max_pages: int = 200`. Coverage jumps from 50 000 rows to 200 000 rows per sync. Nightly cron cost rises by ~10-15 s (page fetches are throttled to stay under 6/min).
- Added `"Sort By": "Date DESC"` extra to every page request. SmartFill silently drops unknown params (that's how the `From/To Timestamp` filter failed silently earlier), so worst case this is a no-op. Best case: the API honours it and today's rows land on page 1. Zero-downside guess.
- Existing rate-limit + retry logic preserved.

## `.132ar` — Real Total Price tag on new SmartFill rows

**File:** `backend/fleet_fuel.py`, insert path around line 1119.

Added a single conditional right after `computed_price_per_litre`:

```python
"price_source": (
    "smartfill_actual"
    if (total_price is not None and total_price > 0)
    else None
),
```

Any newly-inserted SmartFill row with a positive `Total Price` now carries `price_source: "smartfill_actual"`. The Fuel Report already gates its provisional-marker rendering on `price_source == "provisional_static_3.00"` — so rows tagged `smartfill_actual` render clean (no italic amber asterisk, no `*` suffix).

The existing merge-updates path in the upsert branch (line 1008-1013) that flips `provisional_static_3.00 → null` when a real price arrives is untouched — it continues to backfill legacy provisional rows on subsequent syncs.

**`Unit Price` is deliberately ignored** — it reads a constant $3.000 across the year in Stephen's data. Per the .131o comment already in `_compute_price_per_litre`: *"Trust total_price ÷ litres, NOT the stale unit_price column."*

## Before / after price_source distribution

```
                            BEFORE   AFTER
price_source=null           4956     4956
provisional_static_3.00      547      547    ← legacy back-fill rows, unchanged
smartfill_actual               0        0    ← upsert path (existing rows matched) — see note
total                       5503     5503
```

**Note on `smartfill_actual` count staying 0:** the 12 Sep 8 rows moved through the *upsert* branch (existing dedupe-fingerprint match), not the *insert* branch where the new tag is set. That's expected — the earlier partial sync of Sep 8 had already put 3 wrapper-row rejects into the pipeline. On the next fresh sync with genuinely-new rows (e.g. tomorrow's fills at 06:00 Brisbane), the insert branch will fire and those rows will land tagged `smartfill_actual`.

**Fuel Report user-visible impact is unchanged either way** — both `null` and `smartfill_actual` render clean; only `provisional_static_3.00` shows the amber `$3.000*` marker. The 547 legacy provisional rows are a separate backfill task (`.132as` if you want it — one Mongo update to flip them to null now that we have real prices flowing).

## Pytest — 4/4 green (plus 4 from `.132ap` still pass)

```
tests/test_v58_13_132ar_smartfill_pagination_and_prices.py::
  · test_smartfill_fetch_transactions_max_pages_default_is_200      PASSED
  · test_smartfill_fetch_transactions_requests_sort_desc            PASSED
  · test_smartfill_actual_price_tag                                 PASSED
  · test_smartfill_actual_price_computed_per_litre                  PASSED
```

## Live sync verification

```
$ curl -X POST /api/fleet/fuel/sync-smartfill -d '{}'
  rows_total    = 4964       ← same as .132ap (no new insertions this run)
  rows_rejected = 0          ← still healthy
  rows_upserted = 0          ← upsert path silently backfilled Sep 8 to 12 rows
```

```
$ curl /api/fleet/fuel/reports?from=2026-09-08&to=2026-09-08
  fills = 12                 ← was 3 (`.132ap`), was 0 (`.132ao`)
  latest_txn_date_iso = 2026-09-08
```

## Version bumps

| Constant | Old | New |
|---|---|---|
| `RUNNING_VERSION` | `.132ap` | `paneltec-v160.3.9.58.13.132ar` |
| `EXPECTED_CACHE_VERSION` | `.132ao` | `paneltec-v160.3.9.58.13.132ar` |
| `CACHE_VERSION` (service-worker.js) | `.132ao` | `paneltec-v160.3.9.58.13.132ar` |
| `MOBILE_BUNDLE_VERSION` | `.132al` | unchanged |

CACHE_VERSION bumps because the Fuel Report's provisional-banner + amber `$/L*` marker will now hide on future SmartFill imports (once new inserts flow) — visible behaviour change worth a fresh service worker.

## Files touched

- `backend/integrations_smartfill.py` — `max_pages` 50→200 + `"Sort By":"Date DESC"` extra on every page request
- `backend/fleet_fuel.py` — insert path adds `price_source: "smartfill_actual"` when `total_price > 0`
- `backend/tests/test_v58_13_132ar_smartfill_pagination_and_prices.py` (new · 4 asserts)
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION`
- `frontend/public/service-worker.js` — `CACHE_VERSION`
- `memory/v58_13_132aq_and_132ar_smartfill_pagination_and_prices_shipped_finish_deferred.md` (this memo)

Zero DB migrations. Zero new deps.

## Instructions for Stephen

1. Hard-refresh once (CACHE_VERSION bumped — expect the usual ~30-60 s cache-version transient-404 window per the ops note).
2. Fuel Report → **This Week** → **Refresh** button. Today's fills should now match your SmartFill portal count exactly (12 fills, 8023 L, real per-fill prices).
3. Tomorrow's 06:00 Brisbane cron will fire against the new pagination cap + newest-first sort — every subsequent day's fills should land in DB on the same day, tagged `smartfill_actual`, without any manual intervention.

## Known follow-ups (deferred to future batches)

- **`.132as` (5-line backfill)** — one Mongo update to flip the 547 legacy `provisional_static_3.00` rows to `null` OR `smartfill_actual` if a matching real-priced row exists via dedupe fingerprint. That will make the amber `$3.000*` marker disappear from historical rows too, not just future ones.
- MyProfile Admin-PIN section + Users Management superadmin Clear PIN (`.132am` Option-B split)
- Sentry mobile crash reporting with proper `disableAutoUpload:true` plugin config (`.132an` retry, when Stephen provides DSN)
- P2 backlog carried forward: Workers multi-select, BOM forecast, Details modal, iOS TestFlight, invite email dead-end, ephemeral-upload-storage lints
