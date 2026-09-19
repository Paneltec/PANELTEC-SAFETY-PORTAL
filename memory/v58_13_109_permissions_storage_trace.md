# v58.13.109 — Permissions storage-path trace

**Investigation date**: 2026-09-04.
**Trigger**: Task 3 in the .109 batch flagged the "Precast Panel role"
as having drifted with an "empty `permissions` array on all roles".

## Finding: no drift. The "empty" field is a UI-label mismatch.

### Canonical storage path (verified)
- **Collection**: `db.roles`
- **Key**: `role_id` (e.g. `custom_precast_panel_employee`,
  `custom_construction_worker_l1`, `admin`, `hseq_lead`, `supervisor`,
  `worker`, `auditor`).
- **Field**: `permission_tokens: list[str]` — each token is the
  `"{resource}.{action}"` pair matching the product of
  `PERMISSIONS_SCHEMA` × `ACTIONS` in `backend/permissions.py`.

### Resolution chain at request time (per `backend/permissions.py`)
1. Per-user override — `db.user_permissions.overrides[resource][action]` (bool).
2. **Role default** — DB-first (`_role_tokens(role_id)` → `db.roles.permission_tokens[]`).
3. Hardcoded fallback — `permissions.ROLE_DEFAULTS[role][resource][action]`
   ONLY when no active DB doc exists for that role_id (boot-strap safety).

This is v58.13.35 (Phase 6) semantics — see the block comment at
`backend/permissions.py:308`.

### Precast Panel state (byte-verified from Mongo)
```
role_id: custom_precast_panel_employee
name:    Precast Panel Employee
tokens:  16
[
  'certifications.view',
  'hazards.edit', 'hazards.open', 'hazards.view',
  'help.open', 'help.view',
  'inductions.view',
  'notifications.use', 'notifications.view',
  'pre_starts.edit', 'pre_starts.open', 'pre_starts.view',
  'reference_library.view',
  'site_diary.view',
  'swms.view',
  'workers.view'
]
```
Byte-for-byte equal to `custom_construction_worker_l1` (also 16 tokens).
No sync required.

### Why the brief called it "empty"
The Roles Admin UI (`frontend/src/pages/RolesAdmin.jsx`) surfaces the
`permission_tokens[]` array under a column labelled "Permissions" —
plural. When an admin looks at the raw MongoDB dump (or the
`/api/roles/…` payload) with an expectation of a top-level
`permissions` field (singular), they see nothing there because the
canonical field is `permission_tokens`. This was a naming-alignment
red herring, not data drift.

### Regression-lock shipped with this memo
- `tests/backend_unit/test_precast_panel_permissions_v58_13_109.py`
  - `test_canonical_storage_path_is_db_roles_permission_tokens` — asserts
    the storage path assumption survives future refactors.
  - `test_precast_panel_has_16_tokens` — count pin.
  - `test_precast_panel_tokens_match_construction_worker_l1_exactly` —
    symmetric-difference diff on any drift.
  - `test_precast_panel_carries_core_daily_loop_tokens` — spot-check
    on the six load-bearing daily-loop tokens (pre_starts + hazards
    open/view/edit) so a both-roles-narrowed regression still fails.

### Ancestry / prior art
- `backend/scripts/backfill_broken_role_tokens_v58_4.py` established
  the pattern for seeding tokens on a role that had drifted to zero
  (custom_cleaner, custom_mechanic_technician). Same canonical field.
  Same idempotent merge-union approach. Precast Panel would use the
  same script if drift ever appeared — but today, none has.

### If you ever need to reseed Precast Panel manually
Duplicate the pattern from v58.4:
```python
await db.roles.update_one(
    {"role_id": "custom_precast_panel_employee"},
    {"$set": {"permission_tokens": sorted(set(before) | set(NEW_TOKENS)),
              "updated_at": now}},
)
await db.admin_actions.insert_one({
    "id": f"v58.13.109-precast-reseed-{now.replace(':','').replace('-','')[:15]}",
    "actor": "system-cleanup-v58-13-109",
    "action": "reseed_role_tokens",
    "role_id": "custom_precast_panel_employee",
    "tokens_added": added,
    "reasoning": "…",
    "backfilled_at": now,
})
```
Merge-union is safe; overwrite is not (would strip any admin-added
custom tokens).
