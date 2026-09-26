# v58.13.132n3 — SWMS `asset_kinds` visibility branch + admin legacy-scope audit widget

## TL;DR

Two `.132kn` follow-ups from the memo's own list land as `.132n3`:

- **B2** (follow-up #4): Add a 6th branch to
  `swms_visibility_filter` matching `applies_to.asset_kinds`
  against the `kind` of each asset a worker is assigned to.
  Live data (Paneltec Pty Ltd) has one SWMS with
  `applies_to.asset_kinds: ['plant']` (Concrete/Asphalt Cutting)
  which was silently invisible to plant operators before this
  ship.
- **B1** (follow-up #2): Read-only admin audit widget on the
  SWMS Assignments page. Reports the count of SWMS in the org
  that currently rely on the legacy-null "visible to everyone"
  fallback, with a "Review" CTA that jumps the admin to the
  first sample so they can tag it via the existing editor.

Bonus (defensive correctness): `_clean_applies_to` in
`swms_extras.py` now preserves `asset_kinds` on writes. Pre-`.132n3`
that cleaner silently dropped the field on any
`PUT /assignments/*` round-trip — losing tags admins or bulk-
importers had set.

## What NOT to do (from investigation)

The task brief's naive hypothesis — "add `team_id`/`org_id`
filter to every SWMS read + backfill" — was rejected during
investigation:

1. `org_id` scoping is already in `crud._scoped()` (base
   filter for every list + detail read).
2. `.132kn` deliberately replaced the pre-existing broken
   `TEAM_SCOPED_RESOURCES` creator-narrowing with an
   `applies_to`-matrix scheme (WHS Reg 39 compliant).
3. Live-fire proves no cross-org leakage: stephen@paneltec
   (Paneltec Pty Ltd) sees exactly his org's 14 active SWMS
   and gets 404 on a Paneltec Civil SWMS id.

Re-adding a `team_id` narrowing on top of that would re-
introduce the compliance gap. See the investigation report
handed back to the user in the previous turn.

## B2 — `applies_to.asset_kinds` branch

### The visibility contract (post-`.132n3`)

A worker sees a SWMS when ANY of the following are true:

| # | Match | Data source |
|---|-------|-------------|
| 1 | `applies_to` null / missing / literal `{}` | Legacy default — 34/51 live SWMS org-wide fall here |
| 2 | `applies_to.roles` ∋ `role_id` or `role` (case-insensitive) | JWT + user doc |
| 3 | `applies_to.worker_ids` ∋ user id | JWT |
| 4 | `applies_to.asset_types` ∩ `workers.assigned_asset_type_ids` | `workers` collection |
| 5 | `applies_to.company_ids` ∋ `workers.simpro_company_id` | `workers` collection |
| 6 | **NEW** `applies_to.asset_kinds` ∩ `assets.kind` for any asset in `workers.assigned_asset_ids` | `workers` + `assets` collections |

Branch 6 fires **only** if the worker has at least one
assigned asset — otherwise it's omitted from the `$or`
entirely (verified by
`test_filter_omits_asset_kinds_branch_when_no_kinds`) so
we don't emit `{$in: []}` clutter.

### Query cost

One extra `db.assets.find({id: {$in: [...]}, kind: exists})`
per non-privileged SWMS list call. `assets.id` is indexed;
worker's `assigned_asset_ids` is typically 1-10 rows.
Amortised sub-ms.

## B1 — Legacy-scope audit widget

### Backend
`GET /api/admin/swms/legacy-scope-count` — admin-gated
(`role == "admin"`; 403 for anyone else, verified live).

Response shape (JSON):
```json
{
  "org_id":                 "<uuid>",
  "count":                  11,
  "count_effectively_null": 0,
  "total_active":           14,
  "ttl_seconds":            60,
  "sample_ids":             ["<id1>", ..., "<id5>"]
}
```

- `count` — SWMS where `applies_to` is null / missing / `{}`.
- `count_effectively_null` — SWMS where `applies_to` is a
  present object but every array inside is empty. These are
  ALSO admin-tagging targets, but visually distinct: the admin
  DID try to tag them and left them incomplete.
- `sample_ids` — up to 5 ids across both buckets so the FE
  can offer a "Review the first one" jump.

Live at ship time (Paneltec Pty Ltd): `{count: 11,
count_effectively_null: 0, total_active: 14}` — matches the
`.132kn` audit distribution.

### Frontend
`frontend/src/components/swms/SwmsLegacyScopeAuditCard.jsx`
— compact amber card rendered above the SWMS Assignments
grid. Shows the ratio (`N of X SWMS need a coverage matrix
(P%)`) and a "Review the first one" CTA that sets the parent
page's `selectedId` state → the existing editor opens on
that SWMS. Hidden entirely when `count + count_effectively_null == 0`,
or on any API error (403 for non-admin).

Read-only. Never mutates any SWMS. All tagging still flows
through the existing `PUT /admin/swms/assignments/*` endpoint.

## Bonus defensive fix — `_clean_applies_to` preserves `asset_kinds`

`swms_extras.py:_clean_applies_to` was stripping any keys not
in `{roles, worker_ids, company_ids, asset_types}`. Live data
already has one SWMS with `asset_kinds: ['plant']` set from a
seed / bulk-import path. Any admin round-trip through the
Assignments editor would have silently dropped that field —
turning the SWMS invisible to the new branch 6 matcher, which
is worse than not having the branch at all.

Post-`.132n3`:
```python
def _clean_applies_to(raw: dict) -> dict:
    return {
        "roles":        [str(x) for x in (raw.get("roles") or [])],
        "worker_ids":   [str(x) for x in (raw.get("worker_ids") or [])],
        "company_ids":  [str(x) for x in (raw.get("company_ids") or [])],
        "asset_types":  [str(x) for x in (raw.get("asset_types") or [])],
        "asset_kinds":  [str(x) for x in (raw.get("asset_kinds") or [])],  # .132n3
    }
```

## Files touched

- `backend/permissions_scope.py` — expanded the contract
  block-comment (branch 6 rationale), added `asset_kind_slugs`
  worker-enrichment lookup, added branch 6 to the `$or`.
- `backend/swms_extras.py` — new `GET /admin/swms/legacy-scope-count`
  endpoint (admin-gated), `_clean_applies_to` preserves
  `asset_kinds`.
- `backend/tests/test_v58_13_132n3_swms_asset_kinds_branch.py`
  — 8 test cases (see below).
- `frontend/src/components/swms/SwmsLegacyScopeAuditCard.jsx`
  — new component.
- `frontend/src/pages/SwmsAssignmentsAdmin.jsx` — imports
  and renders the audit card above the existing origin note.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `.132n3`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `.132n3`.
- `memory/v58_13_132n3_swms_asset_kinds_and_audit.md` —
  this memo.

## Verification

### Unit tests
```
pytest tests/test_v58_13_132n3_swms_asset_kinds_branch.py -v
========================= 8 passed, 1 warning in 0.25s ==========================
```

- `test_plant_worker_sees_plant_swms` — branch 6 fires on
  plant kind ✅
- `test_vehicle_only_worker_does_not_see_plant_swms` —
  vehicle-only worker excluded ✅
- `test_no_worker_row_no_branch_6` — user without a `workers`
  row doesn't match via branch 6 ✅
- `test_role_branch_still_matches` — role branch overrides
  missing branch 6 match ✅
- `test_empty_asset_kinds_does_not_match` — empty-arrays
  applies_to matches nothing (the exact case the audit
  widget surfaces to admins) ✅
- `test_filter_includes_asset_kinds_branch_for_plant_worker`
  — structural check on the returned Mongo filter ✅
- `test_filter_omits_asset_kinds_branch_when_no_kinds` —
  no `{$in: []}` clutter when the worker has no assets ✅
- `test_no_branch_6_regression_on_role_only_swms` — role
  branch still works after adding branch 6 ✅

Every test cleans up its own sandboxed `test-org-<uuid>`
rows in the fixture teardown. Guarded by conftest's
`live_db_writes` marker (opted in at module scope) and the
`production_db_guard` autouse fixture (which blocks any
write to `*@paneltec.com.au` accounts).

### Live-fire (pod)
```
$ curl /api/admin/swms/legacy-scope-count (admin JWT)
→ 200
  {
    "org_id": "3116f250-a4eb-43f3-98a5-2a3656d6cb63",
    "count": 11,
    "count_effectively_null": 0,
    "total_active": 14,
    "ttl_seconds": 60,
    "sample_ids": [<5 uuids>]
  }

$ curl /api/admin/swms/legacy-scope-count (worker JWT)
→ 403  {"detail": "Admin only"}   ← gating verified

$ curl /api/swms?limit=5000 (admin JWT)
→ 200  14 rows                    ← non-regression on the main list
```

### Frontend compile
```
[frontend] webpack compiled successfully
[frontend] Compiled successfully!
```

## Not touched

- `/app/mobile/*` — banned.
- SWMS creation / import paths (`swms_router` build_router
  entry point in `crud.py` — the ONLY change relevant to the
  filter is the branch composition in `permissions_scope`).
- `_is_privileged` short-circuit in `crud._list_impl` — admin
  and hseq_lead still bypass the whole helper.
- Existing branches 1-5 — untouched, non-regression covered.
- The `asset_types` semantics — branch 4 stays keyed on
  slugs from `workers.assigned_asset_type_ids`; branch 6 is
  the coarser "kind" facet.
- Sidebar / navigation — audit widget renders inline within
  the existing SWMS Assignments page.

## Known limitations

- `count_effectively_null` was 0 in live data at ship time —
  the widget's split between "null" and "effectively null"
  is defensive against future writes that create empty-array
  `applies_to` objects. The bucket exists so we don't
  accidentally under-report.
- No auto-refresh polling on the widget. The `ttl_seconds: 60`
  hint on the response is FE-side advisory; refetch happens
  on page mount only. If admins want a live-updated count as
  they tag SWMS in the editor, a follow-up ship can add a
  `useEffect` re-fetch on save.
- Widget is admin-only per the backend gate. Managers /
  hseq_leads see nothing today. Extending the audit surface
  to those roles is a separate scope decision.
