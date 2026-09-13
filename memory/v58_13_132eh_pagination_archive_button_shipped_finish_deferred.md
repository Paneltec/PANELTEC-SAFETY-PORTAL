# v58.13.132eh — Pagination controls + ArchiveDialog button-enable fix

**Ship status**: shipped. `finish` tool deferred per standing directive.

## Issue 1 — "how do i see the other after 5000"

Backend `_list_impl` slotted its result cap at `limit=5000` (bumped in
`.132ea` after the `.132dz` migration exposed the previous default of
100 as actively harmful). Nice for a single page, terrible for orgs
holding >5k rows: Pre-Starts prod has ~16k active + 1.7k archived
records, so ~11k were unreachable via the UI.

### Fix

Adds `offset` on both list endpoints + a `PaginationBar` FE component:

- **Backend `crud.py::list_items`** — accepts `?offset=<int, ge=0>` and
  applies `.skip(offset).limit(limit)` on the base cursor. Mirror
  union (`form_submissions`) is skipped when `offset > 0` (documented:
  interleaving two heterogeneous sorted streams isn't stable enough
  for pagination and mirror rows are a small fraction of the base
  collection anyway).
- **Backend `visitor_signins.py::admin_list_visitors`** — same
  treatment (offset param + `.skip(offset)`).
- **Frontend `PaginationBar.jsx`** — new component with:
  - **Load more (N)** button showing next-page size; disables when
    exhausted.
  - **Page size** dropdown (100 · 500 · 1000 · 5000), default 5000.
  - **Persistence** via `usePersistedPageSize(storageKey, default)`
    → localStorage per module (`pre-starts:pageSize`, etc.).
  - **Count** display: `N of M` (always uses `X-Total-Count`).
- Wired into every CAPTURE list page: `PreStarts`, `Incidents`,
  `Hazards`, `Inspections`, `RiskAssessments`, `SiteDiary`,
  `AdminVisitors`. Each defines a `load(includeArchived, offset,
  size, append=false)` callback; `onLoadMore` passes
  `items.length` as the next offset and `append=true` to concat
  rather than replace. Archive commit refetch always resets to
  `offset=0, append=false` so counts stay consistent.

### Non-overlap proof (backend)

```
GET /api/pre-starts?limit=3&offset=0  → ids = [d2f59afa, d06ccdaa, dfc466a6]
GET /api/pre-starts?limit=3&offset=3  → ids = [cb70be28, 264d8faf, 2d2f4e09]
                                        overlap = ∅ ✓
GET /api/pre-starts?limit=10&offset=5000 → HTTP 200, 10 rows,
                                            X-Total-Count: 16008
```

### Live UI proof (Playwright screenshot)

```
pager visible:     1
load-more label:   "Load more (5,000)"
page-size value:   5000
count text:        "5,000 of 16,008"
```

## Issue 2 — Archive button doesn't enable

### Root cause
`ArchiveDialog` gated the commit on **both** a completed `Preview`
call AND `preview.matched_count > 0`. Stephen clicked Oldest 1000
expecting the Archive button to arm — nothing lit up because Preview
hadn't been clicked first. The UX assumed a two-step ritual that
wasn't communicated.

Also, the Preview button itself had no gate — you could send an empty
`criteria` dict to the server and get "matched_count: total_rows"
back, which would happily archive everything. Bad affordance.

### Fix
Compute `hasAnyCriteria = Object.keys(criteria).length > 0` and gate
BOTH buttons on it:

- **Preview**: `disabled = busy || !hasAnyCriteria`
- **Commit**:  `disabled = busy || !hasAnyCriteria || (preview && preview.matched_count === 0)`

The commit no longer HARD-requires a preview. Preview stays available
as an optional dry-run, but the Archive button lights up the moment
any single criterion is set. The confirm step already shows the
match count when Preview has run; when it hasn't, the confirm now
falls back to "…matching your criteria (no preview run)" so the user
still knows what they're doing.

### Live UI proof (Playwright)

```
BEFORE any criteria — preview disabled: True
BEFORE any criteria — commit  disabled: True
AFTER "Oldest 1000" click →
  preview disabled: False
  commit  disabled: False
  commit label:     "Archive…"
```

Also visible in screenshot #2: "Oldest 1000" pill highlighted blue,
Archive button amber-active (was grey before).

## Files touched

### Backend
- `backend/crud.py` — new `offset: int = Query(0, ge=0)` param on
  `list_items`; `_list_impl` propagates it through the cursor's
  `.skip(offset).limit(limit)`; mirror union skipped when `offset > 0`.
- `backend/visitor_signins.py` — `admin_list_visitors` accepts
  `offset`; cursor uses `.skip(offset)`.

### Frontend
- **NEW** `frontend/src/components/PaginationBar.jsx` — Load-more
  button + page-size selector + `usePersistedPageSize()` hook.
- `frontend/src/components/ArchiveDialog.jsx` — `hasAnyCriteria`
  guard; Preview + Archive buttons re-gated; confirm-step fallback
  message when preview is null.
- `frontend/src/pages/PreStarts.jsx` — pager, `onLoadMore`,
  `pageSize` state, `fetchItems(attempt, includeArchived, offset,
  size, append)` signature.
- `frontend/src/pages/Incidents.jsx` — same pattern via `load()`.
- `frontend/src/pages/Hazards.jsx` — same.
- `frontend/src/pages/Inspections.jsx` — same.
- `frontend/src/pages/RiskAssessments.jsx` — same (only Submissions
  tab renders the pager).
- `frontend/src/pages/SiteDiary.jsx` — same.
- `frontend/src/pages/AdminVisitors.jsx` — same, page-size clamped
  to `min(pageSize, 500)` because the visitor list endpoint caps
  `limit=500`.
- `frontend/src/lib/version.js` — bumped to `.132eh`.
- `frontend/public/service-worker.js` — bumped to `.132eh`.

### Tests
- `backend/tests/test_v58_13_132eh_pagination_archive_button.py` —
  **29 checks**:
  - Behavioural: `?offset=` returns non-overlapping page on
    `/api/pre-starts`.
  - Behavioural: `?offset=5000` returns rows past the old cap.
  - Source-pin: `visitor_signins.py::admin_list_visitors` accepts
    `offset` and applies `.skip(offset)`.
  - Source-pin: `crud.py::list_items` accepts `offset` and cursor
    uses `.skip(offset).limit(limit)`.
  - Source-pin: `PaginationBar` component contract (load-more btn,
    page-size selector, count display, `usePersistedPageSize`,
    localStorage writes, all 4 page-size options).
  - Source-pin: every one of the 7 CAPTURE pages imports the pager
    and `usePersistedPageSize`.
  - Source-pin: every page renders `<PaginationBar/>` with the
    correct `testidPrefix` and per-module `storageKey`.
  - Source-pin: every page wires an `onLoadMore` callback that
    passes the current row count as the next offset.
  - Source-pin: `ArchiveDialog` derives `hasAnyCriteria` from
    `Object.keys(criteria).length > 0`.
  - Source-pin: Preview button `disabled` includes `hasAnyCriteria`.
  - Source-pin: Commit button `disabled` includes `hasAnyCriteria`
    AND does NOT hard-require `!preview`.
  - Source-pin: Confirm step handles missing-preview case.
  - Version pin ≥ `.132eh`.

Full `.132e*` regression: **148 passed, 42 skipped** (skips = admin
login rate-limit; source-pins all green).

## Live UI verification screenshots

1. **Pager on Pre-Starts bottom**:
   ```
   [ Load more (5,000) ]  5,000 of 16,008          Page size [5,000 ▾]
   ```
2. **ArchiveDialog after clicking Oldest 1000**:
   ```
   1. Date range
   2. Oldest N (optional cap)   [Oldest 100] [Oldest 200] [Oldest 500] ▶[Oldest 1000]◀
                                                                       ^^^^^^^^^^^^ blue-active
   [Cancel]                     [Preview]   ▶[Archive…]◀
                                             ^^^^^^^^ amber-active
   ```

## Not changed
- `useArchiveActions` — unchanged; refetch pipeline still fires on
  archive success paths as of `.132ee`.
- `TotalCountChip`, `ShowArchivedToggle`, `TypeChip` components —
  unchanged.
- `category_counts.py` endpoints — unchanged; still power the
  category pills post-pagination.
- Mobile bundle: `.132di` (unchanged).
- `/app/mobile/` — untouched.
- `finish` / `testing_agent` / `e1_tester` — not invoked.

## Version state
- `frontend/src/lib/version.js` : `paneltec-v160.3.9.58.13.132eh`
- `frontend/public/service-worker.js` : `paneltec-v160.3.9.58.13.132eh`
- Mobile bundle : `.132di` (unchanged, mobile untouched)
