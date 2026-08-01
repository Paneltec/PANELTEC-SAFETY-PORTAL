# 05 — Data model (proposed Pydantic classes + Mongo collections)

**Version:** v160.3.9.26-P1 · **Date:** 2026-02-01

**Not committed.** These are drafts. Nothing under `backend/models/`
or `backend/*.py` is touched in Phase 1.

## Design summary

- Paneltec today has:
  - `ROLE_DEFAULTS` — hard-coded matrix in `permissions.py` (5 roles).
  - `user_permissions` collection — per-user overrides layered on top of
    role defaults (already in production, see `permissions.py`
    `effective_for()`).
  - `permission_presets` collection — reusable matrices, admin-authored
    (see `permission_presets.py`).
- Phase 2/3 extends this:
  - `permissions` — the canonical token catalogue, derived from
    `PERMISSIONS_SCHEMA × ACTIONS`. Seeded, not hand-edited. Enables the
    UI to render the matrix.
  - `roles` — persistent role table. Seeded from `ROLE_DEFAULTS`; also
    accepts `is_system=false` custom rows.
  - `users.role_id` — new FK. Legacy `users.role` string kept.
  - `user_permission_overrides` — new. Sparse (only cells that differ
    from the role default). This differs from the current
    `user_permissions.overrides` (which stores the whole matrix). See
    "Migration note" at the bottom.
  - Audit collections — new.

## Collection: `permissions` (catalogue — seeded, read-only in prod)

Purpose: source of truth for the UI matrix so it does not have to import
Python constants. Rebuilt on server boot from
`PERMISSIONS_SCHEMA × ACTIONS`.

```python
# backend/models_permissions.py (DRAFT)
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Literal, Optional

Action = Literal["open", "view", "edit", "delete", "email", "team_view", "use", "approve"]
# `approve` is NEW (see doc 03 permittowork.Approver rationale).

class Permission(BaseModel):
    token: str = Field(..., description="e.g. 'swms.edit'")
    resource: str
    action: Action
    label: str
    group: str = Field(..., description="Lucidity module family, e.g. 'competency'")
    subgroup: Optional[str] = None
    email_supported: bool = True
    delete_supported: bool = True
    is_system: bool = True
```

Mongo indexes:

- unique: `token`
- non-unique: `resource`, `group`

## Collection: `roles`

```python
# backend/models_roles.py (DRAFT)
class Role(BaseModel):
    role_id: str = Field(..., regex=r"^[a-z][a-z0-9_.-]{0,63}$")
    name: str
    description: str
    permission_tokens: list[str] = Field(default_factory=list)
    is_system: bool = False
    org_id: Optional[str] = None      # None for system roles, set for custom
    created_by: Optional[str] = None
    created_at: str                    # ISO-8601, TZ-aware
    updated_at: str
    deprecated: bool = False
    supersedes_role_id: Optional[str] = None  # for migration
```

Mongo indexes:

- unique: `role_id`
- non-unique: `org_id`

Seeded rows (from doc 04): `admin`, `hseq_manager`,
`hseq_manager_readonly`, `hseq_manager_creator`, `report_emailing_admin`,
`responsible_manager`, `contractor_rep`, `contractor_rep_submit_only`,
`mechanic`, `training_inductions_only`, `general_user`.

## Collection: `users` — additions

```python
# additions to backend/models.py User (DRAFT — NOT committed)
class User(BaseModel):
    # ... all existing fields unchanged ...
    role: str                                    # legacy, keep during transition
    role_id: Optional[str] = None                # NEW — FK into roles.role_id
    simpro_employee_id: Optional[str] = None     # NEW — for Simpro sync
    simpro_position: Optional[str] = None        # NEW — "Position" from Simpro
    simpro_last_synced_at: Optional[str] = None  # NEW — ISO-8601
    is_archived: bool = False                    # NEW — true when Simpro shows terminated
    activation_status: Literal[
        "active", "pending_activation", "archived"
    ] = "active"                                 # NEW — matches archived + Simpro-new
```

New Mongo indexes:

- non-unique: `role_id`, `simpro_employee_id`, `is_archived`

## Collection: `user_permission_overrides` (NEW — sparse)

```python
# backend/models_permission_overrides.py (DRAFT)
class UserPermissionOverride(BaseModel):
    id: str
    user_id: str
    token: str                                # e.g. 'swms.delete'
    grant: Literal["allow", "deny"]
    reason: str                               # required — free-text audit note
    granted_by: str                           # user_id of admin who set it
    granted_at: str
    revoked_at: Optional[str] = None
    revoked_by: Optional[str] = None
```

Mongo indexes:

- unique compound: `(user_id, token, revoked_at)` where `revoked_at IS NULL`
- non-unique: `user_id`, `granted_by`

**Resolution order** (matches `permissions.py::effective_for` semantics,
now token-based):

1. Active override for `(user_id, token)` → allow/deny wins.
2. `role.permission_tokens` contains `token` → allow.
3. Else deny.

## Collection: `role_audit` (NEW)

```python
# backend/models_role_audit.py (DRAFT)
class RoleAuditEntry(BaseModel):
    id: str
    role_id: str
    action: Literal["created", "updated", "deleted", "restored", "seeded"]
    before: Optional[dict] = None
    after: Optional[dict] = None
    actor_user_id: str
    actor_ip: Optional[str] = None
    reason: Optional[str] = None
    at: str
```

Retention: never auto-purge. Feeds the compliance audit_exports view.

## Collection: `user_permission_audit` (NEW)

```python
# backend/models_user_permission_audit.py (DRAFT)
class UserPermissionAuditEntry(BaseModel):
    id: str
    user_id: str
    change_type: Literal[
        "role_assigned", "role_changed", "override_granted",
        "override_revoked", "user_archived", "user_reactivated",
    ]
    before: Optional[dict] = None
    after: Optional[dict] = None
    actor_user_id: str
    actor_ip: Optional[str] = None
    reason: Optional[str] = None
    at: str
```

## Migration note — reconciling `user_permissions` (existing) with `user_permission_overrides` (new)

The current `user_permissions` collection stores the **entire** effective
matrix per user (used by `permission_presets.py::_matrix()`). Two options:

- **Option A (recommended).** Keep `user_permissions` as a materialised
  view for fast reads. Compute it from `roles.permission_tokens ∪
  active user_permission_overrides` on every role/override write.
  Backwards-compatible with existing `effective_for()`.
- **Option B.** Retire `user_permissions`. Query overrides + role live on
  every request. Slower and touches every guard — high risk.

**Recommend Option A.** Phase 2 wires the write-side; Phase 3 flips the
read-side.

## Field-level surprises to raise with you before Phase 2

1. **`approve` action.** Adds a value to `Action`. Ripples through
   `permissions.py`, `permission_presets.py`, and the frontend
   `PermissionsMatrix` UI. Ship as Phase-2 Step-0 before roles are
   seeded, else we'd need a second migration.
2. **`role_id` naming for sub-domain "General User (Training / Inductions Only)"** collides in slugify with `general_user_training_inductions_only`. Recommend `training_inductions_only` as canonical (see doc 04), and log the aliases in `roles.supersedes_role_id`.
3. **`activation_status="pending_activation"`.** A user newly discovered
   via Simpro who has no `role_id` yet. UI must block sign-in for
   `pending_activation` users. That's a Phase 2 story on `/auth/login`.
