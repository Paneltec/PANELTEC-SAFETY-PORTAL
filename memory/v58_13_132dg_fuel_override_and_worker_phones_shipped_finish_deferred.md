# v58.13.132dg — Fuel override toggle + worker phone tap-to-call — SHIPPED (finish deferred)

## Scope

Two features shipped in one batch:

### Part 1 — Fuel price OVERRIDE toggle
`.132df` locked "real prices are never overwritten." Stephen now wants the option to reverse that at will — a per-org boolean that, when ON, reprices EVERY fuel transaction (including real SmartFill-tagged rows) at read time using the provisional price. Stored `total_price` in Mongo remains untouched — the toggle is a pure read-time overlay, reversible with a single click.

### Part 2 — Worker phone tap-to-call in Ad-hoc Job Assignments
`.132cf` already snapshotted `worker_phone` on every assignment doc. `.132dg` surfaces it on all three phone touchpoints in `AdminAssignDailyJobs.jsx` as `tel:` links so admins can tap-to-call from desktop or mobile web.

## Rules (locked by pytest — 13/13 green)

### Toggle OFF (default, matches .132df)
- Provisional-marker rows → repriced at `litres × provisional_price`
- SmartFill rows without a real price (`total_price ≤ 0`, `litres > 0`) → repriced
- Real SmartFill-tagged rows (`smartfill_actual`, `total_price > 0`) → **NEVER touched**

### Toggle ON (override active)
- **Every row** with `litres > 0` → `litres × provisional_price` at read time
- Stored `total_price` in Mongo **still never mutated** — reversible by unchecking
- UI card + banner turn amber; ⚠ **OVERRIDE ACTIVE** badge visible
- Info line: *"⚠ OVERRIDE ACTIVE — ALL fills (including SmartFill real prices) are being displayed at $X.XX/L. Real prices in the DB are preserved."*

## Files touched

### Backend

- `backend/fuel_price_settings.py`
  - `effective_total_price(tx, price, override_smartfill=False)` — 3-arg signature; override=True bypasses `price_source` inspection entirely.
  - `get_org_override_smartfill(org_id)` — standalone boolean helper.
  - **`get_org_price_state(org_id) -> tuple[float, bool]`** — combined price + override in a single Mongo round-trip. Used by aggregation hot paths.
  - `PriceIn.override_smartfill_real: Optional[bool] = None` — omit-to-preserve semantics for legacy clients.
  - `_out()` returns `override_smartfill_real` (defaults False for legacy docs).
  - `put_price_settings` — persists override, records history on either price OR override change, flushes downstream caches on any real change.
  - History row now carries `old_override` + `new_override` (legacy rows have these absent).

- `backend/fleet_fuel_reports.py`
  - `_aggregate` → `provisional_price, override_smartfill = await get_org_price_state(org_id)`.
  - `effective_total_price(t, provisional_price, override_smartfill)` on every tx.
  - `has_provisional` flag: when override=True, fires on any row with `litres > 0` (all repriced).

- `backend/fleet_fuel.py`
  - `asset_fuel_summary` — split-bucket Mongo aggregation retained; Python payload switches to `all_litres × provisional_price` when override=True.
  - `card_summary` — same treatment for `all_time` + `ytd`.
  - `last_fill.total_price` on the asset drawer runs through `effective_total_price(latest, provisional_price, override_smartfill)`.

### Frontend

- `frontend/src/pages/FuelReporting.jsx`
  - New state `priceOverrideDraft` — controls the Edit modal checkbox.
  - Card palette flips to **amber** when `override_smartfill_real=true` (border, ring, icon, pill, edit button, history toggle) so admins immediately know the toggle is on.
  - **`⚠ OVERRIDE ACTIVE`** badge rendered next to the "Provisional fuel price" label (`data-testid="fuel-price-override-badge"`).
  - Info line switches copy dynamically between OFF ("Only applies to fills without a SmartFill-tagged real price. Applies to past and future fills — real prices are never overwritten.") and ON ("⚠ OVERRIDE ACTIVE — ALL fills (including SmartFill real prices) are being displayed at $X.XX/L. Real prices in the DB are preserved.").
  - Edit modal — new checkbox row with `data-testid="fuel-price-override-checkbox"` + amber-tinted label + sub-caption matching Stephen's brief verbatim.
  - PUT payload sends `override_smartfill_real` alongside the price.
  - Toast copy: *"Fuel price updated to $X.XX/L — reports refreshed."*

- `frontend/src/pages/AdminAssignDailyJobs.jsx`
  - **Worker list rows** — phone rendered as `<a href="tel:...">` with `data-testid="worker-row-phone-<id>"` + `onClick={stopPropagation}` so the tel: tap doesn't trigger the worker-select. Missing phone → `<span>—</span>`.
  - **Worker header card** (right pane after selecting) — phone rendered as `<a href="tel:...">` with `data-testid="worker-header-phone"`. Missing phone → "no phone on record" (grey).
  - **Assignments list rows** — phone rendered as `<a href="tel:...">` with `data-testid="assignment-phone-<id>"` between worker name and site name. Missing phone → `—`.
  - Hover state: `hover:text-blue-700 hover:underline` for tel: links.

### Version sync (3 web files)

- `frontend/src/lib/version.js` → `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` = `paneltec-v160.3.9.58.13.132dg`
- `frontend/public/service-worker.js` → `CACHE_VERSION` = `paneltec-v160.3.9.58.13.132dg`
- Mobile bundle stays at `.132dc` (Expo specialist ships next mobile batch; use `MOBILE_VERSION_SYNC_OPTIONAL=true` at commit time).

## Backend audit — Part 2

- `GET /api/mobile/daily-jobs/admin/workers` (`mobile_daily_jobs_admin.py:47`) — already returns `phone` field. ✓
- `GET /api/mobile/daily-jobs/admin/assignments` (`mobile_daily_jobs_admin.py:120`) — already reads `worker_phone` snapshot from `.132cf`; falls back to `users.mobile` / `users.phone` / `workers.mobile` / `workers.phone` for legacy rows. ✓
- `create_daily_job_assignment` in `mobile_daily_jobs.py:205` — already snapshots `worker_phone` at create time via `assignee.get("phone")`. ✓

**No backend changes required for Part 2.** Frontend rendering fix only.

## Pytest lock — 13/13 passing

```
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_effective_total_price_accepts_override        PASSED
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_helpers_exported                              PASSED
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_priceIn_has_optional_override                 PASSED
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_history_records_override_transitions          PASSED
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_reports_and_summaries_use_price_state         PASSED
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_frontend_override_ui_wired                    PASSED
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_override_off_matches_132df_behaviour          PASSED   ← END-TO-END (row C untouched)
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_override_on_reprices_smartfill_real           PASSED   ← END-TO-END (row C repriced at read time; DB untouched)
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_override_toggle_alone_bumps_history           PASSED
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_admin_assign_page_has_tel_links               PASSED
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_backend_admin_workers_returns_phone           PASSED
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_backend_admin_assignments_carries_worker_phone PASSED
tests/test_v58_13_132dg_fuel_override_and_phones.py::test_three_way_sync_at_132dg_or_later              PASSED
```

Regression check: **29/29** across `.132de` + `.132df` + `.132dg`.

### End-to-end pytest math

Same seeded 3 rows as `.132df` (Row A provisional-marker 40L @$2.25 stale, Row B SmartFill w/o price 10L, Row C SmartFill real 20L @$1.80):

| State | Row A | Row B | Row C | Total |
|---|---:|---:|---:|---:|
| **OFF @ 2.25** | 40 × 2.25 = 90 | 10 × 2.25 = 22.50 | **36.00 (real, protected)** | **$148.50** |
| **ON @ 3.00** | 40 × 3.00 = 120 | 10 × 3.00 = 30 | **20 × 3.00 = 60 (repriced)** | **$210.00** |

Row C's DB `total_price` remains **36.00** after both states — read-time only, reversible.

## Live curl proof (Stephen · admin · this month, 6723.2 L across 83 fills)

```
OFF @ 2.25  →  $20,142.70   (real prices preserved, ~745L provisional × $2.25)
ON  @ 2.25  →  $15,127.12   (ALL 6723.2 L × $2.25)
Δ           = -$5,015.58    (real SmartFill prices > $2.25 avg, folded down)

OFF @ 3.00  →  $1,108,714.44 (YTD total)
ON  @ 2.25  →  $831,535.81   ≈ 369,571.48 × 2.25 (exact, entire org)
```

Stored `total_price` in Mongo verified unchanged across all state flips.

## Cache invalidation

Same `_bust_downstream_caches()` hook from `.132df` fires whenever EITHER `price_changed` OR `override_changed` is true. Both `_FUEL_SUMMARY_CACHE` + `_CARD_SUMMARY_CACHE` are flushed synchronously inside the PUT, so an asset-drawer / card-drawer opened immediately after a toggle sees fresh numbers without waiting for the 60s TTL.

## Audit trail

Every history row now records BOTH transitions:
- `old_price` / `new_price`
- `old_override` / `new_override`

An override-only toggle (same price) still appends a history row — verified by `test_override_toggle_alone_bumps_history` which starts at `2.25/OFF`, flips to `2.25/ON`, and asserts the audit collection appends a new row with `old_override=False, new_override=True`.

## Screenshots captured

### Part 1 — Fuel toggle
1. **Card OFF** — emerald palette. Info reads *"Only applies to fills without a SmartFill-tagged real price. Applies to past and future fills — real prices are never overwritten. Last edited by Stephen Guy on 2026-09-10."* · `History (20)` · green **Edit** button. `Total cost: $20,142.70*` for the month.
2. **Edit modal (checkbox unchecked)** — slate/greyed override row.
3. **Edit modal (checkbox checked)** — amber-tinted override row, checkbox filled.
4. **Card ON** — amber palette. **⚠ OVERRIDE ACTIVE** badge visible. Info reads *"⚠ OVERRIDE ACTIVE — ALL fills (including SmartFill real prices) are being displayed at $2.25/L. Real prices in the DB are preserved. Last edited by Stephen Guy on 2026-09-10."* · `Total cost: $15,127.12*` (all fills repriced at $2.25). Success toast: *"Fuel price updated to $2.25/L — reports refreshed."*

### Part 2 — Worker phone tap-to-call
5. **Ad-hoc Job Assignments** — Casey Worker row shows `0412345678` as a tel: link next to the `PANELTEC CIVIL` role chip. Right-pane header shows the same phone as a tel: link next to the worker's email. Playwright verified 1 `<a href="tel:0412345678">` in the list + 1 in the header (test phone was seeded then restored). Missing-phone rows render `—`.

## Decisions

- **Amber card palette when override is ON** — the toggle inverts the safety guarantee, so the UI must scream it loudly. Emerald signals "safe / real prices preserved", amber signals "read-time override active". No red — real prices in the DB are still intact, so red would overpromise concern.
- **Override checkbox lives inside the Edit modal** — keeps the toggle an intentional two-click action ("Edit" → "check" → "Save") rather than a one-click card-level switch that Stephen could bump by accident.
- **`Optional[bool]` on `PriceIn.override_smartfill_real`** — mobile app and older FE bundles PUT the price without the override field; omit-to-preserve avoids stomping the toggle to False on every mobile save.
- **Override-only toggles still append history** — audit completeness. `test_override_toggle_alone_bumps_history` locks this.
- **`get_org_price_state(org_id)`** — single Mongo round-trip returns both settings. Every aggregation touches both; no reason to fetch twice.
- **Toast copy explicitly says "reports refreshed"** — Stephen sees the FE `priceRefreshTick` bump kick off a leaderboard refetch. Confirms cache-bust worked end-to-end.
- **Tel: link `onClick={stopPropagation}` on the worker list row** — tapping the phone opens the dialer without also selecting the worker. Only the phone text is clickable; anywhere else on the row still selects.

## Non-blockers left in place (per standing directives)

- 20 pre-existing `ephemeral-upload-storage` lints — v58.14.x scope, not touched.
- 4 pre-existing `fuel_cards` pytest failures — unrelated data-state drift.
- Mobile bundle stays at `.132dc` — Expo specialist to bump with next mobile batch.
- No workers currently have seeded `mobile`/`phone` fields on `db.users`. When Stephen imports real phone data (or Simpro sync populates them), the tap-to-call UI activates automatically for every worker; missing-phone rows continue to render `—` gracefully.

## Ship checklist

- [x] Backend: `effective_total_price` accepts 3rd override arg.
- [x] Backend: `get_org_price_state` + `get_org_override_smartfill` helpers.
- [x] Backend: `PriceIn.override_smartfill_real` with omit-to-preserve semantics.
- [x] Backend: History row records both price + override transitions.
- [x] Backend: `_aggregate` + `asset_fuel_summary` + `card_summary` wire the override.
- [x] Backend: Cache flush on override-only toggle.
- [x] Frontend: Fuel Price card amber palette + ⚠ OVERRIDE ACTIVE badge + dynamic info line.
- [x] Frontend: Edit modal override checkbox + sub-caption (Stephen's copy verbatim).
- [x] Frontend: PUT payload carries `override_smartfill_real`.
- [x] Frontend: 3 tel: link touchpoints in `AdminAssignDailyJobs.jsx` (list row, header, assignments row).
- [x] Frontend: Missing-phone graceful fallback (`—` / `no phone on record`).
- [x] 3-way web version sync at `.132dg`.
- [x] Pytest 13/13 (`.132dg`) + 29/29 combined (`.132de` + `.132df` + `.132dg`).
- [x] Live curl proof of toggle math (OFF vs ON at same price).
- [x] UI screenshots of both OFF and ON states + edit modal + tap-to-call rendering.
- [x] Seeded phone restored after screenshot capture.
- [ ] `finish` tool — **deferred per standing directive**.
- [ ] Mobile bundle bump — **deferred to Expo specialist**.
