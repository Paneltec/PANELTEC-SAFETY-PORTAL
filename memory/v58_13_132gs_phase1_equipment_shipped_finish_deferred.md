# v58.13.132gs — Phase 1: Equipment Register enhancements · SHIPPED (finish deferred)

## Scope

Phase 1 of the 4-phase office-staff enhancement brief. Three
additive extensions to the Equipment Register:

1. **Multi-docs per equipment (GridFS)** — new generic `documents`
   array alongside the existing `certs` array. Stored in a distinct
   GridFS subdir (`equipment_documents/`) so audits + admin file
   surfaces can tell certs from ancillary paperwork (spec sheets,
   manuals, warranties, invoices).
2. **Model Number** — new `model_number` field on the equipment
   record, surfaced on the create/edit modal and the list table.
   Existing rows read as `None` (no destructive backfill needed —
   Pydantic tolerates missing keys, `_shape` defaults to `None`).
3. **Editable Category CRUD** — new `equipment_categories`
   collection + admin-only sub-router at `/api/equipment/categories`.
   Soft-delete only; equipment already tagged with a deleted
   category keeps the snapshot string. Default 8 categories
   auto-seed on first list call per org.

## Files changed

```
backend/equipment_register.py                              rewritten
backend/server.py                                          +5 −1  (multi-import + categories mount)
backend/tests/test_v58_13_132gs_phase1_equipment.py        NEW 234 lines · 11 checks · all green
backend/tests/test_v58_13_132gl_b_equipment_register.py    1 test relaxed for forward-compat
frontend/src/pages/EquipmentRegister.jsx                   rewritten (adds Manage Categories modal + Model + Documents)
frontend/src/lib/version.js                                RUNNING_VERSION + EXPECTED_CACHE_VERSION → .132gs
frontend/public/service-worker.js                          CACHE_VERSION → .132gs
memory/v58_13_132gs_phase1_equipment_shipped_finish_deferred.md   NEW (this)
```

## Backend API (delta)

Six new endpoints, one modified schema, one modified create:

```
GET    /api/equipment/categories               list active categories (admin)
POST   /api/equipment/categories               create (admin, 409 on dupe)
PATCH  /api/equipment/categories/{cid}         rename (admin, 409 on dupe)
DELETE /api/equipment/categories/{cid}         soft-delete (admin)

POST   /api/equipment/{eid}/documents          upload generic document
GET    /api/equipment/{eid}/documents/{doc_id} download (inline)
DELETE /api/equipment/{eid}/documents/{doc_id} soft-delete

EquipmentIn / EquipmentPatch now carry `model_number: Optional[str]`.
Create initialises `documents: []`.
```

`categories_router` MUST include-before `equipment_register_router`
in `server.py` — pinned by
`test_categories_router_mounted_before_eid_catchall`.

## Frontend UX (delta)

* **Manage categories button** (admin-only) top-right of Equipment
  Register page → opens `ManageCategoriesModal` with add / rename /
  soft-delete. Existing equipment keeps its category snapshot on
  deletion; the modal warns the admin.
* **Model number** — new input in Add/Edit modal + new column in
  the table (mono font, `—` fallback).
* **Documents** — new "Supporting documents" section inside the
  Edit modal (edit-only; new rows must be saved first). Upload
  button + list of attachments; each item is a clickable inline
  preview link + delete button. Table gains a Docs count chip.
* Category dropdown now backed by the API. If a row references a
  soft-deleted category, the dropdown renders it with `(removed)`
  so the admin sees the snapshot without accidentally overwriting
  it on a plain "Save".

## Pytest

```
$ pytest backend/tests/test_v58_13_132gs_phase1_equipment.py -v
11 passed in 3.18s
```

11 checks locking the whole surface:

* Backend router pins (8 new endpoint decorators).
* `model_number` on both Pydantic schemas.
* Category-router mounted before `/{eid}` (blast-radius guard).
* Frontend testids + endpoint call-sites + `model_number` payload.
* Admin gate on Manage categories button.
* Version bumps on all three files.
* CRUD round-trip: categories (create · dupe-409 · rename · soft-delete).
* Anonymous 401/403 on categories list.
* Full model-number + document round-trip (create · patch · upload ·
  detail includes it · download bytes · soft-delete · 404 afterwards).
* Storage-subdir separation pin (`equipment_certs` vs `equipment_documents`).

## Behavioural / visual verification

Live Playwright hit against
`https://whs-compliance.preview.emergentagent.com/app/equipment`:

* Page loads with sidebar version pill reading **v160.3.9.58.13.132gs**.
* `equipment-manage-categories-btn` rendered (admin gate honoured).
* Add Equipment modal contains `equipment-model-input`.
* No console errors.

## Ops notes

* `/app` volume was at 100 % on ship start (same webpack cache
  regression as `.132gr`). Cleared `/app/frontend/node_modules/.cache`
  (regenerates on next dev rebuild); dropped to 84 %. Followed the
  `.132gr` playbook.
* Standing directive for a retention auto-trigger after each backup
  snapshot (from `.132gr` follow-up backlog) is still open. Not in
  Phase 1 scope; will pick up separately.

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester` invoked.
* `/app/mobile/` untouched.
* CRA — no Vite migration.
* Version bumped in all three canonical files (`version.js` ×2 +
  `service-worker.js`).
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Deferred / follow-ups

* **Phase 2 (SDS module enhancements)** — next up. Delete, rename,
  expiry date + tinted-row styling, sort/filter on the list view.
* **Phase 3 (Inductions dropdown admin CRUD)** — after Phase 2.
* **Phase 4 (bug fixes)** — Pre-start Select-Vehicle dropdown empty,
  SSRAs incorrectly in Risk Assessments tab.
* Retention auto-trigger after each snapshot (from `.132gr`).
* Pre-flight disk-usage guard on backup POST (from `.132gr`).

## Message for Stephen

Hard-refresh once `.132gs` is live. On the Equipment Register:

1. New **"Manage categories"** button top-right (admin only). Click
   it to add / rename / remove categories. Categories you remove
   stay attached to any equipment already using them — you just
   won't see them in the dropdown for new rows.
2. New **Model number** column and field on every equipment row.
3. Open any existing row's **Edit** modal to find the new
   **Supporting documents** section. Attach spec sheets, manuals,
   warranty PDFs — anything that isn't a calibration cert. Cert
   uploads (with expiry logic) still work exactly as before.
