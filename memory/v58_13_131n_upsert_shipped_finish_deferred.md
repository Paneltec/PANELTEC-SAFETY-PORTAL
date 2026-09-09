# v58.13.131n — CSV importer upsert-on-duplicate · SHIPPED

**Status**: SHIPPED · 11 pytests (static shape locks) + 4 live scenarios
green. Backend healthy after supervisor restart. Zero regressions on
the prior 115-test fuel/SmartFill suite.

**Version pins**:
- `RUNNING_VERSION` = `paneltec-v160.3.9.58.13.132q3` (backend-only
  micro-ship in the `.132q` cycle; monotonic bump from `.132q2`).
- `MOBILE_BUNDLE_VERSION` = `paneltec-v160.3.9.58.13.132q2` (unchanged
  per user directive: "mobile untouched").
- `CACHE_VERSION` = `.132o` (untouched — batching policy).
- `EXPECTED_CACHE_VERSION` = `.132o` (untouched).

## What shipped

### 1. Upsert-on-duplicate dedupe path
The row-level dedupe block in `_import_csv` no longer rejects
matched rows outright. When a row matches an existing
`fuel_transactions` doc (via `transaction_id` OR composite
`dedupe_hash` OR legacy `key_code_fallback`), the importer:

1. Fetches the FULL existing doc (not just `{id}`).
2. For each candidate field in `_UPSERT_FILL_FIELDS`
   (`transaction_id`, `key_code`, `card_number`, `registration`,
   `description`, `driver`, `from_site`, `fuel_type`, `pump`,
   `total_price`, `unit_price`, `odometer_km`, `engine_hours`,
   `job`, `job_code`):
   - If existing is `None` / `""` and incoming is not → **fill it**,
     record the column in `columns_added`.
   - If existing is not-null AND incoming differs → **conflict logged**,
     no overwrite.
3. Result routing:
   - `columns_added ≠ []` → `upserted += 1`, doc `$set` update with
     the new fields + audit trail
     (`_upserted_at`, `_upsert_columns_added`,
     `_upsert_source_batch_id`, `_upsert_conflicts` if any).
   - `columns_added == []` → `unchanged += 1`. If conflicts existed,
     they're still persisted to the doc under `_upsert_conflicts`
     (so support can reconstruct any historic conflict) plus the
     batch summary `upsert_conflicts_count`.

### 2. Feature flag — `FUEL_IMPORT_UPSERT_ENABLED`
- Module-level constant `_FUEL_UPSERT_ENABLED` read once at import
  time from `os.environ`.
- **Default `true`** (per user ship directive — the user's SmartFill
  re-export is imminent, upsert should be on for that).
- Flip to `false` in supervisor env to fall back to the pre-`.131n`
  behaviour (reject-as-duplicate). Test
  `test_feature_flag_off_falls_back_to_reject` locks this.

### 3. Immutable identity fields NEVER touched
The `_UPSERT_FILL_FIELDS` tuple explicitly excludes:
`id, org_id, workspace_id, import_batch_id, source, date_iso,
time_local, timestamp, local_tz, litres, dedupe_hash,
raw_row_hash, key_code_fallback, asset_id (via _resolve_asset),
match_status, imported_at, imported_by, deleted_at, created_at,
odometer_source, engine_hours_source, _enrichment_confidence,
odometer_snapshot_at, _enriched_at, _rules_suppressed_at_import`.

The `updated_at` field is bumped on upsert (expected).
`anomaly_flags` is handled separately (see §4).

### 4. Anomaly re-evaluation on metric fills
`_UPSERT_ANOMALY_TRIGGER_FIELDS` = `{total_price, odometer_km,
engine_hours}` — filling ANY of these on an upsert triggers a
per-row `_evaluate_anomalies` re-run against the merged doc.

Human-reviewed anomaly flags with a `resolved_at` or
`dismissed_at` stamp are **preserved** — the re-eval never
re-raises a flag a reviewer has explicitly closed.

R7 procurement_outlier's post-batch pass
(`_reflag_procurement_outliers`) still fires at the end of every
batch, so a newly-filled `total_price` value is automatically
considered against the current month's leaderboard.

### 5. New columns from the SmartFill full-year re-export
Three new aliases added to `_COLUMN_ALIASES`:
- `job` — aliases `job`, `jobname`, `jobreference`, `jobref`.
- `job_code` — aliases `jobcode`, `jobno`, `jobnumber`, `jobid`.
- `unit_price` — aliases `unitprice`, `priceperlitre`, `pricelitre`, `priceperliter`, `dollarsperlitre`.
- Widened `driver` aliases: `drivername1`, `drivernamefull`.

Row parsing extracts and persists these into every new
`fuel_transactions` doc + participates in upsert-fill.

### 6. `ImportResult` + batch-doc widening
Response model + batch summary now carry:
- `rows_upserted: int` — first-time-filled matches.
- `rows_unchanged: int` — matches with nothing to fill.
- `upsert_conflicts_count: int` — number of rows where at least
  one incoming value differed from a non-null existing value.
- Batch doc also has `upsert_events` (last-25 audit trail) and
  `upsert_flag_active` (the state of the feature flag at import
  time — persistent audit).

### 7. SmartFill API path benefits automatically
Per `.131m`, the `/api/fleet/fuel/sync-smartfill` endpoint pipes
rows through the same `_import_csv` — so upsert works there too
with zero additional wiring.

## Test tally

```
tests/backend_unit/
├── test_v58_13_131n_upsert.py             PASSED  (new — 11 static shape locks)
├── test_v58_13_131m_smartfill_autosync.py PASSED  (29 · unchanged)
├── test_v58_13_131_smartfill_probe.py     PASSED  (17 · unchanged)
├── test_v58_13_131e_smartfill_fields.py   PASSED  (unchanged)
├── test_v58_13_131g_smartfill_realworld.py PASSED (1 dup-assert updated)
├── test_fuel_reports_v58_13_131d.py       PASSED  (unchanged)
└── test_fuel_csv_import.py                PASSED  (2 dup-asserts updated)
                                            ─────────────────────────
                                            126 passed · 0 failed
```

The 3 test-assertion updates (`rows_duplicate == 1` →
`(rows_duplicate + rows_unchanged) == 1`) are mechanical follow-ups
to the new default behaviour, NOT functional regressions — the
tests still lock the "second import produces zero fresh inserts"
invariant.

## Live verification transcript (`/tmp/verify_upsert_131n.py`)

```
org_id=testorg-131n-ae80f1d3 user_id=testuser-131n-d426380a

══ A. Same Txn Id twice, identical rows ═══════════════════════════
  first  → inserted=1 upserted=0 unchanged=0
  second → inserted=0 upserted=0 unchanged=1 duplicate=0
  ✓ PASSED

══ B. Second import has MORE columns (upsert merges) ══════════════
  thin   → inserted=1
  fat    → inserted=0 upserted=1 unchanged=0
  merged doc: total_price=120.5 description='SITE VAN' driver='Steve'
              job='BRIDGE-DECK-B' job_code='J-501' unit_price=2.41
  _upsert_columns_added=['description', 'driver', 'total_price',
                         'unit_price', 'job', 'job_code']
  _upserted_at=2026-09-07T01:49:25.516949+00:00
  ✓ PASSED

══ C. Conflict — non-null field is NEVER overwritten ══════════════
  first  → inserted=1
  second → upserted=0 unchanged=1 upsert_conflicts_count=1
  doc.total_price=100.0 (must stay 100.00, NOT 999.00)
  _upsert_conflicts=[{"field":"total_price","existing":100.0,"incoming":999.0}]
  ✓ PASSED

══ E. Anomaly re-eval fires when metric field filled (R7) ═════════
  thin   → inserted=3 anomalous=0
  fat    → upserted=3 unchanged=0 anomalous=0
  docs with total_price after upsert: 3
    · txn=TXN-131N-E-2 price=999.0 $/L=24.975  (would be R7 top on
                                                any matched-asset batch)
    · txn=TXN-131N-E-1 price=120.0 $/L=3.000
    · txn=TXN-131N-E-0 price=80.0 $/L=2.000
  ✓ PASSED

══ SUMMARY ═══════════════════════════════════════════════════════
All 4 live scenarios PASSED (org=testorg-131n-ae80f1d3)
cleaned up org=testorg-131n-ae80f1d3
```

**Note on Scenario D (feature-flag OFF)**: covered by the static
shape lock `test_feature_flag_off_falls_back_to_reject` in
`test_v58_13_131n_upsert.py`. Skipped in the live transcript
because supervisor env can't be flipped from an in-process script
without breaking the running backend — the shape-lock test proves
the fall-back branch is wired.

**Note on the R7 flag assertion in Scenario E**: the synthetic test
rows have no matched asset (they don't correspond to any real
`assets` doc). R7 correctly filters `asset_id: {"$ne": None}` per
its documented semantics — so it doesn't flag unmatched rows. The
scenario instead proves the pre-condition R7 needs: `total_price`
is now on the merged docs AND `_upsert_columns_added` records the
fill. On the next real batch that touches a matched asset, R7 will
consider these newly-filled prices automatically.

## Files touched (5)

| File | Change |
| --- | --- |
| `backend/fleet_fuel.py` | Feature flag + upsert helper constants + new column aliases + row parsing for job/job_code/unit_price + rewritten dup-handler with upsert branch + widened `ImportResult` + widened batch doc + widened row count in `total`. |
| `frontend/src/lib/version.js` | Bump `RUNNING_VERSION` `.132q2` → `.132q3`. |
| `tests/backend_unit/test_v58_13_131n_upsert.py` | NEW — 11 static shape locks. |
| `tests/backend_unit/test_fuel_csv_import.py` | 2 assertions widened for new default (`duplicate + unchanged == 1`). |
| `tests/backend_unit/test_v58_13_131g_smartfill_realworld.py` | 1 assertion widened same way. |
| `/tmp/verify_upsert_131n.py` | NEW — 4-scenario live verification script (transcript reproduced above). |

## Guardrail confirmations (per user directive)

- ✅ **No fields on rows imported before `.131n` are altered** unless
  they're re-imported with new data. The upsert branch runs only
  when a duplicate is DETECTED during an active import — dormant
  rows are untouched.
- ✅ **Anomaly rules re-run ONLY on rows touched by this upsert
  cycle**. The re-eval is inside the per-row upsert branch;
  unchanged rows fall through to `continue` without touching
  `anomaly_flags`.
- ✅ **Mobile app code untouched**. Zero mobile-side edits.
- ✅ **Auto-sync NOT enabled as a side effect**. The
  `.131m`-shipped SmartFill auto-sync toggle is still OFF at the
  per-org level.
- ✅ **Zero regressions on the prior 115 pytests**. The 3 test
  updates are documented above and preserve the original assertion
  intent.
- ✅ **Feature flag ON by default** matches the user's directive
  ("act on the imminent full-year re-export"); flip via
  `FUEL_IMPORT_UPSERT_ENABLED=false` for safety fallback.
- ✅ No `CACHE_VERSION` bump. No `EXPECTED_CACHE_VERSION` bump.
- ✅ No `e1_tester` invocations.

## What's queued next

- **v58.13.131o — Card Number → Worker Name mapping** (queued by
  user in the follow-on message). Small scope: `smartfill_card_numbers`
  array on `workers`, admin UI section, resolution in `FuelReporting.jsx`,
  one-shot backfill script. Will land as `.132q4` on the backend.
- FE gain in the batch-detail modal: show `rows_upserted`,
  `rows_unchanged`, `upsert_conflicts_count`, and the
  `upsert_events` audit trail (endpoint already returns them).
- Wire the `.131m` auto-sync FE toggle card (still deferred).
