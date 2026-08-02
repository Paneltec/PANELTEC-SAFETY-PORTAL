# 04 — Role catalogue (proposed)

**Version:** v160.3.9.26-P1 · **Date:** 2026-02-01

## Design principle

Paneltec already has a `resource × action` matrix with per-user
overrides. This redesign **keeps that**, and introduces named
**roles** as saved matrices that admins can assign to users.

- Each row below is a proposed system role. `role_id` is stable.
- `permission_tokens[]` uses the `<resource>.<action>` tokens defined in
  doc 03. **`use` is the paid-feature gate** (already present on `ai`).
  We add it on `notifications` for send-broadcast.
- `is_system=true` means the role is seeded and read-only in the UI
  (matches how `permission_presets.py` distinguishes built-ins today).
- Users always have exactly one `role_id`; per-user grants live in
  `user_permission_overrides` for delta on top.

## System roles

### 1. `admin` — Administrator (system)

- **Description.** Full access. Owns user management, integrations,
  billing, permissions catalogue.
- **Persona.** Stephen Guy, Craig Large.
- **Tokens.** All actions on all resources (existing `admin` matrix).
- **Migration.** Existing `role == "admin"` users get `role_id = admin`
  and their `user_permissions.overrides` is preserved as-is.

### 2. `hseq_manager` — HSEQ Manager (system)

- **Description.** HSEQ lead with cross-team visibility. Cannot delete
  destructively; cannot manage users or integrations.
- **Persona.** Managers who currently hold `hseq_lead`. Matches Lucidity
  `<module>.Manager` for competency, induction, hr, incident, risk.
- **Tokens.** `open/view/edit/email/team_view` on `swms`, `pre_starts`,
  `site_diary`, `hazards`, `incidents`, `inspections`, `risk_assessments`,
  `contractors`, `renewals`, `workers`, `inductions`, `certifications`,
  `documents`, `forms`, `assets`, `vehicles`, `suppliers`,
  `reference_library`, `notifications`, `sites`. `use` on `ai`,
  `notifications`. Read on `users`, `audit_exports`.
- **Migration.** Rename `hseq_lead` → `hseq_manager` at the role level,
  keep the legacy string for backwards-compat during Phase 4.
  `hseq_lead == 'hseq_lead'` continues to resolve until deprecation.

### 3. `hseq_manager_readonly` — HSEQ Manager (Read-only) (system)

- **Description.** Cross-team **read-only** oversight. Mirrors
  Lucidity's `risk.Read Only` (184 grants — the second-highest cell
  count in the sheet). New role — no direct equivalent today.
- **Persona.** Auditors, external safety consultants (mirror of the
  existing `auditor` role but scoped tighter).
- **Tokens.** `view` (+ `open` where relevant) on every capture and
  reference resource. NO edit, delete, email.
- **Migration.** `role == "auditor"` users can opt in to this new role;
  the legacy `auditor` matrix stays available for another cycle.

### 4. `hseq_manager_creator` — HSEQ Manager (Creator) (system)

- **Description.** Can create/edit new records but not delete or manage
  templates. Mirrors Lucidity `permittowork.Manager (Creator)` and the
  intent of "Manager" columns that omit template ownership.
- **Persona.** Field HSEQ leads authoring forms/permits day-to-day.
- **Tokens.** Same as `hseq_manager` MINUS `forms.edit` on template
  schemas (only on submissions) MINUS `reference_library.edit`.
- **Migration.** New — no existing users default to this. Opt-in.

### 5. `report_emailing_admin` — Report Emailing (system)

- **Description.** Cannot create/edit records. Can view + send/email
  scheduled reports on the resources they're granted. Mirrors Lucidity
  `<module>.Report Emailing`.
- **Persona.** Ops managers who receive weekly audit digests.
- **Tokens.** `view` + `email` on `swms`, `pre_starts`, `hazards`,
  `incidents`, `inspections`, `risk_assessments`, `contractors`,
  `renewals`, `inductions`, `certifications`, `forms`,
  `reference_library`. `view` + `use` on `notifications`.
  `view` + `email` on `audit_exports`.
- **Migration.** New. Seed empty; admins assign.

### 6. `responsible_manager` — Responsible Manager (system)

- **Description.** Owns close-out on the records their team submits.
  Mirrors Lucidity `incident.Responsible Manager`.
- **Persona.** Site supervisors accountable for incident close-out.
- **Tokens.** Same as our current `supervisor` role: full CRUD on
  hazards/incidents/inspections + `team_view`, view-only on the
  rest. Additionally `notifications.use` for close-out digests.
- **Migration.** `role == "supervisor"` → `role_id = responsible_manager`.
  Legacy `role` string preserved.

### 7. `contractor_rep` — Contractor Representative (system)

- **Description.** Employee of a subcontracting company. Sees only
  their own contractor org's records. Cross-module.
- **Persona.** External subcontractor coordinator.
- **Tokens.** `open/view/edit/email` on `contractors`, `workers`,
  `certifications`, `inductions`, `documents` — all with
  `team_view=false` and record-level scoping by `company_id`.
- **Migration.** New. No auto-migration — must be assigned per external
  user, ideally by matching the Simpro `company_id` on their user
  record.

### 8. `contractor_rep_submit_only` — Contractor Representative (Submit-Only) (system)

> **v160.3.9.30 amendment:** `forms.edit` granted (open/view/edit) because
> the whole purpose of this role is submitting compliance forms
> (renewals, inductions, PPE declarations). Without it the "submit-only"
> persona has no way to actually submit anything and becomes an
> unshippable ghost role. The token was omitted from the original v26
> draft; this amendment brings the catalogue and `ROLE_DEFAULTS` +
> `roles_catalogue._tokens_contractor_rep_submit_only()` back in sync.

- **Description.** Narrowest external role. Can only submit required
  documents + compliance forms. Cannot see the contractor register at large.
- **Persona.** Casual subcontractors invited to upload PPE/insurance and
  submit renewal forms — nothing else.
- **Tokens.** `contractors.view` (own org only), `documents.{open,view,edit}` (own submissions), `certifications.{view,edit}` (own submissions), `forms.{open,view,edit}` (submit compliance forms).
- **Migration.** New. Assign via renewal-link workflow.

### 9. `mechanic` — Mechanic (system)

- **Description.** Focused on plant maintenance. Cannot delete assets,
  cannot manage users. Mirrors Lucidity `asset.Mechanic Role` (1 grant).
- **Persona.** Yard mechanic maintaining the plant register.
- **Tokens.** `assets.{open,view,edit,team_view}`, `vehicles.{open,view,edit}`, `documents.{open,view,edit}` scoped to maintenance PDFs, `certifications.view` scoped to plant.
- **Migration.** New. Manual assignment.

### 10. `training_inductions_only` — Training / Inductions Only (system)

- **Description.** Can only see/edit induction and cert records.
  Nothing else. Mirrors Lucidity `induction.Training / Inductions Only`
  (1 grant) and `competency.General User (Training / Inductions Only)`
  (1 grant).
- **Persona.** Training coordinator (may be a contractor).
- **Tokens.** `inductions.{open,view,edit,email}`, `certifications.{open,view,edit,email}`, `workers.view` (for name lookup only).
- **Migration.** New. Manual assignment.

### 11. `general_user` — General User (system)

- **Description.** Regular Paneltec user (office/field). Sees their own
  submissions across capture modules. **Default role for Simpro-synced
  employees who are not admins.** Mirrors Lucidity `<module>.General User`
  which appears **557 times** — by far the most-populated column in the
  sheet.
- **Persona.** Nearly every user.
- **Tokens.** `open/view/edit` on `swms`, `pre_starts`, `site_diary`,
  `hazards`, `incidents`, `inspections`, `risk_assessments`,
  `contractors`, `documents` — all `team_view=false`. `view` on
  `workers` (own record via user_id). `view` on `help`. `use` on
  `notifications` (receive-only, no send). No `email` action.
- **Migration.** `role == "worker"` → `role_id = general_user`. Legacy
  string preserved.

### 12. `custom` — Custom role (placeholder, non-seedable)

- **Description.** Reserved id. When an admin creates a bespoke role in
  the UI, its `role_id` is `custom.<slug>` and `is_system=false`.
- **Persona.** Any org-specific carve-out.
- **Migration.** N/A.

## Roles proposed for deprecation

| Legacy `role` string | New `role_id` | Deprecation window |
| --- | --- | --- |
| `admin` | `admin` | keep — same id |
| `hseq_lead` | `hseq_manager` | keep legacy string until Phase 5 tail |
| `supervisor` | `responsible_manager` | keep legacy string until Phase 5 tail |
| `worker` | `general_user` | keep legacy string until Phase 5 tail |
| `auditor` | `hseq_manager_readonly` | ⚠ Opt-in only. `auditor` matrix in `ROLE_DEFAULTS` stays until the audit-exports team decides. |

## Roles to explicitly NOT create

- **Per-module Administrator** (e.g. `asset_administrator`). Lucidity has
  12 of these; combining them all into one user creates spaghetti.
  Instead: admins assign the closest system role + use per-user
  overrides. If in practice a single "asset administrator only" persona
  emerges, promote it later.
- **Per-module Read-Only.** Same reasoning. `hseq_manager_readonly`
  covers 90 % of the intent.
- **`Column Configuration`.** UI-only preference, not a role.

## Summary table

| role_id | is_system | Description (one line) | Existing users migrate from |
| --- | --- | --- | --- |
| `admin` | ✓ | Full access | `role="admin"` |
| `hseq_manager` | ✓ | HSEQ manager (edit, no destructive delete) | `role="hseq_lead"` |
| `hseq_manager_readonly` | ✓ | Cross-team read-only oversight | (opt-in) `role="auditor"` |
| `hseq_manager_creator` | ✓ | Field HSEQ, no template ownership | new — opt-in |
| `report_emailing_admin` | ✓ | View + email scheduled reports only | new |
| `responsible_manager` | ✓ | Team supervisor, owns close-out | `role="supervisor"` |
| `contractor_rep` | ✓ | External contractor coordinator (org-scoped) | new |
| `contractor_rep_submit_only` | ✓ | External submitter (documents only) | new |
| `mechanic` | ✓ | Plant maintenance | new |
| `training_inductions_only` | ✓ | Training coordinator | new |
| `general_user` | ✓ | Default for everyone else | `role="worker"` |
| `custom.<slug>` | ✗ | Admin-authored bespoke role | user-created |
