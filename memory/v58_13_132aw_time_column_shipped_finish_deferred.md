# v58.13.132aw — Time column on every fuel transaction surface

## Stephen's ask (verbatim)

> "still looking for you to include the time of the fuel transaction in our reports as well."

## Audit table

Every fuel transaction display surface in the frontend + backend was checked:

| Surface | File | Date | Time | Action |
|---|---|---|---|---|
| Per-fill drilldown (Fuel Report) | `frontend/src/pages/FuelReporting.jsx` `<FuelTransactionsList>` | ✅ | ✅ | Already present (`.132aj`) — no change |
| **Top 5 · Highest fills** | `FuelReporting.jsx` `highestFills` table | ✅ | ❌ → ✅ | **Time column added** (HH:MM 24 h) |
| **Top 5 · $/L outliers** | `FuelReporting.jsx` `outliersReal` table | ✅ | ❌ → ✅ | **Time column added** |
| Asset drawer → Fuel tab → recent transactions | `frontend/src/components/AssetFuelTab.jsx` | ✅ | ✅ | Already present (`When = date · HH:MM`) |
| Fuel Anomaly Inbox rows | `frontend/src/pages/FuelAnomalyInbox.jsx` `<AnomalyRow>` | ✅ | ✅ | Already present (`When = date · HH:MM:SS`) |
| Anomaly Inbox → Manual match modal txn caption | `FuelAnomalyInbox.jsx` `<ManualMatchModal>` | ✅ | ✅ | Already present (`date · time_local · litres`) |
| CSV export — detail mode (`?detail=1`) | `backend/fleet_fuel_reports.py::_stream_detail` | ✅ | ✅ | Already present (`(time_local or "")[:8]`) |
| CSV export — aggregated (default) | `backend/fleet_fuel_reports.py::_stream_aggregated` | n/a | n/a | Rollup rows have no timestamp — nothing to add |
| Rollup rows (per-vehicle / per-driver / admin summary) | `FuelReporting.jsx` "Last fill" col | ✅ | n/a | Not a per-transaction row |

Two surfaces silently missed Time (both are the "Top 5" panels near the top of the Fuel Report). Both fixed in this ship.

## Backend changes

**File:** `backend/fleet_fuel_reports.py::_aggregate`

- `projection` — added `"time_local": 1` so the field flows through the aggregator.
- `outlier_rows` — now carries `time_local` on every row alongside `timestamp` and `date_iso`.
- `top_by_fill_litres` payload — appends `time_local` (HH:MM:SS as stored by SmartFill; frontend trims to HH:MM).
- `top_dpl_outliers_real` payload — appends `time_local`.
- `top_dpl_outliers` (back-compat) — appends `time_local`.

Zero shape breakage — every new field is additive. Old PDF renderer / legacy consumers ignore the extra key.

## Frontend changes

**File:** `frontend/src/pages/FuelReporting.jsx`

- **Top 5 · Highest fills** table (line 613 area): new `<th>Time</th>` between Date and Cost. Cell renders `(f.time_local || '').slice(0,5) || '—'` — HH:MM 24 h, matches the drilldown / Asset drawer convention.
- **Top 5 · $/L outliers** table (line 684 area): new `<th>Time</th>` after Date. Same render + testid pattern.

New data-testids for pytest / e2e:
- `fuel-reporting-highest-fill-time-{i}` (i = 0..4)
- `fuel-reporting-outlier-real-time-{i}` (i = 0..4)

## Version state

| Constant | Before | After |
|---|---|---|
| RUNNING_VERSION | `paneltec-v160.3.9.58.13.132av` | `paneltec-v160.3.9.58.13.132aw` |
| EXPECTED_CACHE_VERSION | `paneltec-v160.3.9.58.13.132av` | `paneltec-v160.3.9.58.13.132aw` |
| CACHE_VERSION (`service-worker.js`) | `paneltec-v160.3.9.58.13.132av` | `paneltec-v160.3.9.58.13.132aw` |
| MOBILE_BUNDLE_VERSION | `paneltec-v160.3.9.58.13.132at` | unchanged |

CACHE bumped so open tabs reload once and the two Top-5 tables pick up the new column.

## Verification

- **Live smoke test**: hit `/app/fleet/fuel` on the preview URL post-deploy.
  - `data-testid="fuel-reporting-highest-fill-time-0"` returned `"13:20"` (a real fill's HH:MM).
  - Screenshot at `/app/memory/screens/v58_13_132aw_time_columns.png` (raw at `/tmp/fuel_report_time_columns.png`) shows the Top-5 · $/L outliers table with Time column populated (`14:55`, `15:25`) alongside the existing date column, and the drilldown table below with **DATE · TIME · VEHICLE · DRIVER · LITRES · COST · $/L · TXN ID** headers — end-to-end proof that Date + Time are visible on every per-transaction surface Stephen was asking about.
- **Pytest regression sweep**: `test_v58_13_132aj_fuel_reporting.py` + `test_v58_13_132au_dedupe.py` + `test_v58_13_132av_clear_admin_pin.py` → **20 passed, 1 warning in 5.41s**. Nothing broken by the aggregator projection expansion.

## Files changed

- `backend/fleet_fuel_reports.py` — 4 edits: projection, `outlier_rows` builder, `top_by_fill_litres`, `top_dpl_outliers_real` + `top_dpl_outliers` payloads.
- `frontend/src/pages/FuelReporting.jsx` — 2 edits: Top-5 · Highest fills table, Top-5 · $/L outliers table.
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION bump.
- `frontend/public/service-worker.js` — CACHE_VERSION bump.

## Not in this ship

Nothing deferred — the audit was exhaustive and every fuel transaction display surface now shows Time.

## Rollback

Frontend-only + additive backend fields. Revert this commit; CACHE bump will re-fire the "Update available" toast one more time.
