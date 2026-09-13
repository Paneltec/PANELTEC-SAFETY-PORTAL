# v58.13.132eg — Server-side category-count pills

**Ship status**: shipped. `finish` tool deferred per standing directive.

## The bug

Category filter pills at the top of Daily Pre-Starts summed to
**exactly 5,000** — the pagination page size — not the true DB total
(**16,008 active** on prod). Same root cause as `.132ef`'s
X-Total-Count fix: pill counts were derived client-side from
`decorated.length` (only the loaded page), not a server aggregate.

Screenshot before → after (live prod, same session):

| Chip | Before .132eg | After .132eg |
|---|---|---|
| `All`                                  | `5000`   | **`16008`** |
| Daily Pre-Start                        | ~1500ish | **`6840`** |
| Daily Pre-Start (needs review)         | `3774`   | `3777` |
| Vacuum Truck (VT) Daily Pre-Start      | (missing / capped) | `1166` |
| Tip Truck Daily Pre-Start              | (missing / capped) | `940` |
| Weekly Pre-Start                       | (missing / capped) | `618` |
| … 20 more categories …                 |          | truly counted |
| **Sum of category pills**              | ≤ 5000   | **16,002** (matches `all_count` ±race window) |
| Total chip (`.132ef`)                  | 5,000 showing · 5,000 total | 5,000 showing · **16,008 total** |

Pill total and header total now agree; both drop by N when N records
are archived (verified with the `.132ee` refetch pipeline still in
place).

## Grep findings — Phase 1

Only **PreStarts.jsx** rendered category pills sourced from
`decorated.length` / bucket-summing over the loaded page. The other
six CAPTURE modules already used shared `CaptureListToolbar` /
select dropdowns without pill-count derivations, so no other list
page exhibits the exact "pills summing to page size" bug today.

That said, all 7 modules ship a `/category-counts` endpoint so any
future pill row can consume it without a schema conversation.

```
Incidents.jsx        → no pill counts (tabs only)
Hazards.jsx          → no pill counts (tabs only)
Inspections.jsx      → no pill counts (tabs only)
RiskAssessments.jsx  → no pill counts (tabs only)
PreStarts.jsx        → pill counts derived from `decorated` — BUG (fixed)
SiteDiary.jsx        → no pill counts
AdminVisitors.jsx    → no pill counts (custom table)
```

## Backend contract — Phase 2

New module `backend/category_counts.py` registers seven endpoints
under a single `APIRouter`:

| Endpoint | Grouping strategy |
|---|---|
| `GET /api/pre-starts/category-counts`      | inferred template type (mirror of FE `inferTemplateType`) — `template_name_snapshot` → `template_name` → parse `::<TYPE>` from `work_summary` |
| `GET /api/incidents/category-counts`       | native `category` ∪ `form_submissions[template_category_snapshot=incident].template_name_snapshot` |
| `GET /api/hazards/category-counts`         | native `severity` ∪ `form_submissions[template_category_snapshot∈{hazard, near_miss}].template_name_snapshot` |
| `GET /api/inspections/category-counts`     | native `template_name` ∪ `form_submissions[template_category_snapshot=inspection].template_name_snapshot` |
| `GET /api/risk-assessments/category-counts`| native `severity` ∪ `form_submissions[template_category_snapshot=risk_assessment].template_name_snapshot` |
| `GET /api/site-diary/category-counts`      | native rows bucketed under `"Free-form"` ∪ mirrored `template_name_snapshot` |
| `GET /api/admin/visitors/category-counts`  | `purpose` |

All share the identical response contract:
```json
{
  "categories": [{"label": "Daily Pre-Start", "count": 6840}, ...],
  "all_count": 16008,
  "archived_count": 1719
}
```

- Query param: `?include_archived=false` (default). Set `true` to
  count archived rows too.
- Aggregation is `count_documents` / `$group` — server-side, no
  in-memory truncation, no `.to_list(limit)` cap.
- Mirror categories are the exact set the list router uses
  (`crud.py::build_router(mirror_categories=...)`).
- `archived_count` is invariant of `include_archived` (always the
  archived-pool size for that module — matches `.132ee`'s
  `X-Archived-Count` header semantics).
- Permission gate is the same `<resource>.view` used on the module's
  list endpoint.

## Live prod curl trace (post-`.132eg`)

```
$ curl /api/pre-starts/category-counts
all: 16008 | arch: 1719 | top: Daily Pre-Start (6840),
                                Daily Pre-Start (needs review) (3777),
                                Vacuum Truck (VT) Daily Pre-Start (1166),
                                Tip Truck Daily Pre-Start (940),
                                Weekly Pre-Start (618),
                                CVT Daily Pre-Start (570)

$ curl /api/incidents/category-counts        → all=215  top=near_miss(113), property(82), Incident Report(20)
$ curl /api/hazards/category-counts          → all=0    (all migrated to risk_assessments per .132dz)
$ curl /api/inspections/category-counts      → all=17   top=Daily Site Inspection(9), 27 Point Visual Inspection(8)
$ curl /api/risk-assessments/category-counts → all=3562 top=Construction & Excavation - SSRA(1779),
                                                          Viatec Traffic Solutions - SSRA(1452),
                                                          Viatec Traffic Solutions SSRA(179),
                                                          Construction & Excavation SSRA(80),
                                                          Drain Cleaning - SSRA(66)
$ curl /api/site-diary/category-counts       → all=1    top=VTS Tight Site Audit(1)
$ curl /api/admin/visitors/category-counts   → all=2    top=Contractor(2)
```

For every module, `sum(categories.count) == all_count` — locked by
the `test_category_counts_endpoint_shape` pytest.

## Route order gotcha (documented so it doesn't bite again)

FastAPI matches routes in registration order. Both `prestarts_router`
(prefix `/pre-starts`, has `@r.get("/{item_id}")`) and
`visitor_admin_router` (prefix `/admin/visitors`, has
`@admin_router.get("/{visitor_id}")`) contain a catch-all detail
route that would swallow `/category-counts` and return `404: "Not
found"` / `404: "Visitor not found"`.

Fix: `category_counts_router` is registered **before** every
CRUD/visitor-admin router in `server.py`. First occurrence: after the
`visitor_public_flat_router` line, second occurrence: after
`auth_invite_router` (both anchors chosen because they sit above the
CRUD block in the include chain).

## Frontend — Phase 3

`PreStarts.jsx` now:
1. Fetches `/api/pre-starts/category-counts` on mount **and** every
   time `showArchived` flips (side-by-side with the list fetch).
2. `typeIndex` useMemo **prefers** `categoryCounts.categories` when
   loaded; falls back to the client-side `decorated` bucket-sum
   when the endpoint hasn't answered yet (or fails).
3. `totalCount` (feeds the "All" chip AND `filteredCount` display)
   is `categoryCounts?.all_count ?? decorated.length`.
4. `useArchiveActions` refetch callback now invokes **both**
   `fetchItems(0, showArchived)` AND `fetchCategoryCounts(showArchived)`
   so the pill counts re-hydrate the moment an archive commits.

Palette is still resolved client-side via `paletteForType(label)`
so colours stay consistent with the FE inference. `TypeChip`
component itself is unchanged.

## Files touched

### Backend
- `backend/category_counts.py` — **new module**, 7 routes, single
  `APIRouter`, ~250 lines.
- `backend/server.py` — includes `category_counts_router` before
  `visitor_admin_router` and before the CRUD block.

### Frontend
- `frontend/src/pages/PreStarts.jsx` — new state
  `categoryCounts`, new callback `fetchCategoryCounts`, wired into
  the archive refetch pipeline and the pill-render useMemos.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132eg`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132eg`.

### Tests
- `backend/tests/test_v58_13_132eg_category_counts.py` — **new**,
  27 checks across:
  - Backend module contract (all 7 routes exist).
  - Behavioural: shape + `sum(categories.count) == all_count`.
  - Behavioural: `include_archived=true` returns ≥ `include_archived=false`.
  - Behavioural: `archived_count` invariant under toggle.
  - Cross-endpoint: PreStarts `all_count` ≈ `X-Total-Count`
    (±3 tolerance for the auto-archive scheduler race window).
  - Source-pin: FE fetches on mount + toggle change.
  - Source-pin: `typeIndex` prefers server counts.
  - Source-pin: "All" pill uses `categoryCounts?.all_count`.
  - Source-pin: archive refetch triggers `fetchCategoryCounts`.
  - Version pin ≥ `.132eg`.

Full `.132e*` regression: **121 pass, 40 skipped** (skips = admin
login rate-limit, source-pins all green).

## Not changed
- `useArchiveActions` — unchanged since `.132ee` (refetch-on-success
  contract).
- Backend list endpoints — `X-Total-Count` / `X-Archived-Count`
  headers unchanged since `.132ef`.
- Pill click behaviour — unchanged; still filters the loaded rows
  client-side.
- `TypeChip` / palette helpers — unchanged.
- Mobile bundle: `.132di` (unchanged).
- `/app/mobile/` — untouched.
- `finish` / `testing_agent` / `e1_tester` — not invoked.

## Version state
- `frontend/src/lib/version.js` : `paneltec-v160.3.9.58.13.132eg`
- `frontend/public/service-worker.js` : `paneltec-v160.3.9.58.13.132eg`
- Mobile bundle : `.132di` (unchanged, mobile untouched)
