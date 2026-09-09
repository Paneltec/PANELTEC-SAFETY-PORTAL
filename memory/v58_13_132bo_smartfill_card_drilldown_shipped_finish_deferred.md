# v58.13.132bo — SmartFill card drill-down drawer + clickable Top-10 leaderboards

**Status:** SHIPPED · finish tool deferred per standing directive.
**Version pins:**
- `RUNNING_VERSION`         = `paneltec-v160.3.9.58.13.132bo`
- `EXPECTED_CACHE_VERSION`  = `paneltec-v160.3.9.58.13.132bo`
- SW `CACHE_VERSION`        = `paneltec-v160.3.9.58.13.132bo`
- `MOBILE_BUNDLE_VERSION`   = unchanged (no `/app/mobile/` code touched).

---

## USER PAIN (verbatim)

> "Clickable Top 10 rows on Fuel dashboard → per-card popup."

The three admin leaderboards on `/app/fleet/fuel` (Top 10 · Highest $, Top 10 · Highest $/L, Top 10 · Most fills) rendered but did nothing on click. Admins had to jump elsewhere to see any per-card history.

---

## What shipped

### Backend

1. **`fleet_fuel_reports.py::_aggregate`** — each rollup bucket now
   accumulates a `_card_numbers` set of distinct SmartFill card numbers
   seen under that key (driver / employee / vehicle). Row output gets a
   new `card_numbers: sorted([...])` field.

2. **`fleet_fuel_reports.py::_lb_row`** — passes `card_numbers`
   through so `GET /fleet/fuel/reports` responds with:

   ```json
   {
     "leaderboards": {
       "top_by_cost":  [{"key": "...", "label": "...", "card_numbers": ["21314"], ...}],
       "top_by_dpl":   [...],
       "top_by_fills": [...]
     }
   }
   ```

3. **`fleet_fuel.py`** — the three drill-down endpoints already landed
   in the previous session; unchanged this ship:
     - `GET  /fleet/fuel/cards/{card_number}/summary` — all-time / YTD /
       30d fills / 90d anomaly count / top driver / linked vehicle.
       60s TTL cache per `(org_id, card_number)`.
     - `GET  /fleet/fuel/cards/{card_number}/transactions?limit&offset&flagged_only`
     - `POST /fleet/fuel/cards/{card_number}/assign` — 200 on happy
       path, 200 + `no_change=true` on repeat, 409 on conflict, 404 on
       unknown vehicle, 400/422 on empty body.

### Frontend

1. **`pages/FuelReporting.jsx`**
   - Imported `SmartFillCardDrawer`.
   - New state: `drawerCard` + `cardChooserRow`.
   - New callback `handleLeaderboardClick(row)`:
     - 0 linked cards → `toast.message("No SmartFill card linked to this row.")`.
     - 1 linked card → open drawer directly with that card.
     - 2+ cards → open `<CardChooserDialog>` picker first.
   - `<Leaderboard>` component gains an `onRowClick` prop; clickable
     rows get `cursor-pointer hover:bg-blue-50/60`, a native title
     tooltip, and a `{n} cards` chip when the row groups multiple
     cards under the same driver label.
   - `<SmartFillCardDrawer>` + inline `<CardChooserDialog>` mounted at
     the end of the return.

2. **`components/fleet/SmartFillCardDrawer.jsx`** — two small bug
   fixes on top of the previous session's scaffold:
   - `AssignVehicleDialog` — `/assets` list response uses the `assets`
     key (not `items`). Fallback chain updated to
     `r.data.assets || r.data.items || r.data || []` so the vehicle
     search actually populates.
   - Anomaly-chip click handler — the bitwise-AND typo
     (`setFlaggedOnly(true) & loadRows(0)`) was preventing the
     `Anomalies (90d)` chip from filtering the transactions table.
     Rewritten as explicit `if/setFlaggedOnly/loadRows`.

3. **New in-file component `CardChooserDialog`** — modal picker for
   rows that group 2+ SmartFill cards.

---

## Pytests (14 checks, all green)

`backend/tests/test_v58_13_132bo_smartfill_card_drilldown.py`:

1. `test_card_summary_shape` — all expected keys + nested shape.
2. `test_card_summary_cache_ttl` — 60s cache honoured (same `generated_at`).
3. `test_card_transactions_pagination` — limit/offset + `vehicle_rego` enrichment.
4. `test_card_transactions_flagged_only` — filter returns only flagged rows.
5. `test_card_assign_missing_vehicle_returns_404`.
6. `test_card_assign_empty_body_returns_422_or_400`.
7. `test_card_assign_idempotent` — round-trip: link → same link returns `no_change=true`.
8. `test_card_assign_conflict_returns_409` — different vehicle claiming same card is refused.
9. `test_leaderboard_rows_expose_card_numbers` — every Top-10 row on every board carries `card_numbers: list`.
10. `test_fuel_reporting_imports_drawer` — source pin.
11. `test_fuel_reporting_wires_onrowclick` — 3× onRowClick + drawer + chooser mounted.
12. `test_leaderboard_component_uses_cursor_pointer` — hover class present, card_numbers referenced.
13. `test_drawer_component_uses_assets_key_fallback` — `r.data.assets` in AssignVehicleDialog.
14. `test_version_and_cache_bumped_to_132bo` — all three canonical strings pinned to `.132bo`.

```
============================== 14 passed in 2.89s ==============================
```

Regression sanity — reran `.132aj` + `.132bi`:

```
============================== 13 passed, 1 warning in 1.77s ==============================
```

---

## Playwright screenshots (verified live)

- `/app/memory/v58_13_132bo_01_leaderboards.jpeg` — Fuel reporting
  page showing all three Top-10 leaderboards with clickable rows
  (`Card 21314 (unlinked) $1,483.77`, `Card 21321 $1,474.92`, …).
- `/app/memory/v58_13_132bo_02_drawer_open.jpeg` — Card 21314
  drawer open showing:
    - Header: `SmartFill Card · Card 21314` + amber "Unlinked" pill.
    - Summary grid: `Total spend $78,705.21 · 179 fills`,
      `Total litres 26,235 L · 3.00/L avg`, `YTD spend $42,162.48`,
      `Fills (30d) 13`, `First seen May 19 2025`,
      `Top driver (90d) — no dominant driver`, and an amber
      `Anomalies (90d) 37 · Click to filter list →` chip.
    - Transactions table (179 rows) with `Flagged only` checkbox
      and each row's Vehicle rego + anomaly count chip.

Version pill in the sidebar footer reads `paneltec-v160.3.9.58.13.132bo`.

---

## NOT changed

- `/app/mobile/` — untouched (only `MOBILE_BUNDLE_VERSION` bumped… actually not this ship — no mobile change needed).
- The 20 pre-existing `ephemeral-upload-storage` warnings — still
  parked for v58.14.x per user directive.
- The three `.132bo` backend endpoints (already tested via curl in
  the previous session; only pytest coverage was added).
- All comms / scheduler / email / SMS paths.

---

## Ops notes

- Cache bumped so any admin sitting on `.132bn` will see the
  "Update available" toast and reload once, picking up the new
  leaderboard click affordance without a hard refresh.
- Rows whose CSV never carried a `card_number` (legacy unlinked
  rows without card data at all) show as non-clickable with no
  hover state — a small visual signal that drill-down is only
  available for card-tagged fills.

Next up in the backlog (per PROJECT_STATE):
1. `.132bp` (or later) — tighten backend `_norm_role` for Mobile
   Modules endpoint.
2. `.132bb-web` follow-up — wire `POST /fleet/fuel/transactions/{id}/flag-suspicious`.
3. Investigate the P1 500 toast on Permission Matrix "preview as
   role" panel open (spotted in `.132bn`).
