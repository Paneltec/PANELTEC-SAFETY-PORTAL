# v58.13.132bz — Fuel UI hardening bundle (5 issues)

**Status:** SHIPPED · finish tool deferred.
**Version pins:** RUNNING_VERSION / EXPECTED_CACHE_VERSION / SW CACHE_VERSION → `paneltec-v160.3.9.58.13.132bz`.

## Issues

| # | Report | Root-cause | Fix |
|---|---|---|---|
| 1 | Bulk Dismiss/Resolve "processes only 50 at a time" | `bulkAction` was correctly sending the full selection in ONE call — but `PAGE_SIZE=50` meant only 50 checkboxes were on screen. The `.132bw` "Select all N matching" affordance existed but was hidden until the user checked at least one row. | New amber **pre-selection banner** above the table that surfaces `Showing 50 of N matching · [Select all N matching →]` whenever `total > filtered.length` and nothing is selected yet. One click populates selection with the full match set (up to 2000) → one API call, not 50-at-a-time. |
| 2 | Top 5 $/L outliers table missing rego | `top_dpl_outliers_real` rows exposed `label` = `Organisation total` for every row (admin scope collapses to org-total). Rego wasn't in the payload. | Backend: new `_resolve_regos_for_txns(org_id, txn_ids)` helper populates `linked_rego` + `inferred_rego` per outlier (formal `asset_id` → linked; else CSV `registration` → inferred; else null). Frontend: new Rego column between SCOPE and LITRES, emerald bold for linked, violet italic bold for inferred, `—` for null. |
| 3 | `$` clipped on Top 10 Highest $ leaderboard | The `inferred` chip added in `.132bu` widened the label cell (max-w-[220px]) and pushed the $ column into the truncation zone. | Chip label `inferred` → `inf.` (5 chars vs 8), tighter padding (`px-1 py-0` vs `px-1.5 py-0`), and `whitespace-nowrap` on the $ column. Max-width dropped to `170px` in leaderboards, `180px` in the outlier variant. |
| 4 | XT16AB row in Per Employee / Per Vehicle tabs no longer opens drilldown | The main scoped-table `<tr>` in `FuelReporting.jsx` used to be non-interactive (no onClick handler was ever wired — `.132bo` added click-handlers only to the admin `<Leaderboard>` component). | Per-row `onClick` now restored: for single-card rows, fires `setDrawerCard(cards[0])` → opens the same `SmartFillCardDrawer` as the leaderboards. Non-card rows stay non-clickable. Hover + `cursor-pointer` + title tooltip communicate the affordance. |
| 5 | `Card 21301 (unlinked)` legacy format still surfacing | `_key_label` in `fleet_fuel_reports.py` was still building `f"Card {card} (unlinked)"` (with parens). This label bled through to Per Employee / Per Vehicle tables (which read `row.label` verbatim) and to the outlier table. | (a) Backend: `_key_label` now emits `f"Card {card} · unlinked"` (middle-dot). (b) `_aggregate` runs the full `linked_rego`/`inferred_rego` cascade on EVERY row before returning (not just leaderboards) — same batch pattern as `.132bu` but pulled up one level. (c) Frontend: Per-row rendering in the main scoped table now applies the identical `displayLabel` cascade used by leaderboards. |

## Files changed
| File | Change |
|---|---|
| `backend/fleet_fuel_reports.py` | `_key_label`: parens → middle-dot. New `_resolve_regos_for_txns` helper. `_aggregate`: batch-resolves `linked_rego` + `inferred_rego` on every row before return. `_leaderboards`: now a thin slicer (dedup'd the enrichment logic). `top_dpl_outliers_real` rows now carry `linked_rego` + `inferred_rego`. |
| `frontend/src/pages/FuelReporting.jsx` | Per-row cascade + onClick restored for the main scoped table. Outlier table gains a Rego column. Leaderboard chip shortened to `inf.`, metric column gets `whitespace-nowrap`, max-widths tightened to prevent clipping. |
| `frontend/src/pages/FuelAnomalyInbox.jsx` | New amber **pre-selection banner** that renders when `selected.size === 0 && total > filtered.length && filtered.length > 0`. Testids `fuel-anomaly-preselect-banner` + `fuel-anomaly-preselect-select-all`. |
| `frontend/src/lib/version.js` + SW | Version bump. |
| `backend/tests/test_v58_13_132bz_fuel_ui_hardening.py` | **NEW** — 9 pytests covering all 5 issues. |

## Root-cause explanation (bulk batch-size + popup regressions)

- **"Bulk processes 50 at a time"** was a *discoverability* bug, not a chunking bug. `.132bw` correctly raised the backend cap to 2000 and added a "Select all matching" link — but the link only appeared after a user checked at least one row. Stephen's workflow was: tick 50 checkboxes on page 1 → click Bulk Resolve → done. Never saw the link. `.132bz` fixes this by surfacing the affordance *before* the first selection, in an amber banner that reads `Showing 50 of 813 matching · Select all 813 matching →`.
- **"Per Employee popup broken"** was a *never-existed* regression. The click handler was never present on the scoped-table rows — `.132bo` added it to the admin `<Leaderboard>` component only. Stephen was likely remembering an older prototype or expecting parity with the (new) leaderboard behaviour. `.132bz` grants him that parity.

## Pytest
```
============================== 9 passed in 1.79s ==============================
```
Regression sweep (`.132bo` + `.132bp` + `.132bq` + `.132bu` + `.132by` + `.132bz`): 50 passed, 1 skipped, 5 errors (all 429 login rate-limit failures — Stephen's account throttles under parallel test-fixture setup; not a functional regression, individually all pass).

## Screenshots (live, verified)

- `/app/memory/v58_13_132bz_01_preselect_banner.jpeg` — Anomaly Inbox with amber pre-selection banner: `Showing 50 of 813 matching transactions. [Select all 813 matching →]`.
- `/app/memory/v58_13_132bz_02_after_select_all_from_preselect.jpeg` — post-click: sticky black bar shows `813 transactions selected`, all checkboxes ticked, toast `Selected 813 matching transactions.` in the top-right.
- `/app/memory/v58_13_132bz_03_leaderboard_no_clip.jpeg` — Fuel Reports Top 10 · Highest $ shows `Card 21314 · XT02AX  inf.   $1483.77` with the full 4-digit dollar visible (no clip). Rows 1-10 all render cleanly with cascade labels including `Card 21310 · unlinked · $870.27` (issue 5 verified).
- `/app/memory/v58_13_132bz_04_outlier_rego_column.jpeg` — Top 5 · $/L outliers table with new Rego column. Console verified `outlier-0 rego cell: 'XT16AB'`.
- `/app/memory/v58_13_132bz_05_per_employee_click_opens_drawer.jpeg` — Per Employee tab, row click on a single-card row fires the SmartFillCardDrawer.

Console output:
```
Issue 1 preselect banner visible: True
  banner text: 'Showing 50 of 813 matching transactions.\nSelect all 813 matching →'
  after click, bulk count: '813 transactions selected'
Issue 3 lb-cost row-0 text: '1\tCard 21314 · XT02AX  inf.\t$1483.77\t—'
Issue 2 outlier-0 rego cell: 'XT16AB'
```

## NOT changed
- No hard deletes of `fuel_transactions`.
- No mobile touched.
- No new backend endpoint (all 5 fixes are in existing `/reports` + one FE-only banner).
- `MAX_BULK` remains at 2000 (from `.132bw`).
- The 5 `.132bp` regression errors during parallel batch runs are login rate-limits, tracked separately.

## Backlog carried forward
- Login rate-limiting bites during large parallel `pytest` sweeps. Options: raise the auth backoff, add a `pytest-xdist`-aware token pool, or introduce a service-account bearer for test-only.
- Formal card→vehicle linker (`POST /fleet/register/formalise-card-links` — nominated in `.132by` memo) still open.
- Delete orphaned `FuelAnomalyBanner.jsx` file (unused since `.132bw`).
- Permission-matrix "preview as role" P1 500 toast (from `.132bn`).
