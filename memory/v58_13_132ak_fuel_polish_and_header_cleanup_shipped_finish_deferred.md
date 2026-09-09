# v58.13.132ak — Fuel polish + header cleanup + SmartFill auto-sync live

**Ship status:** SHIPPED (finish deferred).
**Comms Safe Mode:** ON (unchanged — auto-sync is a scheduled data-pull, no outbound comms).
**Batch scope:** web + backend only. Mobile untouched.

---

## Fix A — SmartFill auto-sync ENABLED

**Env flip:**
- Appended `SMARTFILL_AUTO_SYNC_CRON=1` to `/app/backend/.env` (idempotent — grep-guarded).
- `sudo supervisorctl restart backend` → clean restart, pid 10979.

**Registration verified in the boot log:**
```
2026-09-08 01:14:43,636 | INFO | paneltec.smartfill.cron |
  APScheduler job registered — smartfill_auto_sync_cron at 06:00 Australia/Brisbane daily
```

**Live endpoint state (after restart):**
```
GET /api/fleet/fuel/smartfill-status →
{
  "auto_sync_enabled": true,           ← per-org toggle already ON
  "cron_registered":   true,           ← ← NEW (was false in .132aj)
  "last_synced_at":    "2026-09-08T01:01:38.765613+00:00",
  "last_batch_summary": {rows_inserted:0, rows_duplicate:0, rows_anomalous:0, rows_rejected:1, ...}
}
```

Card in the UI now shows the emerald `ENABLED` pill and the line *"Runs daily at 06:00 Australia/Brisbane."* (see screenshot below). Next scheduled run: **Wed 09/09/2026 06:00 AEST** (06:00 Australia/Brisbane, no DST → 20:00 UTC 08/09).

**Note:** The most recent manual sync (from earlier today) returned `rows_rejected: 1` — this is the known P1 backlog item *"SmartFill manual sync endpoint rejected 1/1 rows"*. Auto-sync is now scheduled and will run daily; the row-rejection bug is unaffected by this batch and still tracked separately.

---

## Fix B — Per-Employee / Per-Vehicle / Admin Rollup tables

**Column swap:** `Fills` **removed**, `Last fill` **added** (2nd column, right after label).

**Default sort:** `Last fill` desc — most recently fuelled entity at the top. Live output (Per-Vehicle, last-week):

```
XT16AB          · last_fill=2026-09-05 · litres=425.65
Daniel Butler   · last_fill=2026-09-05 · litres=35.78
XT42BN          · last_fill=2026-09-04 · litres=223.49
XT02AX          · last_fill=2026-09-04 · litres=181.03
L10QF           · last_fill=2026-09-04 · litres=119.45
...
```
SORT_OK: True across all 33 vehicles.

**Backend (`fleet_fuel_reports.py::_aggregate`):**
- Each rollup bucket now tracks `_latest_date_iso` + `_latest_timestamp` (updates on every fill via lexicographic string compare — ISO ordering ≡ chronological).
- Row payload gains `latest_fill_date_iso` + `latest_fill_timestamp`.
- Row sort: `key=(latest_fill_date_iso, total_price)`, `reverse=True`.

**Frontend (`FuelReporting.jsx` main rows table):**
- Header row: `{Scope}` · **Last fill** · Litres · Cost · Avg fill (L) · Avg L/100km · $/L · Δ $/L.
- New per-row test-id `fuel-reporting-row-last-fill-{key}`.
- Empty cell renders em-dash if `latest_fill_date_iso === ""`.

Applies to all three scope tabs (Per-Employee, Per-Vehicle, Admin Rollup) uniformly — same aggregation path.

---

## Fix C — Top 5 · Highest fills subtitle + range pill

- Subtitle line added directly under the panel title: *"Highest single fills within the selected range."*
- Range pill added top-right of the panel: **`31/08/2026 – 06/09/2026`** (formatted `DD/MM/YYYY`, honours the current `from`/`to` filter state).
- test-id: `fuel-reporting-highest-range-pill`.
- Zero behavior change — clarity only.

---

## Fix D — Header cleanup

**Investigation (as requested):**
- **Search input** (`topbar-search`) — was a placeholder since v54; tooltip literally said *"Full search UI queued for v54."* Never wired to any endpoint. Removed entirely.
- **Workspace switcher** (`workspace-switcher`) — load-bearing across 4 pages (Dashboard, AuditExports, Contractors, Ask) via `useWorkspace()` / `wsParams()`. Not safe to fully delete. Instead:
  - Stephen's org actually has **1** workspace (`156f06df-…` "Work Admin"). With a single workspace, the "All / Work Admin" choice is a no-op and just clutters the header.
  - New conditional: `showSwitcher = workspaces.length > 1`. Multi-tenant plumbing preserved; switcher reappears the moment a 2nd workspace is provisioned via Settings → Workspaces.

**Result** (screenshot `/tmp/ak_header_clean.png`):
```
Paneltec Civil │ [sidebar toggle]  │  [notifs] [Import PDFs] [API 3/5] [Backup] [Comms Safe ON 157] [Stephen ▼]
```
No Search input, no workspace pill. Playwright confirms: `SEARCH_present=0, WS_switcher_present=0`.

**Load-bearing hooks preserved:**
- `useWorkspace()` in Dashboard.jsx / AuditExports.jsx / Contractors.jsx / Ask.jsx — untouched.
- `wsParams(workspaceId)` behavior unchanged (defaults to `{}` for `workspaceId==='*'`).
- Restore path for both if needed: revert the two `search_replace` diffs in `AppShell.jsx` — full JSX preserved via git history + explicit comment breadcrumbs.

---

## Fix E — CSV export column swap

**`fleet_fuel_reports.py::_stream_aggregated` header + row output:**

Before:
```
<Scope>,Litres,Total price,Fills,Avg fill (L),$/L,Delta $/L (vs prev)
Organisation total,3856.19,11568.57,45,85.69,3.0,
```

After:
```
Vehicle,Last fill,Litres,Total price,Avg fill (L),$/L,Delta $/L (vs prev)
XT16AB,2026-09-05,425.65,1276.95,141.88,3.0,
Daniel Butler,2026-09-05,35.78,107.34,35.78,3.0,
XT42BN,2026-09-04,223.49,670.47,74.5,3.0,
```

Full metadata block still prepended (Report range, Scope, Period, Generated, Generated by, Latest txn on file). `?detail=1` (per-fill) mode already has a `Date` column per fill — unchanged.

---

## Version bumps

| Constant | Old | New |
|---|---|---|
| `RUNNING_VERSION` | `paneltec-v160.3.9.58.13.132aj` | `paneltec-v160.3.9.58.13.132ak` |
| `EXPECTED_CACHE_VERSION` | `paneltec-v160.3.9.58.13.132aj` | `paneltec-v160.3.9.58.13.132ak` |
| `CACHE_VERSION` (service-worker.js) | `paneltec-v160.3.9.58.13.132aj` | `paneltec-v160.3.9.58.13.132ak` |
| `MOBILE_BUNDLE_VERSION` | `paneltec-v160.3.9.58.13.132ai` | **unchanged** |

---

## Pytest

New file: `backend/tests/test_v58_13_132ak_fuel_polish.py` — 5 asserts.
Also patched one `.132aj` assertion to match the swapped CSV header.

```
$ python -m pytest tests/test_v58_13_132ak_fuel_polish.py \
                  tests/test_v58_13_132aj_fuel_reporting.py \
                  tests/test_v58_13_132ah_range_delivery.py \
                  tests/test_v58_13_132af_apk_downloads.py -v

tests/test_v58_13_132ak_fuel_polish.py::test_rows_include_latest_fill_date_iso           PASSED
tests/test_v58_13_132ak_fuel_polish.py::test_rows_default_sort_is_latest_fill_desc       PASSED
tests/test_v58_13_132ak_fuel_polish.py::test_employee_scope_also_sorted_by_last_fill     PASSED
tests/test_v58_13_132ak_fuel_polish.py::test_csv_export_swaps_fills_column_for_last_fill PASSED
tests/test_v58_13_132ak_fuel_polish.py::test_smartfill_cron_registered_after_env_flip    PASSED
tests/test_v58_13_132aj_fuel_reporting.py  (7 tests)                                     PASSED
tests/test_v58_13_132ah_range_delivery.py  (6 tests)                                     PASSED
tests/test_v58_13_132af_apk_downloads.py   (1 test)                                      PASSED

============================== 19 passed in 5.13s ==============================
```

---

## Screenshots

- **`/tmp/ak_header_clean.png`** — Dashboard header without Search or workspace switcher.
- **`/tmp/ak_fuel_vehicle_lastfill.png`** — Per-Vehicle tab with SmartFill card showing `ENABLED` emerald pill + *"Runs daily at 06:00 Australia/Brisbane."* Top 5 · Highest fills with subtitle *"Highest single fills within the selected range."* and range pill `31/08/2026 – 06/09/2026`.
- **`/tmp/ak_fuel_employee_lastfill.png`** — Per-Employee tab, same treatment.

Full page renders now sort rows by last-fill desc (verified live: `05/09/2026, 05/09/2026, 04/09/2026, ...`).

---

## Files touched

**Backend:**
- `backend/fleet_fuel_reports.py` — bucket tracks `_latest_date_iso`/`_latest_timestamp`; row payload adds `latest_fill_date_iso`/`latest_fill_timestamp`; row sort by newest fill; CSV aggregated export column swap.
- `backend/.env` — appended `SMARTFILL_AUTO_SYNC_CRON=1` (idempotent).

**Frontend:**
- `frontend/src/pages/FuelReporting.jsx` — main rows-table header swap + new `Last fill` cell; Top 5 subtitle + range pill.
- `frontend/src/components/layout/AppShell.jsx` — search input removed; workspace switcher conditional tightened to `workspaces.length > 1`.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` bumps.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bump.

**Tests:**
- `backend/tests/test_v58_13_132ak_fuel_polish.py` (new, 5 asserts)
- `backend/tests/test_v58_13_132aj_fuel_reporting.py` — one assertion updated for the CSV column swap

**Docs:**
- `memory/v58_13_132ak_fuel_polish_and_header_cleanup_shipped_finish_deferred.md` (this memo)

Zero mobile changes. Zero DB migrations. Zero new dependencies.

---

## Instructions for Stephen (retest)

1. Hard-refresh once (SW `CACHE_VERSION` bumped).
2. Open any page — header now shows **no Search box, no workspace pill** (workspace switcher hidden while you only have 1 workspace; it'll reappear automatically if you create a 2nd via Settings → Workspaces).
3. Go to **Fleet & Service Register → Fuel reports**:
   - SmartFill Auto-sync card at top now shows **ENABLED** (emerald) with *"Runs daily at 06:00 Australia/Brisbane."*
   - Click **Per-Vehicle** or **Per-Employee** — table now leads with `Last fill` column and sorts newest-first. Top row is the most recently fuelled entity.
   - **Top 5 · Highest fills** panel now has the *"Highest single fills within the selected range"* subtitle and shows the active range as a pill (top-right).
   - Click **Export CSV** — file now has `Last fill` column instead of `Fills`.
4. Cron reality check: at 06:00 tomorrow (Brisbane), the daily sync will fire automatically. The card's `Last synced` timestamp will update without manual intervention. Watch for the notification bell — the cron emits `smartfill_auto_sync` notifications when a batch inserts or when it fails.

---

## Known P1 followup (unchanged, out of scope for `.132ak`)

The last manual sync returned `rows_rejected: 1, rows_inserted: 0` — SmartFill API returns a shape the row-mapper rejects. This is your existing backlog item *"SmartFill API auto-sync pipeline validation (P1)"* / *"SmartFill manual sync endpoint rejected 1/1 rows"*. Auto-sync scheduling doesn't unblock this — the cron will keep failing at row-mapping until we fix that specifically. Recommended next batch when you're ready.

---

## Standing backlog (carried forward)

- Multi-select rows + Print-selected on Workers tab (P2)
- BOM forecast max/min + rain probability on mobile home (P2)
- Details modal for accepted-job hero Details button (P2)
- iOS TestFlight wire-up (waiting on Apple Developer account) (P2)
- **SmartFill row-rejection bug** (P1 — auto-sync scheduling is now live but rows still reject at mapping stage)
- Invite email dead-end (P2 · comms_safe_mode blocks M365)
- Parked `ephemeral-upload-storage` lints for v58.14.x
- Sentry crash reporting for mobile if `.132ai` still misbehaves
