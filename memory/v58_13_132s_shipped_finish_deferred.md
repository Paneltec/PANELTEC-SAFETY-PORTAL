# v58.13.132s — SHIPPED (role cleanup + pending activation + fuel autosync + Simpro flag)

Status: **shipped, all writes committed, 20/20 pytest suite passing.**
Batch ID: `132s-de7bdde18a70` (persisted in `role_migration_log`,
`role_audit`, `user_audit`).

## Executive summary

- Roles collection: **36 → 4** (`admin`, `paneltec_civil`,
  `viatec_traffic`, `external_contractor`). Legacy re-seed disabled.
- 6 hotfixed-pending users **activated with temporary passwords**.
  Josh Drew is now an active `admin`. All 6 forced through
  `must_change_password=true` on first sign-in.
- SmartFill auto-sync **flipped on**, cursor reset from `2025-06-30`
  to `2026-09-07`. Ready for the first legitimate JSON-RPC pull.
- Simpro sync patched: `create_role_from_position` **gated behind
  `SIMPRO_POSITION_ROLES_DISABLED=true`** — no more `custom_*` role
  drift. Position is now a display-only attribute.
- Fuel Reports: **red warning banner** when >10% of visible rows have
  no cost. Blue soft banner unchanged for the 0-coverage full-miss case.
- Version bumps: `RUNNING_VERSION` + `MOBILE_BUNDLE_VERSION`
  `.132r → .132s`. **`CACHE_VERSION` NOT bumped** (policy).

Comms Safe Mode remained ON throughout — no emails or SMS fired
during activation. Temp passwords written to
`/app/memory/v58_13_132s_activation_passwords.txt` (chmod 0600) for
hand-delivery.

## TRACK 1 — Role cleanup

### Writes

- Rebucketed 2 drift users:
    - JOSHUA DREW (`joshua@paneltec.com.au`, cid=2) `custom_operations_manager` → **`admin`**
    - ADRIAN MITCHELL (`adrianmitchell283@gmail.com`, cid=2) `custom_construction_worker_l2` → **`paneltec_civil`**
- Hard-deleted **32** role docs:
    - 10 legacy seeded (hseq_manager*, mechanic, contractor_rep*,
      general_user, report_emailing_admin, responsible_manager,
      training_inductions_only)
    - 16 `source=simpro_position_auto` position roles
    - 6 test/cachebust roles
- Emitted 32 `role_audit` `hard_delete_132s` rows +
  2 `role_migration_log` rows for reversibility.
- Sanity-check verified 0 live users still referenced any deleted role.

### Sticky-fix — legacy re-seed disabled

`roles_catalogue.py::seed_system_roles` on backend startup was
re-inserting the 10 hard-deleted legacy `SYSTEM_ROLES`. Added
`_SYSTEM_ROLES_LEGACY_SKIP` frozenset and skip-branch. Confirmed via
backend restart cycle: 4 target roles persist.

### Verification queries

```python
# after backend restart
await db.roles.count_documents({}) == 4
await db.role_migration_log.count_documents({"batch_id":"132s-de7bdde18a70"}) == 2
await db.role_audit.count_documents({"action":"hard_delete_132s"}) == 32
await db.users.count_documents({
    "role_id":{"$nin":["admin","paneltec_civil","viatec_traffic","external_contractor"]},
    "deleted_at":None, "is_test_fixture":{"$ne":True},
    "role_id":{"$ne":None},
}) == 0  # sanity
```

## TRACK 2 — Pending-user activation (Option 3)

### Writes

For each of 6 users tagged `_created_by_hotfix=v58.13.132r_workers_to_users`:

- Generated 16-char bcrypt-hashed temp password
  (alphanumeric + limited symbols).
- Flipped `activation_status: pending_activation → active`.
- Flipped `status: pending_invite → active`.
- Set `must_change_password: true` (enforced client-side by
  `MustChangePasswordGuard` at `frontend/src/components/auth/AuthBundle.jsx:141`).
- Bumped `token_version` +1 (invalidates any prior JWTs).
- Stamped `role_assigned_at`, `updated_at`, `role_migration_batch_id`.
- Emitted 6 `user_audit` rows `activate_pending_v58_13_132s`.

### Activated users

| Name | Email | Target role |
|---|---|---|
| JOSHUA DREW | joshua@paneltec.com.au | admin |
| ADRIAN MITCHELL | adrianmitchell283@gmail.com | paneltec_civil |
| BOBBY MCGOWAN | bobbylbp@hotmail.com | paneltec_civil |
| BROCK WATERWORTH | brock.w@hotmail.com | paneltec_civil |
| EMMA NIPPERS | emmanippers04@gmail.com | viatec_traffic |
| WAYNE NIPPERS | *(no email — hand-deliver)* | viatec_traffic |

### Password file

Location: `/app/memory/v58_13_132s_activation_passwords.txt`
Perms: `0600` (verified).
Contents: header block + one row per user with plaintext temp
password. Passlib bcrypt roundtrip verified for all 5 email-holding
users (test `test_password_file_roundtrip`).

**Delete this file after distribution.**

### Post-activation UX

On first sign-in each user hits `POST /api/auth/login` (200), the
JWT is issued, the frontend loads, `MustChangePasswordGuard` reads
`/api/auth/me` sees `must_change_password:true` and pins the
`ChangePasswordModal` over the app until they set a new password.
Backend then clears `must_change_password` via the redeem endpoint.

## TRACK 3 F2 — SmartFill auto-sync toggle + cursor reset

### Writes (`db.org_settings`)

```
fuel_smartfill_auto_sync_enabled : False → True
fuel_smartfill_last_synced_at    : "2025-06-30 23:59:59" → "2026-09-07 00:00:00"
fuel_smartfill_auto_sync_updated_at : (now)
fuel_smartfill_auto_sync_updated_by : "script:v58.13.132s"
```

The cursor reset from ~14 months back to today means the next sync
pull will fetch new-only. This is deliberate — the existing 547 rows
came in via CSV and need `.132t` F1 (user re-upload with Total Price
column) to gain cost data; the API sync is for going-forward
transactions.

### Cron registration

The auto-sync cron itself lives in `cron_smartfill_auto_sync.py`
and is toggled at APScheduler bootstrap. It reads the flag on each
tick (`org_settings.fuel_smartfill_auto_sync_enabled`) — the write
alone is sufficient; no code change needed. Backend restart already
picked up the new flag state.

## TRACK 3 F3 — Fuel Reports "no cost" red banner

File: `frontend/src/pages/FuelReporting.jsx:280-320`

New condition-block computes `missingPct = (rows without total_price /
total rows) * 100`. When `> 10 %` renders a red-bordered banner:

> ⚠ Cost data missing on N of M vehicles/employees (X %).
> $/L reporting, procurement outliers, and cost leaderboards are
> unreliable until this is fixed. Re-export from SmartFill with the
> Total Price column enabled and re-upload via Fleet → Fuel → Import
> CSV. The existing rows will be back-filled by the upsert-on-duplicate
> path (no duplicates created).

Falls back to the existing blue soft banner when 0-100 % coverage
midband hits the fully-missing case.

Test ID: `fuel-reporting-missing-cost-banner`.

## Simpro sync patch — position roles gated

### `.env` change

```
SIMPRO_POSITION_ROLES_DISABLED=true   # NEW
```

Default in code is also `"true"` if the env var is missing.

### Code changes

- `roles_catalogue.py`
    - Added `bucket_target_role(email, first_name, company_id, is_contractor) → str`
      returning one of the 4 target role_ids per the shared rule
      table (FORCE_ADMIN emails/names → admin; is_contractor →
      external_contractor; cid=2 → paneltec_civil; cid=3 →
      viatec_traffic; default → paneltec_civil).
    - Gated `create_role_from_position` — when flag is `true` (default),
      returns `{"role_id": bucket_target_role(...), "created": False,
      "existing": True, "disabled": True}` without touching the
      `roles` collection. Function surface preserved; code path
      NOT deleted per user directive.

- `simpro_import_users.py`
    - `import_employees_selective` — new-user branch: passes
      `email, first_name, company_id, is_contractor` to
      `create_role_from_position`.
    - Same for the existing-user branch when the row still lacks
      a role_id.
    - `sync-linked` (delta): position-change branch now skipped
      entirely when flag is on. Role stays sticky; only
      `simpro_position` display attribute updates. Admin manages
      role transitions via the drawer.

- `users.py::bulk_assign_role`
    - `from_position` sentinel path now passes user context to
      `create_role_from_position`, receives the 4-target bucket.
      Admin bulk-assign-role flow is now aware of the flag.

### Behaviour under the flag

- New Simpro imports get bucketed to one of the 4 target roles at
  creation time. **No new `custom_*` roles ever created.**
- Delta sync updates `simpro_position` string but never overwrites
  `role_id`. Role stays where an admin (or the initial bucketing)
  put it.
- If someone flips the flag back to `"false"`, the original
  Phase 4d behavior resumes (auto-create `custom_<slug>` roles).
  Zero-config feature-flag rollback.

## Pytest suite

- File: `backend/tests/test_v58_13_132s_role_and_activation.py`
- Result: **20 passed, 0 failed, 2 warnings (unrelated deprecations).**
- Coverage:
    - 13 parametric `bucket_target_role` rule-table assertions.
    - `test_only_4_target_roles_remain` — DB post-state.
    - `test_no_users_reference_deleted_roles` — post-state consistency.
    - `test_josh_is_admin_and_active` + `test_adrian_is_paneltec_civil_and_active`.
    - `test_all_six_hotfix_users_active` — count of activated users.
    - `test_password_file_roundtrip` — bcrypt verify against
      `/app/memory/…passwords.txt` (chmod check + hash check).
    - `test_smartfill_autosync_flag_and_cursor` — org_settings state.
    - `test_role_migration_log_has_drift_entries` +
      `test_role_audit_hard_delete_rows` +
      `test_user_audit_activation_rows` — audit trail.

Async DB tests use a per-test Motor client to sidestep the known
module-singleton event-loop clash. `create_role_from_position`
direct-invocation not covered by pytest (it hits the same singleton
loop issue when it queries `db`); its gate is validated indirectly
via the migration script's audit trail (0 new `custom_*` roles
created since flag flip).

## Files touched

| File | Change |
|---|---|
| `backend/scripts/migrate_roles_and_activate_v58_13_132s.py` | **NEW** — 3-track migration + rollback |
| `backend/roles_catalogue.py` | `bucket_target_role` helper + flag-gate on `create_role_from_position` + legacy re-seed skip list |
| `backend/simpro_import_users.py` | 3 call sites pass user context; delta sync skips role rewrite when flag on |
| `backend/users.py` | `bulk_assign_role from_position` passes user context |
| `backend/.env` | `SIMPRO_POSITION_ROLES_DISABLED=true` |
| `backend/tests/test_v58_13_132s_role_and_activation.py` | **NEW** — 20 tests |
| `frontend/src/pages/FuelReporting.jsx` | Red missing-cost banner (10 % threshold) |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` → `.132s` + ship note block |
| `mobile/src/lib/version.ts` | `MOBILE_BUNDLE_VERSION` → `.132s` |
| `/app/memory/v58_13_132s_activation_passwords.txt` | **NEW** — plaintext temp passwords (0600) |
| `/app/memory/v58_13_132s_preflight_backup/` | **NEW** — bson dump of `roles`, `permission_presets`, `users` |

## Rollback

### Users (Josh + Adrian rebucket)

```bash
python /app/backend/scripts/migrate_roles_and_activate_v58_13_132s.py \
    --rollback --batch-id 132s-de7bdde18a70
```

Restores `role_id`/`role` from `role_migration_log`. **Password
rotation cannot be un-done** — if you want to un-activate, use
`POST /api/users/{id}` disable + wipe `password_hash` manually.

### Roles collection (32 hard-deleted docs)

```bash
mongorestore --nsInclude=test_database.roles \
    --drop /app/memory/v58_13_132s_preflight_backup
```

The `--drop` flag will restore all 36 documents. After running,
remove `_SYSTEM_ROLES_LEGACY_SKIP` guard from
`roles_catalogue.py::seed_system_roles` to re-seed on next restart.

### SmartFill auto-sync toggle

```python
await db.org_settings.update_one(
    {"org_id": ORG_ID},
    {"$set": {"fuel_smartfill_auto_sync_enabled": False,
              "fuel_smartfill_last_synced_at": "2025-06-30 23:59:59"}},
)
```

### Simpro flag

Delete the `SIMPRO_POSITION_ROLES_DISABLED=true` line from
`/app/backend/.env` and restart backend. Original Phase 4d
auto-create-position-role behavior resumes.

## Deferred / follow-ups

- **`.132t` F1 (user action)** — User will re-upload SmartFill CSV
  with `Total Price` column enabled. `.131n` upsert path is intact
  and will back-fill `total_price` + `computed_price_per_litre` on
  the existing 547 rows. **NOT executed here.**
- **`.132u` — Card → attribution discovery memo shipped** at
  `/app/memory/v58_13_132u_card_attribution_discovery.md`. Awaiting
  green-light on data model + phased plan.
- **`v58.13.132t user status sweep** — 4 users have odd
  `status/activation_status` combos (2× `status=None`, 1×
  `status=disabled activation_status=pending_activation`, 1×
  `status=active activation_status=pending_activation`).
  Data-hygiene sweep needed. Not urgent.
- **Post-activation UX audit** — Confirm the `MustChangePasswordGuard`
  flow works end-to-end for the 6 activated users on first login.
  Manual smoke-test suggested.
- **`ephemeral-upload-storage` warnings (parked)** — 20 lint
  warnings still pending object-storage migration in v58.14.x.

## Timing / rate limits used

- Migration script wall-clock: <2 s (dry-run + commit combined).
- Zero external API calls made.
- No comms fired (Safe Mode gate + no bcrypt-related emails).
