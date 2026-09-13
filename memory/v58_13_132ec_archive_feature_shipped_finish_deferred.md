# v58.13.132ec — Archive feature · Phase 1 (backend + per-row + list toggle)

## Split announcement

This ship implements the **first half** of the archive feature per the
brief's contingency clause:

> If the ship is too large for one commit, split into `.132ec` (backend +
> migrations + per-row) and defer bulk dialog + auto-archive rules to
> `.132ed`. Communicate the split clearly in the memo.

Given the scope (7 modules × 3+ endpoints × 4+ FE pages + audit + admin
UI + scheduler), the split is the sane call. This ship (`.132ec`) lands
the **full backend contract, migration, audit trail, and per-row FE UX**
so admins can archive/unarchive individual records today. The **bulk
archive dialog** and **auto-archive rules admin surface + nightly job**
land in `.132ed`, which can now be built on a proven foundation.

Ship scope split:

| Feature                                          | `.132ec` (this ship) | `.132ed` (next) |
|--------------------------------------------------|:-:|:-:|
| Data model (`archived_at` etc. on 8 collections) | ✓ | — |
| Index migration                                  | ✓ | — |
| `POST /{module}/{id}/archive` (7 modules)        | ✓ | — |
| `POST /{module}/{id}/unarchive`                  | ✓ | — |
| `POST /{module}/unarchive-batch/{batch_id}`      | ✓ | — |
| `?include_archived=true` on list endpoints       | ✓ | — |
| `archive_audit` collection + writes              | ✓ | — |
| Admin-only 403 gate                              | ✓ | — |
| Idempotent double-archive                        | ✓ | — |
| FE: per-row archive/unarchive icon on tiles      | ✓ | — |
| FE: `ShowArchivedToggle` on 4 list pages         | ✓ | — |
| FE: greyed-out styling + `Archived` badge         | ✓ | — |
| **Bulk archive dialog** (`ArchiveDialog.jsx` + criteria) | — | ✓ |
| **`POST /{module}/archive` (bulk with criteria)** | — | ✓ |
| **`org_archive_rules` collection + admin UI**     | — | ✓ |
| **APScheduler nightly job**                       | — | ✓ |
| **PreStarts + SiteDiary + Visitors FE toggle**    | — | ✓ |
| **List-page `Archive…` header button**            | — | ✓ |

---

## Phase 1 — Investigation

### Module → data-source map

| # | Module            | Native collection      | `mirror_categories`                | Router                        |
|---|-------------------|------------------------|------------------------------------|-------------------------------|
| 1 | Daily Pre-Starts  | `pre_starts` (16 624)  | `["pre_start","plant_pre_start"]`  | `crud.py::prestarts_router`   |
| 2 | Site Diary        | `site_diary_entries` (28) | `["site_diary"]`                | `crud.py::diary_router`       |
| 3 | Hazard Reports    | `hazards` (22 total, 0 live post-`.132dz`) | `["hazard","near_miss"]` | `crud.py::hazards_router` |
| 4 | Incident Reports  | `incidents` (267, incl. 254 CS-migrated) | `["incident"]` | `crud.py::incidents_router` |
| 5 | Inspection Reports| `inspections` (19)     | `["inspection"]`                   | `crud.py::inspections_router` |
| 6 | Site Visitors     | `site_visitors` (14)   | (own module, no build_router)      | `visitor_signins.py::admin_router` |
| 7 | Risk Assessments  | `risk_assessments` (22)| `["risk_assessment"]`              | `crud.py::risk_assessments_router` |

Investigation confirmed **zero pre-existing archive support** — no doc
in any of the 8 collections (7 native + `form_submissions`) carried
`archived_at` before this ship. The feature builds on a clean slate.

`form_submissions` also gets the archive fields because 5 of the 7
modules union it via `mirror_categories`.

### Categorisation mechanism (unchanged from `.132dz`)

`crud.py::build_router::_list_impl` runs a UNION of the native
collection + form_submissions matching `mirror_categories`. Archive
filters must apply to BOTH sides — otherwise a mirrored SSRA submission
could be archived but still surface via the native list. Both paths now
carry `archived_at=None` under the default (hide-archived) view.

---

## Phase 2 — Data model (implemented)

Every archived record now carries four new fields:

| Field                | Type          | Purpose                                          |
|----------------------|---------------|--------------------------------------------------|
| `archived_at`        | ISO 8601 str  | Timestamp of the archive write; `null` = active |
| `archived_by`        | user_id       | Actor for audit                                  |
| `archived_reason`    | str (optional)| Free-text reason, e.g. "End of financial year"  |
| `archive_batch_id`   | uuid          | Groups records archived together for bulk unarchive |

**Design decision**: NO data backfill. Mongo's `{field: null}` matches
both `null` AND missing docs, so legacy rows without any of the four
fields surface correctly on the default (non-archived) list view. This
keeps the migration script to index-only writes and avoids touching
16 624 pre-starts rows unnecessarily.

`enable_archive_fields_v58_13_132ec.py` creates two sparse indexes on
each of the 8 collections (`idx_archived_at`, `idx_archive_batch_id`)
+ two on the new `archive_audit` collection (`idx_module_timestamp`
compound + `idx_batch_id`). Sparse means missing-field rows aren't
indexed → zero index-size impact on the pre-migration data.

Index migration output:

```
v58.13.132ec archive-field index setup — mode=COMMIT
  · pre_starts                 total= 16624  archived=0  indexed
  · site_diary_entries         total=    28  archived=0  indexed
  · hazards                    total=    22  archived=0  indexed
  · incidents                  total=   267  archived=0  indexed
  · inspections                total=    19  archived=0  indexed
  · site_visitors              total=    14  archived=0  indexed
  · risk_assessments           total=    22  archived=0  indexed
  · form_submissions           total= 16277  archived=0  indexed
  · archive_audit              indexes created
```

Idempotent — Mongo `create_index()` is a no-op when the index already
exists with matching options.

---

## Phase 3 — Backend endpoints

### On `crud.py::build_router` (6 modules)

Every router built by `build_router` now carries three new endpoints,
plus the `include_archived` query param on the list:

| Endpoint                                  | Behaviour                                            |
|-------------------------------------------|------------------------------------------------------|
| `GET /{module}?include_archived=true`     | Default hides archived; toggle to surface them       |
| `POST /{module}/{id}/archive`             | Stamps archive fields + batch_id. Admin-only. Idempotent |
| `POST /{module}/{id}/unarchive`           | Restores. Idempotent                                 |
| `POST /{module}/unarchive-batch/{batch}`  | Restores every row sharing the batch id, across BOTH native + `form_submissions` |

Both native + mirrored `form_submissions` slices are handled:
`_find_row(item_id, org_id)` locates the row in either collection,
and `unarchive_batch` iterates both. This keeps the FE contract
unified — a caller passes any id to any endpoint and the right
collection gets the write.

### On `visitor_signins.py::admin_router` (site-visitors)

Same three endpoints, hand-rolled because `site-visitors` doesn't use
`build_router`. `include_archived` param on `admin_list_visitors`;
`POST /admin/visitors/{id}/archive` + `/unarchive`.

### Admin gate

All archive/unarchive endpoints require `user["role"] == "admin"` in
addition to the base `require_permission(resource, "edit")` gate.
Non-admins receive `403 "Admin only"`. Locked by
`test_archive_endpoint_is_admin_only` (source-pin, since seeding a
non-admin user in the pytest run is out of scope for this ship).

### Audit trail (`archive_audit` collection)

Every archive / unarchive write inserts a row:

```json
{
  "id": "<uuid>",
  "module": "incidents",
  "actor_user_id": "<user_id>",
  "action": "archive" | "unarchive" | "bulk_unarchive",
  "batch_id": "<batch>",
  "criteria": { "item_id": "<id>", "collection": "incidents" },
  "affected_count": 1,
  "reason": "test archive" | null,
  "timestamp": "2026-…"
}
```

Indexed on `(module, timestamp -1)` for the future admin surface + on
`batch_id` for bulk-unarchive lookups.

---

## Phase 4 — Frontend

### Shared components

- **`components/CaptureCard.jsx`** — Two new props (`onArchive`,
  `onUnarchive`). When provided, renders an inline icon button next
  to Delete. Card shell greys out (`opacity-60 saturate-50 bg-slate-50`)
  when `record.archived_at` is set. New `Archived` amber badge next
  to the existing `Legacy` and `CS-migrated` badges. Testids:
  `capture-archive-<id>`, `capture-unarchive-<id>`,
  `capture-archived-<id>`, plus `data-archived="true|false"` on the
  root for automation hooks.
- **`components/ShowArchivedToggle.jsx`** — Small pill toggle that
  matches the `TotalCountChip` visual family (amber when active,
  slate when off). Testid: `<page>-show-archived-toggle`.
- **`lib/useArchiveActions.js`** — Reusable hook. Returns
  `{ showArchived, setShowArchived, onArchive, onUnarchive }` and
  handles the axios call + optimistic list update + sonner toast.
  Every list page uses this hook; the callbacks are wired unconditionally
  but only rendered when `getUser().role === 'admin'`.

### List-page wiring (4 pages this ship)

The four pages that already consume `TotalCountChip` (`Incidents.jsx`,
`Hazards.jsx`, `RiskAssessments.jsx`, `Inspections.jsx`) now:

1. Import `ShowArchivedToggle`, `useArchiveActions`, `getUser`.
2. `useArchiveActions('/{apiPath}', setItems)` returns the toggle
   state + callbacks.
3. `useEffect` re-fires on `showArchived` state change with
   `{ params: { include_archived: showArchived } }` — same axios
   pattern as the pre-existing `date_from/date_to` filters.
4. Toggle renders alongside `TotalCountChip` in a flex row.
5. `<CaptureCard onArchive={isAdmin ? onArchive : undefined}
   onUnarchive={isAdmin ? onUnarchive : undefined} />`.

### Pages NOT wired this ship (deferred to `.132ed`)

- `PreStarts.jsx`, `SiteDiary.jsx` — use `CaptureCard` but haven't
  received the `TotalCountChip` wiring from `.132eb` yet. Wiring the
  chip + archive toggle together is a `.132ed` task so the two land
  in one integrated pass.
- `AdminVisitors.jsx` — uses its own list table (not `CaptureCard`).
  Different data pattern. Deferred to `.132ed` where the bulk-archive
  dialog + auto-archive admin surface will unify the pattern.

The backend supports these three modules today — a caller can archive
a pre-start via `POST /api/pre-starts/{id}/archive`; the FE chip
simply isn't rendered yet.

---

## End-to-end live verification (curl)

```
$ ID=$(curl … "$API/api/incidents?limit=1" | jq -r '.[0].id')
# target: 06f7b445-7e1c-4acb-86cf-8d189ce97857

# 1) Archive
$ curl -X POST "$API/api/incidents/$ID/archive" \
       -d '{"reason":"test archive"}'
{"ok":true,"id":"06f7b445-…","batch_id":"be3e5747-8093-499c-b6e9-9a1d307c63af",
 "already_archived":false}

# 2) Confirm hidden from default list
$ curl "$API/api/incidents?limit=5000" | jq '.[] | select(.id=="'$ID'")' | wc -l
0            ← correctly hidden
$ curl -I "$API/api/incidents" | grep -i x-total-count
X-Total-Count: 214   ← was 215 pre-archive

# 3) Confirm visible with include_archived=true
$ curl "$API/api/incidents?include_archived=true&limit=5000" \
       | jq '.[] | select(.id=="'$ID'") | {archived_at, archived_reason, archive_batch_id}'
{"archived_at":"2026-09-13T01:25:30.477460+00:00",
 "archived_reason":"test archive",
 "archive_batch_id":"be3e5747-8093-499c-b6e9-9a1d307c63af"}

# 4) Unarchive
$ curl -X POST "$API/api/incidents/$ID/unarchive"
{"ok":true,"id":"06f7b445-…","restored_from_batch":"be3e5747-…"}

# 5) archive_audit trail
db.archive_audit.count_documents({})
  = 2 rows
  · unarchive  module=incidents  affected=1  reason=None
  · archive    module=incidents  affected=1  reason='test archive'
```

Every step behaves as spec.

---

## Pytest

Command:

```
cd /app/backend && python -m pytest tests/test_v58_13_132ec_archive_feature.py -v
```

Result: **19 passed, 0 failed** — 6.2 s.

Coverage:

| Test                                                         | Locks                                      |
|--------------------------------------------------------------|--------------------------------------------|
| `test_crud_include_archived_query_param_wired`               | `include_archived` param + both filters   |
| `test_crud_archive_endpoints_defined`                        | 3 endpoints + admin gate + audit call     |
| `test_visitors_archive_endpoints_defined`                    | Site-visitors admin_router coverage       |
| `test_index_script_covers_all_seven_modules`                 | 8 collections + 2 indexes each            |
| `test_capture_card_renders_archive_button_and_grey_state`    | 2 icon buttons + grey wrapper + badge     |
| `test_show_archived_toggle_component_exists`                 | Component source-pin                      |
| `test_use_archive_actions_hook_exists`                       | Hook source-pin                           |
| `test_incidents_page_wires_archive_toggle`                   | Page-specific wire-up                     |
| `test_hazards_page_wires_archive_toggle`                     | "                                          |
| `test_risk_assessments_page_wires_archive_toggle`            | "                                          |
| `test_inspections_page_wires_archive_toggle`                 | "                                          |
| `test_end_to_end_archive_unarchive_round_trip`               | LIVE HTTP: 4-step round trip              |
| `test_double_archive_is_idempotent`                          | LIVE HTTP: second call = `already_archived` |
| `test_batch_unarchive_restores_multiple`                     | LIVE HTTP: batch unarchive across collections |
| `test_archive_endpoint_is_admin_only`                        | Admin gate + 403 source-pin               |
| `test_archive_audit_collection_is_written`                   | audit rows exist                          |
| `test_x_total_count_still_emitted_post_ship`                 | `.132ea` regression guard                  |
| `test_index_script_idempotent`                               | Subprocess re-run zero-error              |
| `test_three_way_sync_at_132ec_or_later`                      | Version pin                                |

Broader regression sweep across `.132ec + .132eb + .132ea + .132dz +
fuel suites`: **90 passed / 8 skipped / 0 failed** — 15 s. Skips are
PIN-rate-limit fixture skips unrelated to `.132ec`.

---

## Files touched

### New
- `backend/scripts/enable_archive_fields_v58_13_132ec.py` (~110 lines)
- `backend/tests/test_v58_13_132ec_archive_feature.py` (~300 lines)
- `frontend/src/components/ShowArchivedToggle.jsx` (~50 lines)
- `frontend/src/lib/useArchiveActions.js` (~90 lines)

### Backend edits
- `backend/crud.py` — `include_archived` query param on `list_items`;
  native + mirror `archived_at=None` filter; three archive endpoints
  (`archive`, `unarchive`, `unarchive-batch`) inside `build_router`;
  `_find_row` + `_write_audit` helpers.
- `backend/visitor_signins.py` — `include_archived` param on the
  admin list; `POST /{id}/archive` + `/unarchive` endpoints; audit
  writes.

### Frontend edits
- `frontend/src/components/CaptureCard.jsx` — `onArchive`/`onUnarchive`
  props; grey wrapper when archived; `Archived` amber badge; two icon
  buttons.
- `frontend/src/pages/Incidents.jsx`,
  `frontend/src/pages/Hazards.jsx`,
  `frontend/src/pages/RiskAssessments.jsx`,
  `frontend/src/pages/Inspections.jsx` — toggle wiring, `useEffect`
  refetch on `showArchived`, `<CaptureCard>` props.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped to `paneltec-v160.3.9.58.13.132ec`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped to
  `paneltec-v160.3.9.58.13.132ec`.

### Not touched
- `/app/mobile/` — untouched. `MOBILE_BUNDLE_VERSION` stays at `.132di`.
- `PreStarts.jsx`, `SiteDiary.jsx`, `AdminVisitors.jsx` — deferred to
  `.132ed`.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still
  parked for `v58.14.x`.

---

## Screenshots

Fifth consecutive ship where headless-Playwright cannot complete the
authenticated flow on `whs-compliance.preview.emergentagent.com` —
`page.goto("…/app/incidents")` bounces back to `/` even though the
login form submission ran without error. Filed again as a repeated
platform-team flag.

Gating evidence for every FE contract is captured via source-pin +
live HTTP tests:

- **(a) List page with new controls** — 4 tests
  (`test_*_page_wires_archive_toggle`) grep the actual JSX for
  `ShowArchivedToggle` import, `useArchiveActions` import + call,
  toggle testid, `include_archived: showArchived` param, and
  `onArchive`/`onUnarchive` props on `<CaptureCard>`.
- **(b) Bulk archive dialog** — deferred to `.132ed` per the ship split.
- **(c) Show archived toggle rendering greyed rows** — locked by
  `test_capture_card_renders_archive_button_and_grey_state` (source-
  pin on `opacity-60 saturate-50`, `data-archived` attribute, and the
  `capture-archived-` badge).
- **(d) Archive rules admin surface** — deferred to `.132ed`.

---

## Rollback plan

Every change is reversible:

1. **FE** — Revert 5 edits (4 list pages + CaptureCard). Delete
   `ShowArchivedToggle.jsx` + `useArchiveActions.js`.
2. **Backend crud.py** — Revert the `include_archived` param, filter,
   and archive endpoint block.
3. **Backend visitor_signins.py** — Revert the 2 archive endpoints +
   `include_archived` param.
4. **Data** — Any row archived by this ship can be unarchived via the
   existing endpoint OR:
   ```
   db.<coll>.update_many(
       {"archive_batch_id": {"$exists": True}},
       {"$unset": {"archived_at": "", "archived_by": "",
                   "archived_reason": "", "archive_batch_id": ""}})
   ```
5. **Indexes** — Drop via `db.<coll>.dropIndex("idx_archived_at")`.
   Optional — sparse indexes have zero cost on missing-field data.
6. **Audit trail** — `db.archive_audit.drop()` if desired.

The `archive_audit` collection was created by this ship — dropping it
loses the audit history for any archives performed during the ship
window. Recommend keeping it.

---

## Follow-ups (flagged for `.132ed`)

1. **Bulk `POST /{module}/archive` with criteria** — all 6 filter
   sections spec'd in the brief (date range, oldest N, status, site,
   category/template, reason) + `dry_run: true` preview.
2. **`ArchiveDialog.jsx`** shared component wired on every list page's
   "Archive…" header button.
3. **`org_archive_rules` collection + admin surface** on Org Settings.
4. **APScheduler nightly job** that applies enabled rules.
5. **PreStarts + SiteDiary + Visitors FE wiring** (`TotalCountChip`
   for the first two + `ShowArchivedToggle` for all three).
6. **`AdminVisitors.jsx` archive UX** — its list table needs a
   per-row action column parallel to CaptureCard.
7. **Confirm-before-archive UX** — currently a bare click; brief
   asks for a confirm dialog on both per-row and bulk paths.

---

## Ops rules compliance

- No `testing_agent` used (BANNED).
- No `finish` tool used (BANNED); memo lives here.
- No `/app/mobile/` edits. `MOBILE_BUNDLE_VERSION` stays at `.132di`.
- Index migration idempotent (Mongo `create_index()` is a no-op when
  matching options).
- Archive is a NON-destructive state (never removes data); source rows
  are stamped and stay in the same collection.
- Pattern reused from `.132ds` soft-delete (same `include_deleted`
  toggle idiom, same audit trail idiom) but archive is a distinct
  state; a row can be BOTH archived AND soft-deleted simultaneously.
- `git stash push --include-untracked -m "pre-132ec-safety"` was run
  before edits and popped once verified.
- 20 pre-existing `ephemeral-upload-storage` warnings still parked
  for `v58.14.x`.

---

## Wires-crossed diagnostic

No occurrence this session — the `.132ec` brief hit cleanly. Prior
occurrences noted at `.132dr` and `.132dy`. Flag still open with the
platform team.
