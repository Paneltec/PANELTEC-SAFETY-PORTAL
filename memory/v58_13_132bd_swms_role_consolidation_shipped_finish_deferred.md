# v58.13.132bd — SWMS + Roles consolidation to 4 core roles [SHIPPED · finish deferred]

Landed: 2026-02 (session ship — awaiting Stephen's on-device verification before `finish` is invoked).

## Scope (Stephen's brief — 5 steps)

| # | Deliverable | Status |
|---|---|---|
| 1 | Backfill legacy SWMS `applies_to.roles` tokens → 4 core role_ids | ✅ (0 pending; previously written in earlier `.132bd` pass) |
| 2 | Backfill legacy `users.role` / `users.role_id` → 4 core role_ids | ✅ (6 users rewritten this pass — original script missed them) |
| 3 | Swap `SwmsAssignmentsAdmin.jsx` `ROLE_CHOICES` → live `/api/admin/roles` | ✅ |
| 4 | Delete 3 dead hardcoded role Sets (`EDIT_ROLES` / `ELEVATED_ROLES` / `WRITE_ROLES`) across the 4 named files | ✅ |
| 5 | Pytest guardrail asserting no legacy tokens remain | ✅ (3/3 passing) |

## Core role_ids (canonical set)

```
admin · paneltec_civil · viatec_traffic · external_contractor
```

## Backend backfill — final results

Script `/app/backend/scripts/consolidate_legacy_roles_v58_13_132bd.py`:

* Legacy-map extended to cover `worker`, `supervisor`, `hseq_lead`, `auditor` (originally assumed absent — five accounts had them).
* User backfill now normalises BOTH `role` AND `role_id` (previous version only touched `role`).
* Preference order for target selection (matches how backend `require_permission` reads user docs):
  1. `role_id` already core → keep it (mirror to `role`)
  2. `role` already core → keep it (mirror to `role_id`)
  3. Map via `LEGACY_MAP` on `role_id` first, then `role` (prevents privilege escalation when the two fields disagree, e.g. `role='auditor'`/`role_id='general_user'` → `paneltec_civil`, not `admin`)

### 6 users rewritten (Paneltec Pty Ltd org)

| Email | old `role` | old `role_id` | new (both fields) |
|---|---|---|---|
| worker@paneltec.com | worker | general_user | paneltec_civil |
| super@paneltec.com | supervisor | responsible_manager | admin |
| audit@paneltec.com | auditor | general_user | paneltec_civil |
| worker_stephen@paneltec.com.au | worker | general_user | paneltec_civil |
| demo@paneltec.com | hseq_lead | hseq_manager | admin |
| david@appzoola.com | paneltec_civil | general_user | paneltec_civil |

All 6 also received `_role_backfilled_at` breadcrumb + `updated_at` bump.

### SWMS docs

Dry-run reports **0** SWMS docs to rewrite → the earlier `.132bd` pass already normalised all 11 legacy-tagged SWMS docs.

## Frontend

### `SwmsAssignmentsAdmin.jsx`

* Removed static `ROLE_CHOICES` array (was pinning legacy `manager`/`hseq_lead`/`supervisor`/`auditor`/`worker` — none of which are catalogue roles anymore).
* Added parallel fetch of `/admin/roles` in `load()`, materialised into `roleChoices` state as `[[role_id, name], …]`. Seed roles surface first, then custom, alphabetical inside each group.
* `Editor` component takes `roleChoices` as a prop and forwards to the roles `ChipGroup`.
* `ChipGroup` renders an italic empty-state ("No roles available — create one in Settings › Roles.") if the array is empty (prevents silent zero-chip render).
* Deny-page copy updated: was "restricted to Admin, Manager and HSEQ Lead roles" → now "restricted to users with the `swms.edit` permission".
* `EDIT_ROLES` set + its `void` reference deleted.

### Dead-set purges (3 files)

| File | Removed |
|---|---|
| `SitesAdmin.jsx` | `EDIT_ROLES` (Set) + `void EDIT_ROLES` |
| `SiteScanResolver.jsx` | `ELEVATED_ROLES` (Set) + `void ELEVATED_ROLES` |
| `Renewals.jsx` | `WRITE_ROLES` + `IMPORT_ROLES` (both Sets) + their `void` references |

All 4 files still gate via `useCan(<resource>, <action>)` — no runtime behaviour change.

### Version pair bumped in lockstep

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132bc` | `.132bd` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `.132bc` | `.132bd` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `.132bc` | `.132bd` |

Production build: **PASS** (`yarn build` — 1.2 MB gzip main bundle, no compile errors).

## Pytest guardrail

```
tests/test_v58_13_132bd_swms_role_consolidation.py::test_no_swms_references_legacy_role  PASSED
tests/test_v58_13_132bd_swms_role_consolidation.py::test_no_user_role_is_legacy          PASSED
tests/test_v58_13_132bd_swms_role_consolidation.py::test_migration_is_idempotent         PASSED
======================= 3 passed in 0.70s =======================
```

Idempotency: post-commit dry-run reports `SWMS docs to rewrite: 0` / `User docs to rewrite: 0`, which the pytest asserts.

## Known follow-ups (deliberately out of scope for `.132bd`)

7 additional pages still define local `WRITE_ROLES` sets against legacy tokens. These were NOT in Stephen's 4-file cleanup brief for `.132bd`. Track for a future letter:

* `Ask.jsx` (dead — `void`d)
* `Certifications.jsx` (dead — `void`d)
* `DocumentLibrary.jsx` (**LIVE — L748 `WRITE_ROLES.has(user?.role)`** — needs migration to `useCan('documents', 'edit')`)
* `FormSubmissions.jsx` (dead — `void`d)
* `Forms.jsx` (dead — `void`d)
* `Suppliers.jsx` (dead — `void`d)
* `Workers.jsx` (dead — `void`d)

## Files touched

```
backend/scripts/consolidate_legacy_roles_v58_13_132bd.py   (extended LEGACY_MAP + both-field write)
frontend/src/pages/SwmsAssignmentsAdmin.jsx                (live roles fetch)
frontend/src/pages/SitesAdmin.jsx                          (dead EDIT_ROLES removed)
frontend/src/pages/SiteScanResolver.jsx                    (dead ELEVATED_ROLES removed)
frontend/src/pages/Renewals.jsx                            (dead WRITE_ROLES/IMPORT_ROLES removed)
frontend/src/lib/version.js                                (RUNNING_VERSION + EXPECTED_CACHE_VERSION → .132bd)
frontend/public/service-worker.js                          (CACHE_VERSION → .132bd)
```

Finish tool intentionally NOT invoked — awaiting Stephen's on-device tab-reload verification (soft-refresh should surface the new SW).
