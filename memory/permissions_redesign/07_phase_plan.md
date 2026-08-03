# Phase Plan — Users & Permissions Redesign

*(Existing content preserved below the v160.3.9.30 addendum)*

## v160.3.9.30 addendum — Phase 6 backlog

**Phase 6 (post-Phase-4 cleanup) — Refactor `effective_for()` to merge
`ROLE_DEFAULTS` with `roles.permission_tokens[]` from the DB.**

Currently `effective_for()` in `permissions.py:270` only consults the
in-code `ROLE_DEFAULTS` dict. New system roles seeded into the
`roles` collection via `roles_catalogue.py` (contractor_rep,
contractor_rep_submit_only, hseq_manager, mechanic, etc.) require
duplicate `ROLE_DEFAULTS` entries or they receive zero permissions
at auth-time. This duplication is fragile — the drift test in
`test_contractor_rep_scoping_v160_3_9_30.py` exists to catch it.

The clean fix (was Blocker-F-ii during Phase 3d) is to make
`effective_for()`:
1. Read `roles.permission_tokens[]` for `user.role_id` from the DB.
2. Union with any `ROLE_DEFAULTS[user.role]` entry (for backward-compat
   with legacy role strings).
3. Overlay user-specific `user_permissions.overrides`.

Deferred until Phase 5 completion (legacy `role` string retirement)
because Phase 5 removes half the problem: once every user has a
`role_id` and no legacy `role` string, `effective_for()` can rely
solely on `roles.permission_tokens[]`.

**Owner:** whoever picks up Phase 6.
**Estimated scope:** ~30 LOC change in `permissions.py`, 5 LOC change
in `auth.py`, delete of the duplicate `ROLE_DEFAULTS` entries for the
newer system roles (contractor_rep, contractor_rep_submit_only,
hseq_manager, etc. — keep admin + hseq_lead + supervisor as legacy
role-string catches).

## v160.3.9.31-4a addendum — Phase 6 backlog #2

**Unify the three coexisting role↔form models into one canonical shape.**

Phase 4a shipped a third role↔form data model (`role_forms` collection)
without retiring the two legacy ones. All three now coexist:

| Model | Where it lives | Written by | Read by |
|-------|----------------|------------|---------|
| A | `orgs.role_form_allowlist.<legacy_role>` (subdoc on orgs) | `PermissionPresetsAdmin` via `PUT /api/org/role-presets/{role}/forms` | mobile forms library (worker feed) |
| B | `form_templates.applies_to.roles[]` (per-template array) | `FormAssignmentsAdmin` via `PUT /api/form-templates/{id}/applies-to` | mobile forms library (dispatch + assignment notifier) |
| C | `role_forms` collection (org_id + role_id + form_id) | `RolesAdmin` drawer via `/api/admin/roles/{role_id}/forms` | nothing yet (catalogue only; `is_required` unenforced) |

Model A keys on hardcoded legacy role strings (`worker`, `supervisor`,
`foreman`, `contractor`, `hseq`) so it cannot represent modern `role_id`s
(`hseq_manager`, `contractor_rep_submit_only`, `custom_*`). Model B stores
free-form lowercase role strings on each template. Model C stores real
`role_id`s tied to the roles catalogue.

**Proposed unification (Phase 6):**
1. Migrate Model A entries → Model C by aliasing legacy keys onto the
   catalogue (`worker→general_user`, `hseq→hseq_manager`, etc.).
2. Migrate Model B entries → Model C by inverting the join, aliasing
   the free-form role strings the same way.
3. Deprecate the two legacy endpoints; keep them as read-only shims
   returning the projection over Model C for one release cycle.
4. Wire the mobile forms library to Model C. Honour
   `role_forms.is_required` as the enforcement dimension.
5. Rewrite `RoleFormsSection.jsx` (currently mounted in
   `PermissionPresetsAdmin`) to read from Model C keyed on `role_id`,
   drop the hardcoded 5-role dropdown.

**Owner:** whoever picks up Phase 6.
**Estimated scope:** ~150 LOC (migration script + shim endpoints +
mobile library rewrite + `RoleFormsSection` refactor). Data migration
is idempotent and safe to re-run.

---

## Original phase plan (v160.3.9.26 discovery)

Phases 1–4 executed under v160.3.9.26 → v160.3.9.30. See individual
close-out notes in the same directory (`08_phase3b_notes.md`,
`09_frontend_gate_sweep.md`).

### Deferred items from v160.3.9.26 planning

1. Doc 03 — how to handle `hr.Report Emailing` and
   `asset.Report Emailing` on resources with `email_supported=False`.
2. Doc 06 — Simpro-email matches a `workers` row but no `users` row.
3. Simpro sync stays manual — no cron.

## v160.3.9.32-4b addendum — Phase 6 backlog #3

**Delete `Onboard.jsx` and 410 the public invite/redeem routes** once
all `activation_status="pending_activation"` users have been transitioned
to `active` (via admin set-password or magic-link reset) and every
in-flight invite token has expired.

Phase 4b removed the admin-triggered invite paths (`POST /api/users` and
`POST /api/users/{id}/invite` both return 410 Gone). The public consumer
side is still alive:
- `POST /api/auth/invite/validate` (auth_invite.py:214)
- `POST /api/auth/invite/redeem` (auth_invite.py:267)
- Frontend page `Onboard.jsx`

Invite token TTL is defined by `INVITE_TTL_HOURS` in `auth_invite.py` —
check the constant before scheduling the cleanup so no in-flight tokens
get stranded. Reset-password magic-link path stays alive indefinitely.

**Owner:** whoever picks up Phase 6.
**Estimated scope:** ~15 LOC (410 the 2 public routes, delete Onboard.jsx).


---

## Phase 6 backlog — Mobile "Add worker" affordance orphan (v160.3.9.34.1)

`v160.3.9.34.1` 410'd `POST /api/workers` and removed the manual
"Add worker" affordance from the web `Workers.jsx` page. Mobile was
intentionally NOT modified in this ticket (strict "do not touch
`/app/mobile/` except for the version bump" rule).

**Orphan reference:** `mobile/src/components/WorkerEditModal.tsx:199`
```ts
if (isNew) {
  await api.post('/workers', f);
  Alert.alert('Success', 'Worker added');
}
```
Any upstream "Add worker" affordance in the mobile app that opens
`WorkerEditModal` in `isNew` mode will now silently surface the generic
`apiError(e)` toast when the user taps save (endpoint returns 410).

**Follow-up work (before next mobile beta cycle):**
1. Hide the mobile "Add worker" button wherever it launches
   `WorkerEditModal` with an empty worker object.
2. Replace the modal's `isNew` branch with an informational sheet:
   *"Workers come from Simpro. Contact your admin."*
3. Optionally delete the `isNew` branch of `submit()` in
   `WorkerEditModal.tsx` once the button is gone.

Not urgent — the endpoint returns 410 gracefully — but should ship
before the next mobile beta so the UX stops promising a create it
can't fulfil.

**Owner:** whoever picks up Phase 6 (mobile track).
**Estimated scope:** ~10 LOC in `mobile/`.
