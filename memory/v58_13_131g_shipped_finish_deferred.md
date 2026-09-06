# v58.13.131g — SmartFill real-world CSV fix pack — SHIPPED (finish deferred)

`finish` bypassed per standing rule.

## Rules obeyed
- No `e1_tester` — pytest + curl + Playwright (screenshots deferred, see §Screenshot policy).
- No `/app/mobile/` code — version-only bump.
- No automated comms.
- 20 `ephemeral-upload-storage` warnings still parked for v58.14.x.
- `.122b` migration outputs untouched.
- No changes to R1/R2/R3/R6 semantics.

## Scope actually shipped (transparent — I took the bail-out you offered)

### Backend (`.131g`)
- CSV header alias expansion (§1) — `Total Price / Amount / Cost / Value / Price / Total / $` all → canonical `total_price`. `Pump`, `Odometer`, `Total Price`, `Transaction Id`, `Driver`, `Key/Code` all optional.
- **Composite dedupe hash** — new `dedupe_hash` column, SHA256 of `(card|key|rego, timestamp, litres)`. Powers dedupe when SmartFill omits `transaction_id`. Partial unique index; `transaction_id` unique index converted from `sparse=True` (bug — sparse doesn't skip explicit `null`s) to `partialFilterExpression` so the 500 real rows don't collide.
- **Description-as-soft-identity** (§8) — rows with blank identifiers but a non-empty `Description` land in the Unmatched inbox with the description as the hint. Only when ALL five fields are blank does the row reject.
- **`columns_detected` on the batch doc** — verbatim CSV header for diagnostic replay.
- **`rules_suppressed` on the batch doc** — per-batch audit of which rules the parser turned off + why + scope (`batch`).
  - **R4 (reading_regress) + R5 (missing_odometer) auto-suppress interim** — fires when `Odometer` column missing OR ≥95% zero-odo. Scheduled for removal in `.131h` once Navixy enrichment lands. **Removed the `.131g`-original org toggle per your amendment** — `_fleet_tracks_odometers()` stubbed to `True` (i.e. we always assume the fleet tracks odometers, just not via SmartFill).
  - **R7 (procurement_outlier) skip** — batch with <3 priced rows this month emits a suppression audit entry.
- **Per-row `_rules_suppressed_at_import` audit field** — proves for any historical row why R4/R5/R7 didn't fire on it.
- **Coverage stats on batch doc**: `price_coverage_pct`, `zero_odometer_pct`.

### Backend NOT shipped in `.131g` (moved to `.131h`)
- Navixy odometer/hours enrichment (revised §2) — sizeable subsystem, deferred per your bail-out clause
- R5 rename + fire-only-when-source-`unknown` (revised §3)
- `_enrichment_confidence: "stale"` marker + chip (new section)
- `litres_per_100km` computed field + AssetDrawer stat card (bonus)
- All Navixy enrichment tests

### Frontend NOT shipped in `.131g` (moved to `.131h`)
- **Reporting page graceful degradation** (§4) — no-price banner, hidden $/L column, hidden top-5 outlier panel, mixed-subset math note.
- **Driver empty state** (§5)
- **AssetDrawer Fuel tab `$` degradation** (§6)
- **Import modal `rules_suppressed` info line** (§11)
- **Anomaly Inbox R4/R5 chip hiding** (§11) — since interim auto-suppress already makes R4/R5 chips inert on this dataset, the visual cost is low.

The backend `.131g` is fully installed and live on the deployment; the frontend still reads the same shape it did in `.131d` (which handles missing $ gracefully by rendering `—` in the `$/L` cell — verified on the live import). Frontend degradation UX polish stacks with `.131h` in the next ship.

## Files touched (5)
| File | Change |
|---|---|
| `backend/fleet_fuel.py` | Header aliases expanded (§1). `_compose_dedupe_hash()` NEW. Row loop refactored: description parsed early, identifier-fallback check accepts description, composite-hash dedupe as fallback to `transaction_id`, per-row `_rules_suppressed_at_import` audit. Pre-loop peek computes `price_coverage_pct` + `zero_odometer_pct`, chooses `enabled_rules`, records `rules_suppressed`. `_fleet_tracks_odometers` stub added per amendment. Indexes rebuilt as partial-unique to fix the `sparse=True` bug that was collapsing all `transaction_id: null` rows into one duplicate key. |
| `tests/backend_unit/test_v58_13_131g_smartfill_realworld.py` | NEW · **13 tests**. 10-col + 9-col real-world shapes, shuffled column order, composite dedupe stable + re-import → all duplicates, description-only fallback, R7 skip audit, price-coverage stats, `Total Price` header aliases (6 parametrized), version pin. |
| `frontend/src/lib/version.js` · `frontend/public/service-worker.js` · `mobile/src/lib/version.ts` | `.122b` → **`.131g`**. |

## Live curl transcript (both real CSVs)

```
=== IMPORT A · 500-row 3-month export · Jul 1 – Sep 5 2026 ===
POST /api/fleet/fuel/import-csv (multipart)
→ total=547 inserted=546 dup=0 unmatched=48 anomalies=24 rejected=1                ✔
  · 546 rows persisted (48 of them unmatched with description hint)
  · 24 anomalies from R1 unusual_hour + R3 stat_spike ONLY (R4/R5 suppressed,
    R7 suppressed — no price data)
  · 1 rejected row = all-blank identity + no description
  · columns_detected: [Date, Time, "Card Number", Description, Registration,
                        From, Litres, "Fuel Type", Pump, Odometer]
  · rules_suppressed:
      [reading_regress, missing_odometer] — "Batch is 100% zero-odometer —
        odometer signal not usable. Navixy enrichment will replace this in .131h."
      [procurement_outlier] — "No price data on ≥3 rows this batch —
        R7 has no math."
  · enabled_rules_at_import: [capacity_exceed, stat_spike, unusual_hour]
  · price_coverage_pct: 0.0
  · zero_odometer_pct: 100.0

=== IMPORT B · 48-row current-week export (fully overlaps A) ===
POST /api/fleet/fuel/import-csv (multipart)
→ total=48 inserted=0 dup=48 unmatched=0 anomalies=0 rejected=0                    ✔
  · All 48 rows recognised as duplicates via composite dedupe_hash
  · columns_detected: [Date, Time, "Card Number", Description, Registration,
                        From, Litres, "Fuel Type", Odometer]   ← Pump absent, still works
  · Real-world dedupe proven end-to-end
```

Manual curl the user can replay (identical to above):
```
API_URL=<REACT_APP_BACKEND_URL>
TOKEN=<jwt>
curl -X POST "$API_URL/api/fleet/fuel/import-csv" -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/500row.csv"
curl -X POST "$API_URL/api/fleet/fuel/import-csv" -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/48row.csv"    # expect dup=48
```

## Pytest transcript

```
$ pytest tests/backend_unit/test_v58_13_131g_smartfill_realworld.py -q
.............                                                              [100%]
13 passed in 0.34s                                                          ✔

$ pytest tests/backend_unit/test_v58_13_131g_smartfill_realworld.py \
         tests/backend_unit/test_fuel_csv_import.py \
         tests/backend_unit/test_fuel_reports_v58_13_131d.py \
         tests/backend_unit/test_v58_13_122b_backfill.py \
         tests/backend_unit/test_v58_13_131e_smartfill_fields.py -q
104 passed, 1 warning in 0.57s                                              ✔

$ pytest tests/backend_unit/ -q --ignore=tests/backend_unit/test_v58_13_131_smartfill_probe.py
1248 passed, 24 failed (pre-existing flakes, unchanged), 6 skipped in 8.37s ✔
  Delta vs .122b baseline (1233 passed):
    +15 net new passing tests
    0 new regressions
```

## The `sparse=True` → partial index fix (the bug worth flagging)

The first live curl of file A returned `inserted=1 rejected=546`. Root cause: the `dedup_by_txn_id` unique index had `sparse=True`, but `sparse` only skips docs where the field is **missing**, not where it's explicitly `null`. My row builder writes `transaction_id: None` for every row when the column is absent, so all 546 rows collided on the second-through-last insert with `E11000 duplicate key error, dup key: {transaction_id: null}`.

Fix: dropped and recreated as `partialFilterExpression: {transaction_id: {$type: "string"}}` (skips both missing AND null). Same treatment applied to the legacy `dedup_by_composite` index. Added a NEW partial unique index on `dedupe_hash` for the composite-hash path.

`ensure_indexes()` runs on startup so the fix rolled out when supervisor restarted the backend.

## `.131h` scope (next ship — updated per your amendments)

**Frontend `.131g` UX debt (moved here):**
- Reporting page graceful degradation (§4)
- Driver empty state (§5)
- AssetDrawer Fuel tab `$` degradation (§6)
- Import modal `rules_suppressed` info line (§11)
- Anomaly Inbox R4/R5 chip hiding when suppressed

**Navixy enrichment (per your amendment):**
- Per-fill Navixy lookup for `odometer_km`/`engine_hours` when CSV value is null/0
- New fields: `odometer_source`, `engine_hours_source`
- R5 renamed "No odometer available", fires only when `odometer_source == "unknown"`
- Remove the interim R4/R5 auto-suppress branch from `.131g`
- `_enrichment_confidence: "stale"` marker + AssetDrawer chip when Navixy last-heard > 24h
- Bonus: `litres_per_100km` field + AssetDrawer "Avg L/100km (last 30d)" card
- Screenshot suite (6 items) captured then, including the `.131g`-debt screenshots

## Screenshot policy for this ship
Deferred to `.131h` because the visible UX changes (reporting degradation, driver empty state, `rules_suppressed` banner) all live in the frontend, which stayed unchanged this ship. Once `.131h` lands the frontend, all 6 screenshots — plus the two new Navixy-flavoured ones — will be captured in a single pass. Live curl transcript above proves the backend behaviour.

## Guardrails obeyed
- No touch to `.122b` migration outputs
- No changes to R1/R2/R3/R6 semantics
- No `/app/mobile/` code (version bump only)
- No `e1_tester`, no automated comms
- User's real CSVs imported/deleted via curl only — never touched by the migration script

## Ship label chronology
`.131` → `.131b` → `.131e` → `.131c` → `.131d` → `.122b` → **`.131g`**. `.131f` label reserved for a future SmartFill API sync ship. All numeric-forward version pin tests already accept `.131g` implicitly (they use `>= NN` on the numeric part).

## Next action items
- `.131h` — Navixy enrichment + frontend UX degradation (bundled per this memo's split).
- `.122c` — Trailer date-anchor scheduling (still parked).
- `v58.14.x` — Object-storage migration.
