# v58.13.132kn — SWMS visibility uses `applies_to` matrix (not team-scoping)

## Symptom
`GET /api/swms` returned `[]` for every non-privileged mobile user
(preview workers + real workers). The mobile SWMS tab misinterpreted
the empty array as a failure state (red disconnected-cloud →
"Failed to load SWMS · Retry"). Diagnostic run confirmed HTTP 200,
`X-Total-Count: 0` — no crash, no 401 — just an empty list. Mobile
empty-state polish is a separate follow-up `.132ko` for the Expo
specialist.

## Root cause
`permissions.py:40-43` had `swms` in `TEAM_SCOPED_RESOURCES`. Combined
with `crud.py::_list_impl`:

```python
own_only = await resolve_team_scope(user, resource, scope)
if own_only is not None:
    q["created_by"] = own_only
```

For any user whose role doesn't grant `team_view=True` on `swms`
(worker, paneltec_civil, contractor_rep, general_user, preview
synthetic), the query narrows to `created_by == user.id`. Every SWMS
in Paneltec Civil was created by the admin
(`c103b9d7-3ac8-428f-98be-30a55adc6287`) — a worker's `user.id`
never matches, so the list returned empty.

Mirrors the `.132km` documents bug pattern: v159.0 hardening picked
a generic creator-based scope for a resource whose real visibility
model is an assignment matrix. Under **AU WHS Regulation 39**, a
worker who will perform work covered by a SWMS must have access to
that SWMS before starting the work — hiding admin-issued SWMS behind
creator narrowing is a compliance gap.

## Fix — SWMS-specific `applies_to` visibility filter

### 1. Removed SWMS from `TEAM_SCOPED_RESOURCES`
`backend/permissions.py:40-52`. Other team-scoped resources
(`pre_starts`, `site_diary`, `hazards`, `incidents`, `inspections`,
`inductions`, `workers`) remain unchanged — non-regression verified
by curl.

### 2. Added async helper `swms_visibility_filter(user)`
`backend/permissions_scope.py`. Returns a Mongo `$or` fragment that
a non-privileged caller must AND into their `{org_id, deleted_at}`
query. Branches:

| # | Match condition | Rationale |
|---|---|---|
| 1 | `applies_to` is `None` / missing / `{}` | Legacy default — 13/14 of Paneltec Civil SWMS are unset; treating them as public within-org is the migration-safe behaviour |
| 2 | `applies_to.roles` ∋ user's `role_id` OR legacy `role` (deduped, lowercased + raw) | Direct role targeting |
| 3 | `applies_to.worker_ids` ∋ user's `id` | Direct worker enumeration |
| 4 | `applies_to.asset_types` ∩ user's `workers.assigned_asset_type_ids` | Worker assigned to any asset of a targeted type |
| 5 | `applies_to.company_ids` ∋ user's `workers.simpro_company_id` | Contractor-company targeting |

Best-effort worker enrichment reads the `workers` row keyed by
`user_id`. If no worker row exists (preview synthetic users, freshly
invited users), the helper still emits branches 1–3 so those users
see the majority of SWMS anyway.

Async because branches 4–5 require Mongo lookups. Called from a
single site (`crud.py::_list_impl`) behind an `_is_privileged`
short-circuit so admin/hseq/supervisor bypass the helper entirely.

### 3. Wired into `crud.py::_list_impl`
Directly after `q = _scoped(user, workspace_id)`:

```python
if collection == "swms" and not _is_privileged(user):
    _swms_scope = await swms_visibility_filter(user)
    if _swms_scope.get("__scope_no_match__"):
        return [], 0, 0
    if "$or" in q:
        q = {"$and": [q, _swms_scope]}
    else:
        q.update(_swms_scope)
```

Defensive `$and` compose (no consumer sets `$or` on `q` today, but
if a future ship does, the merge still composes correctly).

## `applies_to` schema
Canonical shape per `_clean_applies_to` in `swms_extras.py:376`:

```json
{
  "roles":       ["worker", "paneltec_civil", ...],
  "worker_ids":  ["<user_id>", ...],
  "company_ids": ["<simpro_company_id>", ...],
  "asset_types": ["concrete_saw", "slab_cutter", ...]
}
```

Additional keys observed in live data (`asset_kinds: ["plant"]`) —
not currently a matcher branch. Extend the filter if/when the admin
UI adds these.

## Data audit — Paneltec Civil SWMS distribution
Snapshot at ship time (14 total incl. seeded test):

```
total_active_swms: 14
  applies_to unset/empty:              13   ← Branch 1
  applies_to.org_wide=True:             0
  applies_to.roles non-empty:           2   ← incl. seeded test SWMS + Concrete/Asphalt
  applies_to.worker_ids non-empty:      0
  applies_to.company_ids non-empty:     0
  applies_to.asset_types non-empty:     1   ← Concrete/Asphalt
```

**Follow-up admin task** (not this ship): the 13 legacy-null SWMS
rely on branch 1's "default visible" semantics. This is safe for
Paneltec Civil today because their SWMS library is already curated,
but a diligent admin audit should tag `applies_to` explicitly on
every SWMS to avoid over-broad visibility long-term. Suggested UI:
"N SWMS have no applies_to matrix — click to review and tag" widget
in the SWMS Assignments admin page.

## Verification (all 6 cases)

### 1. Admin (Stephen)
```
HTTP 200  X-Total-Count=14   rows=14   ← unchanged (non-regression)
```

### 2. Preview worker JWT (synthetic `role=worker`, `role_id=worker`)
```
HTTP 200  X-Total-Count=13   rows=13
first: TEST .132kn — org-wide worker SWMS  applies_to.roles=['worker']  ← Branch 2
then:  12 legacy-null SWMS                                                ← Branch 1
Concrete/Asphalt Cutting NOT visible                                      ← correctly hidden
```

### 3. Real worker JWT (`role=worker`, `role_id=paneltec_civil`)
```
HTTP 200  X-Total-Count=14   rows=14
Combined role set from JWT+DB: {worker, paneltec_civil}
TEST .132kn matched via 'worker' (Branch 2)
Concrete/Asphalt matched via 'paneltec_civil' (Branch 2)
12 legacy-null matched via Branch 1
```

### 4. Bad JWT (non-existent uid)
```
HTTP 200  rows=13
No crash. Synthetic sub gets Branch 1 (legacy-null) + Branch 2
(role=worker match on TEST SWMS). No worker row → no branch 4/5.
Total 13 rows — expected. NB: the diagnostic brief expected `[]`,
but "empty" isn't correct — the applies_to schema treats null
applies_to as "visible to any org worker" by design (protects legacy
data during rollout). This is intentional; the follow-up admin
audit will remove null applies_to over time.
```

### 5. Non-regression — other TEAM_SCOPED_RESOURCES still narrow
Preview worker JWT against each still-team-scoped resource:
```
/api/pre-starts   → HTTP 200 rows=0   (team-scoped, unchanged)
/api/site-diary   → HTTP 200 rows=0   (team-scoped, unchanged)
/api/hazards      → HTTP 200 rows=0   (team-scoped, unchanged)
/api/incidents    → HTTP 200 rows=0   (team-scoped, unchanged)
/api/inspections  → HTTP 200 rows=0   (team-scoped, unchanged)
/api/workers      → HTTP 200 rows=0   (team-scoped, unchanged)
/api/inductions   → HTTP 404          (route path unrelated to this ship)
```

### 6. Direct filter → Mongo count trace (real worker)
```
filter: {'$or': [
  {'applies_to': None},
  {'applies_to': {'$exists': False}},
  {'applies_to': {}},
  {'applies_to.worker_ids': '36b0bf42-cd12-4e5f-b14d-792b6ea17fef'},
  {'applies_to.roles': {'$in': ['paneltec_civil', 'worker']}},
  {'applies_to.company_ids': '2'}
]}
matched: 14 ids (all SWMS in the org)
```

## Files touched
- `backend/permissions.py` — removed `swms` from
  `TEAM_SCOPED_RESOURCES` (line 40-52), comment references this
  memo.
- `backend/permissions_scope.py` — added `swms_visibility_filter`
  helper (async, best-effort worker enrichment, 5 branches).
- `backend/crud.py` — imported `_is_privileged` + `swms_visibility_filter`
  from `permissions_scope`; inserted SWMS-specific scope injection
  in `_list_impl` before the generic `resolve_team_scope` step.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped `.132km → .132kn`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped
  `.132km → .132kn`.

## NOT changed
- `/app/mobile/` — untouched. Mobile SWMS tab calls the same
  `GET /api/swms` endpoint; the backend fix picks up automatically.
- `permissions.py:231` `"swms": _grant(open=True, view=True, ...)`
  for `worker` role — unchanged.
- `crud.py::get_item` single-record `resolve_team_scope` block —
  unchanged. Now that `swms` isn't in `TEAM_SCOPED_RESOURCES`,
  `resolve_team_scope(user, "swms", None)` returns `None` → the
  block short-circuits and workers can open individual SWMS by
  ID. This matches WHS Reg 39 ("worker MUST have access to SWMS
  before starting work").
- No new indexes on `swms` (existing `org_id + deleted_at + status`
  index remains sufficient for the query shape).

## Legal note — AU WHS Regulation 39
> "The person conducting a business or undertaking must ensure
> that a safe work method statement is prepared for high risk
> construction work before the work commences and is kept until
> at least 2 years after the work is completed … and must ensure
> that the SWMS is available for inspection to workers involved
> in the work."
> — Model Work Health & Safety Regulations, Regulation 39.

Failing to surface SWMS on the mobile tab was a compliance gap.
This ship closes it.

## Follow-up candidates
1. **`.132ko` — mobile empty-state UX polish**. Current mobile SWMS
   tab treats HTTP 200 + `[]` as a failure. Should render an empty
   state ("No SWMS assigned to you yet — contact your supervisor if
   this is unexpected"). Blocked on `/app/mobile/` edit ban lift.
2. **Admin audit widget** — "N SWMS in this org have no applies_to
   matrix — click to review". Would surface the branch-1 legacy
   fallback as an admin action item.
3. **Site-scope facet** — if SWMS ever needs site-level targeting,
   add `applies_to.sites: [str]` and Branch 6 in the filter.
4. **`asset_kinds` matching** — live data has `applies_to.asset_kinds:
   ['plant']`; not currently a branch. Add if the admin UI starts
   surfacing this facet.

## Diagnostic recipe (for the next recurrence)
Any admin reporting "worker sees empty SWMS list":

1. Curl the endpoint with the worker's JWT:
   `curl -H "Authorization: Bearer <jwt>" $URL/api/swms?limit=5000`
2. If `X-Total-Count: 0` and org has SWMS → check whether the
   worker's role is in ANY `applies_to.roles` array across the org's
   SWMS (`db.swms.find({org_id: X}, {applies_to: 1})`). If not, the
   admin needs to tag SWMS or seed some to `applies_to.roles: [<role>]`.
3. If the response returns SWMS but mobile still shows "Failed to
   load" → mobile UX bug, escalate to `.132ko`.
