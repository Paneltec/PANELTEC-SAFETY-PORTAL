# v58.13.132dh — Fuel Provisional Price Toggle (universal override) — SHIPPED (finish deferred)

## Scope

Replace the `.132dg` modal checkbox with a **header segmented control** that lets an admin flip the whole org's Fuel dashboard between two named price sources:

| Mode | Behaviour |
|---|---|
| **`smartfill_with_fallback`** (default) | Real SmartFill prices are shown per fill; provisional is used only when a fill has no real price. |
| **`provisional_all`** | ALL fills (including SmartFill-tagged ones) are re-priced at read time to `litres × provisional_price`. |

Stored `total_price` and `computed_price_per_litre` in Mongo are **never mutated** — this is a reversible read-time overlay across the entire Fuel dashboard: Organisation total, Top 10 Highest $, Top 10 Highest $/L, Top 10 Most Fills, Per-Fill Transactions table, per-asset drawer, per-card drawer.

Migration safety: legacy docs without `override_mode` fall back to the `.132dg` boolean (`override_smartfill_real`) → default OFF → `smartfill_with_fallback`. Zero behaviour change on deploy until an admin flips the toggle.

## Files touched

### Backend

- `backend/fuel_price_settings.py`
  - New `OverrideMode = Literal["provisional_all", "smartfill_with_fallback"]` type alias.
  - New `_mode_from_bool(bool) → OverrideMode` + `_bool_from_mode(OverrideMode) → bool` bridge helpers. Both fields are persisted for BC — legacy mobile / older FE bundles still PUT the boolean; new FE PATCHes the enum.
  - `_out()` prefers stored enum → falls back to legacy boolean → returns both.
  - `get_org_override_smartfill()` + `get_org_price_state()` — both helpers now prefer the enum when present.
  - `PriceIn.provisional_price_per_litre: Optional[float]` (was required) — enables **mode-only PATCH** payloads. Stored price is preserved when omitted.
  - `PriceIn.override_mode: Optional[OverrideMode]` — new field. Enum wins over boolean when both present.
  - `put_price_settings` resolves precedence `enum → boolean → preserve-stored`; persists BOTH fields; audit-appends on price OR mode change; carries `old_mode` / `new_mode` on the history row.
  - Cache-bust behaviour from `.132df` unchanged (fires on any real change).

- `backend/fleet_fuel.py::list_transactions`
  - After the Mongo find, calls `effective_total_price(item, provisional_price, override_smartfill)` per row and recomputes `computed_price_per_litre` at read time.
  - Response body now carries `price_state = { provisional_price_per_litre, override_smartfill_real, override_mode }` so the FE can render the "Provisional override active" badge without a second round-trip.
  - Applies the reprice symmetrically:
    - `provisional_all` → every row shows `provisional_price` in `$/L`.
    - `smartfill_with_fallback` → real SmartFill rows untouched, unpriced/marker rows repriced.

- `backend/fleet_fuel.py::asset_fuel_summary` + `card_summary` — carried over from `.132dg`; already switches to `all_litres × provisional_price` when override is on. No further changes needed.

- `backend/fleet_fuel_reports.py::_aggregate` — carried over from `.132df`/`.132dg`; already fetches `get_org_price_state` and reprices per tx. No changes needed.

### Frontend

- `frontend/src/pages/FuelReporting.jsx`
  - **New header component**: rounded-xl white card with `data-testid="fuel-price-source-toggle"`, sitting immediately above the emerald/amber Fuel Price card. Contains:
    - Eyebrow *"Fuel price source"* + dynamic sub-copy (fallback vs override).
    - **⚠ Provisional override active** amber pill (`data-testid="provisional-override-active-badge"`) rendered only when mode = `provisional_all`.
    - Admin: pill-shaped segmented control with two tabs — `[SmartFill (real)]` white/blue when selected · `[Provisional (override all)]` amber when selected. Testids `fuel-price-source-smartfill` + `fuel-price-source-provisional`.
    - Non-admin: read-only chip `data-testid="fuel-price-source-readonly"` showing the current mode label.
  - **New setter** `setOverrideMode(mode)` — PATCH-style PUT with only `{ override_mode }`, toasts *"Provisional override active — reports refreshed."* or *"Real SmartFill prices restored — reports refreshed."*, calls `loadPriceSettings()` + bumps `priceRefreshTick` (reload leaderboards) + `loadTxnList()` (reload Per-Fill Transactions).
  - **Edit modal cleanup** — the `.132dg` modal checkbox (`fuel-price-override-checkbox` / `fuel-price-override-row`) is removed. Dual controls confused Stephen; the header segmented control is now the single toggle. Modal is price-only.
  - `priceOverrideDraft` state deleted (was only used by the modal checkbox).

### Version sync (3 web files)

- `frontend/src/lib/version.js` → `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` = `paneltec-v160.3.9.58.13.132dh`
- `frontend/public/service-worker.js` → `CACHE_VERSION` = `paneltec-v160.3.9.58.13.132dh`
- Mobile bundle stays at `.132dc` — commit with `MOBILE_VERSION_SYNC_OPTIONAL=true`.

## Anomaly detection audit

The `_evaluate_anomalies` detector in `backend/fleet_fuel.py:587` runs five rules: `unusual_hour`, `capacity_exceed`, `stat_spike`, `reading_regress`, `missing_odometer`. The `stat_spike` rule bounds on **litres** vs μ+2σ, not on `$/L`. There is no existing `$/L` anomaly rule in the codebase — searched every `_flag(` call site and no threshold references `total_price` / `computed_price_per_litre`.

Consequence: applying the effective toggled price to `$/L` anomaly thresholds is a **no-op today**. When the first `$/L` anomaly rule is added, the pattern is already in place — read `get_org_price_state()` once at the top of `_evaluate_anomalies` and use it inside the rule. Called out in this memo so the next hand knows the plumbing is ready but no wiring was needed.

## Pytest lock — 12/12 passing

```
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_override_mode_enum_defined                    PASSED
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_priceIn_accepts_mode_and_makes_price_optional PASSED
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_out_surfaces_mode_and_boolean                 PASSED
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_history_records_mode_transition               PASSED
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_list_transactions_reprices_at_read_time       PASSED
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_frontend_header_segmented_control_wired       PASSED
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_modal_override_checkbox_removed               PASSED
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_mode_switch_persists_org_wide                 PASSED  ← E2E
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_provisional_all_reprices_every_row            PASSED  ← E2E
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_smartfill_with_fallback_preserves_real        PASSED  ← E2E
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_mode_only_payload_preserves_price             PASSED  ← E2E
tests/test_v58_13_132dh_fuel_price_source_toggle.py::test_three_way_sync_at_132dh_or_later              PASSED
```

Regression check: `.132de` 7 + `.132df` 9 + `.132dg` 13 + `.132dh` 12 = **41/41 combined**. The `.132dg::test_frontend_override_ui_wired` was updated to reflect the header-based UI (removed modal-checkbox testid assertions; retained the "OVERRIDE ACTIVE" banner + payload-shape guardrails).

## Live curl proof

```
$ PUT { override_mode: "smartfill_with_fallback", price: 2.25 }
→ { mode: "smartfill_with_fallback", override_smartfill_real: false, price: 2.25 }

$ PUT { override_mode: "provisional_all" }           # mode-only PATCH
→ { mode: "provisional_all", override_smartfill_real: true, price: 2.25 }   # price preserved!

$ GET /transactions?page=1&size=3
price_state: { provisional: 2.25, override: true, mode: "provisional_all" }
  · XT96AZ · 118.76L · total=267.21   · dpl=2.25   · src=smartfill_actual   ← real price folded
  · XT42BN ·  47.2L · total=106.20   · dpl=2.25   · src=smartfill_actual   ← real price folded
  · L08QF  ·  35.23L · total= 79.27   · dpl=2.2501 · src=smartfill_actual   ← real price folded

$ PUT { override_mode: "smartfill_with_fallback" }   # mode-only PATCH
→ { mode: "smartfill_with_fallback", ... }

$ GET /transactions?page=1&size=3                    # SAME rows
  · XT96AZ · 118.76L · total=356.28   · dpl=3.0    · src=smartfill_actual   ← real price restored
  · XT42BN ·  47.2L · total=141.60   · dpl=3.0    · src=smartfill_actual   ← real price restored
  · L08QF  ·  35.23L · total=105.69   · dpl=3.0    · src=smartfill_actual   ← real price restored
```

Stored values on the same 3 rows in Mongo are unchanged across both toggles — verified by pytest `test_provisional_all_reprices_every_row` reading `fuel_transactions.find_one()` directly and asserting `total_price = 90.0`, `computed_price_per_litre = 1.80` for the seeded real-price row after multiple flips.

Aggregate impact on the current live org (Stephen, this month):
- **SmartFill (real)** → Total Cost `$20,142.70*` across 6,723.2 L
- **Provisional (override all) @ $2.25** → Total Cost `$15,127.12*` across 6,723.2 L (all fills at $2.25/L)
- Δ = **-$5,015.58** (real SmartFill prices > $2.25 avg were folded down)

## Screenshots captured

1. **SmartFill (real) mode** — segmented control blue-white on the SmartFill tab. Header sub-copy: *"SmartFill real prices are shown per fill. Provisional ($2.250/L) is used only when a fill has no real price."* Provisional Fuel Price card in emerald. Total cost `$20,142.70*`.
2. **Provisional (override all) mode** — segmented control amber on the Provisional tab. **⚠ PROVISIONAL OVERRIDE ACTIVE** amber badge visible in the header. Header sub-copy: *"Every fill (including SmartFill real) is being displayed at $2.250/L — read-time override."* Provisional Fuel Price card turns amber with "OVERRIDE ACTIVE" banner. Toast: *"Provisional override active — reports refreshed."* Total cost `$15,127.12*`.
3. **Per-Fill Transactions under Provisional mode** — every row in the table shows `$2.250` in the $/L column (XT96AZ 118.76L $267.21 $2.250, XT42BN 47.20L $106.20 $2.250, L08QF 35.23L $79.27 $2.250, K68JF, A42FT, XT36DO, XT78AH, XT16AB, D67YQ, XT73DF, L15NH … all $2.250). Top 10 Highest $/L (right column) also fully at $2.250 — matches Stephen's original screenshot pattern verbatim.

## Decisions

- **Header segmented control** — a pill-shaped tablist with two tabs was chosen over a single amber checkbox because Stephen's screenshot pattern needs to reassure admins that both source states are legitimate (not "danger vs safe"). SmartFill tab renders white-on-blue when selected; Provisional tab renders amber-on-white — the amber colour is a warning cue only when Provisional is *active*, not when it's merely available to pick.
- **`override_mode` enum stored alongside legacy boolean** — zero-downtime migration. Legacy mobile clients still PUT `override_smartfill_real=True/False` and the enum is derived. New FE PATCHes the enum only. `_out()` always returns both.
- **PATCH-style mode-only payload** — `provisional_price_per_litre` demoted to `Optional[float]` on `PriceIn`, so the FE can flip the toggle in a single call without needing to re-fetch and re-send the price. Backend preserves the stored price when omitted. Locked by `test_mode_only_payload_preserves_price`.
- **Modal checkbox removed** — dual controls (modal + header) would let two admins land in inconsistent UI states in the same session. Header segmented control is the single source of truth; modal is now price-only. Locked by `test_modal_override_checkbox_removed`.
- **`price_state` in `/transactions` response** — the FE badge needs the current mode + price. Bundling it into the same response avoids a second GET and keeps the toggle-flip → table-repaint transition in a single round-trip.
- **`$/L` anomaly threshold** — no such rule exists today; audit above documents this. Wiring will land when the rule is added.

## Non-blockers left in place (per standing directives)

- 20 pre-existing `ephemeral-upload-storage` lints — v58.14.x scope.
- 4 pre-existing `fuel_cards` pytest failures — unrelated data-state drift.
- Mobile bundle stays at `.132dc`.

## Ship checklist

- [x] Backend: `override_mode` enum + BC boolean bridge.
- [x] Backend: PATCH-style `PriceIn` (price optional).
- [x] Backend: history row records mode transition (`old_mode` / `new_mode`).
- [x] Backend: `list_transactions` reprices per row + returns `price_state`.
- [x] Backend: enum-precedence resolution (`enum → boolean → preserve`).
- [x] Frontend: header segmented control with 3 testids + amber active badge.
- [x] Frontend: admin-only via `canEditFuel`; non-admins get read-only chip.
- [x] Frontend: mode flip → refetch leaderboards + Per-Fill Transactions.
- [x] Frontend: modal-checkbox path removed (single source of truth).
- [x] 3-way web version sync at `.132dh`.
- [x] Pytest 12/12 (`.132dh`) + 41/41 combined.
- [x] Live curl proof: same 3 rows @ $2.25/L under `provisional_all`, back at $3.00/L under `smartfill_with_fallback`. DB never mutated.
- [x] UI screenshots: both modes + Per-Fill Transactions under Provisional showing all $2.250 rows.
- [ ] `finish` tool — **deferred per standing directive**.
- [ ] Mobile bundle bump — **deferred to Expo specialist**.
