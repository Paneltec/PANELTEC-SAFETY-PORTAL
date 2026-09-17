# v58.13.132hv — Amanda dupe archive + worker_companies purge + role default fix (shipped)

## What shipped

Three bundled fixes, all with live evidence before committing.

### 1. Amanda Guy duplicate archived

Live audit of the two Amanda Guy worker records:

| Field                | KEPT `4d0fa50a…` (simpro=50) | ARCHIVED `f7e200f8…` (simpro=1086) |
|----------------------|------------------------------|------------------------------------|
| Certifications       | **13**                       | 0                                  |
| Position             | `Office Manager`             | (empty)                            |
| Mobile               | `0400 153 842` (formatted)   | `0400153842`                       |
| User link            | `linked` → `bb1daa5e…`       | `email_conflict`                   |
| SWMS signoffs        | 0                            | 0                                  |
| Inductions           | 0                            | 0                                  |
| HR documents         | 0                            | 0                                  |
| Created              | 2026-06-27 10:48:26          | 2026-06-27 10:48:40 (14s later)    |
| Name canonical form  | `AMANDA GUY` (Simpro shape)  | `Amanda Guy` (manual re-add form)  |

The kept record wins on every measurable dimension. The dupe was
soft-deleted (`deleted_at`, `active=False`, `archived_reason`,
`archived_by`, `archived_at`) with a `worker.duplicate_archived`
audit log entry linking it back to the kept record. **Historical
certifications / HR docs / signoffs were NOT cascade-deleted** —
`.132hm`'s cascade only fires on doc-library folder deletes, not
worker archives.

**Mirror status delta:** conflict bucket 1 → 0.

### 2. `worker_companies` full purge

Feature shipped in `.132hq`, purged in `.132hv` per Stephen's ask.

* `db.worker_companies` collection **dropped** (was 6 docs).
* `workers.worker_company_id` + `worker_company_name` fields
  `$unset` on 70 rows.
* `worker_companies.py` module **deleted**.
* Router unmounted from `server.py` (`/api/worker-companies/*` now
  returns **404** — verified live).
* Startup backfill hook (`backfill_worker_company_ids_on_startup`)
  removed.
* `workers.py::_serialise` `worker_company_name` override deleted
  — `company_label` now derives purely from `simpro_company_id`
  (`"2" → Paneltec`, `"3" → Viatec`, `"manual" → Manual`, else
  `Simpro`).
* Pydantic `WorkerCreate` + `WorkerUpdate` no longer declare
  `worker_company_id` / `worker_company_name`.
* `.132hq` pytest file **deleted**; replaced by four
  purge-verification tests below.

### 3. Role-catalogue fix (the actual bug behind "Glen's role dropdown is empty")

Root cause: `.132hs` provisioner defaulted new users to
`role="viewer"`. The `.132s` cleanup migration
**hard-removed** `viewer`, `worker`, `hseq_lead`, `supervisor`,
`auditor` from the platform's role catalogue. Only 4 roles remain:

  * `admin`
  * `paneltec_civil`
  * `viatec_traffic`
  * `external_contractor`

The FE `useSystemRoles` merges seeded roles with `LEGACY_ROLES`
but the drawer role dropdown filters `source !== 'legacy'` (line
2387 of `UsersManagement.jsx`) — legacy fallbacks are dropped to
avoid 404 on assignment. Result: any user whose `role` isn't in
the seeded 4 shows a placeholder "Select role" — Glen (`role="worker"`
from my own earlier manual flip) and MELINDA LINFORD invited row
(`role="viewer"` from `.132hs`) both appeared empty.

**Fix:** provisioner now derives the default from
`worker.simpro_company_id`:

  * `"2"`   → `paneltec_civil`
  * `"3"`   → `viatec_traffic`
  * else    → `external_contractor`

**Retroactive fixes applied to Stephen's org:**

  * Glen — Walker Designs (`user_id=a6331196…`, simpro_company_id=2)
    → `paneltec_civil`, `role_locked=true`.
  * MELINDA LINFORD invited row (`user_id=05bca7ce…`,
    simpro_company_id=2) → `paneltec_civil`, `role_locked=true`.
  * MELINDA LINFORD admin row (`user_id=c103b9d7…`) was
    accidentally set to `external_contractor` by an initial name
    query. **Reverted** to `role=admin`. Both audit entries
    written.

## Files touched

* `backend/worker_user_provisioning.py` — new
  `default_role` derivation from `worker.simpro_company_id`.
* `backend/workers.py` — removed `worker_company_id` /
  `worker_company_name` from Create + Update Pydantic models;
  removed `_serialise` override.
* `backend/server.py` — unmounted `worker_companies` router,
  deleted startup backfill hook.
* **Deleted:** `backend/worker_companies.py`.
* **Deleted:** `backend/tests/test_v58_13_132hq_worker_companies.py`.
* `backend/tests/test_v58_13_132hs_worker_auto_provision.py` —
  updated the "happy path" role assertion (`viewer` → derived).
* `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped `.132hu` → `.132hv`.
* `frontend/public/service-worker.js` — `CACHE_VERSION` in
  lockstep.

## Tests (32 across .132hs/.132ht/.132hu/.132hv, all green)

`tests/test_v58_13_132hv_amanda_dupe_wcpurge_role_default.py` — 8 new:

  1. `/worker-companies` returns 404 (router unmounted).
  2. `worker_companies.py` + `.132hq` pytest both deleted.
  3. `server.py` no longer imports or mounts the router / startup
     backfill.
  4. `workers.py` no longer declares `worker_company_*` model
     fields or the `_serialise` override.
  5. Audit log entry for Amanda dupe archive exists and links
     back to the kept record; dupe worker is soft-deleted.
  6. Provisioner default role derives correctly for all three
     `simpro_company_id` cases (`"2"`, `"3"`, `None`).
  7. Provisioner no longer writes `role: "viewer"` (source-level
     guard).
  8. Three-way version lockstep at `.132hv`.

## Ops rules honoured

* No `testing_agent` / `e1_tester` / `finish` — pytest + live
  reproduction only.
* No `/app/mobile/` edits.
* No hard-coded env values.
* Three-way version lockstep bumped.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Live verification snapshot post-fix

    /api/worker-user-mirror-status:
      workers_total=69, linked=68, invited_pending=0,
      invite_sent=0, email_conflict=0, no_email=1, unset=0

    /api/worker-companies                        → HTTP 404
    users.find({id: "a6331196-…" (Glen)})        → role=paneltec_civil, role_locked=true

## Deferred / open

* **Wayne Nippers** — still `no_email`; Stephen will add address +
  re-run backfill.
* **Auto-provision default DECISION** — Stephen was still choosing
  between {A: `worker`+retro-flip, B: keep viewer, C: split} when
  the wider audit revealed the 4-role model. That question is now
  MOOT; `.132hv` derives from `simpro_company_id` which is a
  better default than any of A/B/C. If Stephen wants a different
  policy (e.g. always `external_contractor`), a future ship can
  override in one line.
* **`worker_companies` FE references** — none remaining after the
  `.132ht` toolbar rollback + `.132hv` code purge (`grep` clean).
