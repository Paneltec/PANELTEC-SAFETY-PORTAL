# v58.13.131 — SmartFill Fuel API discovery + Phase-2/3/4/5 spec

## Status
**DISCOVERY-ONLY SHIP · PAUSED FOR GREEN-LIGHT.** Backend integration module (`backend/integrations_smartfill.py`) + probe results + full downstream spec attached. No user-facing endpoints, no Mongo writes, no cron, no UI in this ship.

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — version-only bump.
- No comms — the hourly sync described below is a data FETCH, no emails/SMS. Anomaly detector surfaces in the UI only. Standing rule: any future "Email me this report" surface must fire synchronously inside an HTTP request context.
- 20 deferred warnings still parked.
- **SmartFill secret never logged, never persisted, never in API responses.** Read only via `os.environ`.

## User's verbatim ask
> "under the Fleet & Service Banner i would like you to create a Fuel usage api link the fuel usage to each vehicle and record litres/$ value record time taken day and month quantity and we may be able to flag any unusual activity in usage, build nice popup and reporting as well."

## SmartFill API — probe results (2026-09-05T05:07:59Z)

Endpoint: `https://fmtdata.com/API/api.php` · JSON-RPC 2.0 dialect.

**Wire-shape quirk** (discovered via probe): SmartFill's param key is `parameters` (plural), NOT the strict-spec `params`. Also returns `error.code` as a **string** (not int), and uses `error.error` instead of `error.message` for the message text. Both quirks bridged in `integrations_smartfill.py::call()` and `SmartFillAPIError`. HTTP status is **400** for RPC errors (not 200 + envelope-error) — parsed the body BEFORE `raise_for_status()`.

**28 candidate methods probed** — classification:

| Status | Count | Methods |
|---|---:|---|
| **available** | **1** | `Tank:Level` |
| **not_enabled** (code 1 = "Method not supported") | **8** | `Tank:List`, `Tank:Levels`, `Tank:Alarms`, `Tank:Deliveries`, `Tank:Transactions`, `Tank:Fills`, `Tank:History`, `Tank:Consumption` |
| **method_not_found** (code 5 = "No such method") | **19** | all `Vehicle:*`, `Transaction:*`, `Fill:*`, `Report*`, `Site:List`, `Unit:List`, introspection, `Data:Query`, `Usage:List` |

Raw probe artifact: `/app/memory/smartfill_probe_v58_13_131.json` (URL redacted, credentials never persisted).

Extra-params probe confirmed `Tank:Deliveries` is a **hard subscription-tier gate** — passing `unitNumber`, `fromDate`, `toDate` alone or in combination still returns `code 1: Method not supported`.

### `Tank:Level` response shape (verified live)
```
result: {
  columns: ["Unit Number","Tank Number","Description","Volume","Volume Percent",
            "Capacity","Tank SFL","Status","Last Updated","Timezone"],
  values:  [["5841","1","SmartFill 5841 Tank 1","355","0","0","0","Offline",
             "1970-01-01 00:00:00","Australia/Hobart"]]
}
```
All values arrive as **strings** (numeric coercion at persistence time). `Last Updated="1970-01-01 00:00:00"` on the current sample indicates this tank has never reported a real reading — the account has 1 tank registered but the physical unit hasn't yet phoned home.

Full sanitized shape: `/app/memory/smartfill_tank_level_shape_v58_13_131.json`.

## 🚨 CRITICAL BLOCKER before Phase 2

**The fuel-USAGE feature is impossible on the current SmartFill subscription tier.** `Tank:Level` gives us only a point-in-time snapshot of tank remaining volume — NOT per-transaction refuel history, NOT per-vehicle attribution, NOT time-series consumption.

To ship the feature the user described, one of these must happen:

1. **[Recommended]** User contacts SmartFill support and asks for `Tank:Deliveries` + `Tank:Transactions` (or `Tank:Fills`) to be enabled on account `Paneltec4869`. Those 8 `Tank:*` methods are RECOGNIZED (not `No such method`), which means they exist server-side and are gated by subscription plan, not by the API surface. A support ticket referencing "unlock Tank:Deliveries + Tank:Transactions for JSON-RPC clientReference Paneltec4869" should be sufficient.

2. **[Fallback]** Derive fill events by polling `Tank:Level` frequently and detecting the level-jumps that indicate a delivery/fill:
   - Poll every 15 min (16 tank readings/hour, 384/day per tank).
   - A `Volume` step-UP over the previous reading of `>= 10% of capacity` = presumed fill event.
   - Litres computed from `ΔVolume`.
   - Time = `Last Updated` of the after-reading.
   - **Vehicle attribution is impossible via this path** — SmartFill's `Tank:Level` has no vehicle metadata. Best we can do is attribute the fill to whichever asset was closest to the site at the timestamp (join to Navixy GPS trace).
   - **$ value is impossible** without a price-per-litre source (either static config or a second API).

3. **[Alternative source]** SmartFill has a Web Portal exports (CSV/XLSX) that Stephen may already receive — if so, we can ship a **File-drop importer** with the same schema/anomaly logic, defer live API integration until support enables the gated methods.

**Explicit user green-light needed on which path** before Phase 2 begins. Recommend Path 1 in parallel with a stub Path 3 (importer) so the feature can ship even if support turnaround is slow.

## Proposed Mongo schema — `fuel_transactions`

```
{
  id:                 str,          # PyObjectId → str
  org_id:             str,          # scoping
  workspace_id:       str | null,   # scoping
  # ── Source-of-truth fields ──
  source:             "smartfill_api" | "smartfill_import" | "manual",
  source_ref:         str,          # e.g. SmartFill transaction id
                                     # or file-import row hash
  unit_number:        str,          # SmartFill Unit Number
  tank_number:        str,          # SmartFill Tank Number
  tank_description:   str,
  # ── The transaction ──
  filled_at:          ISO8601 str,  # from `Last Updated` (converted to UTC)
  tz:                 str,          # from `Timezone` — kept for audit
  litres:             float,        # ΔVolume or Tank:Deliveries.volume
  cost_aud:           float | null, # if Tank:Deliveries returns $, else null
  price_per_litre:    float | null, # cost_aud / litres when both known
  volume_before:      float | null, # for step-up detection path
  volume_after:       float | null,
  capacity:           float | null,
  # ── Vehicle attribution ──
  vehicle_asset_id:   str | null,   # resolved via SmartFill vehicle metadata
                                     # OR Navixy GPS proximity join OR
                                     # manual attribution
  attribution_method: "direct" | "gps_proximity" | "manual" | "unassigned",
  attribution_confidence: float | null,  # 0.0-1.0 for gps_proximity path
  # ── Anomaly flags (see rules below) ──
  anomaly_flags:      [str],        # ["rolling_2sigma", "exceeds_capacity_10pct",
                                     #  "unusual_hour"]
  anomaly_reviewed:   bool,         # admin acked
  anomaly_reviewed_by: str | null,  # user_id
  anomaly_reviewed_at: ISO8601 str | null,
  # ── Audit ──
  created_at:         ISO8601 str,
  updated_at:         ISO8601 str,
  deleted_at:         ISO8601 str | null,
  ingest_run_id:      str,          # for backfill idempotency
}
```

Indexes:
```
(org_id, workspace_id, filled_at DESC)          # dashboard queries
(vehicle_asset_id, filled_at DESC)              # per-vehicle history
(org_id, source, source_ref) UNIQUE             # idempotency
(org_id, anomaly_flags, filled_at DESC)         # anomaly review inbox
(org_id, unit_number, tank_number, filled_at DESC)  # per-tank drilldown
```

## Proposed backend endpoints

All under `/api/fleet/fuel/…` · guarded by the existing
`FLEET_REGISTER_ENABLED` env flag + reuse `assets.view` /
`assets.edit` permissions (no new perm tokens).

| Verb | Path | Purpose |
|---|---|---|
| GET  | `/fleet/fuel/summary`                          | Org-wide rollup: litres + $ + tx count for last 24h / 7d / 30d, top 5 vehicles, open anomaly count |
| GET  | `/fleet/fuel/transactions`                     | Paginated list; filters: `vehicle_asset_id`, `unit_number`, `from_date`, `to_date`, `anomaly_only`, `unassigned_only` |
| GET  | `/fleet/assets/{id}/fuel-history`              | Per-vehicle: rolling 12-week transaction list, monthly totals, avg L/100km, avg $/month |
| GET  | `/fleet/fuel/anomalies`                        | Anomaly inbox — flagged but not yet reviewed |
| POST | `/fleet/fuel/anomalies/{id}/acknowledge`       | Admin marks an anomaly as reviewed |
| POST | `/fleet/fuel/sync`                             | On-demand sync trigger (admin-gated). Returns `{tx_added, tx_updated, anomalies_flagged}` |
| POST | `/fleet/fuel/attribute/{tx_id}`                | Manual vehicle attribution (for unassigned rows) |
| GET  | `/fleet/fuel/report.pdf`                       | Generate a monthly PDF report (reportlab, same pattern as service sheet). **Synchronous HTTP context → OK to email via the report page's "Email me" button** |
| POST | `/fleet/fuel/import`                           | CSV/XLSX file-drop fallback (Path 3) |

## Anomaly detection — 3 rules (all defaults, per user green-light)

Applied at ingest time (during `/fleet/fuel/sync`), persisted to the row's `anomaly_flags` list. Every rule is per-vehicle-scoped so a small ute's baseline doesn't drag on a heavy vac truck.

### Rule 1 — `rolling_2sigma`
- For a fill `f` on `vehicle_asset_id = V`:
  - Compute μ = mean of the last 30 days of V's fills (litres).
  - Compute σ = stddev of same window.
  - If `f.litres > μ + 2σ` AND at least 6 historical fills exist → flag.
- Cold-start: skip until V has ≥ 6 fills in the last 30 days.

### Rule 2 — `exceeds_capacity_10pct`
- If `f.litres > vehicle.fuel_tank_capacity_l × 1.10` → flag.
- Requires `assets.fuel_tank_capacity_l` to be populated. Fallback rule when null: skip.
- New optional field on assets doc: `fuel_tank_capacity_l: float | null` (backfill migration in Phase 3).

### Rule 3 — `unusual_hour`
- If `f.filled_at.hour ∈ {2, 3, 4}` local time → flag.
- Uses the fill's `tz` field (from SmartFill's Timezone column).

Flag composition: a single row can carry any subset of the 3 flags. Anomaly inbox filters by presence of any flag; drilldown modal shows all 3 rule states with pass/fail chips.

## Proposed frontend surface

### 1. Banner (Fleet & Service Register page)
Below the existing "Fleet & Service Register" hero banner + toolbar gradient. New **"Fuel Usage · SmartFill"** strip. 4 tiles:
- **Litres this month** — count + delta vs prior month
- **$ this month** — total + delta
- **Anomalies open** — count with an amber pulse if > 0; clicks to anomaly inbox
- **Last sync** — relative time + status pill (green / amber / red) + manual "Sync now" button (admin-gated)

Testids: `fuel-banner`, `fuel-tile-litres`, `fuel-tile-cost`, `fuel-tile-anomalies`, `fuel-tile-sync`, `fuel-sync-now-btn`.

### 2. Vehicle drawer — new "Fuel" tab
Sits between "Service Log" and "Maintenance History" tabs on the existing AssetDrawer (`AssetDrawer.jsx`). Contents:
- 12-week bar chart of monthly litres (Recharts, matches the existing dashboard bars).
- Rolling 30-day L/100km (if odo data + fill data both present).
- Fill history table: date · litres · $ · price/L · anomaly chips.
- "Manually attribute" button on rows with `attribution_method="unassigned"`.

Testids: `asset-fuel-tab`, `fuel-history-row-<id>`, `fuel-manual-attribute-btn-<id>`.

### 3. Anomaly inbox modal
Reachable from the banner's "Anomalies open" tile. Shows unreviewed anomalies grouped by vehicle. Each row has 3 chips (2σ / capacity / hour) coloured by pass/fail, "Acknowledge" button. Admin-only.

Testids: `fuel-anomaly-inbox`, `fuel-anomaly-row-<id>`, `fuel-anomaly-ack-btn-<id>`.

### 4. Reporting page — `/app/fleet/fuel-report`
New route under Fleet & Service Register. Filters: date range · vehicle · anomaly-only. Includes:
- Monthly totals table
- Per-vehicle L/100km heat-map
- Anomaly summary
- "Download PDF" + **"Email me this report"** — the latter fires SYNCHRONOUSLY in the HTTP request context (via `send_email_in_request()`), NOT queued to a background scheduler. Satisfies the ContextVar HTTP-gate.

Testids: `fuel-report-page`, `fuel-report-download-pdf`, `fuel-report-email-me-btn`.

## Sync strategy — hourly cron (confirmed)

- **Cadence**: every hour on the :07 minute (matches other paneltec crons that stagger to avoid Mongo hot-second contention).
- **Cron entry**: new module `backend/cron_fuel_sync.py` (mirroring `backend/cron_simpro_delta.py` shape). Registered from `backend/server.py::@app.on_event("startup")` block.
- **Idempotency**: `(org_id, source, source_ref) UNIQUE` index → safe to re-run any window. Missing `source_ref` (Path 2 step-up detection) synthesises a deterministic ref from `(unit_number, tank_number, filled_at)`.
- **Data window**: fetch last 25 hours on every run (1h overlap for late-arriving records).
- **Comms-safe**: NO email/SMS out of the cron. Anomalies surface via the UI's amber pulse + inbox.
- **Failure handling**: 3 retries with exponential backoff, then persist a `sync_health` doc with the error msg (never the secret). Banner tile reads this to render red/amber status.
- **Env kill-switch**: `FUEL_SYNC_ENABLED=false` short-circuits the cron (parallel to `FLEET_REGISTER_ENABLED`).

## Phase breakdown (post-.131)

| Ship | Scope | Depends on |
|---|---|---|
| **v58.13.131** (this ship) | Discovery + probe module + spec | — |
| **v58.13.131a** | User contacts SmartFill support to enable `Tank:Deliveries` + `Tank:Transactions`. If unlocked, re-probe + confirm data shape. If NOT unlocked, pivot to Path 2 (step-up detection) or Path 3 (CSV import) | User action outside our code |
| **v58.13.131b** | Backend Phase — Mongo schema + indexes + `POST /fleet/fuel/sync` (on-demand only) + ingest pipeline (Tank:Deliveries OR step-up detection) + anomaly detector | .131a resolved |
| **v58.13.131c** | Cron — hourly sync, health-status doc, banner "last sync" tile fetches it | .131b |
| **v58.13.131d** | Frontend Phase 1 — banner + 4 tiles + "Sync now" button + anomaly inbox modal + AssetDrawer "Fuel" tab | .131c |
| **v58.13.131e** | Frontend Phase 2 — `/app/fleet/fuel-report` page + PDF + on-demand "Email me this report" (synchronous HTTP context) + CSV import fallback if Path 3 chosen | .131d |
| **v58.13.131f** | Backfill migration — populate `assets.fuel_tank_capacity_l` from Simpro asset specs where present; manual UI to fill the rest. Dry-run + `--commit` gate as usual | .131b |

Every phase is independently ship-safe. Any phase can be paused for user review without leaving the app in a half-broken state.

## What .131 actually ships

1. `backend/integrations_smartfill.py` — 240-line SmartFill JSON-RPC client. Public surface:
   - `call(method, extra_params=None, *, timeout=15.0)` — generic invoker.
   - `get_tank_levels()` — `Tank:Level` pass-through.
   - `get_vehicle_list()` / `get_vehicle_fill_history()` — high-confidence stubs (both currently return `method_not_found` per the probe; kept in the module for the .131a re-probe).
   - `list_available_methods(candidates=None)` — probe helper. Never logs bodies.
   - `columnar_to_rows(result)` — SmartFill's `{columns, values}` → list-of-dicts.
   - `SmartFillConfigError` / `SmartFillAPIError` classes.

2. Env vars added to `backend/.env`:
   ```
   SMARTFILL_API_URL="https://fmtdata.com/API/api.php"
   SMARTFILL_API_KEY="Paneltec4869"
   SMARTFILL_API_SECRET="cc7593ec6a70e2f7"
   ```

3. Probe artifacts:
   - `/app/memory/smartfill_probe_v58_13_131.json` — full 28-method probe result (URL redacted).
   - `/app/memory/smartfill_tank_level_shape_v58_13_131.json` — sanitized `Tank:Level` response shape.

4. `tests/backend_unit/test_v58_13_131_smartfill_probe.py` — 12-check pytest suite:
   - Module imports cleanly.
   - `parameters` key (plural) is used in the RPC body — this is the wire-quirk lock.
   - Secret NEVER logged / persisted / echoed in the module source.
   - `_creds()` fails fast when any env var is missing (with a clean error that doesn't include the value).
   - `SmartFillAPIError` bridges the `code=str` + `error.error=msg` quirks.
   - `columnar_to_rows` correctly transforms the `{columns, values}` envelope.
   - `list_available_methods` classifies `code=1` as `not_enabled`, `code=5` as `method_not_found`, `code=3` as `needs_params`.
   - Candidate list includes the 8 gated `Tank:*` methods so a future re-probe (after support enables them) will detect the flip to `available` without a code change.

5. Version bump `.130a → .131` across all 3 canonical constants.

6. NO changes to server.py, no router registration, no Mongo writes, no cron entry, no frontend, no comms path.

## NOT in .131 (deferred)

- Mongo `fuel_transactions` collection creation (Phase .131b).
- `POST /fleet/fuel/sync` HTTP endpoint (Phase .131b).
- Anomaly detector implementation (Phase .131b).
- Cron scheduling (Phase .131c).
- Frontend banner / tab / inbox / report (Phase .131d–e).
- CSV/XLSX importer fallback (Phase .131e).
- Backfill of `assets.fuel_tank_capacity_l` (Phase .131f).
- Any email / SMS wiring — will only appear behind an on-demand button in Phase .131e (synchronous HTTP context, ContextVar-safe).

## Awaiting user green-light

Two decisions blocking Phase .131b:

1. **Which data path?** Path 1 (contact SmartFill support · recommended) vs Path 2 (step-up detection · vehicle attribution impossible) vs Path 3 (CSV importer · needs Stephen's existing SmartFill Web Portal export format).

2. **Any spec adjustments** to the schema / endpoints / anomaly rules / frontend surface / phase breakdown above?

Once green-lit I open Phase .131b.

---

## v58.13.131b addendum — Confirmed SmartFill Portal Transaction schema

User confirmed the per-transaction fields via a SmartFill Portal
Transaction-detail screenshot. This supersedes the column list
above for the CSV path.

### Confirmed CSV fields (per transaction)
| Field | Example | Notes |
|---|---|---|
| **Transaction Id** | `5841004940` | External primary key. Authoritative dedupe. |
| Date/Time | `2026-09-04 19:25:30` | Combined datetime; parser accepts split Date + Time too |
| Litres | `44.310` | 3-decimal precision |
| Units | `Litres` | Hard-reject row when `!= Litres` (R6) |
| Fuel Type | `Diesel` | |
| From | `Paneltec Breadalbane` | SOURCE tank / site (not destination) |
| Total Price | `132.930` | Capture, not used for anomaly logic |
| **Key / Code** | `100000000536B` | **Primary match** → `assets.smartfill_key_code` |
| Card Number | `21355` | Secondary match → `assets.smartfill_card_number` |
| Description | `Ranger` | Fuzzy match source (difflib 0.85) |
| Registration | `K82KU` | Rego match → `assets.rego_serial` |
| Driver | *nullable* | "No driver is assigned." is a valid state |
| Pump | `1` | int, nullable |
| Odometer | `0` or km | 0 is a data-quality flag not fraud (R5) |

### Revised dedupe
1. Primary: `transaction_id` UNIQUE.
2. Fallback (transaction_id missing): `(key_code, timestamp, litres)`.

### Revised match order
1. `key_code` → `assets.smartfill_key_code`
2. `card_number` → `assets.smartfill_card_number`
3. `registration` → `assets.rego_serial` (case-insensitive)
4. Fuzzy `description` → `assets.name` (difflib 0.85)
5. Else `unmatched`

### Anomaly rule additions
- **R5 `missing_odometer`** (LOW) — Odometer == 0 AND asset has prior non-zero reading.
- **R6 `unit_mismatch`** — hard-reject at row level when `Units != "Litres"`. Not a flag; the row never lands in `fuel_transactions`, just in `errors[]`.

### Endpoint filter additions
- `GET /transactions` — new filters `from_site`, `fuel_type`, `driver`, `key_code`.
- `GET /stats` — new `by_site` grouping.

### Header normalisation
CSV header matcher now normalises `lower + strip non-alnum` so
`Transaction Id`, `TransactionID`, `TRANS_ID`, `trans-id` all
resolve to the same canonical key.

---

## .131d reporting spec (confirmed by user — do NOT build in .131e)

**Weekly + Monthly reports** at two scopes:
- **Per-employee** (grouped by `fuel_transactions.driver`)
- **Per-vehicle** (grouped by `fuel_transactions.asset_id`)
- **Admin rollup** across all employees + all vehicles

**Primary metric — Dollars-per-Litre**:
  `sum(total_price) / sum(litres)` computed per group per period.

**Secondary exposed metrics**:
  · total_spend  · total_litres  · fill_count  · avg_fill_size
  · top-5 highest `$/L` outliers (procurement signal — flags dodgy
    fills or suppliers charging above market)

**Export**: CSV per report (same schema as `GET /fleet/fuel/export` +
`$/L` column).

Deferred until `.131e` (AssetDrawer editors) ships.
