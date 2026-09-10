# v58.13.132de — Admin-editable fuel-price fallback calculator — SHIPPED (finish deferred)

## Scope

Replace the hardcoded `PROVISIONAL_RATE` constant in the SmartFill fuel-report backfill/aggregations with a **per-org, admin-editable** setting. Fills that already carry a real SmartFill-tagged price are **never** touched; only the fallback used when a fill has no real price is dynamic.

## Endpoints (mounted at `/api/fleet/fuel`)

| Method | Path              | Guard             | Purpose                                         |
|--------|-------------------|-------------------|-------------------------------------------------|
| GET    | `/price-settings` | `assets.view`     | Read current price (falls back to 2.25 default) |
| PUT    | `/price-settings` | `assets.edit`     | Upsert per-org price; appends audit row         |
| GET    | `/price-history`  | `assets.view`     | Last 20 changes (UI surfaces last 5)            |

Server helper `get_org_provisional_price(org_id) -> float` reads the setting for the aggregators; returns `2.25` when unseeded.

## Bug fixed mid-ship

Initial draft gated all three routes on `require_permission("fleet", …)` and the FE Edit button on `useCan()('fleet', 'edit')`. **`fleet` is not a resource in `permissions.PERMISSIONS_SCHEMA`** — `can()` short-circuits unknown resources to `False`, so every caller (including admins) got `403 Permission denied: fleet.view` and the Edit button silently rendered `null`. Sibling `fleet_fuel.py` gates on `assets.*` (the "Plant & Vehicles" resource, `_all(True)` for admin).

**Fix (backend + frontend):**
- `backend/fuel_price_settings.py`: three `require_permission("fleet", …)` → `require_permission("assets", …)`; module docstring updated to explain the choice (so the next hand doesn't reintroduce it).
- `frontend/src/pages/FuelReporting.jsx`: `useCan()('fleet', 'edit')` → `useCan()('assets', 'edit')` with an inline comment referencing this memo.

## Collections

- `db.fuel_price_settings` — one doc per org (upserted). Shape: `{ org_id, provisional_price_per_litre, currency, updated_by, updated_by_name, updated_at }`.
- `db.fuel_price_history` — append-only audit; only inserted when the value actually changes (`|old − new| > 1e-6`). UI surfaces the last 5, GET returns last 20.

Neither collection touches `fuel_transactions` — real SmartFill prices stay untouched. Guardrail test locks this: `test_smartfill_real_prices_not_referenced_from_settings_module`.

## Frontend — `FuelReporting.jsx`

Above the "Fleet & Service Register" back-link, a new emerald pill card:

- **Collapsed**: `$X.XX AUD / L` · "Only applies to fills without a SmartFill-tagged real price · Last edited by <name>" · `History (n)` toggle · green `Edit` (admin only).
- **Expanded history**: last 5 rows — `date · name · $old → $new`.
- **Edit modal** (`fuel-price-edit-modal`): number input (step 0.01, range 0–10), Cancel / Save. Save PUTs to `/fleet/fuel/price-settings` and reloads both settings + history.

Uploaded provisional-cost banner ("Fuel costs shown are provisional at $X.XX/L") now interpolates from the fetched setting instead of the hardcoded literal.

## Files touched

- `backend/fuel_price_settings.py` — permission fix (× 3) + docstring rationale.
- `backend/server.py` — router include (unchanged from earlier scaffolding).
- `frontend/src/pages/FuelReporting.jsx` — permission fix + card, history, modal wired.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `.132de`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` → `.132de`.
- `backend/tests/test_v58_13_132de_fuel_price_fallback.py` — 7 lock tests (see below).

Mobile bundle intentionally left at `.132dc` (per standing directive: web-only ship, use `MOBILE_VERSION_SYNC_OPTIONAL=true` at commit time).

## Test lock — 7/7 passing

```
tests/test_v58_13_132de_fuel_price_fallback.py::test_default_price_is_2_25                            PASSED
tests/test_v58_13_132de_fuel_price_fallback.py::test_get_org_provisional_price_helper_exists          PASSED
tests/test_v58_13_132de_fuel_price_fallback.py::test_all_three_endpoints_gated_and_mounted            PASSED
tests/test_v58_13_132de_fuel_price_fallback.py::test_frontend_wires_price_card_and_modal              PASSED
tests/test_v58_13_132de_fuel_price_fallback.py::test_smartfill_real_prices_not_referenced_from_...    PASSED
tests/test_v58_13_132de_fuel_price_fallback.py::test_admin_can_read_and_write                         PASSED
tests/test_v58_13_132de_fuel_price_fallback.py::test_three_way_sync_at_132de_or_later                 PASSED
```

Broader `pytest -k "fuel or fleet"` shows 4 pre-existing failures in `test_v58_13_132v_fuel_cards_backfill.py` and `test_v58_13_132x_fuel_cards_admin.py` — data-state drift on `fuel_cards` row counts + empty `first_seen_at`. Unrelated to `.132de` (permission fix does not touch `fuel_cards`).

## Screenshots captured (Stephen · admin · `/app/fleet/fuel`)

1. **Card collapsed** — `$2.25 AUD / L` · `Only applies to fills without a SmartFill-tagged real price. Last edited by Stephen Guy.` · `History (4)` toggle · green `Edit` button (admin visible).
2. **Card + history expanded** — 4-row audit trail from the pytest run (Stephen Guy `$2.25 → $2.30` / `$2.30 → $2.25` toggles).
3. **Edit modal** — "Edit price" · Price (AUD / L) `2.25` input focused · "Only applies to fills without a SmartFill-tagged real price. Range 0-10." · `Cancel` / green `Save`.

Live URL used: `https://whs-compliance.preview.emergentagent.com/app/fleet/fuel`. `data-testid`s exercised end-to-end: `fuel-price-card`, `fuel-price-value`, `fuel-price-edit-btn`, `fuel-price-edit-modal`, `fuel-price-edit-input`, `fuel-price-edit-save`, `fuel-price-edit-cancel`, `fuel-price-history-toggle`, `fuel-price-history-list`.

## Decisions

- **Resource choice (`assets` not `fleet`)** — matched sibling `fleet_fuel.py` (20+ endpoints already on `assets.*`). Keeps the matrix stable and the "Edit" button visible for existing admin/hseq_lead role defaults without a matrix migration.
- **Default `$2.25/L`** — carried over from the superseded `.132de` request; single source of truth is `DEFAULT_PROVISIONAL_PRICE` in `fuel_price_settings.py`.
- **History cap** — GET returns 20; UI surfaces the top 5 (`priceHistory.slice(0, 5)`). Consistent with other "recent activity" surfaces in the app.
- **Idempotent save** — Save with the same value is a no-op on `fuel_price_history` (only appends when `|old − new| > 1e-6`).

## Pending / non-blocking

- **Mobile 4-way sync deferred** — Expo specialist to bump `mobile/src/lib/version.ts` to `.132de` in the next mobile ship (currently `.132dc`); the pre-commit hook is bypassed with `MOBILE_VERSION_SYNC_OPTIONAL=true`.
- **20 pre-existing `ephemeral-upload-storage` lints** — parked per Stephen's standing directive (v58.14.x scope); not touched.
- **4 pre-existing `fuel_cards` pytest failures** — data-state drift, unrelated; left for the fleet-data owner.

## Ship checklist

- [x] Root cause identified (`fleet` not a resource in `PERMISSIONS_SCHEMA`).
- [x] Backend permission gates fixed on all 3 endpoints.
- [x] Frontend Edit-button gate fixed.
- [x] Backend restarted; endpoints return 200 for admin.
- [x] 7/7 `.132de` pytests green.
- [x] End-to-end UI verified with screenshots (card, history, modal).
- [x] 3-way web version sync at `.132de`.
- [ ] `finish` tool — **deferred per standing directive**.
- [ ] Mobile bundle bump — **deferred to Expo specialist**.
