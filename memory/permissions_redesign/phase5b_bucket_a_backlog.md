# Phase 5b — Bucket A backlog · per-file conversion of legacy `user.role`-string gates

**Ship target for Phase 5 (v160.3.9.36):** compatibility shim in
`auth.py::get_current_user()` makes `user["role"]` an authoritative
derivative of `user["role_id"]`. All Bucket-A call sites listed below
continue to work correctly through the shim — they read a value that
was itself sourced from the DB's authoritative `role_id`.

**This backlog file tracks the per-site cleanup work** to eliminate
the legacy string gates entirely and replace them with
`Depends(require_permission(resource, action))` or `useCan()`
equivalents. The cleanup is NOT gated by any deadline — each site
can be migrated on its own schedule with dedicated regression tests.

**Migration rule of thumb per site:**
1. Identify the FastAPI dep already in force on the endpoint (usually
   `require_permission` or `get_current_user`).
2. If `require_permission(resource, action)` already gates the route,
   the string gate below is safe redundancy — either delete outright
   OR promote to a `require_permission(resource, action)` on the exact
   same tuple.
3. If no `require_permission` gates the route yet, add one FIRST,
   verify with a pytest, THEN delete the string gate.
4. For dict-keyed lookups (e.g. `caller_role = user.get("role").lower();
   modules = matrix[caller_role]`), the shim already delivers a
   correct legacy string; the site is functionally correct, migrate
   when the surrounding function is next touched.

## Category tally · 2026-08-03 audit

- Simple admin-only gates: 22
- Admin / manager / hseq_lead trio: 12
- Admin + hseq_lead: 3
- `_ADMIN_ROLES` module-const sets: 7
- `WRITE_ROLES` module-const sets: 11
- `EDIT_ROLES` / `_LEGACY_EDIT_ROLES` sets: 3
- `_CARD_WRITE` etc. + role-branch logic: 7
- Lowercased `role_key` privilege ladder: 15
- Admin/owner or admin/manager small allow-lists: 3
- Special-case gates (`swms_phase45.py:236` branch, `ask.py:32/37`,
  `users.py:533/584` target-side, `auth.py:159` legacy dep,
  `mobile_modules.py:239` keyed lookup, `permissions_scope.py:71`
  scope filter): 8
- **Total Bucket-A call sites:** ~91

## Per-file checklist

### High-traffic files (start here — most impact)

- [ ] `workers_inductions.py` — 16 gates (lines 187, 367, 464, 584,
      694, 992, 1128, 1130, 1187, 1199, 1221, 1245, 1302 + branches).
      Blast radius: worker-cards, induction-lists, expiring reminders.
- [ ] `forms.py` — 7 gates (103, 403, 434, 574, 830, 938, plus
      `caller_role` lower at 403). Blast radius: forms library +
      submissions RBAC. High test coverage exists in tests/.
- [ ] `asset_service.py` — 6 gates (209, 634, 823, 859, 923; plus 297,
      555 as reads). Blast radius: plant / assets CRUD.
- [ ] `file_pdf.py` — 5 gates (622, 827, 902, 919, 983). Blast radius:
      PDF export endpoints; low-cost — mostly admin-only.
- [ ] `auth_invite.py` — 5 gates (175, 293, 404, 483, 496). Blast
      radius: invite lifecycle. Some already return 410 (v34.1);
      double-check before migrating.
- [ ] `worker_certifications.py` — 4 gates (108, 271, 485, 533).
      Blast radius: cert CRUD; token candidate `certifications.edit`.
- [ ] `org_settings.py` — 4 gates (48, 99, 138, 177). Includes an
      `owner` allow-list (unique). Blast radius: org root settings.

### Medium files

- [ ] `swms_extras.py` — 3 gates (169, 333, 396)
- [ ] `mobile_modules.py` — 3 gates (159, 183) + keyed lookup 239
- [ ] `sites_qr.py` — 2 gates (297, 474)
- [ ] `sites_signon_v127.py` — 1 gate (70)
- [ ] `supplier_panels.py` — 3 gates (26, 159, 182)
- [ ] `workers_qr.py` — 2 gates (58, 383) + worker-record `role`
      reads (161, 193, 301) which are HR fields on worker doc
      (NOT the caller's role — those stay as-is).
- [ ] `admin_active_sessions.py` — 1 gate (35) + serialisation
      read (76) which now flows through the shim automatically.
- [ ] `swms_phase45.py` — 2 gates (236 branch, 307 raise)
- [ ] `asset_navixy_sync.py` — 2 gates (1018, 1035)
- [ ] `exports.py` — 2 gates (309, 332)
- [ ] `session_history.py` — 1 gate (46) + 3 serialisation reads
      (83, 119, 179) — the reads are historical snapshots and
      correctly preserve the role AT capture time; do not migrate.

### Low files (one gate each)

- [ ] `crud.py:302`  — `{"hseq_lead", "admin"}` on SWMS CRUD.
- [ ] `assets.py:149` — `{"admin", "hseq_lead"}` helper.
- [ ] `workers.py:45,68,101,213,249` — worker CRUD + viewer_role
      + role_key privilege ladder. Note: line 68 reads `viewer.role`.
- [ ] `contractors.py:256` — `{"admin", "manager"}`.
- [ ] `master_risks.py:47` — `_ADMIN_ROLES` set.
- [ ] `cs_incident.py:25` — `_ADMIN` set.
- [ ] `list_forms.py:32` — `_ADMIN_ROLES` set.
- [ ] `list_roles.py:22` — `_ADMIN` set.
- [ ] `companies.py:24` — `_ADMIN` set.
- [ ] `completed_training.py:24` — `_ADMIN` set.
- [ ] `incident_root_causes.py:31` — `_ADMIN_ROLES` set.
- [ ] `help_reference_images.py:72` — admin-only.
- [ ] `workspaces.py:21` — admin-only.
- [ ] `settings_nav.py:209` — `WRITE_ROLES` lower-cased.
- [ ] `suppliers.py:36` — `WRITE_ROLES`.
- [ ] `suppliers_qr.py:165` — `EDIT_ROLES`.
- [ ] `renewals.py:97` — `WRITE_ROLES`.
- [ ] `email_outbox.py:180,263` — privileged read + created_by-vs-admin.
- [ ] `document_library.py:78` — `roles` allow-list.
- [ ] `document_categories.py:97,129` — `role_acl` map keyed on
      lowered role string.
- [ ] `dashboard.py:69` — `{"admin","hseq_lead","supervisor"}`
      privileged report scope.
- [ ] `imports.py:95` — role_key lower for import gating.
- [ ] `bulk_import_prestarts.py:70` — `_WRITE_ROLES` lower.
- [ ] `induction_columns.py:94` — `_WRITE_ROLES` lower.
- [ ] `ask.py:32,37,181` — AI privileged + mobile-modules keyed +
      `WRITE_ROLES`.
- [ ] `users.py:533,584` — TARGET user role check (self-demote /
      soft-delete guard). Different semantic (checks the target's
      role, not the caller's) — needs care.
- [ ] `permissions_scope.py:71` — `legacy` lowercase used inside
      scope filter. Interacts with Phase-6 scope resolution;
      migrate together with the scope refactor.
- [ ] `integrations_simpro.py:1150` — `{"admin","manager","hseq_lead"}`.

## Notes / gotchas

- `require_roles(*roles)` in `auth.py:159` is a deprecated legacy
  dep still used by ~20 endpoints in `integrations_simpro.py` and
  `simpro_zip_import.py`. Docstring updated to flag deprecation
  in v160.3.9.36. Migrating these endpoints to
  `Depends(require_permission("integrations","edit"))` is a
  separate line-item — do it as one sweep once the token
  taxonomy for the simpro sub-actions is settled.

- Sites reading `worker.role` (HR field on a worker doc, NOT the
  caller's login role) are NOT part of this backlog and must be
  left alone: `workers_qr.py:161,193,301`, `asset_service.py:555`,
  `form_assignment_notifier.py:53,72,243,277`.

- Frontend `MobileModulesSection.jsx` was renamed in v160.3.9.36
  (row-key parameter `role` → `role_id`). No further FE work in
  this backlog — the earlier v160.3.9.29-2a/2b sweep already
  migrated the FE surface.

## Testing convention for each migration

For every migrated file, add or extend a pytest that:
1. Confirms the endpoint returns 403 for a role WITHOUT the token.
2. Confirms 200 for a role WITH the token.
3. Uses an ephemeral user + role via the `_mongo` fixture
   (**never mutate stephen@paneltec.com.au or any prod record**).
4. Deletes the ephemeral doc in `finally:`.

See `tests/test_role_default_db_first_v35.py` for the reference
pattern established by Phase 6.
