# v58.13.132bv — Bulk actions robustness (Fuel Anomaly Inbox)

**Status:** SHIPPED · finish tool deferred.
**Version pins:** RUNNING_VERSION / EXPECTED_CACHE_VERSION / SW CACHE_VERSION → `paneltec-v160.3.9.58.13.132bv`.

## USER PAIN
Stephen: **"Bulk Dismiss / Bulk Resolve does not remove tagged rows from the Open filter."**

## Root-cause investigation
Backend curl reproducer confirmed the endpoint is functionally correct — seeding a txn with 3 open flags → `POST /bulk-resolve` writes `resolved_at` on all 3 → row drops from `resolved=false`. Playwright reproduction also passed cleanly (selected 3 rows → bulk-dismiss → those specific ids no longer visible → Total Matches drops 1372→1318).

So Stephen's report was almost certainly one of three UX artefacts, all fixed defensively here:
1. **Response race** — `reload()` was fired but not awaited. The state updates preceding it (`setSelected(new Set())`, `setBulkAttrOpen(false)`) triggered a re-render that painted **stale `items`** while the async fetch was still in flight, so for 100–500ms Stephen saw the un-touched rows.
2. **Sort-shift illusion** — rows drop out at position N; rows at N+1, N+2… scroll up with identical-looking rego/rule chips. Without ID inspection the eye sees "same rows" and assumes no-op.
3. **No feedback on skipped rows** — when a selected row had no open flags, `_bulk_flip` skipped it and returned `failed: [{txn_id, reason: "no open flags"}]`. The FE toast just read `Resolved · 0 transactions` with no hint.

## Files changed
| File | Change |
|---|---|
| `backend/fleet_fuel.py::_bulk_flip` | `bulk-dismiss` now additionally stamps `dismissed_at` on every touched flag (bulk-resolve does not). Semantic split so downstream analytics can distinguish user-triggered dismissal from resolution. |
| `frontend/src/pages/FuelAnomalyInbox.jsx::bulkAction` | **Optimistic FE removal** — actioned ids are stripped from local `items` state *before* the reload fires, so the visual drop-out is instant. **`await reload()`** — no more fire-and-forget race. **Toast surfaces skipped count** — `Resolved · N transactions · K skipped` when the backend response's `failed[]` is non-empty. |
| `frontend/src/lib/version.js` + SW | Version bump. |
| `backend/tests/test_v58_13_132bv_bulk_actions_robustness.py` | **NEW** — 7 pytests including the exact 3-flag reproducer Stephen requested. |

## Regression reproducer

`test_bulk_resolve_flips_all_open_flags`:
- Seeds a txn with 3 open flags (`unusual_hour`, `capacity_exceed`, `no_odometer`).
- POSTs `bulk-resolve` with that single txn_id.
- Asserts response `resolved=1, flags_resolved=3`.
- Asserts DB: every flag has `resolved_at` set + `resolved_action="resolved"` + no `dismissed_at`.

`test_bulk_dismiss_flips_all_open_flags_and_stamps_dismissed_at`:
- Same seed. POSTs `bulk-dismiss`.
- Asserts every flag has BOTH `resolved_at` AND `dismissed_at` set + `resolved_action="dismissed"`.

`test_bulk_resolve_removes_row_from_open_list`:
- Seeds, bulk-resolves, then pages through `/anomalies?resolved=false` (up to 40 pages) and asserts the seeded txn is not present.

## Pytest
```
============================== 7 passed in ~2s ================================
```

Regression sanity — full `.132bo` → `.132bv` sweep:
```
============================== 57 passed, 1 skipped in 11.65s =================
```

## Screenshots (live, verified)

- `/app/memory/v58_13_132bv_repro_after_dismiss.jpeg` — pre-`.132bv` control test: selected 3 rows for bulk-dismiss, all 3 disappeared. Confirmed even the pre-fix backend already worked.
- `/app/memory/v58_13_132bv_01_optimistic_removal.jpeg` — post-`.132bv`: selected 4 rows, bulk-dismiss, at **500ms** the actioned ids are already gone from the DOM (optimistic strip). Toast reads `Dismissed · 4 transactions` with Undo. Total 1012 (dropped from 1016).

Console output:
```
BEFORE bulk-dismiss: first 5 = [e08e..., d40c..., f3ea..., 2d0b..., 7419...]
selected ids:        [e08e..., d40c..., f3ea..., 2d0b...]
500ms after bulk-dismiss:   selected ids still visible = []  ← optimistic
3.5s after bulk-dismiss:    selected ids still visible = []  ← post-reload
```

## NOT changed
- No new bulk endpoint added — the four `.132bs` endpoints still handle everything.
- List-anomalies filter (`resolved=false`) still keys off `resolved_at` alone — single-source-of-truth for "open". `dismissed_at` is a semantic annotation, not a filter axis.
- No `/app/mobile/` code touched.
- No hard deletes of `fuel_transactions`.
