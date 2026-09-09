# v58.13.132ca — Bulk action truncation fix (header select-all now select-all-matching)

**Status:** SHIPPED · finish tool deferred.
**Version pins:** RUNNING_VERSION / EXPECTED_CACHE_VERSION / SW CACHE_VERSION → `paneltec-v160.3.9.58.13.132ca`.

## Root cause

Backend was **never** truncating. Curl reproducer with 300 seeded txns → `bulk-resolve` writes `resolved_at` on all 300 in one call. `matching-ids` returns 713 of 713 (not 50).

The bug was UX: the **header select-all checkbox** was `togglePageAll` (visible page only = 50 rows). Stephen ticked it, saw `50 transactions selected`, clicked Bulk Resolve → 50 processed. Correct code, wrong mental model. The `.132bz` amber pre-select banner solved this for users who noticed it, but Stephen kept reaching for the header checkbox.

## Fix

`togglePageAll` now promotes to `selectAllMatching` when `total > filtered.length`. Also added a `CROSS-PAGE` amber badge next to the bulk-count so cross-page selections are unmistakable.

## Files changed
- `frontend/src/pages/FuelAnomalyInbox.jsx` — `togglePageAll` promotes; new `fuel-anomaly-bulk-cross-page-badge` testid.
- `frontend/src/lib/version.js` + SW — version bump.
- `backend/tests/test_v58_13_132ca_bulk_action_truncation_fix.py` — **NEW**, 5 pytests including the 300-row backend reproducer.

## Pytest
```
============================== 5 passed in 2.89s ==============================
```
1. `test_bulk_resolve_300_flags_no_truncation` — seed 300, POST bulk-resolve once, assert all 300 have `resolved_at`.
2. `test_matching_ids_not_page_scoped` — assert `len(ids) == min(total, 2000)`.
3. FE source pins for promotion + cross-page badge.
4. Version.

## Playwright verification (live)
- `/app/memory/v58_13_132ca_01_header_promotes_to_all_matching.jpeg` — after clicking header checkbox: `713 transactions selected · CROSS-PAGE` badge visible, every row on the page ticked, sticky bar with Bulk Resolve / Dismiss / Attribute / Clear.
- `/app/memory/v58_13_132ca_02_after_bulk_resolve.jpeg` — after Bulk Resolve click: `TOTAL MATCHES` dropped **713 → 0** in one click. Toast reads `Resolved · 713 transactions` with `Undo`.

## Item 1 — Workspaces vs Sites: read-only investigation

**Files / routes**
- `frontend/src/pages/Workspaces.jsx` — mounted at `/app/settings/workspaces`.
- `frontend/src/pages/SitesAdmin.jsx` — mounted at `/app/sites`.

**Collections**
- `workspaces` — 11 live rows across ALL orgs. Paneltec org has ONE row (`Work Admin`, `default_for_org=true`). Every other org has a `Default workspace` row created on org bootstrap. Effectively: **workspace = org**.
- `sites` — **0 rows in the entire DB**. Empty collection.
- `simpro_sites` — 2 live rows for Paneltec org: `Paneltec Depot @ 19 Connector Park Drive`, `New Paneltec Depot @ 30 Remount Road`. These are the "Depots" Stephen means.

**Consumers of `workspace_id`**
- `pre_starts`: **16,624** rows.
- `swms`: 30. `hazards`: 22. `inspections`: 19. `incidents`: 13. `assets`: 4. `fuel_transactions` + `jobs`: 0.

**Consumers of `site_id`** — **0 across every collection.**

**Verdict**
- The `sites` collection is unused; `SitesAdmin.jsx` reads from `simpro_sites`.
- `workspaces` is effectively a per-org default (`Work Admin` for Paneltec). Stephen's read is correct: it's a duplicate of the org record with an extra address blob.
- The **real** "depots" data lives in `simpro_sites`.

**Proposed merge shape** (for Stephen's approval before code changes):
1. **Keep `simpro_sites`** as the canonical depots collection. Rename it to `sites` at the API layer (`GET /api/sites`) but leave the collection name to avoid breaking Simpro sync.
2. **Retire `workspaces`** — migrate the single `Work Admin` row's address/branding fields into `orgs.default_site_address` (or attach to `simpro_sites` for Paneltec org).
3. **`workspace_id` FKs** — 16,624 pre-starts + a few hundred other rows need to be either:
   - re-pointed to `site_id` (would need bidirectional migration), OR
   - the `workspace_id` field re-labelled as `site_id` since all workspaces are effectively 1:1 with the default site.
4. **Sidebar nav** — collapse `Settings → Workspaces` into `Compliance → Sites`. Keep `Sites` as the surviving label.
5. **Permission gates** — no permission is currently keyed on workspace vs site. Both use org-scoped `assets.*` / `sites.*` gates.

Awaiting Stephen's go-ahead before touching code.
