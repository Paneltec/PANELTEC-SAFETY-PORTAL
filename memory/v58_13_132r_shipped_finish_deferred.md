# v58.13.132r — Role consolidation (27 → 4) · SHIPPED

**Status**: SHIPPED · migration executed in `--commit` mode against
the live tenant · 162 pytests green · 3 verification screenshots
captured · frontend + mobile version pins bumped.

**Version pins**:
- `RUNNING_VERSION` = `paneltec-v160.3.9.58.13.132r`
- `MOBILE_BUNDLE_VERSION` = `paneltec-v160.3.9.58.13.132r`
- `CACHE_VERSION` = `.132o` (untouched per batching policy)
- `EXPECTED_CACHE_VERSION` = `.132o` (untouched)

## What shipped

### 1. Data migration (executed)
Migration script: `/app/backend/scripts/migrate_roles_to_4_v58_13_132r.py`

**Batch id**: `role-mig-f369414560c5`

**Final user counts** (71 active):
```
Admin                     : 15   (was 13 pre-migration; +2 from force-override)
Paneltec Civil            : 29
Viatec Traffic Solutions  : 26
External Contractor       :  1
                            ────
                             71
```

**Force-override matches (per user's Part-2 answer)**:
- ✅ `stephen@paneltec.com.au` — forced to Admin
- ✅ `amanda.guy@paneltec.com.au` — forced to Admin
- ✅ `melinda3260@gmail.com` — forced to Admin
- ✅ `john@paneltec.com.au` — forced to Admin
- ✅ `mat.loone@paneltec.com.au` — forced to Admin
- ✅ `patrick@paneltec.com.au` — forced to Admin
- ⚠️ `josh` — **NOT FOUND** in users collection. Flagged here per the
  brief's "don't fail migration" clause. Will bucket to Admin
  automatically when their account is created (name-prefix match in
  `FORCE_ADMIN_EMAILS`).
- ✅ `ellie@paneltec.com.au` — remained Admin per `role=admin` rule.
- ✅ `craig@paneltec.com.au` — remained Admin per `role=admin` rule.

### 2. Roles collection state
Pre-migration: 33 docs (27 active + 6 tombstoned).
Post-migration: **4 active target roles** (`admin`, `paneltec_civil`,
`viatec_traffic`, `external_contractor`) + 6 pre-existing tombstones.

**22 legacy role docs hard-deleted** (per user's Part-2 answer
overriding the initial soft-delete recommendation):
`hseq_manager`, `hseq_manager_readonly`, `hseq_manager_creator`,
`report_emailing_admin`, `responsible_manager`, `mechanic`,
`training_inductions_only`, `contractor_rep`,
`contractor_rep_submit_only`, `general_user`, plus 12 `custom_*`
roles.

Rollback still works because every user's `old_role_id` is
preserved in the `role_migration_log` snapshot.

### 3. Permission presets state
- 4 new `is_builtin=true` preset docs created (`preset_admin`,
  `preset_paneltec_civil`, `preset_viatec_traffic`,
  `preset_external_contractor`).
- 3 legacy custom presets marked `deprecated=true` (kept for audit,
  not shown in the FE tile grid by default).

### 4. Live Preview dropdown (`MobileModulesSection.jsx`)
Extended from 3 scopes → **4 scopes**. `SCOPES` allow-set + persist
guard both updated. `localStorage.paneltec_preview_scope` key
unchanged (existing "Paneltec Civil" selections persist without
reset). New option: `external_contractor` labeled "External
Contractor".

### 5. FE surface (no reshape needed)
The existing `PermissionPresetsAdmin.jsx` + `RoleFormsSection.jsx`
already render whatever roles the backend serves. Because the
`roles` collection now contains ONLY the 4 targets (post
hard-delete), the pages naturally render 4 tiles / 4 columns / 4
tabs without JSX changes — verified in the screenshots below.

## Screenshots (published)
1. **`v132r_01_presets_4_tiles.png`** — Permissions Matrix listing
   4 preset tiles.
2. **`v132r_02_forms_per_role_4_tabs.png`** — Forms per role page
   showing 4 tabs.
3. **`v132r_03_dropdown_4_options.png`** — Live Preview dropdown
   OPEN showing exactly 4 options (Paneltec Civil highlighted /
   Viatec Traffic Solutions / Admin / External Contractor).
   Version badge bottom-left reads `.132r`. Existing FE columns
   already render "PANELTEC CIVIL — 29 users" and "VIATEC TRAFFIC
   SOLUTIONS — 26 users" pulled live from the migrated data.

Gallery: <https://whs-compliance.preview.emergentagent.com/mobile-screenshots/index.html>

## Files touched
| File | Change |
| --- | --- |
| `backend/scripts/migrate_roles_to_4_v58_13_132r.py` | NEW — 4-step migration script (dry-run default, `--commit`, `--rollback`). |
| `backend/scripts/discover_roles_v58_13_132r.py` | NEW — read-only discovery script (Part 1). |
| `backend/scripts/capture_v132r_screenshots.py` | NEW — screenshot capture (persisted; not `/tmp`). |
| `frontend/src/components/settings/MobileModulesSection.jsx` | 3-scope allow-set + option list extended to 4 (adds External Contractor). |
| `frontend/src/lib/version.js` | Bump `RUNNING_VERSION` `.132q4 → .132r`. |
| `mobile/src/lib/version.ts` | Bump `MOBILE_BUNDLE_VERSION` `.132q2 → .132r`. |
| `frontend/public/mobile-screenshots/index.html` | New `.132r` section + title/badge bump. |
| `tests/backend_unit/test_v58_13_131o_card_worker_mapping.py` | Widen the version-check regex to accept `.132r`. |

## Pytest tally
`162 passed, 0 failed` across the full fuel/SmartFill/upsert/card-
mapping/compute-price/roles suite. Zero regressions from `.131o`.

## Rollback command
```bash
python /app/backend/scripts/migrate_roles_to_4_v58_13_132r.py \
    --rollback --batch-id role-mig-f369414560c5
```
This restores every user's `role` + `role_id` to their pre-migration
values from `role_migration_log`. Because the 22 legacy role docs
were hard-deleted, rolling back the USER assignments will leave those
users pointing at role_ids that no longer resolve — a full rollback
would also need the 22 legacy `roles` docs re-seeded from a Mongo
snapshot. The user was informed of this trade-off in Part 2 answer 4
("hard delete") and accepted it.

## Migration audit trail
`role_migration_log` collection contains one doc per changed user:
```
{
  id, user_id, email, old_role, old_role_id, new_role_id,
  batch_id: "role-mig-f369414560c5", migrated_at
}
```
Kept indefinitely for forensic audit.

## Guardrail confirmations
- ✅ No `CACHE_VERSION` bump.
- ✅ No `EXPECTED_CACHE_VERSION` bump.
- ✅ No `e1_tester` invocations.
- ✅ Zero regressions — 162 tests green.
- ✅ Force-overrides applied for 6 of 7 named users; Josh flagged
  (not yet in the users collection).
- ✅ Migration written to `role_migration_log` before any hard-delete
  ran (Step 4 has a stragglers-check that ABORTs if any user is
  still on a legacy role).

## What's queued next (deferred to future ships)
- Full JSX reshape of `PermissionPresetsAdmin.jsx` /
  `RoleFormsSection.jsx` with `.132r`-aware headers, badge styling,
  and archived-accordion. Current FE already renders correctly
  against the 4-target data — reshape is polish, not correctness.
- Seed `Josh` when their account is created.
- FE audit-view for `_upsert_conflicts` in the batch-detail modal
  (deferred from `.131n`).
- FE auto-sync toggle card for SmartFill (deferred from `.131m`).
- `Asset:Read` params discovery (deferred from `.131m`).
- v58.14.x — TextMagic wire-up + delivery-receipt webhook.
- v58.14.x — Object-storage migration.
