# v58.13.132r — Role consolidation · Discovery (Part 1, FINAL — 4-role target)

**Status**: READ-ONLY discovery complete. NO writes performed. Pausing
for green-light before Part 2 (migration).

**Target confirmed by user**: **4 roles** — HSEQ Officer folded into
company-scoped bucket (no standalone HSEQ role; there are no real
users with a distinct HSEQ label in the live tenant).

## Final 4-target mapping

1. **Paneltec Civil** — all field workers on Simpro Company 2
2. **Viatec Traffic Solutions** — all field workers on Simpro Company 3
3. **Admin** — Full Admin + Owner + Site Manager + Read-Only Auditor equivalents
4. **External Contractor** — outside contractors, restricted access

## Executive summary

The system has **33 role docs** in the `roles` collection, of which
**27 are active** (11 system + 16 active custom, 6 already tombstoned).
The active 27 fold cleanly into 4 targets once we cross-reference
`users.simpro_employee_id → workers.company_id`.

Frontend surface:
- **9 permission-preset tiles** (6 built-in FE + 3 custom DB rows) →
  collapse to **4 built-in tiles** + 3 tombstoned customs.
- **5 Forms-per-role tabs** (Worker · Supervisor · Foreman ·
  Contractor · HSEQ) → **4 tabs** matching the 4 target roles.

## Part 1a — Current 27 active roles → 4 targets

### 11 system roles
| role_id | Target | Note |
| --- | --- | --- |
| `admin` | **Admin** | reused as-is |
| `hseq_manager` | *company-scoped* | folds into Paneltec Civil OR Viatec Traffic Solutions based on the user's Simpro company_id; no standalone HSEQ target |
| `hseq_manager_readonly` | *company-scoped* | same |
| `hseq_manager_creator` | *company-scoped* | same |
| `report_emailing_admin` | **Admin** | |
| `responsible_manager` | **Admin** | |
| `mechanic` | **Admin** | office role |
| `training_inductions_only` | **Admin** | |
| `contractor_rep` | **External Contractor** | |
| `contractor_rep_submit_only` | **External Contractor** | |
| `general_user` | *company-scoped* | Paneltec Civil or Viatec by cid |

### 16 active custom roles
| role_id | Target |
| --- | --- |
| `custom_director`, `custom_administration`, `custom_admin_assistant`, `custom_business_development_manager`, `custom_operations_manager`, `custom_mechanic_technician` | **Admin** |
| `custom_safety_and_compliance_manager` | *company-scoped* (currently Craig · Company 2 → Paneltec Civil; folded as HSEQ, no standalone target per final brief) |
| `custom_construction_worker_l1/l2/l3/cw2`, `custom_machine_operator`, `custom_plumber`, `custom_precast_panel_employee`, `custom_cleaner` | **Paneltec Civil** |
| `custom_traffic_controller` | **Viatec Traffic Solutions** |

### 6 deprecated (already `is_active=false`)
Leave as-is. No migration entry needed.

## Part 1b — User bucketing (4 targets, 71 active users)

```
Admin                     : 13 users
Paneltec Civil            : 27 users
Viatec Traffic Solutions  : 26 users
External Contractor       :  1 user      (test fixture)
Ambiguous                 :  4 users     (ALL test fixtures)
                            ────
                             71
```

### Admin bucket (13 · confirmed placements)
```
stephen@paneltec.com.au          admin                                          Traffic Controller (title)
amanda.guy@paneltec.com.au       admin                                          Office Manager
ellie@paneltec.com.au            admin           (Company 3 tagged but role=admin wins)
melinda3260@gmail.com            admin                                          Admin Assistant
craig@paneltec.com.au            admin           (Safety & Compliance Manager title; per final brief, role=admin → Admin)
john@paneltec.com.au             custom_director                                Director
service@paneltec.com.au          custom_mechanic_technician                     Mechanic-Technician
katrina.guy@paneltec.com.au      admin                                          Administration
mat.loone@paneltec.com.au        custom_business_development_manager            Business Development Manager
patrick@paneltec.com.au          custom_operations_manager                      Operations Manager
testagent@example.com            admin           (test fixture)
tester_agent_123@example.com     admin           (test fixture)
testuser_whs_reg@example.com     admin           (test fixture)
```

### Paneltec Civil bucket (27)
All construction workers L1/L2/L3/CW2, plumbers, machine operators,
precast panel employees, cleaner — all on Company 2.

### Viatec Traffic Solutions bucket (26)
All 26 traffic controllers on Company 3.

### External Contractor bucket (1)
`contractor-rep-fixture@paneltec.com` — test fixture. No real contractor users yet.

### Ambiguous list (4 · all test fixtures)
```
pending-activation-fixture@paneltec.com.au  general_user   → propose Admin
hseq-lead-fixture@paneltec.com.au           hseq_manager   → propose Paneltec Civil (test-suite default)
worker-fixture@paneltec.com.au              general_user   → propose Paneltec Civil
admin@paneltec.com                          general_user   → propose Admin
```

## Part 1c — Permission presets consolidation (9 → 4)

Delete plan: build **4 new** `is_builtin=true` presets (one per
target), **tombstone the 3 custom** presets (`deprecated=true`),
retire the 6 legacy built-in FE tiles by rendering only presets
matching the 4 target roles.

The 3 custom presets:
```
· field_worker_0af29c   · "Field Worker (Custom)"     · based_on: field_worker
· full_admin_d4e876     · "Full Admin (Custom)"       · based_on: full_admin
· full_admin_2669df     · "Full Admin (Custom) #2"    · based_on: full_admin  (dup)
```

**All 3 baseline-match** their `based_on` per initial DB scan — safe
to collapse. Delta-check runs in the migration script; any bespoke
tokens get logged to `role_migration_log.notes` before tombstoning.

## Part 1d — Forms-per-role (5 tabs → 4 tabs)

Rename current tabs `Worker · Supervisor · Foreman · Contractor ·
HSEQ` → `Paneltec Civil · Viatec Traffic Solutions · Admin · External
Contractor`.

Migration duplicates the current `Worker`/`Supervisor`/`Foreman`
per-form settings onto **both** Paneltec Civil AND Viatec Traffic
Solutions (they inherit the same field-worker form set at first;
admins diverge later if needed). The current `HSEQ` tab's ON/OFF
settings union into **both** company-scoped roles (any form
currently exposed to HSEQ is exposed to both company field roles).

## Part 2 — Implementation plan (4-target · same shape as prior)

### Step 1 · Seed 3 new system roles + reuse `admin`
`SYSTEM_ROLES` gets 3 new entries (`paneltec_civil`, `viatec_traffic`,
`external_contractor`); `admin` reused as-is.

### Step 2 · Rebuild `permission_presets`
Insert 4 built-in preset docs, tombstone the 3 customs
(`deprecated=true`).

### Step 3 · Deprecate 22 legacy roles
Set `deprecated=true, deprecated_at=<now>, superseded_by=<new_role_id>`.
Never hard-delete.

### Step 4 · Migration script
`/app/backend/scripts/migrate_roles_to_4_v58_13_132r.py`

- **Dry-run default**
- `--commit` writes with `role_migration_log` audit trail:
  `{id, user_id, email, old_role, old_role_id, new_role_id,
  migrated_at, migrated_by, batch_id, notes}`
- `--rollback --batch-id <id>` restores from log
- Locked `MAPPING = {...}` dict inside the script — reviewed
  before commit

### Step 5 · FE reshape (4 targets)
- `PermissionPresetsAdmin.jsx` — 4 preset cards + archived accordion
- `ListRolesTab.jsx` + `RolesAdmin.jsx` — 4 active + archived accordion
- `RoleFormsSection.jsx` — 4 tabs, current settings duplicated onto
  Paneltec Civil + Viatec Traffic Solutions per Part 1d
- `MobileModulesSection.jsx` — Live Preview dropdown extends
  3 scopes → **4 scopes** (add External Contractor)

### Step 6 · Ship
- All 162 pytests must stay green
- Bump `RUNNING_VERSION` + `MOBILE_BUNDLE_VERSION` `.132q4 → .132r`
- `CACHE_VERSION` untouched
- Ship memo `/app/memory/v58_13_132r_role_consolidation_shipped_finish_deferred.md`

## Guardrails held in Part 1
- ✅ NO writes to any collection during discovery
- ✅ NO deletion of any role doc
- ✅ Live Preview 3-scope dropdown from `.132p` still working
- ✅ Zero code changes shipped; only the read-only discovery
  script at `/app/backend/scripts/discover_roles_v58_13_132r.py`
  (persisted per the recent pod-restart directive) + this memo

## Green-light checklist (4 questions)

1. ⬜ **Craig** (`craig@paneltec.com.au`, `role=admin` + position
   "Safety and Compliance Manager") — final brief rule says
   `role=admin → Admin`. **Currently in Admin bucket.** Confirm?
2. ⬜ Confirm 4 ambiguous test fixtures:
   - `pending-activation-fixture@paneltec.com.au` → **Admin**
   - `hseq-lead-fixture@paneltec.com.au` → **Paneltec Civil**
     (test-suite default; the fixture is a Paneltec HSEQ manager)
   - `worker-fixture@paneltec.com.au` → **Paneltec Civil**
   - `admin@paneltec.com` → **Admin**
3. ⬜ Confirm `ellie@paneltec.com.au` (`role=admin` + Company 3 tag)
   stays in **Admin** per the final brief (`role=admin → Admin`
   wins over company_id).
4. ⬜ Confirm the 22 legacy roles get `deprecated=true` (soft),
   never hard-deleted.

Awaiting your green-light before Part 2 (migration script + FE
reshape + ship).
