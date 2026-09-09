# v58.13.132s — Role docs cleanup — DISCOVERY (Part 1)

Status: **AWAITING GREEN-LIGHT.** No writes performed. Sources of truth:
live Mongo query (`roles`, `users`, `role_audit`, `role_migration_log`,
`simpro_import_audit`, `app_state`), plus static reads of
`backend/roles_catalogue.py`, `backend/simpro_import_users.py`,
`scripts/migrate_roles_to_4_v58_13_132r.py`,
`scripts/sync_workers_to_users_v58_13_132r_hotfix.py`.

## Headline

- **36 role docs** currently live in `roles` (matches user's count).
- **4 KEEP** targets: `admin` (14 users), `paneltec_civil` (29 users),
  `viatec_traffic` (28 users), `external_contractor` (0 active).
- **10 legacy seeded** roles (excluding `admin`) — **all at 0 active
  users**. Safe hard-delete.
- **16 Simpro-auto position roles** (`source=simpro_position_auto`) —
  **14 at 0 users**, **2 with drift** (Josh Drew, Adrian Mitchell).
- **6 test/cachebust** custom roles — all soft-deleted or inert, 0
  users. Safe hard-delete.
- **Drift users: 2** (user's brief said "1" — actually 2; see Table B).

## Table A — Complete role inventory (36 rows)

| # | role_id | Name | source | active_users | test/deleted_users | Proposed action |
|---|---|---|---|---:|---:|---|
| 1 | `admin` | Administrator | seed | 14 | +1 | **KEEP** (target) |
| 2 | `paneltec_civil` | Paneltec Civil | (system) | 29 | +2 | **KEEP** (target) |
| 3 | `viatec_traffic` | Viatec Traffic Solutions | (system) | 28 | 0 | **KEEP** (target) |
| 4 | `external_contractor` | External Contractor | (system) | 0 | +1 | **KEEP** (target) |
| 5 | `contractor_rep` | Contractor Representative | seed | 0 | 0 | **HARD DELETE** |
| 6 | `contractor_rep_submit_only` | Contractor Representative (Submit-Only) | seed | 0 | 0 | **HARD DELETE** |
| 7 | `general_user` | General User | seed | 0 | +4 | **HARD DELETE** |
| 8 | `hseq_manager` | HSEQ Manager | seed | 0 | +1 | **HARD DELETE** |
| 9 | `hseq_manager_creator` | HSEQ Manager (Creator) | seed | 0 | 0 | **HARD DELETE** |
| 10 | `hseq_manager_readonly` | HSEQ Manager (Read-only) | seed | 0 | 0 | **HARD DELETE** |
| 11 | `mechanic` | Mechanic | seed | 0 | 0 | **HARD DELETE** |
| 12 | `report_emailing_admin` | Report Emailing | seed | 0 | 0 | **HARD DELETE** |
| 13 | `responsible_manager` | Responsible Manager | seed | 0 | +1 | **HARD DELETE** |
| 14 | `training_inductions_only` | Training / Inductions Only | seed | 0 | 0 | **HARD DELETE** |
| 15 | `custom_admin_assistant` | Admin Assistant | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ admin bucket) |
| 16 | `custom_administration` | Administration | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ admin bucket) |
| 17 | `custom_business_development_manager` | Business Development Manager | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ admin bucket) |
| 18 | `custom_cleaner` | CLEANER | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ paneltec_civil) |
| 19 | `custom_construction_worker_cw2` | Construction Worker CW2 | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ paneltec_civil) |
| 20 | `custom_construction_worker_l1` | Construction Worker L1 | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ paneltec_civil) |
| 21 | `custom_construction_worker_l2` | Construction Worker L2 | simpro_position_auto | **1** | 0 | **REMAP** Adrian ⇒ `paneltec_civil` (cid=2), then **HARD DELETE** |
| 22 | `custom_construction_worker_l3` | Construction Worker L3 | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ paneltec_civil) |
| 23 | `custom_director` | Director | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ admin bucket) |
| 24 | `custom_machine_operator` | Machine Operator | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ paneltec_civil) |
| 25 | `custom_mechanic_technician` | Mechanic-Technician | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ admin bucket, per `.132r`) |
| 26 | `custom_operations_manager` | Operations Manager | simpro_position_auto | **1** | 0 | **REMAP** Josh ⇒ `admin` (FORCE_ADMIN), then **HARD DELETE** |
| 27 | `custom_plumber` | Plumber | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ paneltec_civil) |
| 28 | `custom_precast_panel_employee` | Precast Panel Employee | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ paneltec_civil) |
| 29 | `custom_safety_and_compliance_manager` | Safety and Compliance Manager | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ admin bucket, per `.132r`) |
| 30 | `custom_traffic_controller` | Traffic Controller | simpro_position_auto | 0 | 0 | **HARD DELETE** (⇒ viatec_traffic) |
| 31 | `custom_cachebust_1b569a` | CacheBust 1b569a | admin_created (soft-deleted) | 0 | 0 | **HARD DELETE** |
| 32 | `custom_cachebust_1c1cc9` | CacheBust 1c1cc9 | admin_created (inactive) | 0 | 0 | **HARD DELETE** |
| 33 | `custom_cachebust_59a895` | CacheBust 59a895 | admin_created (inactive) | 0 | 0 | **HARD DELETE** |
| 34 | `custom_fallback_test_443222` | Fallback Test 443222 | admin_created (soft-deleted) | 0 | 0 | **HARD DELETE** |
| 35 | `custom_fallback_test_825f78` | Fallback Test 825f78 | admin_created (soft-deleted) | 0 | 0 | **HARD DELETE** |
| 36 | `custom_fallback_test_941283` | Fallback Test 941283 | admin_created (soft-deleted) | 0 | 0 | **HARD DELETE** |

Active-user counts exclude `deleted_at != null` and `is_test_fixture=true`.
`+N` shows how many test/deleted users still reference the role (for
audit-trail preservation — soft-deleted user rows keep their old
`role_id` string; not a live pointer).

Net: **KEEP 4**, **HARD DELETE 32**.

## Table B — Drift users (positions not yet bucketed to 4 targets)

| Email | Name | company_id | simpro_position | Current role_id | Correct target (per `.132r` rules + `sync_workers_to_users_v58_13_132r_hotfix.bucket()`) |
|---|---|---|---|---|---|
| `joshua@paneltec.com.au` | JOSHUA DREW | 2 | Operations Manager | `custom_operations_manager` | **`admin`** — matches `FORCE_ADMIN_EMAILS` (line 29 of hotfix) + `FORCE_ADMIN_FIRST_NAMES` |
| `adrianmitchell283@gmail.com` | ADRIAN MITCHELL | 2 | Construction Worker L2 | `custom_construction_worker_l2` | **`paneltec_civil`** — company_id=2 branch, non-contractor |

> **Correction to brief:** 2 drift users (not 1). Both created by the
> `.132r_workers_to_users` hotfix at 02:40:46 UTC with the correct
> bucketed role, but a subsequent code path (Simpro import auto-role,
> see "Drift RCA" below) overwrote them at 02:47:05 UTC.

### Drift RCA

- `role_migration_log`: 0 rows for both users (never migrated by the
  official `.132r` script).
- `role_audit` shows two `create_from_simpro` inserts for
  `custom_operations_manager` (idempotent duplicate; not a data bug).
- Their user docs bear `_created_by_hotfix: v58.13.132r_workers_to_users`
  with `created_at=02:40:46` and `role_assigned_at=02:47:05` — a
  **6-minute-24-second gap**. The hotfix `bucket()` returns `admin` for
  Josh and `paneltec_civil` for Adrian, so the 02:47 rewrite came from
  a different path — `simpro_import_users.create_role_from_position()`
  (called by both `import_employees_selective` line 395 and
  `sync_from_simpro_delta` line 507/530) is the only writer that
  produces `role_assigned_at` + `role_id=custom_<slug>`.
- Root cause: Simpro sync ran after the hotfix and rewrote the two
  freshly-hotfixed users onto position-specific `custom_*` roles.

## Table C — Position → 4-target mapping (Part 2 patch)

Rules crystallised from `scripts/migrate_roles_to_4_v58_13_132r.py`
+ `scripts/sync_workers_to_users_v58_13_132r_hotfix.py::bucket()`.
Applied in order — first match wins.

| Rule | Condition | Target role_id |
|---|---|---|
| 1 | email ∈ `FORCE_ADMIN_EMAILS` **or** first_name ∈ `FORCE_ADMIN_FIRST_NAMES` | `admin` |
| 2 | `is_contractor == true` | `external_contractor` |
| 3 | current `role` ∈ `ADMIN_ROLE_KEYS` (`owner`, `full_admin`, `responsible_manager`) | `admin` |
| 4 | `company_id == "2"` | `paneltec_civil` |
| 5 | `company_id == "3"` | `viatec_traffic` |
| 6 | default | `paneltec_civil` |

**No position lookup.** Position becomes a *display attribute only*
(`simpro_position` on the user doc; never a role_id).

**FORCE_ADMIN_EMAILS** (unified across `.132r` + hotfix, deduped):
`amanda.guy@paneltec.com.au`, `john@paneltec.com.au`,
`joshua@paneltec.com.au`, `mat.loone@paneltec.com.au`,
`melinda3260@gmail.com`, `patrick@paneltec.com.au`,
`stephen@paneltec.com.au`.
**FORCE_ADMIN_FIRST_NAMES**: `josh`, `joshua`.

## Part 2 — Simpro sync patch plan

Two writers are the drift source. Both need the same patch: **replace
`create_role_from_position(position, actor)` with `bucket_target_role(
worker_or_user_doc)` returning one of the 4 target `role_id`s.**

1. **`backend/simpro_import_users.py::import_employees_selective`**
   (lines 390-431 — new-user branch).
   Currently: `res = await create_role_from_position(position, actor)`
   → `new_role_id = res["role_id"]` (e.g. `custom_plumber`).
   Change to: call new helper `bucket_target_role(email, first_name,
   company_id, is_contractor)` returning `admin | paneltec_civil |
   viatec_traffic | external_contractor`. Leave `simpro_position` as a
   display attribute.

2. **`backend/simpro_import_users.py::sync_from_simpro_delta`**
   (lines 460-560 — position-change branch).
   Currently: on position change, `create_role_from_position` and
   set `role_id = custom_<slug>` (unless `role_locked`).
   Change to: on position change, **update `simpro_position` only**;
   never touch `role_id`. Users bucketed once at creation; role stays
   sticky. Admin can still promote/demote via the drawer.

3. **`backend/roles_catalogue.py::sync_from_simpro_positions` endpoint
   + `create_role_from_position` helper** — both marked deprecated
   (return HTTP 410 Gone or plain no-op with a warning), guarded by
   a feature flag `SIMPRO_POSITION_ROLES_DISABLED=true` (already the
   effective default after this migration; hard-fail belt-and-braces).

4. **Test coverage:**
    - Extend `backend/tests/test_phase_4d_v160_3_9_33.py` — assert
      that a new Simpro import lands with one of the 4 target role_ids
      and that `roles` collection cardinality is unchanged.
    - New `backend/tests/test_v58_13_132s_bucket.py` — unit-tests for
      each rule in Table C.

## Part 3 — Execution plan (after green-light)

Single migration script `scripts/migrate_roles_to_4_v58_13_132s.py` with
`--dry-run` (default) and `--commit`, wrapping:

1. Backup: `mongoexport` of `roles` + affected `users` → `/app/memory/
   v58_13_132s_backup_<ISO>.json` (both dry-run + commit modes).
2. Remap Josh + Adrian per Table B. Write `role_migration_log` rows
   with `batch_id=role-cleanup-132s-<hex>` for reversibility.
3. Sanity re-check: assert 0 users still reference any role_id in
   the 32-role hard-delete set. Abort if non-zero.
4. Hard-delete the 32 rows from `roles` (single `delete_many` by
   `role_id ∈ …`). Bust role cache. Emit `role_audit` bulk-hard-delete
   entries with `actor.email=script:v58.13.132s`.
5. Apply Part 2 code patches (Simpro sync files).
6. Version bump `RUNNING_VERSION` + `MOBILE_BUNDLE_VERSION` from
   `.132r` → `.132s`. **No `CACHE_VERSION` / `EXPECTED_CACHE_VERSION`
   bump** (per policy).
7. Ship memo `/app/memory/v58_13_132s_role_cleanup_shipped_finish_deferred.md`.
8. Rollback path: `python scripts/migrate_roles_to_4_v58_13_132s.py
   --rollback --batch-id …` restores Josh + Adrian from
   `role_migration_log`; roles doc restore requires the backup JSON
   `mongoimport --collection roles` (documented in the ship memo).

## Risks / open questions

- **R1 — Cache invalidation.** Backend maintains `_bust_role_cache()`.
  Hard-delete of 32 roles will emit 32 cache-busts. Acceptable.
- **R2 — Legacy `role` string field.** `simpro_import_users.py:407-408`
  derives `role` (legacy allow-list token) from `role_id` via
  `_derive_legacy_role`. If we bucket to 4 targets, the derived legacy
  role should match — spot-check needed on Josh (`admin`) and Adrian
  (`paneltec_civil` → likely legacy `worker`).
- **R3 — `role_locked` interaction.** Delta sync respects `role_locked`
  today. New bucketed sync should also respect it (line 507-521 logic).
- **R4 — Position-role deletion + still-referenced.** `.132r` cleanup
  had a bug pattern where LEGACY_ROLES_TO_DELETE included some rows
  that had non-zero users. The Part-3 pre-check (`sanity re-check`) is
  the belt for that.
- **R5 — Frontend fallback for role labels.** `UsersManagement.jsx:800-808`
  already handles unknown `custom_*` role_ids by prettifying the slug;
  no frontend change needed. `RolesAdmin.jsx` should be spot-checked
  post-migration for empty-state.
- **R6 — Test-fixture users on soft-deleted legacy roles.** `+N` counts
  in Table A include soft-deleted test users still pointing at
  `general_user` etc. Their `role_id` strings will become dangling
  pointers after hard-delete. Backend already handles unknown role_ids
  gracefully (`_derive_legacy_role` falls back). Acceptable.

## Green-light request

Awaiting sign-off on:

1. **Table A row-by-row action list** — anything you want kept that I
   flagged for hard-delete?
2. **Table B drift bucketing** — confirm Josh → `admin`, Adrian →
   `paneltec_civil`.
3. **Table C mapping rules** — any position that MUST map to
   `viatec_traffic` regardless of company_id, or vice versa?
4. **Part 2 patch approach** — hard-disable `create_role_from_position`
   OR leave it callable behind a feature flag for future re-enablement?
5. **Version bump target** — confirm `.132s` on `RUNNING_VERSION` +
   `MOBILE_BUNDLE_VERSION` only.

Reply with green-light + any edits to Tables A/B/C and I will proceed
to Part 2 (code patches) → Part 3 (execution).
