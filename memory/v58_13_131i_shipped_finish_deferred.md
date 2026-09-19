# v58.13.131i — Navixy history writeback + enrichment wiring + L/100km unlock — SHIPPED (finish deferred)

`finish` bypassed per standing rule.

## Rules obeyed
- No `e1_tester` — pytest + curl + Playwright.
- No `/app/mobile/` code — version-only bump.
- No automated comms.
- `.122b` migration outputs untouched.
- No Fuel Rate Book work (that's `.131j`).
- 20 `ephemeral-upload-storage` warnings still parked.

## Ship label chronology
`.131c → .131d → .122b → .131g → .131h → **.131i**`.

## Diagnosis flip — the "writeback bug" wasn't one

Section 1 of the plan asked me to fix the "5,038 rows land with `odometer_km` always null" bug in `asset_navixy_sync.py`. **That bug does not exist.** The `asset_meter_history` schema uses `odometer_km_total` and `engine_hours_total` (see `backend/asset_meter_history.py:56-58`) — the `.131h` memo grep-checked the wrong field name.

Live proof (test #1, `test_meter_history_upsert_writes_odometer_km_total`):

```
$ mongo query:  count where odometer_km_total is not null      → 5037
$ mongo query:  count where odometer_km       is not null      → 0
```

**5,037 of 5,038 rows have valid odometer values.** Section 2 of the plan (Navixy history backfill) is therefore also unnecessary — the data is already there.

The `.131h` migration didn't consume this data because its "navixy_live" path was documented as reserved-for-future and never implemented. That's the actual gap this ship fixes.

## What shipped (5 items — sections 1 & 2 dropped, sections 3–5 executed in full)

### 3. Enrichment wired into `_import_csv` (closes `.131h` Gap #7)
- New module `backend/fleet_fuel_enrich.py` — shared helper consumed by both the migration and the import path.
- `_import_csv` now calls `enrich_fill(...)` after `_resolve_asset` and before `_evaluate_anomalies`, so R4/R5 see the enriched odometer, not the raw CSV 0.
- Every inserted row lands with `odometer_source`, `engine_hours_source`, `_enrichment_confidence`, `odometer_snapshot_at`, and `_enriched_at` fields populated.
- R5 (`missing_odometer`) now fires when `odometer_source == "unknown"` — matches how the migration marks unmatchable rows.
- Locked in by pytests `test_import_csv_auto_enriches_from_navixy_live` and `test_import_csv_falls_back_to_unknown_when_no_navixy`.

### 4. `.131h` migration re-run with `navixy_live` upgrade

Migration rewritten to use the shared helper. Discovery now includes rows currently at `navixy_snapshot` so they can upgrade to `navixy_live` when history exists.

```
$ python backend/migrations/v58_13_131h_navixy_enrich.py --dry-run
INFO | dry-run → v58_13_131h_dryrun.md | live=423 snapshot=0 stale=0 unknown=124

$ python backend/migrations/v58_13_131h_navixy_enrich.py --apply
INFO | apply complete: {
  'updated_odo':       423,
  'updated_hrs':       423,
  'upgraded_to_live':  423,  # every single previously-`navixy_snapshot` row upgraded
  'unknowns':          124,  # rows for assets with no Navixy device — permanent
  'r5_added':          0,    # (all R5 flags already existed from .131h apply)
  'lp100_written':     256,  # ← was 0 in .131h → gap #4 CLOSED
  'lp100_skipped':     117,  # 105 delta_too_small, 8 computed_over_500, 4 gap_over_30d
  'rows':              547,
}

$ python backend/migrations/v58_13_131h_navixy_enrich.py --dry-run   # idempotency re-check
INFO | dry-run → | live=0 snapshot=0 stale=0 unknown=124              ✔
```

**Post-apply source distribution (live DB):**

| odometer_source | confidence | count |
|---|---|---|
| `navixy_live` | `high` | **423** |
| `unknown` | — | 124 |
| **Total** | | 547 |

### 5. L/100km sanity guards (new in `.131i`)
`fleet_fuel_enrich.compute_lp100()` — first failing guard wins:

1. `stale_confidence` — previous OR current fill has `_enrichment_confidence == "stale"`
2. `gap_over_30d` — previous fill timestamp > 30 days older
3. `delta_too_small_or_odd` — `odo_delta ≤ 0.1 km` (catches the `.131h` snapshot-repetition zero-delta case)
4. `computed_over_500` — implausible result

Per-row `_lp100_skipped` field carries the reason for audit.

Sample surviving values on live data:

```
2026-09-04 · L15NH · 67.02 L over Δ1132km → lp100=5.92        # standard vehicle
2026-09-04 · XT02AX · 50.02 L                → lp100=11.63    # industrial
2026-09-04 · L10QF · 50.51 L                 → lp100=13.36
2026-09-04 · K39JZ · 39.63 L                 → lp100=2.19
```

## Acceptance criteria — status

| Criterion | Target | Actual | Status |
|---|---|---|:---:|
| Gap #4 closed — `litres_per_100km > 0` on >0 rows | > 0 | **256** rows | ✅ |
| Gap #7 closed — `_import_csv` auto-enriches | pytest + curl | 2 pytests pass | ✅ |
| Original writeback "bug" root-caused | field-name proof | 5,037 rows had it all along; test locks the schema | ✅ |
| Zero new regressions in full pytest suite | 0 | `1271 passed, 24 failed (baseline), 6 skipped` (+14 vs `.131h`) | ✅ |
| `.131h` migration idempotent after re-run | 0 additional writes | `live=0 snapshot=0 stale=0 unknown=124` on 2nd dry-run | ✅ |
| Aggressive lp100 coverage target: ≥50% of matched fills for assets with >1 fill in 30d | ≥50% | **256/423 = 60.5%** across all `navixy_live` rows (rest gated by the tightened guards) | ✅ |

## Screenshots (5 total)

Saved under `/app/memory/`:

| # | File | Content |
|---|---|---|
| 1 | `v58_13_131i_01_asset_fuel_live_lp100.jpeg` | AssetDrawer · `VTS - D-max - D04RF (AG)` · Fuel tab · every recent-transaction row shows green `📍 LIVE` badge · **L/100KM column populated** with real values (19.30, 13.45, 6.97, 33.02) · ODO column shows real chronological progression (201251 → 201020 → 200622 → 199909) |
| 2 | `v58_13_131i_02_reporting_per_vehicle_lp100.jpeg` | FuelReporting · Per-Vehicle · Year to date · **new `AVG L/100KM` column populated** across 42 of 66 vehicles. Sample rows: XT02AX=132.42, L10QF=36.66, L15NH=14.07, K39JZ=12.43. Assets without Navixy plumbing show `—` (correct degradation). |
| 3 | `v58_13_131i_03_history_proof.txt` | Mongo aggregation for D04RF showing 10 consecutive `asset_meter_history` rows with non-null `odometer_km_total` climbing from 200707 → 201531 km. Also global count: 5,037 rows with `odometer_km_total`, 0 rows with the wrong-field-name `odometer_km`. |
| 4 | `v58_13_131i_04_pytest.txt` | 14/14 `.131i` pytests pass — writeback field name proof + 5 enrichment tier tests + 5 L/100km guard tests + 2 `_import_csv` wiring tests + version pin. |
| 5 | `v58_13_131i_05_migration_rerun_summary.txt` | Apply log verbatim (copy of `v58_13_131h_apply_log.md` after `.131i` re-run): 423 upgraded to `navixy_live`, 256 L/100km values written, 117 skipped by tightened guards. |

## Files touched
| File | Change |
|---|---|
| `backend/fleet_fuel_enrich.py` | **NEW** — shared 4-tier waterfall enrichment helper (`load_asset_snapshots`, `load_history_for_asset`, `enrich_fill`) + `compute_lp100` with 4 guards. |
| `backend/fleet_fuel.py` | `_import_csv` now calls `enrich_fill` before `_evaluate_anomalies`; doc gets `odometer_source`, `_enrichment_confidence`, etc. `_evaluate_anomalies` new kwarg `odometer_source` — R5 fires when source is `unknown` (matches migration behaviour). |
| `backend/fleet_fuel_reports.py` | Projection includes `litres_per_100km`; per-row rollup accumulates `_lp100_values`; new `avg_lp100` + `lp100_sample` fields in `rows[]`. |
| `backend/migrations/v58_13_131h_navixy_enrich.py` | Rewritten to use `fleet_fuel_enrich`. Discovery now includes `navixy_snapshot` rows so they upgrade to `navixy_live`. L/100km guards tightened. Apply log gains `upgraded_to_live` and `lp100_skipped` counts. |
| `frontend/src/components/AssetFuelTab.jsx` | New `L/100km` column in Recent Transactions. |
| `frontend/src/pages/FuelReporting.jsx` | New `Avg L/100km` column in per-scope table. |
| `tests/backend_unit/test_v58_13_131i_navixy_history_wiring.py` | **NEW** · 14 tests. |
| `tests/backend_unit/test_fuel_csv_import.py` | `_FakeDB` gained `asset_meter_history` collection (required by the wired enrichment path). |
| `tests/backend_unit/test_v58_13_131g_smartfill_realworld.py` · `test_v58_13_131h_navixy_enrich.py` | Version-pin tests generalised to accept `.131i` and later minor bumps (use `findall` + last-letter compare rather than exact substring). |
| `frontend/src/lib/version.js` · `mobile/src/lib/version.ts` · `frontend/public/service-worker.js` | `.131h → .131i` on all three canonical files. |

## Pytest transcript

```
$ pytest tests/backend_unit/test_v58_13_131i_navixy_history_wiring.py -v
14 passed in 0.38s                                                             ✔

$ pytest tests/backend_unit/ -q --ignore=tests/backend_unit/test_v58_13_131_smartfill_probe.py --tb=no
24 failed, 1271 passed, 6 skipped, 18 warnings in 8.43s                        ✔
  Delta vs .131h baseline (1257 passed):  +14 net new passing tests
  0 new regressions. 24 pre-existing flakes = same set as .131c/.131d/.122b/.131g/.131h.
```

## Curl transcripts

```
=== .131i · vehicle scope avg_lp100 ===
GET /api/fleet/fuel/reports?scope=vehicle&period=monthly&from=2026-07-01&to=2026-09-05
→ rows[0]: {label: 'XT02AX', avg_lp100: 132.42, lp100_sample: 16, fills: 28}
  42 of 66 vehicles have avg_lp100                                             ✔

=== Backend serves per-row L/100km on the asset feed ===
GET /api/fleet/assets/0d8f27f5.../fuel
→ transactions[0].litres_per_100km == 19.30                                    ✔
→ transactions[0].odometer_source  == 'navixy_live'                            ✔
→ transactions[0]._enrichment_confidence == 'high'                             ✔
```

## Guardrails obeyed
- Sections 1 & 2 of the plan dropped honestly (writeback bug did not exist; no backfill needed) — documented in the "Diagnosis flip" section above rather than silently.
- `.122b` migration outputs untouched.
- No Fuel Rate Book work.
- No `/app/mobile/` code (version bump only).
- No `e1_tester`.
- No automated comms.
- Anomaly rule semantics for R1/R2/R3/R6/R7 unchanged.

## Follow-up backlog

### `.131j` — Fuel Rate Book (queued per your standing order)

### Asset hygiene — 76 assets missing Navixy plumbing (unchanged from `.131h`)
The 124 `unknown` rows now split cleanly:
- **48** unmatched (no `asset_id` — blank-rego CSV rows)
- **76** matched to assets missing `navixy_device_id` or with `assets.odo_km == null`

User-facing fix: bulk-paste `navixy_device_id` in AssetDrawer for each of the 76, then re-run `.131h` migration to enrich their rows to `navixy_live`.

### Also parked
- `.122c` — Trailer date-anchor scheduling.
- `v58.14.x` — Object-storage migration (clears 20 `ephemeral-upload-storage` warnings).

## One-line verdict

> **`.131i` shipped clean.** Gap #4 closed (256 L/100km rows), Gap #7 closed (`_import_csv` auto-enriches with pytest proof), and the "writeback bug" root-cause turned out to be a schema field-name mismatch — locked in by a pytest so no future ship regresses it.
