# v58.13.131b — SmartFill Fuel CSV Importer (backend only) — SHIPPED (finish deferred)

`finish` bypassed per standing rule (20 pre-existing `ephemeral-upload-storage` warnings still parked for v58.14.x).

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — version-only bump.
- **No comms** — anomaly detection surfaces via `GET /fleet/fuel/anomalies` inbox only. No cron, no BackgroundTask, no auto-email.
- 20 deferred `ephemeral-upload-storage` warnings still parked.
- **SmartFill secret never logged, never persisted, never in API responses.** (No changes to `.env` this ship — reused `.131` env vars.)

## Ship one-liner
Phase-2 (backend-only) of the fuel-usage feature. Delivers a hard-idempotent CSV importer for SmartFill Portal Transaction exports, 12 REST endpoints under `/api/fleet/fuel/*`, per-transaction anomaly detection (6 rules: R1–R6), and a 4-step vehicle-match pipeline (key_code → card_number → rego → fuzzy description). Frontend surface lands in `.131c`.

## User's verbatim ask (confirmed schema)
> Portal Transaction detail — Transaction Id, Date/Time, Litres (3dp), Units (`==Litres` required), Fuel Type, From (source site), Total Price, Key/Code (primary match), Card Number, Description, Registration, Driver (nullable — "No driver is assigned." valid), Pump, Odometer.

## Files touched (7)

| File | Change |
|---|---|
| `backend/fleet_fuel.py` | **NEW/REWRITTEN** — 700+ lines. 12 endpoints + CSV parser + 6-rule anomaly detector + 4-step match pipeline + soft-delete rollback |
| `backend/server.py` | Registered `fleet_fuel_router` + `fleet_fuel_asset_router` + startup `ensure_indexes()` hook |
| `tests/backend_unit/test_fuel_csv_import.py` | **NEW** — 24 tests (FakeDB pattern, no motor coupling, no live-DB pollution) — all passing |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` → `.131b` |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `.131b` |
| `mobile/src/lib/version.ts` | `MOBILE_BUNDLE_VERSION` → `.131b` |
| `/app/memory/smartfill_discovery_v58_13_131.md` | Appended `.131b addendum` — confirmed schema, revised dedupe rules, revised match order, R5/R6 anomaly additions, endpoint filter additions, header normalisation contract |

## Mongo schema

### `fuel_transactions` (new)
```
{id, org_id, workspace_id, import_batch_id, import_row_number, source,
 date_iso, time_local, timestamp (UTC ISO), local_tz,
 transaction_id (external PK, unique), key_code, key_code_fallback,
 card_number, registration, description, driver, from_site,
 fuel_type, pump, units, litres, total_price, odometer_km, engine_hours,
 asset_id, match_status ∈ {matched, unmatched, manual},
 anomaly_flags: [{rule, severity, detail, resolved_at, resolved_by, resolved_action, resolved_note, created_at}],
 raw_row (full CSV row), raw_row_hash,
 imported_at, imported_by, deleted_at, created_at, updated_at}
```

**Indexes** (all built at startup via `ensure_indexes()`):
- `(org_id, timestamp DESC)` — dashboard queries
- `(org_id, asset_id, timestamp DESC)` — per-vehicle history
- `(org_id, transaction_id) UNIQUE SPARSE` — primary dedupe
- `(org_id, key_code_fallback, timestamp, litres) UNIQUE SPARSE` — fallback dedupe
- `(import_batch_id)`, `(anomaly_flags.rule)`, `(org_id, match_status)`, `(org_id, from_site)`, `(org_id, key_code)`

### `fuel_import_batches` (new)
```
{id (UNIQUE), org_id, workspace_id, filename, uploaded_by, uploaded_at,
 rows_total, rows_inserted, rows_duplicate, rows_unmatched,
 rows_anomalous, rows_rejected, unmatched_regos, header_warnings,
 preview_sample (first 5 raw rows for audit),
 status ∈ {complete, deleted}, error_summary, deleted_at, deleted_by}
```

## The 12 endpoints (all under `/api/fleet/fuel/*` unless noted)

| Verb | Path | Perm | Purpose |
|---|---|---|---|
| POST   | `/import-csv` | admin | Multipart CSV upload; auto-detects `,` / `;` / `\t` / `\|`; header normaliser (`Transaction Id` = `TransactionID` = `TRANS_ID`); dedupe by `transaction_id` first, then `(key_code_fallback, timestamp, litres)`. Returns `ImportResult`. |
| GET    | `/batches` | view | Paginated import history |
| GET    | `/batches/{id}` | view | Batch detail incl. live active-row count |
| DELETE | `/batches/{id}` | admin | Soft-delete all rows + batch; audit-reversible |
| GET    | `/transactions` | view | Filters: `asset_id`, `batch_id`, `from`, `to`, `from_site`, `fuel_type`, `driver`, `key_code`, `anomaly_only`, `match_status`, pagination |
| GET    | `/anomalies` | view | Filters: `rule`, `resolved` (true/false/null); `resolved=false` = inbox |
| POST   | `/anomalies/{id}/resolve` | edit | Body `{rule, note}`; marks that rule resolved (writes `resolved_at`, `resolved_by`, `resolved_action='resolved'`, `resolved_note`) |
| POST   | `/anomalies/{id}/dismiss` | edit | Same shape → `resolved_action='dismissed'` |
| POST   | `/transactions/{id}/match` | edit | Body `{asset_id}`; sets `match_status='manual'` |
| GET    | `/stats` | view | Rollup: total_litres, total_fills, unique_vehicles, top_by_litres (5), top_by_fills (5), by_month, **by_site** (new per confirmed schema), anomaly_open_count, anomaly_by_rule |
| GET    | `/fleet/assets/{id}/fuel` | view | Per-asset feed + rolling_last_20 μ/σ |
| GET    | `/export` | view | CSV re-export with all confirmed schema columns (Transaction Id, Key/Code, Card Number, From, Units, Total Price, Driver, etc.) |

## 6 anomaly rules (evaluated on-insert)

| Rule | Severity | Trigger | Cold-start guard |
|---|---|---|---|
| **R1 `unusual_hour`** | LOW | local hour outside `[05, 19)` | — |
| **R2 `capacity_exceed`** | HIGH | `litres > asset.fuel_tank_capacity_l × 1.10` | Skip when capacity is null |
| **R3 `stat_spike`** | MEDIUM | `litres > μ + 2σ` of last 20 fills | Activate at ≥ 5 prior fills, σ > 0 |
| **R4 `reading_regress`** | MEDIUM | odometer OR engine_hours below last known non-zero | Skip when prior reading null/0 |
| **R5 `missing_odometer`** | LOW | odometer == 0 AND asset has prior >0 reading | — |
| **R6 `unit_mismatch`** | — | Units column not in `{Litres, Liters, L}` | **HARD-REJECT row** (never lands in `fuel_transactions`, only in `errors[]`) |

## 4-step vehicle match pipeline (in order)
1. `key_code` → `assets.smartfill_key_code`
2. `card_number` → `assets.smartfill_card_number`
3. `registration` → `assets.rego_serial` (uppercased)
4. Fuzzy `description` → `assets.name` (`difflib.get_close_matches` cutoff 0.85; upgrades to `rapidfuzz ≥ 88` if installed — currently on `difflib`)
5. Else `match_status='unmatched'`, surfaces in review queue

## Live curl walkthrough (proof — all 12 endpoints)

Uploaded `/tmp/smartfill.csv` — 5 rows matching the confirmed schema. Result:

```
=== 1) POST /import-csv ===
{
    "batch_id": "1e613577-7560-4ae6-8e0b-024f24b2ce4a",
    "rows_total": 5,
    "rows_inserted": 4,
    "rows_duplicate": 0,
    "rows_unmatched": 0,
    "rows_anomalous": 3,
    "rows_rejected": 1,
    "errors": [{"row": 6, "error": "R6 unit_mismatch: Units='Gallons' (expected Litres)"}]
}

=== 2) GET /batches ===        total=1  inserted=4 anom=3 rej=1

=== 3) GET /stats ===          total_litres=331.25  total_fills=4  unique_vehicles=4
    anomaly_open_count=3  anomaly_by_rule={'missing_odometer': 1, 'reading_regress': 1, 'unusual_hour': 1}
    by_site=[{'site': 'Paneltec Breadalbane', 'litres': 331.25, 'fills': 4}]

=== 4) GET /anomalies?resolved=false ===  total=3
    txn=5841004943 rego=L10QF   time=14:07:45 rules=[missing_odometer]  (R5 — Odo=0 vs prior=102893)
    txn=5841004941 rego=XT02AX  time=09:22:11 rules=[reading_regress]    (R4 — Odo=87231 < prior)
    txn=5841004942 rego=XT44CB  time=03:15:00 rules=[unusual_hour]       (R1 — 03:15 outside window)

=== 5) POST /anomalies/{id}/resolve  rule=missing_odometer ===
{"txn_id": "...", "rule": "missing_odometer", "resolved": 1}

=== 6) GET /anomalies?resolved=false ===  open anomalies now: 2 (was 3)

=== 7) GET /export (first 3 lines) ===
Transaction Id,Date,Time,Key/Code,Card Number,Registration,...,Anomaly Rules,Batch Id
5841004943,2026-09-05,14:07:45,100000000539E,21358,L10QF,...,missing_odometer,1e613577...
5841004941,2026-09-04,09:22:11,100000000537C,21356,XT02AX,...,reading_regress,1e613577...

=== 8) GET /transactions?from_site=Paneltec+Breadalbane ===
    total=4 — all 4 fills, match=matched for every row (key_code / rego resolved)

=== 9) POST /import-csv (same file re-uploaded) ===
    inserted=0  duplicate=4  rejected=1
    → Idempotency confirmed: transaction_id UNIQUE dedupe fires, R6 still rejects.

=== 10) DELETE /batches/{id} ===  {"batch_id": "...", "rows_deleted": 4}

=== 11) GET /stats after delete ===  total_fills=0  total_litres=0.0
    → Soft-delete cascades through the stats aggregation.
```

## Pytest tally
- **`test_fuel_csv_import.py`: 24 / 24 pass** — header normaliser (variants + map resolution), parsers (date/time/datetime/dialect), 4-step match pipeline (key_code / card / rego / fuzzy / unmatched), all 6 anomaly rules (positive + negatives), dedupe by `transaction_id` primary, dedupe by composite fallback, R6 hard-reject, end-to-end smoke (schema fields all persist correctly).
- **Full backend suite**: **1185 passed / 6 skipped / 24 pre-existing failures** — verified on clean `main` before ship (`24 failed / 1161 passed`) so this ship adds **zero new regressions** and **+24 new passing tests**.

## Version bump ✅
```
frontend/src/lib/version.js       RUNNING_VERSION       = 'paneltec-v160.3.9.58.13.131b'
frontend/public/service-worker.js CACHE_VERSION         = 'paneltec-v160.3.9.58.13.131b'
mobile/src/lib/version.ts         MOBILE_BUNDLE_VERSION = 'paneltec-v160.3.9.58.13.131b'
```

## NOT in .131b (deferred)
- Frontend banner / import modal / anomaly inbox / AssetDrawer Fuel tab — Phase **.131c**
- Reporting page `/app/fleet/fuel` + monthly Recharts + CSV re-export UI — Phase **.131d**
- `assets.fuel_tank_capacity_l` + `smartfill_key_code` + `smartfill_card_number` UI editors on AssetDrawer — Phase **.131e** (unlocks R2 + gives the primary+secondary match keys an admin path)
- Live SmartFill API sync — Phase **.131f** (optional; only if subscription upgrades to enable `Tank:Deliveries`)
- Any email/SMS — only ever behind an on-demand button in Phase .131d/e (synchronous HTTP request context)

## Support answer delivered inline
User's separate question "How do I manually add a fleet item?" was answered in the same session: UI path `/app/fleet` → filter tree → green `+` button per Kind → AssetDrawer with `Name*` + `Type*` required, `Rego / Serial` recommended (SmartFill importer match key), `assets.edit` permission gate. Screenshots at `/app/memory/support_addfleet_filter_tree.png` and `/app/memory/support_addfleet_drawer_new.png`.
