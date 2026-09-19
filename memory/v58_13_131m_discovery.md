# v58.13.131m — SmartFill auto-sync · Discovery

**Date**: 2026-09-07
**Blocker check**: PASSED — SmartFill support was correct. The new
method names DO work against our credentials (`Paneltec4869`). Proceeding
with the full ship.

## Executive summary

The `.131k` re-probe concluded that only `Tank:Level` was accessible
and every transaction-shaped candidate returned `code 1: Method not
supported`. That conclusion was **wrong at the naming level, not the
subscription level**. SmartFill's actual method surface uses colon-suffix
`:Read` verbs (`Transactions:Read`, `Tank:Read`, `Asset:Read`,
`Driver:Read`) that the `.131k` candidate list never tried — it only
tried `:List`, `:Detail`, and the noun-plural variants
(`Transaction:List` etc.), all of which return `code 5: No such method`.

Live re-probe of the 4 new names (see
`/app/memory/v58_13_131m_probe_raw.json`) confirms:

| Method | Status | Shape | Blocker for ship? |
| --- | --- | --- | --- |
| `Transactions:Read` | **available** | columnar[0 × 13] | No |
| `Tank:Read` | **available** | columnar[2 × 13] | No |
| `Tank:Level` | available (baseline) | columnar[1 × 10] | No |
| `Asset:Read` | code 3 `Bad Request` | needs required params | No — deferred |
| `Driver:Read` | **available** | columnar[0 × 6] | No |

The 0-row response on `Transactions:Read` for a Jan-2026 window is a
"no transactions in this range" result, not an error — the columnar
envelope is well-formed and the 13 columns are the ones we need.

## Current `integrations_smartfill.py` — what's reusable

Existing scaffolding (all keep-able as-is):
- `_creds()` — env lookup + `SmartFillConfigError` with no secret leak.
- `_rpc_body(method, extra_params)` — JSON-RPC 2.0 body with
  `parameters` key (SmartFill's known deviation from the strict spec).
- `call(method, extra_params, timeout)` — async httpx wrapper that
  parses error envelopes returned with HTTP 400 into
  `SmartFillAPIError(code, message, method)`.
- `columnar_to_rows(result)` — flattens the `{columns, values}` envelope
  into a list of dicts keyed by column name. **Ready to plug directly
  into the CSV import pipeline.**
- `SmartFillConfigError`, `SmartFillAPIError` classes.

Existing method wrappers that need REPLACING (used wrong names):
- `get_tank_levels()` → keep (`Tank:Level` still works).
- `get_vehicle_list()` → **DELETE** (`Vehicle:List` returns code 5).
- `get_vehicle_fill_history()` → **DELETE** (same).
- `list_available_methods()` → keep (unused at runtime — discovery
  helper only).
- `_CANDIDATE_METHODS` tuple → **UPDATE** to add the 4 new names for
  future probes.

Missing from the current file (need to add):
- `smartfill_fetch_transactions(from_ts, to_ts, page_size)` —
  paginated wrapper around `Transactions:Read`. Uses the built-in
  `range: {offset, length}` param the FMT Data PDF documents.
- `smartfill_fetch_assets()` — wraps `Asset:Read` (once we figure out
  the required params; deferred for this ship).
- `smartfill_fetch_drivers()` — wraps `Driver:Read`.
- `smartfill_fetch_tank_history()` — wraps `Tank:Read`.
- Rate-limit bucket honoring the documented **6/min, 60/hour,
  600/day** ceilings. Simple in-process token bucket keyed on
  (minute, hour, day) is enough — this backend has only one worker.

## Column mapping — Transactions:Read → existing CSV pipeline

`Transactions:Read` returns these 13 columns:

```
Date, Time, Card Number, Description, Registration, From, Litres,
Fuel Type, Odometer, Total Price, Transaction Id, Driver Authorisation,
Unit Price
```

The existing CSV import (`fleet_fuel._import_csv`) recognises **all
13** of these column names via its `_norm_header` (which lowercases +
strips non-alphanumerics — so `Transaction Id` → `transactionid` and
maps identically whether it came from a CSV upload or a live API pull).

**Consequence**: SmartFill API rows can be piped through the existing
import pipeline **unchanged** after a small refactor.

## Refactor plan for `fleet_fuel.py`

Current `_import_csv(content: bytes, filename, org_id, workspace_id,
user_id, local_tz)` does all of:

1. Decode + sniff CSV dialect.
2. Header validation.
3. Peek pass (price/odo coverage stats).
4. Row loop: parse → dedupe → resolve asset → Navixy enrich →
   evaluate anomalies → insert.
5. Batch doc creation.
6. R7 post-import re-flag.

Refactor: extract step 4/5/6 into `_import_rows(rows: list[dict],
mapping: dict, ignored: list[str], source: str, filename: str,
org_id, workspace_id, user_id, local_tz, price_coverage_pct,
zero_odo_pct, r7_will_skip, enabled_rules, rules_suppressed)`.

Then:
- `_import_csv()` becomes the CSV-flavoured entry: decode → sniff →
  header validate → peek → build the arg pack → call `_import_rows`.
- `_import_smartfill_batch(rows, source="smartfill_api", ...)` becomes
  the API-flavoured entry: skip decode/sniff/header-validate (the row
  dicts arrive already keyed by column name; header list is fixed).
  Runs its own peek loop over the pre-parsed rows to compute the same
  coverage stats, then calls `_import_rows`.

One change to the doc shape: `source` is now an ARGUMENT, not the
hard-coded `"smartfill_csv"`. Values: `"smartfill_csv"` (existing) |
`"smartfill_api"` (new). Existing rows keep their `"smartfill_csv"`
value — no data migration required.

## Endpoint plan (all admin, JWT)

- `POST /api/fleet/fuel/sync-smartfill` — body `{from_date, to_date}`
  (both optional; defaults: `last_synced_at` from status doc → now).
  Returns the existing `ImportResult` shape so the FE reuses the CSV
  post-import summary component unchanged. Throttled by the same
  rate-limit bucket as the cron.
- `GET /api/fleet/fuel/smartfill-status` — returns
  `{last_synced_at, last_batch_summary, rate_limit_state, auto_sync_enabled}`.
- `POST /api/fleet/fuel/smartfill-auto-sync` — body `{enabled: bool}`
  admin-toggle for the cron. Persists to `org_settings.fuel_smartfill_auto_sync_enabled`.

## Cron plan

`/app/backend/cron_smartfill_auto_sync.py` — mirrors
`cron_simpro_delta.py` shape.

- Guard 1: `SMARTFILL_AUTO_SYNC_CRON=1` env var (registration gate).
- Guard 2: `org_settings.fuel_smartfill_auto_sync_enabled == True` (per-org).
- Schedule: `cron` trigger at **06:00 Australia/Brisbane** daily.
- Job: fetch `Transactions:Read` for `[yesterday_00:00_local, today_00:00_local)`,
  pipe through `_import_smartfill_batch`, tag `triggered_by="cron"`,
  emit an admin notification if the batch has anomalies or rejects.
- Off by default. Ship default = `enabled=False` per user directive.

## Guardrail confirmations

- ✅ CSV import untouched from an external-behaviour POV
  (`/api/fleet/fuel/import-csv` still works, still writes
  `source: "smartfill_csv"` for that path).
- ✅ Auto-sync OFF by default — cron reads
  `fuel_smartfill_auto_sync_enabled` before any RPC call.
- ✅ Rate-limit bucket applies to BOTH the manual endpoint AND the
  cron — 6/min ceiling honoured regardless of trigger.
- ✅ No mobile-app changes.
- ✅ Zero `CACHE_VERSION` bump.
- ✅ No `e1_tester` invocations.

## Ship gate: PASS

No structural surprises. Proceeding with implementation.

## Version pin plan

- `RUNNING_VERSION` `.132q1` → `.132q2` (backend-only micro-ship
  within the `.132q` cycle; monotonic per policy).
- `MOBILE_BUNDLE_VERSION` `.132q1` → `.132q2` (co-bump for the
  version badge to stay in sync; no mobile behavioural changes).
- `.131m` label recorded in the ship-memo body and in the version.js
  header comment (per user directive on non-monotonic label handling).
- `CACHE_VERSION` untouched at `.132o`.
- `EXPECTED_CACHE_VERSION` untouched at `.132o`.
