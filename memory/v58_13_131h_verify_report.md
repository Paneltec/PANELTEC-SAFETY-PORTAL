# v58.13.131h — Verification + screenshot pass — VERDICT: **gaps found (2)**

Read-only verification. Zero writes. Migration re-run in `--dry-run` mode only (idempotent). No pytest additions. No version bumps. `.131i` not started.

## 9-item verification checklist

### 1. ✅ Migration idempotency proof
```
$ python backend/migrations/v58_13_131h_navixy_enrich.py --dry-run
INFO | dry-run → /app/memory/v58_13_131h_dryrun.md | snapshot=0 stale=0 unknown=124
```
360 fresh + 63 stale rows previously enriched are now `odometer_km > 0` → no longer match the null/0 discovery filter → **0 rows would be newly enriched**. The 124 unknowns re-appear (expected — no Navixy device → they cannot be enriched without `.131i`).

### 2. ✅ Live-DB anomaly counts
```
GET /api/fleet/fuel/anomalies?rule=reading_regress&resolved=false&count_only=true
→ {"count": 0}                                                     ✔ (expected ~0)

GET /api/fleet/fuel/anomalies?rule=missing_odometer&resolved=false&count_only=true
→ {"count": 124}                                                   ✔ (expected 124)

GET /api/fleet/fuel/anomalies?resolved=false&count_only=true
→ {"count": 140}                                                   (124 R5 + 16 non-R5)
```
R5=124 matches the migration `--apply` log's `r5_added=124`. R4=0 confirms no false regressions from snapshot-value repetition.

### 3. ✅ `odometer_source` distribution
```
navixy_snapshot / fresh : 360
navixy_snapshot / stale :  63
unknown                 : 124
navixy_live             :   0  (.131i upstream bug — as documented)
csv                     :   0  (no CSV had non-zero odometers)
─────────────────────────────
Total                   : 547  ✔ matches apply log
```

### 4. ⚠️ **GAP** — L/100km computed rows = **0**
```
db.fuel_transactions.count_documents({litres_per_100km: {$ne: null, $exists: true}}) = 0
```
**Honest disclosure**: this matches the shipped memo (`lp100_written: 0`) but does NOT match your spec item 4 ("real number > 0"). The migration's per-asset guard (`delta > 0.1 km AND result ≤ 500 L/100km`) correctly skips every row because every enriched row for a given asset carries the SAME snapshot odo (Navixy `assets.odo_km` is a single point, not per-timestamp history). Deltas = 0 → `_lp100_skipped: "delta_too_small_or_odd"` on every candidate.

**Root cause**: `asset_meter_history.odometer_km` is null on all 5,038 daily-snapshot rows (`.131i` bug). Meaningful L/100km values start landing once `.131i` populates history.

**Verdict**: mechanism is correct, data upstream is not.

### 5. ✅ Indexes include `deleted_at: null` in `partialFilterExpression`
```
dedup_by_txn_id     unique=True  partial={transaction_id: {$type: 'string'}, deleted_at: null}
dedup_by_hash       unique=True  partial={dedupe_hash:    {$type: 'string'}, deleted_at: null}
dedup_by_composite  unique=True  partial={key_code_fallback: {$type: 'string'}, deleted_at: null}
```
Soft-delete pytest present:
```
tests/backend_unit/test_v58_13_131g_smartfill_realworld.py:234:
async def test_soft_delete_then_reimport_succeeds(_patch_db):
```

### 6. ✅ R5 label proof
Sample R5 anomaly response:
```json
{
  "rule": "missing_odometer",
  "severity": "low",
  "detail": "No odometer available (Navixy has no data for this asset)",
  "resolved_at": null,
  "created_at": "2026-09-05T08:19:01.756950+00:00"
}
```
Frontend `RULE_META.missing_odometer.label = "No odometer"` (grep-confirmed in `FuelAnomalyInbox.jsx:26`). Chip visually rendered as `NO ODOMETER` in screenshot 5.

### 7. ❌ **GAP** — `_import_csv` enrichment wiring is **NOT present**
Grep of `/app/backend/fleet_fuel.py`:
```
$ grep -n "_load_navixy_snapshots\|odometer_source\|_enrichment_confidence" backend/fleet_fuel.py
449:  # returns `odometer_source == "unknown"` (see enrichment path
```
Only a code comment — no actual call to `_load_navixy_snapshots` or equivalent inside `_import_csv`. Confirmed by DB check:
```
Rows with _enriched_at set (migration-touched): 547
Rows with odometer_source set               : 547
Rows with odometer_source but no _enriched_at (=import-time set): 0
```
100% of enriched rows came via the migration script. **Zero came via `_import_csv`.**

**The `.131h` ship memo item #6 ("Enrichment wired into `_import_csv`") is inaccurate.** The migration script contains the enrichment code but it is not called from the import path. Future CSV imports will land with raw CSV odometer (0 or null) and no `odometer_source` field. Re-running the migration after each import is the current workaround, which the user has been doing manually.

**Fix scope**: 1 file (`backend/fleet_fuel.py`), 1 call site inside `_import_csv` after `_evaluate_anomalies`, reusing `_load_navixy_snapshots` from the migration module. This should be included in `.131i` or a separate hot-patch.

### 8. ✅ Pytest tally (baseline unchanged)
```
$ pytest tests/backend_unit/ -q --ignore=tests/backend_unit/test_v58_13_131_smartfill_probe.py --tb=no
24 failed, 1257 passed, 6 skipped, 18 warnings in 8.38s
```
Same 24 pre-existing flakes as `.131c/.131d/.122b/.131g/.131h` baseline. Zero new regressions.

### 9. ✅ Version pin — all 3 files sit at `.131h`
```
frontend/src/lib/version.js#RUNNING_VERSION       = paneltec-v160.3.9.58.13.131h
mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION   = paneltec-v160.3.9.58.13.131h
frontend/public/service-worker.js#CACHE_VERSION   = paneltec-v160.3.9.58.13.131h
```

## Screenshot pass — 7 captured + 1 delivered as markdown

Saved to `/app/memory/`:

| # | File | Content |
|---|---|---|
| 1 | `v58_13_131h_verify_01_reporting_no_price_banner.jpeg` | Admin Rollup / This month · blue "Cost data not present in this dataset" banner · Total Cost $0.00 · "Top 5 $/L outliers · No fills with pricing data" · cost chart empty |
| 2 | `v58_13_131h_verify_02_per_employee.jpeg` | Per-Employee tab · 1 row `(no driver)` · CSV has no driver column → driver empty state proof |
| 3 | `v58_13_131h_verify_03_per_vehicle_ytd.jpeg` | Per-Vehicle · Year to date · 547 fills · 44,836.1 L across 66 vehicles · $0.00 · $/L column shows `—` gracefully |
| 4 | `v58_13_131h_verify_04_import_modal.jpeg` | Import Fuel CSV modal (empty state). **Note**: `columns_detected` + `rules_suppressed` panels only render AFTER a successful import. Modal itself opens cleanly, `SmartFillImporter` heading, drop-zone, header help text intact. To capture the populated result state I would need to run a real import (write action — deferred per your "no writes" constraint). |
| 5 | `v58_13_131h_verify_05_anomaly_no_odometer.jpeg` | Anomaly Inbox · `TOTAL MATCHES 140` · every visible chip reads `NO ODOMETER` · cross-rule rows show `STATISTICAL SPIKE + NO ODOMETER` and `UNUSUAL HOUR + NO ODOMETER` |
| 6 | `v58_13_131h_verify_06_fuel_tab_D04RF_fresh.jpeg` | AssetDrawer · `VTS - D-max - D04RF (AG)` · Fuel tab · Fills(20)=11, Total(20)=527L, Mean/fill=47.9L · Recent Transactions: every row shows `📍 SNAP` badge · ODO column populated (201,531 km from Navixy fresh snapshot) |
| 7 | `v58_13_131h_verify_07_fuel_tab_D05RF_stale.jpeg` | AssetDrawer · `VTS - D-Max - D05RF` · Fuel tab · 7 fills · Recent Transactions: every row shows `📍 SNAP` badge **PLUS red `NAVIXY STALE` chip** · ODO column 851 (stale snapshot) |
| 8 | `v58_13_131h_dryrun.md` (fresh) | Migration dry-run summary block. Idempotency re-run wrote the file at 2026-09-05T08:44:37. Contents show `Rows scanned (odo null or 0): 547`, `Would enrich as navixy_snapshot: 0 fresh, 0 stale`, `Would land as unknown: 124`, `navixy_live: 0 (path unavailable in this deployment — reserved for future when history is backfilled)` — proving the apply took AND unknowns are permanent until `.131i`. |

## One-line verdict

> **gaps found: (4) `litres_per_100km` = 0 on live — mechanism correct, upstream Navixy history bug; (7) `_import_csv` does NOT auto-enrich — memo #6 claim inaccurate. Fold both fixes into `.131i`.**

The other 7 checks are clean. The soft-delete/partial-index fix landed correctly, R5 rename is live, the migration is idempotent, R4/R5 counts match the spec, all 3 version files are at `.131h`, and the pytest baseline is unchanged.

## Recommended next-ship (`.131i`) scope

Bundle these three fixes since they share the enrichment code path:
1. Trace `asset_navixy_sync.py` writeback for `asset_meter_history.odometer_km` → fix null-write bug (P0)
2. Wire `_load_navixy_snapshots` into `_import_csv` so future imports auto-enrich (recovered from gap #7)
3. Re-run `.131h` migration once `asset_meter_history` is populated → upgrades 423 `navixy_snapshot` rows to `navixy_live` AND unlocks meaningful `litres_per_100km` values (recovers gap #4)

All three provable via curl + Playwright screenshots. Version bumps `.131h → .131i` on the three canonical files.
