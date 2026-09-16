# v58.13.132gv — Phase 3: Inductions dropdown admin CRUD · SHIPPED (finish deferred)

## Scope

Editable induction-type dropdown for the Worker Inductions matrix.
Previously `InductionCardModal.jsx` shipped with a hardcoded 3-entry
`<select>` (`competency` / `site_induction` / `license`). Office
staff needed to add new induction types (e.g. project-specific site
inductions, contractor-specific competencies) without a code
change. This ships:

* New `induction_types` collection.
* New sub-router `/api/inductions/types` — admin-only writes,
  authenticated read (so non-admin managers filling out a worker's
  induction can still populate the dropdown), soft-delete +
  name-snapshot semantics identical to Phase 1's
  `/api/equipment/categories`.
* Auto-seed the three legacy slug codes on first-list per org so
  existing `worker_certifications.type` values continue to resolve
  to a live dropdown option.
* Frontend dropdown now pulls from the API. If a worker record's
  stored `type` doesn't match any active induction type (e.g. an
  admin soft-deleted the category since the record was created)
  the dropdown surfaces the stored value as an
  `<option>{name} (removed)</option>` entry so the admin sees
  the snapshot without accidentally overwriting it.
* New "Manage induction types" admin modal — add / rename /
  soft-delete, opened from a small **Manage** button next to the
  dropdown (admin-only, gated by `user?.role === 'admin'`).

## Files changed

```
backend/induction_types.py                                        NEW · 186 lines
  · router prefix /inductions/types, admin-only writes.
  · DEFAULT_INDUCTION_TYPES = ['competency', 'site_induction', 'license'].
  · Auto-seed on first-list per org (idempotent).
  · Soft-delete + snapshot semantics (matches Phase 1 categories).

backend/server.py                                                 +4
  · Wire `induction_types_router` under `/api`.

backend/tests/test_v58_13_132gv_phase3_induction_types.py         NEW · 11 checks · all green

frontend/src/components/InductionCardModal.jsx                    +180 −6
  · API-driven dropdown replacing the hardcoded 3-entry <select>.
  · Snapshot-aware option (renders "(removed)" suffix).
  · Manage button next to dropdown (admin-only).
  · ManageInductionTypesModal component (add / rename / soft-delete).
  · Existing TYPE_LABEL map retained for read-side display.

frontend/src/lib/version.js                                       RUNNING/EXPECTED → .132gv
frontend/public/service-worker.js                                 CACHE_VERSION → .132gv
memory/v58_13_132gv_phase3_induction_types_shipped_finish_deferred.md  NEW (this)
```

## Backend API

```
GET    /api/inductions/types                list active types (auth-required)
                                            · auto-seeds legacy defaults on first-list
POST   /api/inductions/types                create (admin, 409 on dupe)
PATCH  /api/inductions/types/{tid}          rename (admin, 409 on dupe)
DELETE /api/inductions/types/{tid}          soft-delete (admin)
```

Snapshot semantics: `DELETE /inductions/types/{tid}` sets
`deleted_at` on the type row. Any `worker_certifications.type`
value already using that string is left alone — the row keeps its
snapshot value; the dropdown surfaces it as `(removed)` next time
that record is opened.

## Frontend UX

* **Add / Edit induction modal** — the "Type" field is now a
  flex row: the `<select>` on the left, an outlined **Manage**
  chip on the right (visible only to admins).
* **Snapshot handling** — if the record's stored type isn't
  present in the active list, the dropdown prepends a
  `<option>value (removed)</option>` entry so the admin sees the
  original string without pressure to overwrite it.
* **Manage induction types modal** — Add input + inline rename +
  soft-delete per row. Delete triggers a `window.confirm` with
  the "existing records keep the snapshot" warning copy.

## Pytest

```
$ pytest backend/tests/test_v58_13_132gv_phase3_induction_types.py -v
11 passed in 2.46s
```

Coverage:

* Backend router decorators + `DEFAULT_INDUCTION_TYPES` seed
  values (legacy codes preserved).
* Router mounted in `server.py`.
* First-list seeds the three legacy values.
* Full CRUD round-trip (create → dupe-409 → rename → soft-delete
  → deleted-type absent from list → missing-id 404 on both
  PATCH + DELETE).
* Anonymous read → 401/403 (authenticated read is intentionally
  open for non-admin managers).
* Frontend: legacy 3-option hardcoded `<select>` removed;
  API-driven fetch present; Manage modal + testids
  (`induction-types-modal`, `induction-type-new-input`,
  `induction-type-add-btn`, `induction-manage-types-btn`) +
  dynamic testids (`induction-type-row-<id>`,
  `induction-type-rename-<id>`, `induction-type-delete-<id>`).
* Admin gate on Manage button (`isAdmin && (<button>…)`).
* Snapshot semantics wired ("(removed)" suffix + `snapshot`
  branch in dropdown builder).
* Frontend calls `POST` / `PATCH` / `DELETE` against
  `/inductions/types`.
* Version pins in all three canonical files.

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester` invoked.
* `/app/mobile/` untouched.
* CRA — no Vite migration.
* Version bumped in `version.js` (RUNNING + EXPECTED) and
  `service-worker.js` (CACHE_VERSION).
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Deferred / follow-ups

* **`.132gw` — backup POST pre-flight disk guard (URGENT)**:
  return HTTP 507 from `POST /api/backup/snapshots` when
  `/app` free-space < 10 %. Pulled forward per Stephen's ask
  after `.132gu` was truncated mid-edit on a 100 %-full pod.
  Shipping immediately after this memo.
* **Phase 4**: Pre-start Select-Vehicle dropdown empty +
  SSRAs incorrectly in Risk Assessments tab.
* Retention auto-trigger after each snapshot (`.132gr` backlog).

## Message for Stephen

Hard-refresh once `.132gv` is live. Open any worker's inductions
matrix → click **Add induction** on a cell:

* The **Type** dropdown is now editable. Existing records with
  the old slug codes (`competency`, `site_induction`, `license`)
  still work — those three are auto-seeded so nothing changes
  visually until you rename them.
* Next to the dropdown, admins see a new **Manage** button →
  opens a modal to add / rename / remove induction types. Types
  you remove stay attached to any worker record already using
  them (you'll see `(removed)` next to the value); they just
  won't appear in the dropdown for new inductions.
* If you want prettier labels for the three seeded types (e.g.
  rename `site_induction` → `Site induction`), open Manage,
  click the pencil, retype, hit enter. New records will pick
  up the friendlier label.
