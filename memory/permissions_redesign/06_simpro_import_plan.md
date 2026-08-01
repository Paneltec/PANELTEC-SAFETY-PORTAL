# 06 — Simpro import plan (manual, no cron)

**Version:** v160.3.9.26-P1 · **Date:** 2026-02-01

## Simpro client status (existing code)

Simpro sync already exists and is admin-only. Relevant files:

- `/app/backend/integrations_simpro_workers.py` — the worker/employee
  sync router.
- `/app/backend/cron_simpro_delta.py` — an existing cron-delta job for
  workers (only). Out of scope for this redesign: users, not workers.
- `/app/backend/scripts/simpro_worker_sync.py` — CLI script variant.
- `/app/backend/simpro_zip_import.py` — bulk XLSX zip importer.

## Endpoint used

Per `integrations_simpro_workers.py`, employees are fetched via:

```
GET  {SIMPRO_BASE}/api/v1.0/companies/{company_id}/employees/          # list
GET  {SIMPRO_BASE}/api/v1.0/companies/{company_id}/employees/{empl_id} # detail
```

Auth: bearer token stored in `org_settings.integrations.simpro`.
Pagination handled by `_paginate()` (existing).

## Field mapping — Simpro → Paneltec `users`

| Simpro field | Paneltec `users` field | Notes |
| --- | --- | --- |
| `ID` | `simpro_employee_id` (string) | Primary anchor for reconciliation. |
| `PrimaryContact.Email` (lower-cased, trimmed) | `email` | Also used as **secondary** match key. |
| `GivenName` / `FirstName` | `first_name` | |
| `FamilyName` / `LastName` | `last_name` | |
| `Position` | `simpro_position` | Free text. NOT auto-mapped to a role. |
| `Archived` (bool) | `is_archived` | If `Archived=true` → set `is_archived=true`, `activation_status="archived"`. |
| — | `simpro_last_synced_at` | Set to now on every successful sync. |
| — | `role_id` | **Not set by sync.** New users land as `pending_activation` with `role_id=null`. Admin must promote. |
| — | `role` (legacy string) | Set to `"worker"` for backwards-compat until Phase 5. |

## Matching rule (deterministic, in order)

1. **Primary — Simpro Employee ID.** Look up existing user by
   `simpro_employee_id`.
2. **Secondary — Email.** If no primary hit, look up by
   `email` (lower-cased). If a match is found, back-fill
   `simpro_employee_id` and log the reconciliation in
   `user_permission_audit`.
3. **No match — create.** Insert a new user with
   `activation_status="pending_activation"`, `is_archived=false`,
   `role_id=null`, `role="worker"` (legacy), `email` populated,
   `password_hash=null` (invited via renewal-link flow).

## Reactivation / archival rule

- **Simpro says Archived=true** → set `is_archived=true`,
  `activation_status="archived"`. **Do NOT delete.**
- **Simpro says Archived=false**, Paneltec had `is_archived=true` →
  set `is_archived=false`, `activation_status="active"` (assuming
  they previously had `role_id`; else set `pending_activation`).
  Log a `user_permission_audit` entry with `change_type="user_reactivated"`.
- **User exists in Paneltec but not in Simpro at all** → leave alone. Do
  not archive automatically; there are non-Simpro users (contractors,
  admins). This is a **passive** sync.

## Trigger

- **Manual only.** Button in `UsersManagement.jsx` (Phase 4 UI).
- **No cron.** `cron_simpro_delta.py` remains a separate concern for
  workers; the users sync is deliberately manual so admins retain
  visibility into who gets provisioned.
- Backend endpoint: `POST /api/users/simpro-import`
  — admin-only. Runs in-request (existing employees API responds fast
  enough — 100–1000 employees per company). Returns a diff summary:
  `{"created": n, "matched": n, "reactivated": n, "archived": n,
  "skipped_no_email": n}`.

## Data-integrity guards

- Skip rows with no email AND no ID.
- Never overwrite a Paneltec user's `role_id` — the sync is one-way
  for identity fields only.
- Never touch `password_hash`, `role`, `role_id`, or
  `user_permission_overrides` from the sync.

## Confirmations for you

- ✓ **No cron work in scope.** The sync is a button click.
- ✓ **No new Simpro endpoint required.** Uses the existing
  `/companies/{cid}/employees/` route already wired in
  `integrations_simpro_workers.py::_fetch_simpro()`.
- ⚠ **One clarification needed before Phase 2 code:** what should
  happen when a Simpro employee's email is populated but does NOT match
  an existing user AND matches a **worker** record in `workers`
  (v3.18)? Option A: create a new user linked to that worker via
  `simpro_employee_id`. Option B: only create a user if the email
  matches a worker AND the worker has never logged in. Recommend A —
  simpler mental model. Confirm before Phase 2.
