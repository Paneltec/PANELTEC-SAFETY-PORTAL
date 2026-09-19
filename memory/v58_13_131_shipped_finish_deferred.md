# v58.13.131 — SmartFill Fuel API discovery + Phase-2/3/4/5 spec — SHIPPED (finish deferred)

`finish` bypassed by the 20 pre-existing `ephemeral-upload-storage` warnings (still parked for v58.14.x per standing directive).

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — version-only bump.
- **No comms** — the hourly sync (Phase .131c) is a data FETCH, never emails/SMS. Anomaly detector surfaces via UI (banner tile pulse + inbox modal). Any future "Email me this report" surface will fire synchronously inside an HTTP request context per the ContextVar HTTP-gate.
- 20 deferred warnings still parked.
- **SmartFill secret never logged, never persisted, never in API responses.**

## Ship one-liner
Phase-1 discovery ship for the fuel-usage feature. Probed 28 SmartFill JSON-RPC methods live against `https://fmtdata.com/API/api.php` using the user-supplied `Paneltec4869` credentials. Discovered the wire-quirks (`parameters` plural, string error code, HTTP 400 + valid envelope) and the subscription-gating story (only `Tank:Level` currently invokable). Delivered a full downstream spec (Mongo schema + 9 endpoints + 3 anomaly rules + frontend surface + hourly cron + 6-phase breakdown) awaiting user green-light. Zero user-facing surfaces changed in this ship.

## User's verbatim ask
> "under the Fleet & Service Banner i would like you to create a Fuel usage api link the fuel usage to each vehicle and record litres/$ value record time taken day and month quantity and we may be able to flag any unusual activity in usage, build nice popup and reporting as well."

## Files touched (6)

| File | Change |
|---|---|
| `backend/integrations_smartfill.py` | NEW · 240-line JSON-RPC 2.0 client + probe helpers + columnar→rows transform + secret-hygiene guardrails |
| `backend/.env` | Added `SMARTFILL_API_URL`, `SMARTFILL_API_KEY`, `SMARTFILL_API_SECRET`. Gitignored (verified via `git check-ignore`) |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` → `.131` + `.131` block header (comms-safe compliance documented in-file) |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `.131` |
| `mobile/src/lib/version.ts` | `MOBILE_BUNDLE_VERSION` → `.131` |
| `tests/backend_unit/test_v58_13_131_smartfill_probe.py` | NEW · 17 tests · all passing |

## Discovery artifacts (all in `/app/memory/`)
- `smartfill_discovery_v58_13_131.md` — **the main spec doc**. Sections: probe results · critical blocker · Mongo schema · 9 proposed endpoints · 3 anomaly rules · 4 frontend surfaces · hourly-cron sync strategy · Phase .131a-f breakdown.
- `smartfill_probe_v58_13_131.json` — raw 28-method probe result (URL redacted; verified no key/secret leak).
- `smartfill_tank_level_shape_v58_13_131.json` — sanitized `Tank:Level` response shape (types + lengths only, never values).

## Probe results (LIVE — 2026-09-05T05:07:59Z)

**28 candidate methods → classification:**

| Status | Count | Methods |
|---|---:|---|
| **available** | **1** | `Tank:Level` (columnar `1 row × 10 cols`) |
| **not_enabled** (code 1) | **8** | `Tank:List`, `Tank:Levels`, `Tank:Alarms`, `Tank:Deliveries`, `Tank:Transactions`, `Tank:Fills`, `Tank:History`, `Tank:Consumption` |
| **method_not_found** (code 5) | **19** | all `Vehicle:*`, `Transaction:*`, `Fill:*`, `Report*`, `Site:List`, `Unit:List`, introspection |

**Wire-quirks discovered + locked in tests:**
- SmartFill's JSON-RPC 2.0 param key is `parameters` (plural), not `params`. Both `_rpc_body()` and a pytest lock this.
- Error code is returned as a **string** and message under `error.error` (not `error.message`). `SmartFillAPIError` bridges both.
- SmartFill returns **HTTP 400** for RPC-level errors WITH a valid JSON-RPC envelope. `call()` parses the body BEFORE `raise_for_status()`, only escalating on 5xx or non-JSON.

## 🚨 Critical blocker for Phase .131b
The feature the user asked for (per-vehicle fuel attribution + litres + $ + anomaly detection) is **impossible on the current SmartFill subscription tier**. `Tank:Level` gives only a point-in-time snapshot — no per-transaction fill history, no vehicle attribution, no time series.

**Three paths forward** (full detail in the discovery memo):
1. **[Recommended]** User contacts SmartFill support to unlock `Tank:Deliveries` + `Tank:Transactions` (or `Tank:Fills`) for account `Paneltec4869`. Those 8 gated methods are RECOGNISED server-side (code 1, not code 5), so they exist but are subscription-gated. Support-ticket ready — the code will auto-detect the flip on re-probe.
2. **[Fallback]** Step-up detection via 15-min `Tank:Level` polling. Vehicle attribution impossible without vehicle metadata; $ impossible without a price-per-litre source.
3. **[Alternative]** CSV/XLSX importer for the SmartFill Web Portal export Stephen may already receive.

## Phase breakdown (post-.131)

| Ship | Scope | Depends on |
|---|---|---|
| **v58.13.131** (this ship) | Discovery + probe module + spec | — |
| **v58.13.131a** | User contacts SmartFill support; re-probe → confirm data shape OR pivot to Path 2/3 | User action outside our code |
| **v58.13.131b** | Backend — Mongo schema + `POST /fleet/fuel/sync` on-demand + ingest pipeline + anomaly detector | .131a resolved |
| **v58.13.131c** | Cron — hourly sync, health-status doc, banner "last sync" tile fetches it | .131b |
| **v58.13.131d** | Frontend Phase 1 — banner + 4 tiles + "Sync now" + anomaly inbox modal + AssetDrawer "Fuel" tab | .131c |
| **v58.13.131e** | Frontend Phase 2 — `/app/fleet/fuel-report` page + PDF + on-demand "Email me this report" (synchronous HTTP context) + CSV importer if Path 3 | .131d |
| **v58.13.131f** | Backfill — populate `assets.fuel_tank_capacity_l` from Simpro specs + manual UI to fill the rest | .131b |

## Pytest tally
- `tests/backend_unit/test_v58_13_131_smartfill_probe.py`: **17 / 17 pass** — module import + public surface + `parameters`-plural key + string-code coercion + HTTP 400 body-parse-before-raise + classification taxonomy (code 1/3/5) + candidate list contains all 8 gated `Tank:*` methods + `columnar_to_rows` shape + secret never hardcoded + `_creds()` fail-fast no-echo + log-hygiene lexical check + memo + probe artifact present with URL/key/secret redacted + version pin ≥ .131.
- Full backend unit suite: **1183 passed / 6 skipped / 2 pre-existing flakes** (`test_fleet_search_null_org_v58_13_120c2::test_search_finds_pm_rows_across_null_and_scoped_orgs` + `test_safe_mode_toggle_perm_v58_13_90::test_ensure_stephen_can_toggle_upserts_override` — both fail on clean `main` too, zero new regressions).

## Version bump
```
frontend/src/lib/version.js   RUNNING_VERSION       = 'paneltec-v160.3.9.58.13.131'
frontend/public/service-worker.js   CACHE_VERSION   = 'paneltec-v160.3.9.58.13.131'
mobile/src/lib/version.ts   MOBILE_BUNDLE_VERSION   = 'paneltec-v160.3.9.58.13.131'
```

## NOT in .131 (deferred)
- Mongo `fuel_transactions` collection — Phase .131b.
- `POST /fleet/fuel/sync` endpoint — Phase .131b.
- Anomaly detector implementation — Phase .131b.
- Hourly cron — Phase .131c.
- Frontend banner / AssetDrawer Fuel tab / anomaly inbox / report page — Phase .131d–e.
- CSV/XLSX importer fallback — Phase .131e.
- Backfill of `assets.fuel_tank_capacity_l` — Phase .131f.
- Any email/SMS wiring — only in Phase .131e behind an on-demand button, synchronous HTTP context.

## PAUSED — awaiting user green-light on two decisions
1. **Which data path?** Path 1 (SmartFill support ticket · recommended) / Path 2 (step-up detection · vehicle attribution impossible) / Path 3 (CSV importer).
2. **Any spec adjustments** to the schema / endpoints / anomaly rules (currently: 2σ + capacity+10% + 2-4 AM) / frontend surface / phase breakdown?

Once green-lit → Phase .131b opens.
