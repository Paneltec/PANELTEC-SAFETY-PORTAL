# v58.13.132bw — Banner removal + bulk scale + Select-all-matching

**Status:** SHIPPED · finish tool deferred.
**Version pins:** RUNNING_VERSION / EXPECTED_CACHE_VERSION / SW CACHE_VERSION → `paneltec-v160.3.9.58.13.132bw`.

## USER PAIN
1. `.132bt` planted the canonical Fuel Anomaly entry-point on the Fuel Reports page. The pre-existing `FuelAnomalyBanner` at the top of `Fleet & Service Register` was now a duplicate cluttering the header.
2. Bulk Dismiss/Resolve felt like it "processed ~50 at a time" — investigation confirmed NO frontend chunking; `PAGE_SIZE=50` just limited how many checkboxes were on screen at once. Selection was page-scoped only.

## Files changed
| File | Change |
|---|---|
| `frontend/src/pages/FleetRegister.jsx` | Removed `import FuelAnomalyBanner` and the `<FuelAnomalyBanner />` render call. Left an explicit removal note comment. `FuelAnomalyBanner.jsx` component file itself kept — not referenced anywhere, can be deleted in a future cleanup. |
| `backend/fleet_fuel.py` | `MAX_BULK` raised **500 → 2000**. New `GET /fleet/fuel/anomalies/matching-ids` endpoint returning the flat id list under the current filter set, capped at 2000. Also added `import re` (was missing at module level — used by the new endpoint's search-regex path). |
| `frontend/src/pages/FuelAnomalyInbox.jsx` | New `selectAllMatching()` handler + a "Select all N matching →" link in the sticky bulk bar. Only shows when `total > selected.size` (i.e. there are more matches than the current selection covers). Shows a capped-warning toast when total > 2000. |
| `frontend/src/lib/version.js` + SW | Version bump. |
| `backend/tests/test_v58_13_132bw_banner_removal_and_bulk_scale.py` | **NEW** — 8 pytests. |
| `backend/tests/test_v58_13_132bs_bulk_anomaly_actions.py` | Updated the `>MAX_BULK` guard test from 501 to 2001 to match the new cap. |

## Endpoint contract

```
GET /api/fleet/fuel/anomalies/matching-ids
  ?resolved=<bool>&rule=<str>&search=<str>&limit=<int, max 2000>

200 → {
  "ids":            ["a1b2...", ...],   # sorted by timestamp desc
  "total_matches":  N,
  "capped":         true|false,          # total_matches > limit
  "limit":          <the applied cap>
}
```

`search` runs a case-insensitive regex against `registration`, `driver`, `resolved_driver_name`, `card_number`, `from_site`, `transaction_id`, `description`. Auth: `assets.view`.

Bulk endpoints (`bulk-resolve`, `bulk-dismiss`, `bulk-attribute`, `bulk-reopen`) now accept up to **2000** txn_ids per call.

## Frontend UX

- Bulk bar's second slot (right of the selection-count) now conditionally renders:
  ```
  Select all 963 matching →   (blue-200 hover:white underline)
  ```
- Click triggers `GET /matching-ids` with the current status/rule/search filters, populates `selected`, and shows either:
  - `Selected 963 matching transactions.` toast, or
  - `Selected first 2000 of 2,842 matches — narrow filters to reach the rest.` when capped.
- Existing bulk actions then operate on the full set in a single call.

## Pytest
```
============================== 30 passed in 6.94s ==============================
```
Covers matching-ids happy path + shape lock, capped-flag semantics, rule filter narrows, search filter reduces total, 2000-id batch accepted / 2001 rejected, Fleet Register banner import + render removed, FE Select-all-matching wired, version bump. Plus `.132bs` + `.132bv` regressions.

## Screenshots (live, verified)

- `/app/memory/v58_13_132bw_01_fleet_register_no_banner.jpeg` — Fleet & Service Register page. Header goes straight from the truck hero → **Fuel Reports** CTA → search bar → Fleet Live dashboards. No amber banner. Console confirms `banner on Fleet Register: False`.
- `/app/memory/v58_13_132bw_02_bulk_bar_select_all_matching.jpeg` — 1 row selected, bulk bar shows `1 transaction selected · Select all 963 matching →`. Console: `select-all-matching link visible: True · copy: 'Select all 963 matching →'`.
- `/app/memory/v58_13_132bw_03_after_select_all_matching.jpeg` — After clicking the link, bulk bar shows `963 transactions selected`, every visible row is ticked, and a Sonner toast reads `Selected 963 matching transactions.`.

## NOT changed
- `FuelAnomalyBanner.jsx` component file kept (orphaned but harmless). Removing the file entirely would require a matching audit of any lingering imports — done here via source-pin test.
- The `.132bt` amber banner on `/app/fleet/fuel` is untouched.
- No mobile touched.
- No hard deletes of `fuel_transactions`.
