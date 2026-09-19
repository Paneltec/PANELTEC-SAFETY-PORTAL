# v58.13.131k — SmartFill API re-probe (discovery only)

Probed: 2026-09-05T09:06Z · endpoint `https://fmtdata.com/API/api.php` · clientReference `...4869`.

## Executive summary

**Status unchanged since `.131`.** SmartFill for account `Paneltec4869` still exposes exactly **one** working method (`Tank:Level`). No transaction, fill, receipt, or reporting endpoints have been enabled. The 8 subscription-gated methods (`Tank:Deliveries`, `Tank:Transactions`, `Tank:Fills`, `Tank:History`, `Tank:Consumption`, `Tank:List`, `Tank:Levels`, `Tank:Alarms`) still return `code 1: Method not supported` — plan tier hasn't changed.

**Recommendation**: stick with the current manual CSV import path (`.131c → .131i`). A receipt-based enrichment path is not feasible against this API surface.

## Credentials — present
```
SMARTFILL_API_URL     = https://fmtdata.com/API/api.php    ✓
SMARTFILL_API_KEY     = Paneltec4869                       ✓ (redacted last-4 = 4869)
SMARTFILL_API_SECRET  = ...cc7593ec6a70e2f7                ✓ (present in env, redacted here)
```
Auth is JSON-RPC only — no OAuth, no session, no HTTP header auth. Credentials live in the RPC `parameters` object as `clientReference` + `clientSecret`.

## JSON-RPC method probe — 39 candidates

| Status | Count | Methods |
|---|---:|---|
| **available** | **1** | `Tank:Level` |
| **subscription-gated** (code 1) | 8 | `Tank:List`, `Tank:Levels`, `Tank:Alarms`, `Tank:Deliveries`, `Tank:Transactions`, `Tank:Fills`, `Tank:History`, `Tank:Consumption` |
| **not implemented** (code 5) | 30 | all `Vehicle:*`, `Transaction:*`, `Fill:*`, `Report*`, `Site:List`, `Unit:List`, `Card:List`, `Driver:List`, `Key:List`, all 7 `Receipt*`/`Receipts*` variants, all 4 introspection methods (`system.listMethods`, `System:Methods`, `Method:List`, `Help:Methods`, `Discover:Methods`, `API:List`) |

Full raw dump: `/app/memory/v58_13_131k_probe_raw.json`.

### Delta vs `.131` baseline
Zero — same 1 available, same 8 gated, same not-found universe. **No support-side changes since 2026-09-05T05:07:59Z.**

### `Tank:Level` with real filters
| Filter | Result |
|---|---|
| `{fromDate, toDate}` | Ignored — returns the same snapshot regardless of range (JSON-RPC returns HTTP 400 wrapper with `code 3: extra_params_not_supported`) |
| `{unitNumber: "5841", fromDate, toDate}` | Same |

**`Tank:Level` is a point-in-time snapshot, not queryable.** No date filter, no per-transaction view. Response shape (from `.131` probe, unchanged): 10-column columnar with Unit Number, Tank Number, Description, Volume, Volume Percent, Capacity, Tank SFL, Status, Last Updated, Timezone.

## REST path sweep — fmtdata.com is not a REST API

Probed 24 REST-style paths (from the plan's candidate list) with both Basic auth and X-API-Key/Bearer headers.

**Every path either 302-redirects to a case-normalisation URL that then returns 403, or 404 outright.**

Sample:
```
GET /api/v1/receipts/5841004903      → 302 → /Api/v1/receipts/5841004903 → 403 (portal login)
GET /receipt/5841004903.pdf          → 404
GET /api/v1/reports/transactions     → 302 → 403
GET /openapi.json                    → 404
GET /swagger                         → 302 → 403
```

The 302 redirects go to the SmartFill web portal (nginx + PHPSESSID cookie), NOT to a machine-consumable REST surface. Basic auth is ignored (portal expects a form login).

**Verdict**: no REST API is exposed on this domain. All programmatic access goes through the JSON-RPC endpoint at `/API/api.php`.

## Receipt-based enrichment path — infeasible

- No `Receipt:*` JSON-RPC methods exist (7 variants all return code 5).
- No REST receipt endpoints (`/receipts/{id}`, `/receipt/{id}.pdf`, bulk download) — all 302 → 403.
- The receipt PDF the user shared (`5841004903_Receipt.pdf`) is likely generated on-demand inside the SmartFill web portal (browser session, not API). No path to fetch it programmatically with the current subscription.

## Recommended path forward

1. **Keep the manual CSV import** (`.131c → .131i` — currently in production). The `.131i` Navixy `navixy_live` enrichment gets us `odometer`, `L/100km`, and R4/R5 automatically. Manual CSV keeps `litres`, `driver`, `key_code`, `card_number`, `registration`, `timestamp`.
2. **Missing on live**: `total_price` and `price_per_litre` — the user's actual CSV exports omit these columns. `.131g` already parses them when present; there's nothing more to build here.
3. **If pricing is a hard requirement**: SmartFill support ticket is the only path. Ask them to enable `Tank:Transactions` (recognised code 1, subscription-gated) on client `Paneltec4869`. That method's shape should include a price column per SmartFill's public docs, though not verifiable without unlock.
4. **Level-jump derivation fallback** (from `.131` memo): poll `Tank:Level` every 15 min, detect step-ups ≥ 10% capacity, attribute to nearest Navixy asset. Still no vehicle attribution, no price. Not worth building.

## Rate limits / gotchas seen
- HTTP 400 is used for JSON-RPC errors (not 200 + error envelope). `integrations_smartfill.call()` already handles this (parse body BEFORE `raise_for_status`).
- `error.code` returns as **string**, `error` field carries the message (not `message`). Already bridged in the module.
- Param key is `parameters`, not `params`. Already bridged.
- No visible per-second or per-day rate limit hit during 39-method sweep (~1 call/sec). No 429 responses.
- PHPSESSID cookie on `/api/*` redirects suggests session state — irrelevant for the JSON-RPC path but confirms the REST base is a portal, not an API.

## No client stub written
Optional section 7 declined — no new working transaction endpoint was found, so a `SmartFillClient` wrapper would only re-implement what `integrations_smartfill.py` already provides for `Tank:Level`. Nothing new to prove-out shape-wise.

## Files touched
- `/app/memory/v58_13_131k_probe_raw.json` (NEW) — full raw probe output.
- `/app/memory/v58_13_131k_smartfill_probe.md` (this file).
- `/app/scripts/probe_131k.py` (NEW) — the probe runner (idempotent, safe to re-run).
- Version bumps on the 3 canonical files.

No writes to Mongo. No changes to `_import_csv`. No new endpoints. No new anomaly rules. No UI.
