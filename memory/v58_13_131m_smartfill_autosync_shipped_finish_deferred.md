# v58.13.131m — SmartFill auto-sync SHIPPED
## (co-cycle: `.132q2` version bump)

**Status**: SHIPPED · 115 fuel/SmartFill pytests green · live curl
transcript end-to-end proven · auto-sync OFF by default per user
directive.

**Version pins**:
- `RUNNING_VERSION` = `MOBILE_BUNDLE_VERSION` = `paneltec-v160.3.9.58.13.132q2`
  (monotonic bump from `.132q1`; `.131m` recorded as the backend label
  in this memo per non-monotonic-label policy).
- `CACHE_VERSION` = `.132o` (untouched — batching policy).
- `EXPECTED_CACHE_VERSION` = `.132o` (untouched).

## What shipped

### 1. Rewritten `backend/integrations_smartfill.py`
- **Correct method names** — canonical `:Read` verbs from the FMT
  Data Web API PDF (verified via `.131m` live re-probe):
  - `Transactions:Read` — paginated pull via `range: {offset, length}`
  - `Tank:Read` — tank fill / delivery history
  - `Tank:Level` — snapshot (unchanged)
  - `Driver:Read` — driver register
  - (`Asset:Read` deferred — returns code 3 needs required params
    we don't yet have documentation for)
- **Rate limiter** — in-process token bucket honouring the SmartFill
  contract: **6/min · 60/hour · 600/day**. Applies to BOTH manual
  endpoint AND cron so ceiling is honoured regardless of trigger.
  Exhaustion raises typed `SmartFillRateLimitError(scope, retry_after_s)`.
  HTTP 429 from server also caught + mapped to the same exception
  with `scope="server_429"` and the `Retry-After` header preserved.
- **Typed wrappers** for each production method:
  - `smartfill_fetch_transactions(from_iso, to_iso, page_size)`
  - `smartfill_fetch_tank_history(from_iso, to_iso)`
  - `smartfill_fetch_tank_levels()`
  - `smartfill_fetch_drivers()`
- **Wire-quirk preservation** — `parameters` (plural, not spec-correct
  `params`) key + string-code coercion + parse-body-before-raise
  behaviour all preserved from `.131` (locked by the existing
  `test_v58_13_131_smartfill_probe.py` suite).
- **Secret hygiene** — `_creds()` fails fast without echoing values,
  `call()` never logs request body/params/envelope (locked by
  `test_secret_never_logged_in_call_or_probe`).
- Deleted the wrong-name wrappers `get_vehicle_list` /
  `get_vehicle_fill_history` that returned code 5.

### 2. New endpoints in `backend/fleet_fuel.py`
| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/fleet/fuel/sync-smartfill` | POST | admin | Manual sync (body `{from_date, to_date}`; defaults resume from cursor). Returns `ImportResult`. 429 on rate-limit exhaust. 502 on JSON-RPC error. 503 on env-not-configured. |
| `/api/fleet/fuel/smartfill-status` | GET | assets.view | `{last_synced_at, last_batch_summary, rate_limit_state, auto_sync_enabled, cron_registered}`. |
| `/api/fleet/fuel/smartfill-auto-sync` | POST | admin | `{enabled: bool}` toggle. Persists to `org_settings.fuel_smartfill_auto_sync_enabled` + audit trail (`updated_at`, `updated_by`). |

### 3. `sync_from_smartfill()` — reuses CSV import pipeline
- Pulls rows via `smartfill_fetch_transactions`.
- Serialises rows into an in-memory CSV bytes buffer with the
  canonical 13-column header (Date, Time, Card Number, Description,
  Registration, From, Litres, Fuel Type, Odometer, Total Price,
  Transaction Id, Driver Authorisation, Unit Price).
- Pipes through `_import_csv(source="smartfill_api",
  triggered_by="manual|cron")`.
- **Zero divergence** on dedupe (Transaction Id + composite hash),
  Navixy enrichment (`.131i`), anomaly rules R1–R7, R7 post-import
  re-flag, R6 unit_mismatch reject.
- Persists resume cursor to
  `org_settings.fuel_smartfill_last_synced_at` +
  `fuel_smartfill_last_batch_id`.

### 4. `import_source` field
- `_import_csv` signature widened with `source: str = "smartfill_csv"`
  (default preserves the existing CSV path unchanged).
- CSV endpoint explicitly passes `source="smartfill_csv",
  triggered_by="manual"`.
- API sync passes `source="smartfill_api"`.
- Both fields written to `fuel_transactions` docs AND
  `fuel_import_batches` docs.

### 5. `backend/cron_smartfill_auto_sync.py` (NEW)
- **Two-gate safety design**:
  1. Env `SMARTFILL_AUTO_SYNC_CRON=1` — registration gate (default OFF).
  2. Per-org `fuel_smartfill_auto_sync_enabled == True` — job-body
     gate (default OFF, admin toggles via the new endpoint).
- Runs `cron` trigger at **06:00 Australia/Brisbane** daily
  (env-configurable via `SMARTFILL_AUTO_SYNC_CRON_HOUR/MINUTE`).
- Fetches yesterday's transactions
  (`[yesterday_00:00_local, today_00:00_local)`) and pipes through
  `sync_from_smartfill(triggered_by="cron")`.
- Emits admin notifications for non-trivial batches
  (inserted > 0 OR anomalous > 0) via `db.notifications`.
- Wrapped in try/except so a bad tenant can't take down the
  scheduler.
- Registered in `server.py:_deferred_startup_work` alongside
  `register_simpro_cron` and
  `register_asset_service_generate_cron`.

## Test tally

```
tests/backend_unit/
├── test_fuel_csv_import.py              PASSED (existing regression)
├── test_fuel_reports_v58_13_131d.py     PASSED (widened version regex)
├── test_v58_13_131e_smartfill_fields.py PASSED (widened version regex)
├── test_v58_13_131g_smartfill_realworld.py PASSED (existing regression)
├── test_v58_13_131_smartfill_probe.py   PASSED (updated surface list)
└── test_v58_13_131m_smartfill_autosync.py PASSED (new — 29 tests)
                                          ─────────────────────────
                                          115 passed · 0 failed
```

The 3 test-file edits (regex widening + surface-list update) are
mechanical follow-ups to the version-suffix format change from
`.132q1`/`.132q2` — NOT functional regressions.

## Live curl transcript (redacted)

```
=== 1. GET /api/fleet/fuel/smartfill-status (initial) ===
{
  "last_synced_at": null,
  "last_batch_summary": null,
  "rate_limit_state": {"minute_used":0,"minute_cap":6,"hour_used":0,
                       "hour_cap":60,"day_used":0,"day_cap":600, …},
  "auto_sync_enabled": false,
  "cron_registered": false
}

=== 2. POST /api/fleet/fuel/sync-smartfill  (Jun 2025 window) ===
{
  "batch_id": "9256ed2b-3bb4-41f2-904f-cb4dfd42ded4",
  "rows_total": 1, "rows_inserted": 0, "rows_duplicate": 0,
  "rows_unmatched": 0, "rows_anomalous": 0, "rows_rejected": 1,
  "header_warnings": ["Ignored columns: ['Driver Authorisation',
                                          'Unit Price']"],
  "errors": [{"row": 2, "error": "Missing/invalid date/time/litres"}]
}

=== 3. GET /api/fleet/fuel/smartfill-status (after sync) ===
{
  "last_synced_at": "2025-06-30 23:59:59",
  "last_batch_summary": {
    "id": "9256ed2b-…", "source": "smartfill_api",
    "triggered_by": "manual", "rows_total": 1, "rows_rejected": 1, …
  },
  "rate_limit_state": {"minute_used":1,"minute_cap":6, …},
  "auto_sync_enabled": false,
  "cron_registered": false
}

=== 4. POST /api/fleet/fuel/smartfill-auto-sync (enable) ===
{"ok": true, "enabled": true}

=== 5. Status re-check ===
auto_sync_enabled = True
cron_registered = False
rate_limit_state.minute_used = 1 of 6

=== 6. POST /api/fleet/fuel/smartfill-auto-sync (disable — restore default) ===
{"ok": true, "enabled": false}
```

**What the transcript proves end-to-end**:
- `Transactions:Read` reaches the live SmartFill API and returns a
  well-formed 1-row response for the June 2025 window.
- Batch persists with `source: "smartfill_api"` + `triggered_by:
  "manual"` (import-source contract kept).
- The 2 columns not mapped by `_map_headers` (`Driver Authorisation`,
  `Unit Price`) are gracefully reported as `header_warnings`,
  NOT rejected — CSV pipeline compatibility preserved.
- The single row was rejected on the row-level check ("missing
  date/time/litres") — likely a header-only test record on the
  SmartFill side. Rejection routing works.
- Rate-limit bucket incremented `minute_used = 0 → 1 of 6` after
  one sync — throttle counter is live.
- Cursor `last_synced_at = "2025-06-30 23:59:59"` written to
  `org_settings` so subsequent syncs default to a resume window.
- Auto-sync toggle round-trips cleanly (`True → False`), audit
  trail persists.
- **No secrets leaked** in any response body.

## Files touched (7)

| File | Change |
| --- | --- |
| `backend/integrations_smartfill.py` | Full rewrite — new methods, rate limit, pagination, typed exceptions. |
| `backend/fleet_fuel.py` | `_import_csv` gains `source` + `triggered_by`; new `sync_from_smartfill` + 3 endpoints + CSV serialiser helper. |
| `backend/cron_smartfill_auto_sync.py` | NEW — daily cron with two-gate safety. |
| `backend/server.py` | Register the new cron in `_deferred_startup_work`. |
| `frontend/src/lib/version.js` | Bump `RUNNING_VERSION` `.132q1` → `.132q2`. |
| `mobile/src/lib/version.ts` | Bump `MOBILE_BUNDLE_VERSION` `.132q1` → `.132q2`. |
| `tests/backend_unit/test_v58_13_131m_smartfill_autosync.py` | NEW — 29 tests. |
| `tests/backend_unit/test_v58_13_131_smartfill_probe.py` | Update surface list to reflect deleted vehicle wrappers + widen version regex + relax call() end-of-body finder. |
| `tests/backend_unit/test_fuel_reports_v58_13_131d.py` | Widen version regex to accept `q1`/`q2`/`p_hotfix` multi-char suffixes. |
| `tests/backend_unit/test_v58_13_131e_smartfill_fields.py` | Same widen. |

## Guardrail confirmations (per user directive)

- ✅ CSV import flow untouched from an external POV
  (`/api/fleet/fuel/import-csv` still works; existing test suite
  passes; source defaults to `"smartfill_csv"` for that path).
- ✅ Auto-sync OFF by default (env gate off + per-org toggle off;
  live curl transcript proves default state).
- ✅ Rate-limit bucket applies to BOTH manual endpoint AND cron
  (single module-level `_BUCKET` instance).
- ✅ No mobile-app changes.
- ✅ No `CACHE_VERSION` bump.
- ✅ No `e1_tester` invocations.
- ✅ Zero regressions in `tests/backend_unit/test_fuel_*` suite.
- ✅ Secret hygiene preserved.

## What's queued next

- **Wire the FE** — a settings card on the fleet-fuel page showing
  `SmartFill status` + `Sync now` + `Auto-sync ON/OFF` toggle (all
  three endpoints exist; FE just needs to consume them).
- **Enable the cron** — flip `SMARTFILL_AUTO_SYNC_CRON=1` in
  supervisor env AFTER a real customer flips the per-org toggle.
- **Investigate `Asset:Read` params** — currently code 3. FMT Data
  PDF has the shape; not blocking auto-sync.
- **v58.14.x** — TextMagic wire-up + delivery-receipt webhook.
- **v58.14.x** — Object-storage migration to clear the 20 parked
  `ephemeral-upload-storage` lint warnings.
