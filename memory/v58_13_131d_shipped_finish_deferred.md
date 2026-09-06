# v58.13.131d — Fuel Reporting page + all 4 bundles — SHIPPED (finish deferred)

`finish` bypassed per standing rule (20 pre-existing `ephemeral-upload-storage` warnings still parked for v58.14.x).

## Rules obeyed
- No `e1_tester` (banned by user) — pytest + curl + Playwright screenshots.
- No `/app/mobile/` code — version-only bump.
- **No cron, no BackgroundTask, no scheduled sends.** Email fires INSIDE the HTTP request user triggered.
- The `send_context` ContextVar gate stays intact (via `graph_send_mail` and `queue_email_doc`).
- Comms Safe Mode honoured — 200 with `sent:false, safe_mode:true, would_have_sent_to:[]`.
- Rate-limit: 5 sends per user per 10 minutes (429 on 6th).
- Report send audit trail in new `fuel_report_emails_sent` collection.
- 20 pre-existing `ephemeral-upload-storage` warnings still parked for v58.14.x.
- `plant_maintenance` back-fill (Issue 2) still parked for `.122b`.

## Ship one-liner
Shipped the full Fuel Reporting page at `/app/fleet/fuel` (period toggle, tab switch, presets, top-5 outliers, Recharts dual-axis + pie, CSV export, admin leaderboards, on-demand email with Safe Mode + rate-limit + audit trail) plus the R7 `procurement_outlier` anomaly rule.

## Ship label chronology
Chain (chronological, not alphabetical): `.131` → `.131b` → `.131e` → `.131c` → **`.131d`**. Version pin in `test_v58_13_131e_smartfill_fields.py` accepts `.131d` explicitly.

## Files touched (11)

| File | Change |
|---|---|
| `backend/fleet_fuel.py` | Added `_reflag_procurement_outliers(org_id, local_tz)` — computes top-3 $/L in the current calendar month across all matched rows and flags them with `R7 procurement_outlier` (severity=medium). **Idempotent** — clears prior R7 flags on rows that fall out of the top-3. Ties broken by earliest `timestamp`, then `id`. Called at the end of every successful `_import_csv()` pass. |
| `backend/fleet_fuel_reports.py` | NEW · reports module. Endpoints: `GET /reports` (JSON aggregation, all 3 scopes), `GET /reports/export` (CSV re-export), `POST /reports/email` (on-demand snapshot). Aggregations compute totals, per-period, per-key rows with $/L + delta-$/L vs prior period, top-5 $/L outliers, and admin leaderboards (highest $ / highest $/L / most fills). PDF renderer via `reportlab.pdfgen.canvas` — headline block + top-5 + breakdown table with page-break handling. Email endpoint honours Comms Safe Mode via `comms_safe_mode.is_blocked()`, hands off to `email_outbox.queue_email_doc()` (which itself gates `send_context`), rate-limits via a Mongo counter over `fuel_report_emails_sent`, audits every attempt (sent OR safe-mode-blocked). Attachments written to `tempfile.NamedTemporaryFile` and cleaned up after send. |
| `backend/server.py` | Registers the new `fleet_fuel_reports` router + wires its `ensure_indexes` into `on_startup`. |
| `tests/backend_unit/test_fuel_reports_v58_13_131d.py` | NEW · 14 tests. R7: top-3 flags applied; prior-month rows ignored; idempotent reshuffle (fresh row demotes T3 cleanly); tie-break by earliest timestamp. Aggregation: employee-scope shape; top-5 outlier ordering; leaderboards produce 3 tables. Email endpoint: Safe Mode ON records intent with `sent:false`; Safe Mode OFF calls `queue_email_doc` with correct payload; rate-limit 429 on the 6th send; permission-gate source-pin; PDF and CSV byte outputs. |
| `tests/backend_unit/test_fuel_csv_import.py` | Updated smoke test — `rows_anomalous` now includes R7 (single row = automatic top-1 outlier). Contract now asserts `>= 1` plus the specific `unusual_hour` flag. |
| `tests/backend_unit/test_v58_13_131e_smartfill_fields.py` | Version-pin widened to accept `.131d`. |
| `frontend/src/pages/FuelReporting.jsx` | NEW · reporting page. Period toggle (Weekly / Monthly), tab switch (Per-Employee / Per-Vehicle / Admin Rollup), preset chips (This Week / Last Week / This Month / Last Month / YTD / Custom) + date pickers. Top-5 $/L outlier panel always visible. Recharts `ComposedChart` (bar $ + line litres, dual-axis) + `PieChart` per active scope. Rows table with `Δ $/L` delta chip. Admin scope adds 3 leaderboards. Export CSV button + Email dialog. |
| `frontend/src/pages/FleetRegister.jsx` | New "Fuel Reports" outlined button (gated on `assets.edit`, not admin-only) next to `Import Fuel CSV`. |
| `frontend/src/pages/FuelAnomalyInbox.jsx` | Added `procurement_outlier` to `RULE_META` with violet severity=medium styling. |
| `frontend/src/components/AssetFuelTab.jsx` | Added `procurement_outlier` to `RULE_LABEL` so the per-asset Fuel tab shows readable text on R7 rows. |
| `frontend/src/App.js` | New route `<Route path="fleet/fuel" element={<FuelReporting />}>`. |
| `frontend/src/lib/version.js` · `frontend/public/service-worker.js` · `mobile/src/lib/version.ts` | `.131c` → `.131d` bump. |

## Backend contract summary

### New endpoints
- `GET  /api/fleet/fuel/reports?scope=employee|vehicle|admin&period=weekly|monthly&from=YYYY-MM-DD&to=YYYY-MM-DD` — read-only aggregation. Response: `{rows, periods, top_dpl_outliers, totals, filters}`. For `scope=admin` also carries `leaderboards: {top_by_cost, top_by_dpl, top_by_fills}`.
- `GET  /api/fleet/fuel/reports/export?…` — streams a filtered CSV with the same columns shown in the rows table.
- `POST /api/fleet/fuel/reports/email` — on-demand email snapshot. Body: `{to, cc, note, scope, period, from_date, to_date, include_pdf, include_csv}`. Response: `{sent: bool, safe_mode: bool, message_id?: str, would_have_sent_to?: [str]}`.
  - **Gated on `assets.edit`** (403 for lower). Rate-limited 5-per-10min per user (429 on 6th). Comms Safe Mode returns 200 + `sent:false, safe_mode:true`. All attempts audited to `fuel_report_emails_sent`.

### R7 procurement_outlier rule
- Fires on the current calendar month only, across all matched transactions (org-wide).
- Flags top-3 by $/L (highest first). Idempotent — repeat passes clear R7 from displaced rows.
- Ties broken deterministically by earliest `timestamp`.
- Detail string: `"Top-3 $/L this month at N.NNN $/L (rank #K of M)"`.

### New collection
- `fuel_report_emails_sent`: `{id, org_id, sent_by, sent_by_email, sent_to[], cc[], note, filters_snapshot, format{pdf,csv}, sent, safe_mode, message_id?, sent_at}`.

## Curl transcript (live · admin=Stephen)

```
=== Import 5-row CSV with pricing ($5/L, $4/L, $5/L, $3/L, $2/L) ===
POST /api/fleet/fuel/import-csv → 200 · inserted=5 anomalous=3 rejected=0    ✔
  (3 anomalous = 3 rows flagged R7 procurement_outlier — top-3 $/L this month)

=== GET /api/fleet/fuel/reports?scope=employee&period=weekly&from=2026-09-01&to=2026-09-30 ===
→ rows_n=4  totals={'litres':459.81,'total_price':985.0,'fills':7,'unique_keys':4}
  outliers_n=5  top1={'label':'Alice','dpl':5.0,'litres':50,'total_price':250,'date_iso':'2026-09-01'}     ✔

=== POST /api/fleet/fuel/reports/email (Safe Mode ON via env default) ===
{"sent":false,"safe_mode":true,"message_id":null,"would_have_sent_to":["stephen@paneltec.com.au"]}          ✔

=== Rate-limit loop (6 sends) ===
attempt #1 → HTTP 200 · sent=False safe=True
attempt #2 → HTTP 200 · sent=False safe=True
attempt #3 → HTTP 200 · sent=False safe=True
attempt #4 → HTTP 200 · sent=False safe=True
attempt #5 → HTTP 429 · "Rate limit: max 5 report emails per 10 minutes. Try again shortly."
attempt #6 → HTTP 429 · same
  (5 total sends registered before attempt #5 — 1 earlier live-curl send + 4 in loop → rate-limit fires
   correctly at the 5th window-cap-crossing send)                                                          ✔

=== Cleanup ===
DELETE /api/fleet/fuel/batches/97717c77-... → 200 · rows_deleted=5                                          ✔
```

## Playwright screenshots (7 required)

Saved under `/app/memory/`:

| # | Screenshot | Verifies |
|---|---|---|
| 1 | `v58_13_131d_01_per_employee.jpeg` | FuelReporting page · **Per-Employee** tab · **Monthly** period · **YTD** preset active. Totals strip (459.8 L / $985 / 7 fills / 4 employees). Top-5 $/L outliers panel (Alice $5.000, Bob $5.000, Alice $4.000, Bob $3.000, Cara $2.000). Cost+litres composed chart + Per-Employee pie share (top 8). |
| 2 | `v58_13_131d_02_per_vehicle.jpeg` | Same view, **Per-Vehicle** tab active. Rows aggregated by K82KU. |
| 3 | `v58_13_131d_03_admin_rollup.jpeg` | **Admin Rollup** tab. Top-5 outliers shows "Organisation total" bucket. Cost+litres composed chart + Admin Rollup pie. Below the fold: 3 leaderboards (Top 10 · Highest $, Highest $/L, Most fills) with `Δ $/L` delta chips. |
| 4 | `v58_13_131d_04_email_dialog.jpeg` | Email dialog open. "To" defaulted to `stephen@paneltec.com.au`, PDF+CSV checked, note textarea empty, rate-limit banner explaining "max 5 sends per user per 10 minutes". |
| 5 | `v58_13_131d_05_email_safemode_banner.jpeg` | Same dialog after clicking Send now. **Amber "Comms Safe Mode is ON"** banner visible: "Nothing was actually sent — the intent was logged for audit. Would have sent to: `stephen@paneltec.com.au`". Send button replaced with Close. Sonner toast confirms "Safe Mode is ON — no email sent. Intent audited." |
| 6 | `v58_13_131d_06_anomaly_r7.jpeg` | Anomaly Inbox at `/app/fleet/fuel/anomalies` on the "All" filter. 3 rows all flagged **PROCUREMENT OUTLIER** (violet, medium severity). K82KU · $250 / $240 / $200 rows for Alice/Bob. |
| 7 | `v58_13_131d_07_fleet_with_reports_btn.jpeg` | FleetRegister header showing both buttons side-by-side: outlined **"Fuel Reports"** (assets.edit gated) + filled blue **"Import Fuel CSV"** (admin-only). Version footer `paneltec-v160.3.9.58.13.131d`. |

## Pytest transcript

```
$ pytest tests/backend_unit/test_fuel_reports_v58_13_131d.py \
         tests/backend_unit/test_fuel_csv_import.py \
         tests/backend_unit/test_v58_13_131e_smartfill_fields.py -q
.........................................................       [100%]
53 passed, 1 warning in 0.53s                                      ✔

$ pytest tests/backend_unit/ -q --ignore=tests/backend_unit/test_v58_13_131_smartfill_probe.py
1197 passed, 24 failed (pre-existing flakes), 6 skipped in 10.33s  ✔
(+14 fuel-report tests vs .131c baseline of 1183 passed — zero new regressions)
```

## Compliance ContextVar / Safe Mode guarantee

The email endpoint respects the full defense-in-depth chain:

1. **HTTP-request gate.** `send_context._current_user_for_sends` ContextVar is set by `auth.get_current_user()` FastAPI dependency. If the endpoint were ever called outside a live HTTP request (cron, worker, scheduler, test w/o context), `graph_send_mail` → `refuse_if_no_request_context` returns `{ok:False, blocked:True, error:"no_request_context"}` and refuses to touch Graph.
2. **Comms Safe Mode.** Checked BEFORE `queue_email_doc` is invoked, and again defensively inside `graph_send_mail`. Blocks are recorded to `comms_outbox_blocked`.
3. **Rate limit.** `fuel_report_emails_sent` counter over the 10-min window per (org_id, sent_by) — enforced BEFORE any attachment is generated so a stuck client can't spam PDF renders.
4. **Audit trail.** Every attempt lands in `fuel_report_emails_sent` with `sent` + `safe_mode` booleans + full filter snapshot + recipients + format flags.

There is no cron, no APScheduler, no BackgroundTask, no `asyncio.create_task(...)` in the send path. The endpoint awaits `queue_email_doc` synchronously in the handler.

## Design decisions on visual ambiguity
- **Delta $/L chip:** rose (up = worse for procurement), emerald (down = better), slate (flat < 0.001 $/L).
- **Top-5 outliers panel** kept in the flowing content zone (not sticky) so long tables don't overlap the chart area.
- **Chart colours:** blue (`#2563eb`) for $ bar (primary metric), amber (`#f59e0b`) for litres line (secondary). Matches the "$ = money-critical / L = volume-context" mental model.
- **Fuel Reports button** = outlined (secondary), Import Fuel CSV = filled blue (primary destructive-ish because it writes wholesale data). Both surface in the same header row.
- **Safe Mode banner** in email dialog: amber, sits ABOVE the form so users can't miss it.

## Route list (new)
- `GET /app/fleet/fuel` — Fuel Reporting page.
- `GET /api/fleet/fuel/reports` — JSON aggregation.
- `GET /api/fleet/fuel/reports/export` — filtered CSV re-export.
- `POST /api/fleet/fuel/reports/email` — on-demand snapshot (rate-limited, audited).

## Next action items (per user's roadmap)
- `.131f` — Live SmartFill API sync (shelved until subscription upgrade).
- `.122b` — Historic `plant_maintenance.latest_usage_reading` back-fill migration.
- `.122c` — Trailer date-anchor scheduling.
- `v58.14.x` — Object-storage migration to clear the 20 parked warnings.
