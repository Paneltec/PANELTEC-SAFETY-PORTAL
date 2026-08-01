# 07 — Phase plan (2–5)

**Version:** v160.3.9.26-P1 · **Date:** 2026-02-01

Every phase is gated by an explicit `finish` and a version bump. No
phase is auto-started. This document is a re-statement in my own words
so you can course-correct before code lands.

## Phase 2 — Backend permission-model extension (no UI changes)

**Goal.** Land the schema changes in `permissions.py` and seed the new
roles table WITHOUT touching any frontend or existing guard.

**Files touched.**

- `/app/backend/permissions.py` — add:
  - `"approve"` to `ACTIONS` (see doc 03 for rationale).
  - Four new resources: `reference_library`, `notifications`, `help`,
    `sites`. Each gets a `PERMISSIONS_SCHEMA` entry and a default row
    in `ROLE_DEFAULTS` for every existing role (deny-by-default is fine
    — admins will grant per-role).
- `/app/backend/models_roles.py` — new file. Pydantic `Role` model per
  doc 05.
- `/app/backend/models_permissions.py` — new file. Pydantic `Permission`
  model per doc 05.
- `/app/backend/models_permission_overrides.py` — new file.
- `/app/backend/models_role_audit.py`, `.../user_permission_audit.py` —
  new files.
- `/app/backend/seed_roles.py` — new. Idempotent seeder that upserts the
  11 system roles from doc 04 into the `roles` collection. Idempotent =
  `$setOnInsert` on immutable fields, `$set` on tokens/description
  every run.
- `/app/backend/server.py` — one line: call `seed_roles.run()` after
  existing startup seeders.
- `/app/backend/tests/test_permission_model_v26.py` — new. Asserts:
  - All 11 seeded roles resolve.
  - `approve` action serializes.
  - Every token in every role exists in `permissions` catalogue.
  - `effective_for()` still returns the same matrix for existing
    `role="admin"|"hseq_lead"|"supervisor"|"worker"|"auditor"` users
    (regression guard).

**Version.** `paneltec-v160.3.9.26-p2`. Bump all 3 canonical files.

**Verification.** Pytest + one manual curl:
- `GET /api/permissions/catalogue` (new endpoint) returns 21 → 25
  resources.
- `GET /api/roles` returns 11 seeded rows.
- Existing users still pass the auth checks they did in v25.

**Risks.**

- Adding `"approve"` to the `Action` `Literal` invalidates any cached
  Pydantic response. Mitigation: rebuild `PERMISSIONS_SCHEMA` on
  startup, don't let clients pin schema hashes.
- Anywhere that iterates over `ACTIONS` and expects exactly 7 will
  break. Grep before merge:
  `grep -rn "for.*ACTIONS\|len(ACTIONS)\|action_count" /app/backend`.

## Phase 3 — Migrate inline `_admin` guards to new resources

**Goal.** Replace the ad-hoc admin guards on Risk Assessment reference
library, sites, help, notifications, comms with matrix-based
`require_permission()`.

**Files touched.**

- `/app/backend/master_risks.py`, `list_forms.py`, `list_roles.py`,
  `incident_root_causes.py`, `cs_incident.py`, `completed_training.py`,
  `companies.py` — swap `_admin(user)` for
  `require_permission("reference_library", "edit")` (or `view`).
- `/app/backend/sites_qr.py`, `sites_signon_v127.py`, `SitesAdmin.jsx`
  guards on the backend — introduce `sites` resource.
- `/app/backend/help_routes.py`, `UserManual` write endpoints — `help`.
- `/app/backend/email_outbox.py`, `comms_safe_mode.py` — `notifications`.
- `/app/backend/permissions.py::PERMISSIONS_SCHEMA` — ensure
  `email_supported` correctly set on `sites`, `notifications` (both
  `True`), `reference_library` and `help` (both `False`).
- `/app/backend/tests/test_admin_guards.py` — extend to cover the new
  resources (RBAC must still 403 on non-admin).

**Version.** `paneltec-v160.3.9.26-p3`.

**Risks.**

- Regression risk on the 7 Risk Assessment tabs. Mitigation: v25's
  `test_admin_guards.py` already covers them; re-run it before merge.
- Sites QR kiosk uses a public route (no auth). Do NOT gate the public
  side of `sites_signon_v127.py` — only the admin/management routes.

## Phase 4 — Users & Roles admin UI

**Goal.** Build the new admin experience: named roles, per-user role
picker, override editor, Simpro import button.

**Files touched.**

- `/app/frontend/src/pages/UsersManagement.jsx` — heavy edits. Add
  role picker column, "Import from Simpro" button, override
  affordances.
- `/app/frontend/src/pages/RolesAdmin.jsx` — new page. CRUD on
  `roles` collection. System roles read-only; custom roles editable.
- `/app/frontend/src/components/permissions/RoleMatrixEditor.jsx` —
  new. The (resource × action) matrix component. Extracts what's
  currently duplicated inline in `PermissionPresetsAdmin.jsx`.
- `/app/frontend/src/pages/PermissionPresetsAdmin.jsx` — repoint to
  the new catalogue endpoint; keep the preset concept alongside roles
  (presets = one-click matrix, roles = named identity).
- `/app/backend/users.py` — new endpoints:
  - `POST /api/users/{id}/role` — assign role_id.
  - `POST /api/users/{id}/overrides` — grant/deny.
  - `POST /api/users/simpro-import` — the Simpro sync button.

**Version.** `paneltec-v160.3.9.26-p4`.

**Risks.**

- Existing `PermissionPresetsAdmin.jsx` renders a hand-rolled matrix.
  Extracting into `RoleMatrixEditor.jsx` and reusing = high value / low
  risk. Prefer that.
- The `pending_activation` login block needs a helpful error page
  ("Your account is being set up — contact your admin"). Miss this and
  Simpro-created users will silently 401.

## Phase 5 — Legacy `role` string retirement + cleanup

**Goal.** Fully migrate to `role_id`. Drop the legacy string.

**Files touched.**

- `/app/backend/auth.py::require_roles()` — accept either `role` or
  `role_id`. After a stability window, only `role_id`.
- Every existing `if user["role"] == "admin"` inline check — grep and
  swap to `require_permission()` or the `role_id` equivalent. This is
  the risky sweep. Recommend a Playwright + curl regression suite
  before deprecation.
- `/app/backend/permissions.py::ROLE_DEFAULTS` — collapse from 5 to
  0 (all defaults now live in `roles` collection).
- `/app/backend/models.py::User.role` — mark deprecated, keep
  read-only.

**Version.** `paneltec-v160.3.9.26-p5`.

**Risks — highest of any phase.**

- Every guard-site becomes a regression opportunity. Mitigation:
  automated grep + a Pytest suite that logs in as each of the 5
  legacy roles and asserts they see the same routes they did in v25.
- Do NOT delete the `role` string from persisted user documents. Keep
  it as a shadow field with `# DEPRECATED: v26-p5` for one more phase.

## Cross-phase risks I want to flag NOW

1. **`Column Configuration` is not a permission.** If we let it slip into
   the roles table, we've conflated table-UI prefs with authorisation.
   Doc 03 flags it. Phase 4 UI must render column-visibility toggles
   OUTSIDE the roles matrix.
2. **112 users to migrate.** Doc 01 shows some users have 33 grants
   (top: Craig.LARGE, ADMINISTRATOR, StephenGUY). Their per-user matrix
   won't cleanly compress into one of the 11 seeded roles — they will
   inevitably need overrides. Design the UI so that "role + overrides"
   is a first-class flow.
3. **`Approver` on permit-to-work has 93 grants.** New action. Adding
   `approve` late (Phase 3+) means every role seeded in Phase 2 needs
   updating. Land `approve` in Phase 2 Step 0.
4. **`Contractor Representative` scoping** requires record-level filter
   by `company_id` on FIVE resources: certifications, workers, hr,
   contractors, documents. That helper does not exist uniformly today.
   Doc 05 assumes it. Actually building it lives in Phase 3 —
   don't ship the roles until the scoping helper is proven.
5. **Read Only role (184 grants)** demands zero-edit UI states across
   every capture module. Currently many "Save" buttons only hide when
   `role === "worker"`. Grep before shipping Phase 4:
   `grep -rn "role.*===.*['\"]admin\|user.role !==" /app/frontend/src`.

## Explicit non-goals for v26 series

- Mobile app changes. `/app/mobile/*` is untouched except for version
  bumps.
- Bulk-PDF live runner unblock (`v12a-live`). Still deferred.
- HR Employees register Step 2 (`v21` — paused by user). Still paused.

## Green light? Red light?

Before I write any Phase 2 code:

1. Confirm the token vocabulary decision — extend existing
   `<resource>.<action>` (yes) vs. invent parallel tokens (no).
2. Confirm the 11 role catalogue in doc 04.
3. Confirm the `approve` action is in scope for Phase 2 Step 0.
4. Confirm the four new resources (`reference_library`, `notifications`,
   `help`, `sites`) are in scope.
5. Confirm Simpro sync stays manual — no cron.
6. Answer the two clarifying questions:
   - Doc 03 — how to handle `hr.Report Emailing` and
     `asset.Report Emailing` on resources with `email_supported=False`.
   - Doc 06 — Simpro-email matches a `workers` row but no `users` row.
