# 03 — Paneltec module map (Lucidity spreadsheet → Paneltec app)

**Version:** v160.3.9.26-P1 · **Author:** discovery pass · **Date:** 2026-02-01

## How this table was built

- **Left column** — every `module.role` cell present in
  `01_raw_taxonomy.json` (12 modules × 3–7 roles = 62 columns).
- **Middle column** — the Paneltec `PERMISSIONS_SCHEMA` resource (from
  `/app/backend/permissions.py`) that owns that concept today. Where no
  existing resource fits, the cell reads `— gap —` and the Notes column
  explains what would need to be added.
- **Third column** — the proposed permission token(s). Tokens follow the
  **existing** `<resource>.<action>` convention already in use
  (`ACTIONS = ["open", "view", "edit", "delete", "email", "team_view", "use"]`).
  We do **not** invent a parallel token vocabulary (`swms.create`,
  `swms.approve`, etc.) — that would fork the model.
- **Notes** — any impedance mismatch. Anything marked ⚠ is a decision
  point for you before Phase 2 code lands.

## Core mapping — modules

| Lucidity module | Paneltec resource(s) | Notes |
| --- | --- | --- |
| `competency` | `certifications`, `workers` | Lucidity treats "competency" as the worker-cert register. Paneltec splits it: `certifications` (cert kinds + expiry) + `workers` (PII owner). Grants on this module fan out to both. |
| `induction` | `inductions` | 1:1. |
| `hr` | `workers` | Lucidity's HR = the sensitive PII face of the worker record. Existing Paneltec `workers` resource already carries `email_supported=False` and `team_view` is HR-scoped in v3.18. |
| `incident` | `incidents` | 1:1. |
| `risk` | `risk_assessments`, `— gap —` (master_risks reference library) | Field submissions map to `risk_assessments`. The v24-shipped Risk Assessments **reference library** (7 tabs: master_risks, list_forms, IRC, cs_incident, list_roles, completed_training, companies) currently uses ad-hoc `_admin(user)` guards. Phase 3 should fold those into a new `reference_library` resource so the same `role_id` catalogue can grant them. ⚠ Confirm before Phase 3. |
| `inform` | `— gap —` (proposal: new `notifications` resource) | Lucidity "Inform" = comms broadcast to users. Paneltec today has `email_outbox` and `comms_safe_mode` behind admin-only routes. Add a `notifications` resource + `send` action, OR reuse `email` action on the target resource. Recommendation: introduce `notifications` (open/view/edit/email + `use=send`) — cleaner audit trail. |
| `lucidityintranet` | `— gap —` (proposal: `help` / `user_manual` resource) | Effectively "who can edit the intranet home / user manual". Paneltec has `UserManual.jsx` and `help_routes.py`; guards are inline. Add `help` resource with open/view/edit + admin-only delete. |
| `permittowork` | `forms` (permit-to-work is a form template family) | Existing `forms` resource carries open/view/edit/delete already. See "Roles" table for the `Approver` and `Manager (Creator)` nuances. |
| `contractor` | `contractors` | 1:1. |
| `asset` | `assets`, `vehicles` | Paneltec `assets` == Plant & Vehicles; `vehicles` is the sub-slice with Navixy GPS. The Lucidity "Mechanic Role" maps cleanly to a new `assets.maintain` capability (see roles table). ⚠ Requires adding `maintain` to `ACTIONS`, OR treating "Mechanic Role" as a named role that inherits `assets.edit` scoped to plant_maintenance sub-collection. |
| `onsite` | `— gap —` (proposal: `sites` resource) | QR sign-on / kiosk. Paneltec code lives in `sites_qr.py`, `sites_signon_v127.py`, `SitesAdmin.jsx`; guards are inline. Add `sites` resource (open/view/edit/delete/team_view). |
| `access` | `users`, `integrations` | Lucidity "Access.Administrator" = full user admin (already covered by our `users.*` matrix). Lucidity "Access.Report Emailing" = a limited role that only receives system access-report emails → maps to a per-user override `users.email=true` while keeping edit/delete=false. |

## Full 62-cell mapping — module × role sub-heading

Every column in the spreadsheet (row-6 module + row-7 role). Tokens use
existing Paneltec actions unless flagged.

| Lucidity `module.role` | Paneltec resource(s) | Token(s) | Notes |
| --- | --- | --- | --- |
| `competency.Administrator` | certifications, workers | `certifications.{open,view,edit,delete,email,team_view}`, `workers.{open,view,edit,delete,team_view}` | Full admin on cert register + underlying workers. |
| `competency.Manager` | certifications, workers | `certifications.{open,view,edit,email,team_view}`, `workers.{open,view,edit,team_view}` | No delete. |
| `competency.General User` | certifications | `certifications.{open,view}` | Own worker only via `team_view=false`. |
| `competency.General User (Training / Inductions Only)` | certifications, inductions | `certifications.view`, `inductions.view` | ⚠ Only 1 row in data — likely a specialty carve-out. Keep as a named role, not a system default. |
| `competency.Contractor Representative` | certifications | `certifications.{open,view,edit,email}` scoped by `team_view=false` + record.company_id match | Contractor-org-scoped. Needs record-level scoping helper (already exists partially in `contractors.py`). |
| `competency.Report Emailing` | certifications | `certifications.{view,email}` | Read + send scheduled reports. |
| `competency.Column Configuration` | UI-only, per-user pref | *not a permission* | This is a table-column visibility saved-view. Store under `user_prefs.certifications.columns[]`, not the permission matrix. |
| `induction.Administrator` | inductions | `inductions.{open,view,edit,delete,email,team_view}` | |
| `induction.Manager` | inductions | `inductions.{open,view,edit,email,team_view}` | |
| `induction.General User` | inductions | `inductions.{open,view}` (self-scope) | |
| `induction.Training / Inductions Only` | inductions | `inductions.{open,view,edit}` | Deliberately capped — cannot delete or email. Ship-blocker for Phase 4 seeding. |
| `induction.Report Emailing` | inductions | `inductions.{view,email}` | |
| `induction.Column Configuration` | UI-only | *not a permission* | See above. |
| `hr.Administrator` | workers | `workers.{open,view,edit,delete,team_view}` | Full HR admin. |
| `hr.Manager` | workers | `workers.{open,view,edit,team_view}` | No delete. |
| `hr.General User` | workers | `workers.{open,view}` (self-scope) | Only own record. |
| `hr.Contractor Representative` | workers | `workers.{open,view,edit}` scoped by `company_id` | Contractor edits their own crew. |
| `hr.Report Emailing` | workers | `workers.view` | ⚠ `workers` has `email_supported=False` — Lucidity's "HR report emailing" must instead grant `audit_exports.{view,email}` filtered to HR. Recommend documenting as `workers.view` + `audit_exports.email` scoped to HR templates. |
| `hr.Column Configuration` | UI-only | *not a permission* | |
| `incident.Administrator` | incidents | `incidents.{open,view,edit,delete,email,team_view}` | |
| `incident.General User` | incidents | `incidents.{open,view,edit}` (self as reporter) | |
| `incident.Responsible Manager` | incidents | `incidents.{open,view,edit,email,team_view}` | Same as our current `hseq_lead` on incidents; the phrase means "the manager responsible for close-out". No delete. |
| `incident.Report Emailing` | incidents | `incidents.{view,email}` | |
| `incident.Column Configuration` | UI-only | *not a permission* | |
| `risk.Administrator` | risk_assessments, `— gap —` reference_library | `risk_assessments.{open,view,edit,delete,email,team_view}`, `reference_library.{open,view,edit,delete}` | ⚠ Requires the new `reference_library` resource. |
| `risk.Manager` | risk_assessments, reference_library | `risk_assessments.{open,view,edit,email,team_view}`, `reference_library.{open,view,edit}` | |
| `risk.Read Only` | risk_assessments, reference_library | `risk_assessments.view`, `reference_library.view` | 184 grants — the second-most-populated column. Confirms we need a true read-only role, not just "worker with view". |
| `risk.Report Emailing` | risk_assessments | `risk_assessments.{view,email}` | |
| `risk.Column Configuration` | UI-only | *not a permission* | |
| `inform.Administrator` | `— gap —` notifications | `notifications.{open,view,edit,delete,use}` | `use=send`. |
| `inform.Manager` | notifications | `notifications.{open,view,edit,use}` | |
| `inform.General User` | notifications | `notifications.{open,view}` | |
| `inform.Contractor Representative` | notifications | `notifications.{open,view}` scoped to their audience | |
| `inform.Report Emailing` | notifications | `notifications.{view,use}` | |
| `inform.Column Configuration` | UI-only | *not a permission* | |
| `lucidityintranet.Administrator` | `— gap —` help | `help.{open,view,edit,delete}` | Edit the user manual / intranet. |
| `lucidityintranet.Manager` | help | `help.{open,view,edit}` | |
| `lucidityintranet.General User` | help | `help.{open,view}` | Almost everyone. |
| `lucidityintranet.Contractor Representative` | help | `help.{open,view}` | |
| `permittowork.Administrator` | forms | `forms.{open,view,edit,delete}` scoped to permit templates | |
| `permittowork.Manager (Creator)` | forms | `forms.{open,view,edit}` scoped to permit templates | ⚠ Only 1 row in data. Rename to `permits.author` in the role catalogue for clarity. |
| `permittowork.Approver` | forms | `forms.{open,view,edit}` + new `forms.approve` action ⚠ | 93 grants — heavy usage. Needs a NEW action `approve` on the permits sub-scope. Recommend adding `approve` to `ACTIONS` at Phase 2. Alternatively, encode as `forms.edit` + a role-level flag; not ideal but no migration required. Confirm before Phase 2. |
| `permittowork.Read Only` | forms | `forms.view` scoped to permits | |
| `permittowork.Column Configuration` | UI-only | *not a permission* | |
| `contractor.Administrator` | contractors | `contractors.{open,view,edit,delete,email,team_view}` | |
| `contractor.Manager` | contractors | `contractors.{open,view,edit,email,team_view}` | |
| `contractor.Contractor Representative - only submit required documents` | contractors, documents | `contractors.view` (own only), `documents.{open,view,edit}` scoped to own submissions | ⚠ Longest column header in the sheet — deliberately narrow. Only 2 grants. Keep it as a distinct role (see doc 04). |
| `contractor.Report Emailing` | contractors | `contractors.{view,email}` | |
| `contractor.Column Configuration` | UI-only | *not a permission* | |
| `asset.Administrator` | assets, vehicles | `assets.{open,view,edit,delete,team_view}`, `vehicles.{open,view,edit,delete,team_view}` | Note: `assets` and `vehicles` both have `email_supported=False`. |
| `asset.Manager` | assets, vehicles | `assets.{open,view,edit,team_view}`, `vehicles.{open,view,edit,team_view}` | |
| `asset.Mechanic Role` | assets | `assets.{open,view,edit}` scoped to plant_maintenance sub-collection ⚠ | Only 1 grant. Two options: (a) treat as named role with `assets.edit=true` + a record-scoping helper that limits mutations to `plant_maintenance` docs, or (b) add a new action `assets.maintain`. Recommend (a) — no `ACTIONS` change needed. Confirm before Phase 2. |
| `asset.Contractor Representative` | assets | `assets.{open,view,edit}` scoped by company_id | |
| `asset.Report Emailing` | assets | `assets.view` | ⚠ `assets.email_supported=False`. Report emailing on assets must instead be `audit_exports.email` filtered to plant templates. |
| `asset.Column Configuration` | UI-only | *not a permission* | |
| `onsite.Administrator` | `— gap —` sites | `sites.{open,view,edit,delete,team_view}` | |
| `onsite.Manager` | sites | `sites.{open,view,edit,team_view}` | |
| `onsite.Report Emailing` | sites | `sites.{view,email}` | ⚠ Need to add `email_supported=True` on the new resource. |
| `onsite.Column Configuration` | UI-only | *not a permission* | |
| `access.Administrator` | users, integrations | `users.{open,view,edit,delete,team_view}`, `integrations.{open,view,edit}` | System owner. Effectively identical to Paneltec `admin`. |
| `access.Report Emailing` | users | `users.view` + `audit_exports.email` scoped to access reports | See HR note above. |
| `access.Column Configuration` | UI-only | *not a permission* | |

## Rollup: what MUST change in the backend permission model

| Change | Rationale | Blocking phase |
| --- | --- | --- |
| Add `reference_library` resource | Fold the 7 Risk Assessment reference-library tabs (Master Risks, ListForms, IRC, CsIncident, ListRoles, CompletedTraining, Companies) currently guarded by ad-hoc `_admin` into the matrix. | Phase 3 |
| Add `notifications` resource | Cover Lucidity's `inform` module. | Phase 3 |
| Add `help` resource | Cover Lucidity's `lucidityintranet` module. Enables non-admin manual editors. | Phase 3 |
| Add `sites` resource | Cover Lucidity's `onsite` module (QR kiosk/sign-on). | Phase 3 |
| Add `approve` action on `ACTIONS` | Lucidity `permittowork.Approver` has 93 grants — heavy usage — and there is no clean way to express "can flip status to Approved but not edit content" with the current 7-action set. | Phase 2 (before role seeding) |
| **Do NOT** add: `swms.create`, `swms.approve`, `hazards.review`, `incidents.close_out` as new tokens | The existing `open/view/edit/delete/email/team_view/use` set already covers these semantics via record scoping + status transitions. Adding parallel tokens would fork the model. | — |

## Rollup: what is NOT a permission (UI-only)

- `Column Configuration` on every module → per-user table-column preference,
  saved under `user_prefs.<resource>.columns`.
- User-toggleable dashboard widgets → same bucket.

## Fields that don't map cleanly (call-outs for you before Phase 2)

1. **"Column Configuration" is not a permission.** 12 grants across 12 modules per user. Recommend a shared "Table view preferences" endpoint and lift it out of the matrix entirely. ⚠
2. **`permittowork.Approver` needs a new action.** 93 grants. ⚠
3. **`asset.Mechanic Role`, `permittowork.Manager (Creator)`, `induction.Training / Inductions Only`** are each single-row grants. Ship them as named roles in the catalogue (doc 04), but do not add per-role columns in the matrix UI.
4. **`hr.Report Emailing` and `asset.Report Emailing`** target resources whose `email_supported=False`. Their real intent is `audit_exports.email` scoped to the relevant template family — handle in Phase 2 seeding, not by flipping `email_supported`.
5. **`onsite`, `inform`, `lucidityintranet`** correspond to code paths that today live behind inline `_admin` guards in `sites_qr.py`, `email_outbox.py`, `comms_safe_mode.py`, `help_routes.py`, `UserManual.jsx`. Phase 3 must migrate those to `require_permission("<new_resource>", "<action>")`.
