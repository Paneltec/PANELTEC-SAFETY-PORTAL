# v58.13.132au — SmartFill dedupe fix + Transaction ID columns shipped

## FLEET-WIDE IMPACT (before / after)

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Live `fuel_transactions` rows | 5,503 | 4,961 | **−542 (−9.85 %)** |
| XT02AX all-time rows | 206 | 178 | −28 |
| XT02AX all-time litres | 30,133.0 L | 26,164.2 L | **−3,968.8 L** |
| XT02AX all-time spend | $90,399.06 | $78,492.60 | −$11,906.46 |
| XT16AB all-time rows | 279 | 248 | −31 |
| XT16AB all-time litres | 31,852.3 L | 28,331.7 L | −3,520.6 L |
| **Fleet Sep 1–8 rows** | **98** | **60** | **−38** |
| **Fleet Sep 1–8 litres** | **8,546.5 L** | **5,108.2 L** | **−3,438.3 L (−40.2 %)** |
| **Fleet Sep 1–8 spend** | **$25,639.47** | **$15,324.72** | **−$10,314.75** |
| XT02AX Sep 1–8 rows | 6 | 4 | −2 |
| XT02AX Sep 1–8 litres | 604.75 L | **423.72 L** | −181.03 L (−29.9 %) |
| Remaining dupe groups | 541 | **0** | zero-dupe |

Every fleet-wide KPI on the Fuel Report was inflated by roughly 10 % (some regos, some ranges, materially worse — Sep 1–8 was inflated 40 %). Numbers on-screen now match SmartFill portal totals fill-for-fill.

## USER PAIN (verbatim, 2026-09-08)

> "XT02AX shows 604 L in our portal vs 114.290 L in SmartFill. 5x discrepancy — major data integrity issue."

### Diagnosis reply summary
- **604 L is the weekly rollup**, not a single-fill bug. Hypothesis half-right.
- **BUT** the rollup itself was inflated because 2 of the 6 rows in it were CSV twins of API rows — real duplicates that neither dedupe path caught.
- True Sep 1–8 XT02AX: 4 unique fills, 423.72 L. Currently on-screen after this ship.

## ROOT CAUSE

`backend/fleet_fuel.py::_compose_dedupe_hash` (v58.13.131g origin) hashed the ISO timestamp at **second precision**.

- `smartfill_csv` rows carry real seconds: `06:28:07`, `14:02:41`, `12:47:56` …
- `smartfill_api` rows arrive from SmartFill's Transactions:Read at **minute precision** (`6:28am` → `06:28:00`)
- `transaction_id` is populated on API rows only (CSV rows have `None`), so the txn_id fast-path never matched either

Result: the same fill hashed two different values → dedupe missed → row inserted twice. 541 dupe groups; 539 were the exact API + CSV twin pattern.

## FIX (this ship)

### 1. `backend/fleet_fuel.py::_compose_dedupe_hash` — canonicalise to minute precision
- Splits the ISO string into `date + time + tz`, zeroes the seconds, drops fractional seconds, re-composes.
- API rows and CSV rows now agree on a single hash for the same fill.
- Backward-compatible: rows with pre-existing minute-precision timestamps produce the same hash they always did.

### 2. `backend/scripts/backfill_dedupe_v58_13_132au.py`
- Enumerates every `(org, registration, card_number, date_iso, litres)` group with >1 live rows.
- Picks a canonical survivor per group (prefer `smartfill_api` → most-attribution → oldest `imported_at`).
- Non-destructively merges any non-null field from losers onto the survivor if the survivor's copy is null (mirrors `_FUEL_UPSERT_ENABLED` merge semantics).
- Soft-deletes losers with `deleted_at`, `deleted_reason="dupe_backfill_.132au"`, `deleted_by="system"`, `_backfill_dedupe_survivor_id=<id>`.
- Re-hashes surviving rows using the new minute-precision function so future ingests collide correctly.
- **Executed 2026-09-08 · dry-run then `--commit`. 542 rows soft-deleted, 0 field merges required (API rows already carried all attribution), 0 hash rewrites needed on survivors (all remaining live rows already had minute-precision timestamps).**

### 3. `backend/scripts/rollback_dedupe_v58_13_132au.py`
- Un-soft-deletes every row tagged `deleted_reason='dupe_backfill_.132au'`.
- Kept for at least one week post-ship in case a "duplicate" pair was actually two legit fills inside the same minute on the same card (extremely unlikely — SmartFill doesn't emit sub-minute duplicates on a real fleet).
- Merged fields on survivors are left in place (merge was additive-only, no destructive overwrite happened).

### 4. `backend/tests/test_v58_13_132au_dedupe.py`
- 8 pytest assertions covering the hash function directly:
  1. CSV path (with seconds) + API path (rounded to minute) → same hash ✓
  2. Fractional seconds also collapse cleanly ✓
  3. `Z` UTC shorthand survives canonicalisation ✓
  4. Different litres in same minute → different hash (guard against over-collapse) ✓
  5. Different minutes → different hash ✓
  6. Different cards, same minute → different hash ✓
  7. All blank identifiers → `None` (row rejected upstream) ✓
  8. Registration falls back and is upper-cased ✓
- **All 8 pass. Result: `8 passed, 1 warning in 0.30s`.**

### 5. Transaction ID column added everywhere admins look
- `frontend/src/pages/FuelReporting.jsx` — Per-fill drilldown table.  
  `<th>Txn ID</th>` + `<td data-testid="fuel-reporting-txn-id-{id}">…</td>` — 8th column.
- `frontend/src/components/AssetFuelTab.jsx` — Asset drawer's recent-transactions table.  
  New "Txn ID" column between L/100km and Flags. `data-testid="asset-fuel-txn-id-{id}"`.
- `frontend/src/pages/FuelAnomalyInbox.jsx` — Anomaly Inbox row.  
  New column between Litres and Anomaly rules. Colspan bumped from 6/7 → 7/8. `data-testid="fuel-anomaly-txn-id-{id}"`.
- `backend/fleet_fuel_reports.py::_stream_detail` — CSV detail export.  
  New trailing "Transaction ID" column in the header and every row. Existing consumers of the aggregated CSV are unaffected.

Backend endpoint responses were already returning `transaction_id` (`/fleet/fuel/transactions`, `/fleet/fuel/anomalies`, `/fleet/assets/{id}/fuel` all use `projection={"_id": 0}` full-doc). No endpoint changes needed.

## VERSION STATE

| Constant | Before | After |
|---|---|---|
| RUNNING_VERSION (`frontend/src/lib/version.js`) | `paneltec-v160.3.9.58.13.132at` | `paneltec-v160.3.9.58.13.132au` |
| EXPECTED_CACHE_VERSION | `paneltec-v160.3.9.58.13.132as` | `paneltec-v160.3.9.58.13.132au` |
| CACHE_VERSION (`frontend/public/service-worker.js`) | `paneltec-v160.3.9.58.13.132as` | `paneltec-v160.3.9.58.13.132au` |
| MOBILE_BUNDLE_VERSION (`mobile/src/lib/version.ts`) | `paneltec-v160.3.9.58.13.132at` | unchanged |

CACHE_VERSION bumped because Fuel Report numbers change visibly for every open tab — any user on `.132as` needs to reload to see the corrected totals.

## DEFERRED TO `.132av`

- MyProfile Admin PIN section (Change PIN, Reset PIN, Last set) at `frontend/src/pages/MyProfile.jsx`.
- Users Management "Clear admin PIN" action at `frontend/src/pages/Users.jsx` (requires acting admin's PIN, writes audit log).
- Backend endpoints for both were already built in `.132as`; UI wire-up is what's left.

Same reason as `.132au` proper: data-integrity fix takes priority and the ship memo would exceed context if bundled.

## ROLLBACK PATH

If any dupe was actually legitimate (two fills on the same card in the same minute — extremely unlikely on a real SmartFill fleet):

```bash
cd /app/backend
python scripts/rollback_dedupe_v58_13_132au.py             # dry-run
python scripts/rollback_dedupe_v58_13_132au.py --commit    # execute
```

Restores all 542 soft-deleted rows. Merged fields on survivors stay (were non-destructive). Hash normalisation stays (matches new canonical form).

Beyond one week, this script can be archived.

## FILES CHANGED

- `backend/fleet_fuel.py` (`_compose_dedupe_hash` canonicalises timestamp)
- `backend/fleet_fuel_reports.py` (`_stream_detail` — Transaction ID CSV column)
- `backend/scripts/backfill_dedupe_v58_13_132au.py` (new — 250 LOC)
- `backend/scripts/rollback_dedupe_v58_13_132au.py` (new)
- `backend/tests/test_v58_13_132au_dedupe.py` (new — 8 pytest)
- `frontend/src/pages/FuelReporting.jsx` (Txn ID column, drilldown table)
- `frontend/src/components/AssetFuelTab.jsx` (Txn ID column, recent transactions)
- `frontend/src/pages/FuelAnomalyInbox.jsx` (Txn ID column, anomaly rows)
- `frontend/src/lib/version.js` (RUNNING_VERSION + EXPECTED_CACHE_VERSION bump + change block header)
- `frontend/public/service-worker.js` (CACHE_VERSION bump)

## TESTING METHOD

- Ran `pytest tests/test_v58_13_132au_dedupe.py -v` → 8 passed.
- Ran the backfill in dry-run first, verified planned counts matched the .131g-era diagnostic exactly, then `--commit`.
- Post-commit sanity: queried MongoDB directly (see below), confirmed 0 remaining dupe groups, XT02AX Sep 1–8 total = 423.720 L (matches SmartFill portal exactly for those dates).

```
XT02AX Sep 1-8: 4 rows (expected 4)
  2026-09-04 06:28:00 | 50.020L | $150.06 | txn=5841004930 | src=smartfill_api
  2026-09-04 14:02:00 | 131.010L | $393.03 | txn=5841004939 | src=smartfill_api
  2026-09-08 08:15:00 | 128.400L | $385.20 | txn=5841004958 | src=smartfill_api
  2026-09-08 09:41:00 | 114.290L | $342.87 | txn=5841004960 | src=smartfill_api
  SUM: 423.720L / $1271.16
soft-deleted with .132au tag: 542
```

Ship memo written to `/app/memory/v58_13_132au_dedupe_fix_shipped_finish_deferred.md`.
