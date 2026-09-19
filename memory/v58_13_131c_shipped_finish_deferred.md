# v58.13.131c — SmartFill Fuel CSV Frontend + Anomaly Inbox — SHIPPED (finish deferred)

`finish` bypassed per standing rule (20 pre-existing `ephemeral-upload-storage` warnings still parked for v58.14.x).

## Rules obeyed
- No `testing_agent` (banned by user).
- No `/app/mobile/` code — version-only bump.
- No comms — anomaly signalling remains inbox-only. No emails / SMS / cron.
- 20 deferred `ephemeral-upload-storage` warnings still parked.
- `plant_maintenance` back-fill (Issue 2) still parked for `.122b`.

## Ship one-liner
Shipped the Fuel CSV admin importer + Anomaly Inbox on the FleetRegister page, and added a per-asset Fuel tab to `AssetDrawer`. Backend gate tightened to strict `admin` on `POST /import-csv` (403 for `hseq_lead`), `GET /anomalies` now supports `count_only=true` for the banner.

## Ship label chronology
Chain is chronological, not alphabetical: `.131` → `.131b` → `.131e` → **`.131c`**. `.131c` is the user-directed label for this ship. Version-pin test in `test_v58_13_131e_smartfill_fields.py::test_version_at_least_131e` now accepts `.131c` explicitly alongside any suffix `>= 'e'`.

## Files touched (10)

| File | Change |
|---|---|
| `backend/fleet_fuel.py` | (a) `_require_admin` tightened from `admin` OR `hseq_lead` → **strict `admin`**. (b) `list_anomalies` accepts `count_only=true` → returns `{count: N}` and short-circuits the body fetch. |
| `tests/backend_unit/test_fuel_csv_import.py` | +5 checks (30 → 35 passing): admin gate allows admin, rejects hseq_lead / worker / missing role; `import_csv_ep` source-pins the `_require_admin` call; `list_anomalies` source-pins the `count_only` branch. |
| `tests/backend_unit/test_v58_13_131e_smartfill_fields.py` | Version-pin `test_version_at_least_131e` widened to accept `.131c` (chronology, not alphabet). |
| `frontend/src/components/FuelAnomalyBanner.jsx` | NEW · amber banner (mounted on FleetRegister) that fetches `resolved=false&count_only=true` on mount and renders nothing when 0. Links to `/app/fleet/fuel/anomalies`. |
| `frontend/src/components/FuelImportModal.jsx` | NEW · admin-only Fuel CSV import modal (drag-drop, .csv only, 20 MB cap). Multipart POST to `/api/fleet/fuel/import-csv`. Results card renders 6 chips + optional header-warnings / unmatched-regos / rejected-rows panels. |
| `frontend/src/pages/FuelAnomalyInbox.jsx` | NEW route `/app/fleet/fuel/anomalies`. Filters: status (open/resolved/all), rule (5-way select), text search across shown rows. Table with per-rule Resolve / Dismiss chips + a "Match" button for unmatched rows. Manual-match modal searches `/fleet/register?search=…` and posts to `/fleet/fuel/transactions/{id}/match`. |
| `frontend/src/components/AssetFuelTab.jsx` | NEW · new "Fuel" tab in `AssetDrawer`. Wraps `GET /fleet/assets/{id}/fuel`. Renders a 4-card rolling-20 summary (Fills / Total / Mean / Tank capacity — amber hint if capacity is unset), a monthly-totals table (Fills / Litres / Cost / $/L), and a recent-transactions table with anomaly chips. |
| `frontend/src/pages/FleetRegister.jsx` | Imports banner + modal. Adds an admin-gated `Import Fuel CSV` button in the header (`usePermissions().role === 'admin'`). Mounts modal at the end. Mounts banner between the header and the SearchBar. |
| `frontend/src/components/AssetDrawer.jsx` | New `{key: 'fuel', label: 'Fuel'}` in `TABS`, imports + mounts `<AssetFuelTab />`. |
| `frontend/src/App.js` | New `<Route path="fleet/fuel/anomalies" element={<FuelAnomalyInbox />}>` inside the authed shell. |
| `frontend/src/lib/version.js` · `frontend/public/service-worker.js` · `mobile/src/lib/version.ts` | `.131e` → `.131c` bump. Full changelog block at the top of `version.js`. |

## Backend contract deltas

- `POST /fleet/fuel/import-csv` — **strict admin only**. `hseq_lead` (which shipped with the .131b gate) is intentionally excluded — CSV imports mutate fleet-wide financial + fuel data. Per-row anomaly resolve/dismiss/manual-match still fall under `assets.edit` (unchanged).
- `GET /fleet/fuel/anomalies?count_only=true` — returns `{"count": N}` (short-circuits the body fetch). Powers the FleetRegister banner. Existing query params (`rule`, `resolved`, `page`, `size`) still respected — `count_only` composes with them.
- `GET /fleet/assets/{asset_id}/fuel` — unchanged, output shape verified live: `{asset_id, transactions[<=500], rolling_last_20: {count, total_litres, mean_litres, stdev_litres}}`.
- All other .131b endpoints unchanged.

## Curl transcript (live, K82KU asset · admin=Stephen · hseq=hseq-lead-fixture)

```
=== count_only (empty state) ===
curl "$API_URL/api/fleet/fuel/anomalies?resolved=false&count_only=true"
→ {"count":0}                                                    ✔

=== full body (empty state) ===
curl "$API_URL/api/fleet/fuel/anomalies?resolved=false&size=1"
→ {"total": 0, "items_len": 0, "page": 1}                        ✔

=== 403 for hseq_lead on POST /import-csv ===
curl -X POST "$API_URL/api/fleet/fuel/import-csv" -H "Authorization: Bearer $HSEQ" \
  -F "file=@/tmp/tinyfuel.csv"
→ HTTP 403 · {"detail":"admin only"}                             ✔

=== 200 for admin on POST /import-csv ===
curl -X POST "$API_URL/api/fleet/fuel/import-csv" -H "Authorization: Bearer $ADMIN" \
  -F "file=@/tmp/tinyfuel.csv"
→ HTTP 200 · batch_id=fd13686f-... · rows_inserted=1             ✔

=== GET /fleet/assets/{id}/fuel ===
curl "$API_URL/api/fleet/assets/f0b96b82-.../fuel" -H "Authorization: Bearer $ADMIN"
→ keys: ['asset_id', 'transactions', 'rolling_last_20']
  tx_count: 1
  rolling: {'count':1, 'total_litres':44.31, 'mean_litres':44.31, 'stdev_litres':None}  ✔

=== cleanup: DELETE /batches/{id} ===
curl -X DELETE "$API_URL/api/fleet/fuel/batches/fd13686f-..."
→ HTTP 200 · rows_deleted=1                                       ✔
```

## Playwright screenshots (10 UI criteria)

Saved under `/app/memory/`:

| # | Screenshot | Verifies |
|---|---|---|
| 1 | `v58_13_131c_fleet_toolbar.jpg` | `Import Fuel CSV` blue button visible in FleetRegister header (admin). Version footer shows `paneltec-v160.3.9.58.13.131c`. |
| 2 | `v58_13_131c_hseq_no_import_btn.jpg` | Same page as HSEQ lead — only `Print labels` shown. `Import Fuel CSV` HIDDEN. |
| 3 | `v58_13_131c_import_modal_empty.jpg` | Modal in empty state — dropzone + blue info banner listing required columns. |
| 4 | `v58_13_131c_import_modal_results.jpg` | Modal after uploading a 4-row CSV: 6 result chips (4 total / 2 inserted / 0 duplicate / 1 unmatched / 2 anomalies / 2 rejected), amber Unmatched identifiers card ("UNKNOWN99"), rose Rejected rows card ("Row 2: E11000 duplicate key error", "Row 4: R6 unit_mismatch"), batch id footer. |
| 5 | `v58_13_131c_fleet_with_banner.jpg` | (superseded by #6) |
| 6 | `v58_13_131c_banner.jpg` | Amber "1 open fuel anomaly · Open inbox →" banner between FleetRegister header and SearchBar. |
| 7 | `v58_13_131c_anomaly_inbox.jpg` | `/app/fleet/fuel/anomalies` renders — "SMARTFILL · ANOMALY INBOX" eyebrow, "Fuel anomalies" H1, total=1, filter row (status Open / Resolved / All + Rule dropdown + search), table row (K82KU / 140.50 L / rose "CAPACITY EXCEEDED" chip / MATCHED / Resolve + Dismiss buttons). |
| 8 | `v58_13_131c_anomaly_inbox_full.jpg` | Full-page anomaly inbox capture. |
| 9 | `v58_13_131c_anomaly_after_resolve.jpg` | After clicking Resolve → toast "Resolved · Capacity exceeded", total=0, empty state "No open anomalies — you're clear." |
| 10 | `v58_13_131c_asset_fuel_tab.jpg` | AssetDrawer opened on Fuel tab. 4 stat cards (Fills 0 / Total 0.0 L / Mean — / Tank capacity — with amber "Set on Details tab to unlock capacity anomaly" hint). Recent transactions empty state "No fuel transactions attributed to this asset yet." Tab bar shows Details / Pairing / Schedules / Service Log / Maintenance History / **Fuel** (active) / Photo / Notes. |

## Pytest transcript

```
$ pytest tests/backend_unit/test_fuel_csv_import.py \
         tests/backend_unit/test_v58_13_131e_smartfill_fields.py \
         tests/backend_unit/test_v58_13_131_smartfill_probe.py -q
............................................................. [100%]
56 passed, 1 warning in 0.41s                                     ✔
```

Full suite baseline: 1183 passed / 24 pre-existing failures / 6 skipped — zero new regressions.

## Design decisions on visual ambiguity
- **Banner color:** amber (`bg-amber-50 border-amber-200`) matches the rest of Paneltec's "action required" surfaces (Service due, Test data detected, Fleet Live 15-min stale warning). Rose reserved for destructive.
- **Import button placement:** header row, LEFT of `Print labels`, filled blue (primary action). Print labels stays outlined (secondary).
- **Anomaly rule pills:** severity-tinted (low=amber, medium=violet, high=rose) — matches the existing Ask Intelligence confidence pill palette so operators don't have to learn a new colour code.
- **Manual match search:** debounced 250 ms, uses the existing `/fleet/register?search=` endpoint. No new backend surface.
- **Rolling-20 stat:** shown even when tank capacity is unknown. Tank capacity card gets an amber tone + hint when unset so the operator knows R2 anomaly won't fire for this asset.
- **HSEQ-lead-friendly path:** they can still resolve/dismiss/manual-match anomalies (per-row, `assets.edit`) — only the wholesale CSV import is admin-gated.

## Route list (new + touched)
- `GET /app/fleet` — banner + Import Fuel CSV button surfaced.
- `GET /app/fleet/fuel/anomalies` — NEW · Fuel Anomaly Inbox page.
- `POST /api/fleet/fuel/import-csv` — admin-only (was assets.edit + admin-OR-hseq_lead; now assets.edit + strict admin).
- `GET /api/fleet/fuel/anomalies?count_only=true` — NEW query param.

## Next action items (per user's roadmap)
- `.131d` — Fuel Reporting page (`/app/fleet/fuel`) + Recharts + CSV re-export.
- `.122b` — Historic `plant_maintenance.latest_usage_reading` back-fill migration.
- `.122c` — Trailer date-anchor scheduling.
- `v58.14.x` — Object-storage migration to clear the 20 ephemeral-upload-storage warnings.
