# v58.13.132hq — Worker company: editable list + backfill

**Status:** Shipped on `main`. Additive. Backfill idempotent.
**Finish:** DEFERRED — user validates.

Extends the two-value `simpro_company_id`-derived `company_label`
(Paneltec/Viatec) into an editable N-value list keyed on a new
`worker_companies` collection. Same shape as `.132gv`'s
`induction_types` pattern per user's Q6 clarification (Walker
Designs is a worker company, not a subcontractor).

## Shipped

### 1. `worker_companies` collection + CRUD

New backend module `backend/worker_companies.py` (mirrors
`induction_types.py` almost line-for-line):

- Collection: `worker_companies` — `{id, org_id, name, created_by,
  created_at, updated_at, deleted_at, seeded}` with a compound
  index on `(org_id, deleted_at, name)`.
- Prefix: `/worker-companies` (hyphenated so it doesn't collide
  with `/workers/{id}` greedy match — verified live: initial
  `/workers/companies` returned "Worker not found" 404).
- Endpoints:
  - `GET /worker-companies` — any authenticated user (toolbar filter
    reads for non-admin roles too). Auto-seeds defaults on first-hit.
  - `POST /worker-companies` — admin, 409 on dupe name.
  - `PATCH /worker-companies/{id}` — admin rename, 409 on dupe.
  - `DELETE /worker-companies/{id}` — admin soft-delete.
- Snapshot semantics: renames / deletes DO NOT cascade to
  existing `workers.worker_company_name` — admin must bulk-
  reassign if the new name should appear on old rows.

### 2. Startup seed + backfill

`backfill_worker_company_ids_on_startup()` runs after
`seed_import_matcher_templates_on_startup()` in
`server.py::on_startup`:

1. Seeds `Paneltec`, `Viatec`, `Walker Designs` for every org
   that has at least one worker (bootstrap chicken-and-egg fix —
   the on-first-GET seed didn't help until an admin actually
   hit the endpoint).
2. For every worker row missing `worker_company_id`:
   - `simpro_company_id == "3"` → Viatec company row
   - Everything else → default (Paneltec company row)
   Stamps both `worker_company_id` (FK) and
   `worker_company_name` (snapshot).

Verified live post-startup on Stephen's tenant: **all 70 workers
now carry `worker_company_name`**, Simpro-2 → Paneltec (correctly),
Simpro-3 → Viatec (correctly).

### 3. Worker model surface

`WorkerPatch` (and `_serialise` return shape) gains:

```python
worker_company_id:   Optional[str]  # UUID reference
worker_company_name: Optional[str]  # snapshot label
```

`_serialise::company_label` derivation is now:

1. `doc.worker_company_name` — explicit snapshot wins
2. Falls back to the legacy Simpro-derived logic
   (2=Paneltec, 3=Viatec, else Simpro / Manual)

Backwards-compat guaranteed for legacy pre-`.132hq` rows that
haven't been touched by the backfill.

### 4. Frontend toolbar

`Workers.jsx` — new multi-select company chip filter in the
workers-toolbar bar:

- Loads `GET /worker-companies` once on page mount into
  `workerCompanies` state.
- Renders one pill button per company alongside the search input,
  data-test IDs `worker-company-chip-{slug}`.
- Active chips flip to a solid `#1e4a8c` bg + white text; inactive
  chips stay white with a blue hover-border.
- `Clear` link appears when at least one chip is active.
- Filter composes with search + sort — chip narrows the visible
  rows to workers whose `worker_company_name` (or fallback
  `company_label`) is in the selected set.
- Default = empty selection = show all (per user's Q2 spec).

## Verification — pytest 9/9 green

```
test_worker_companies_module_pinned                PASSED
test_server_wires_router_and_backfill              PASSED
test_worker_model_carries_company_fields           PASSED
test_seed_defaults_present_live                    PASSED
test_all_workers_backfilled_live                   PASSED  ← 70 workers, 0 missing
test_crud_lifecycle_live                           PASSED  ← create/rename/dupe/delete
test_worker_patch_accepts_company_id_live          PASSED
test_frontend_renders_company_filter_chips        PASSED
test_version_bumped_to_132hq                       PASSED
```

## Version lockstep

- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132hq`
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132hq`

## Files touched (5)

**New (2):**
- `backend/worker_companies.py` (~260 lines — CRUD + seed + backfill)
- `backend/tests/test_v58_13_132hq_worker_companies.py` (9 tests)

**Modified (5):**
- `backend/workers.py` — WorkerPatch fields + `_serialise` label logic
- `backend/server.py` — router mount + backfill startup hook
- `frontend/src/pages/Workers.jsx` — chip filter state + UI + memo dep
- `frontend/src/lib/version.js` — version bump
- `frontend/public/service-worker.js` — cache-version bump

## Ban compliance

- No `finish` / `testing_agent` / `e1_tester` invoked.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Not in scope

- Admin CRUD UI panel — the endpoints exist and are admin-gated;
  a dedicated Settings modal (like `.132gv`'s Manage Induction
  Types) can ship as `.132hqa` if Stephen wants a click-through
  path rather than API calls. All CRUD flows are exercised by
  pytest.
- Cascade-rename on `worker_companies` — snapshot semantics
  match `.132gv` / `.132hn` patterns. Admin bulk-reassign is
  the conscious next step if a rename should apply retroactively.
- Extended reports filtering (SWMS signoffs, inductions) — per
  Q2 defaults, ONLY Workers list gets the filter. Existing
  reports untouched.
- `.132hs` (auto-provision workers → users) — next in the queue.
