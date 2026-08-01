# 08 — Phase 3b implementation notes

**Version:** v160.3.9.28 · **Date:** 2026-08-01

Companion to doc 05 (`05_data_model.md`) — records the intentional
gaps in the `permissions_scope` wiring and the rationale for skipping
two of the five resources originally listed for record-level scoping.

## `hr_employees` — intentionally admin-only

- Every endpoint in `/app/backend/hr_employees.py` is gated by
  `Depends(require_roles("admin"))`. This matches the v3.18 design note
  that HR PII is deliberately admin-only.
- The `hr_employees` schema does not carry a `user_id` FK to the
  `users` collection. The only field that links to a Paneltec user is
  `email` — which is not safe for scoping (a matching email would leak
  every field on the HR record).
- The `permissions_scope` helper RESERVES the resource key `"hr"` and
  **fails closed** for non-privileged callers
  (`scope_filter` returns `{"__scope_no_match__": True}`,
  `can_access_record` returns `False`). This guarantees no code path
  can accidentally expand `hr` access to non-admins without a schema
  change first.
- **Future work** — if we later expose a per-employee self-service
  page, add a dedicated `GET /api/hr-employees/me` endpoint that:
    1. Looks up the HR row by the caller's `simpro_employee_id` or
       `email`.
    2. Applies field-level redaction (DOB / TFN / address) unless the
       caller has an override token.
  That endpoint would NOT go through `scope_filter`; it would use the
  dedicated `require_permission` + explicit self-lookup pattern.

## `worker_certifications` — cross-resource join retained

- Cert routes are keyed by `worker_id` in the URL
  (`GET /api/{worker_id}/certifications`), not by `cert.created_by`.
- The natural scope is *"the worker whose certs these are must be me"*
  — a **cross-resource join** through `workers.user_id == user.id`.
- This is already enforced correctly at
  `worker_certifications.py:275-283` via the local `_require_worker`
  helper. Migrating to the generic `scope_filter` would be strictly
  weaker (it would only check `cert.created_by`, missing the
  `worker_id → user_id` link entirely).
- The `permissions_scope` helper RESERVES the resource key
  `"certifications"` and fails closed on it for non-privileged callers,
  matching the `hr` policy.

## `contractor_rep` — dormant branch, reachable only in Phase 3d

- Both contractor roles (`contractor_rep`, `contractor_rep_submit_only`)
  are seeded with `is_active=False` in Phase 2.
- The `scope_filter` branch that returns `{"id": user.company_id}` for
  `contractors` and `{"company_id": user.company_id}` for the four
  child resources exists in `permissions_scope.py` and is fully
  pytested.
- **Nothing in Phase 3b assigns the role_id to any user.** Assignment
  happens in Phase 3d after (a) the contractor onboarding UI and
  (b) the org-invite flow are in place.
- The branch fails closed if a `contractor_rep` user is missing a
  `company_id` — pytested by
  `test_scope_filter_contractor_rep_no_org_id_fails_closed`.

## `documents` collection — currently empty in prod

- Both `db.documents` and `db.document_library` are empty in the live
  DB at the time of v3b landing. Scoping wiring on
  `document_library.list_files` is in place but has no live traffic
  to exercise. Full pytest coverage on the helper stands in for the
  smoke test.

## `sites_signon_v127.py` — legacy `manager` / `hseq_lead` demoted

- The pre-v28 `_require_admin` helper accepted role in
  `{"admin", "manager", "hseq_lead"}`. Prod-DB survey found ZERO
  active users in those two legacy roles (both existing rows are
  `status=disabled` / activation=`suspended`, plus one test fixture).
- All 6 write endpoints migrated to
  `Depends(require_permission("sites", "edit"))` (create/patch/restore)
  or `.delete` (bulk-delete) or `.view` (recycle-bin / signon-log /
  signon-log-export).
- Legacy `_require_admin` retained as a defensive no-op inside route
  bodies for backwards compatibility if the dep ever gets bypassed.
- If a future org needs a `manager` role to sign visitors on/off,
  the correct remediation is a per-user override
  (`user_permission_overrides.token = "sites.edit"`) rather than
  reopening the legacy role-set gate.

## Manual-site delete fallback

- Pre-v28, `POST /api/sites/bulk-delete` matched only by
  `simpro_site_id`. Sites created via `POST /api/sites` (manual, no
  Simpro link) do not carry a `simpro_site_id` and were un-deletable
  via the API.
- v28 fix: `bulk_delete_sites` now matches by either
  `simpro_site_id` OR `id`. Restore endpoint received the same fix.
- Downstream update uses `id` (the stable UUID) rather than
  `simpro_site_id` for the `$set` filter — deleted docs are keyed
  consistently on `id`.
