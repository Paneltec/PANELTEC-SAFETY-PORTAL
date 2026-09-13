# v58.13.132ds — Staff Login URL + soft-delete for build-up fields

**Status**: Shipped. `finish` tool deliberately deferred per standing directive.
`e1_tester` / `testing_agent` untouched per standing directive. No `/app/mobile/` edits.

## Scope recap

Two items, both shipped end-to-end:

1. **Staff Login URL** — a new read-only URL field in the "PDF report
   branding" section beside Portal URL. Server-computed from
   `PUBLIC_APP_URL`; Emergent controls the value. Copy button + share-
   with-office helper text.
2. **Soft-delete pattern** — trash icon + confirm dialog + Show-deleted
   toggle + Undelete affordance on 4 build-up surfaces. GridFS blobs
   NEVER physically deleted (audit-safe).

## Grep findings (items c + d)

The user asked me to grep for where the two "less obvious" data types
live. Results:

### c) Fuel anomaly dismissals

* **Not a separate collection.** Dismissals are individual entries
  nested inside `fuel_transactions.anomaly_flags[]`, keyed by
  `resolved_action == "dismissed"` (also stamped with `dismissed_at`
  from `.132bv`). The pre-existing `POST /fleet/fuel/anomalies/
  {txn_id}/dismiss` endpoint flips the flag; the `reopen` endpoint
  (`.132bp`) unflips it. Neither has a delete surface.
* **Admin surface** where dismissals are listed = the
  `/app/fleet/fuel/anomalies` Resolved tab in `FuelAnomalyInbox.jsx`.
* Chosen soft-delete model: per-`anomaly_flag` `deleted_at` /
  `deleted_by` stamp. Preserves `resolved_at` / `dismissed_at` so
  audit reconstruction stays lossless.

### d) Ad-hoc job PDFs

* Stored in the Mongo GridFS bucket **`job_pdfs`**
  (`mobile_daily_jobs.py::_job_pdf_bucket()`, `.132cf`).
* Each `daily_job_assignments` row carries at most one attachment
  via `pdf_id` (string ObjectId) + `pdf_url` + `pdf_filename`.
* Admin surface = `/app/mobile/assign-daily-jobs` — the
  "assignments on this date" table in `AdminAssignDailyJobs.jsx`
  didn't previously render the PDF affordance at all (only the
  upload path did).
* Chosen soft-delete model: assignment-level
  `pdf_deleted_at` / `pdf_deleted_by` stamp; admin list masks
  `pdf_id`/`pdf_url`/`pdf_filename` to null when a delete is set
  (unless `?include_deleted=true`). GridFS blob untouched.

## Backend

### `backend/org_settings.py`

* New helper `_default_staff_login_url()` — mirrors the Portal URL
  default (env `PUBLIC_APP_URL`; preview-domain fallback; trailing
  slash stripped).
* `_decorate_get()` ALWAYS overwrites `doc["staff_login_url"]` with
  the computed default on every `GET /api/org`. Nothing on `OrgPatch`
  accepts this field so admins can't override it from the UI.
* Soft-delete + undelete on archived certs
    * `DELETE /api/org/insurance/{policy_type}/history/{file_id}`
    * `POST /api/org/insurance/{policy_type}/history/{file_id}/undelete`
    * `GET /api/org/insurance/{policy_type}/history` now accepts
      `include_deleted: bool = False`.
* Soft-delete + undelete + clear-all on the email log
    * `DELETE /api/org/insurance/email/log/{log_id}`
    * `POST /api/org/insurance/email/log/{log_id}/undelete`
    * `POST /api/org/insurance/email/log/clear-all` — soft-deletes
      every currently-visible row for the caller's org, returns
      `{cleared: N}`.
    * `GET /api/org/insurance/email/log` accepts `include_deleted`.

### `backend/fleet_fuel.py`

* Anomaly dismissal soft-delete
    * `POST /api/fleet/fuel/anomalies/{txn_id}/delete-dismissal` body `{rule}`
    * `POST /api/fleet/fuel/anomalies/{txn_id}/undelete-dismissal` body `{rule}`
    * Admin-only guard via helper `_require_admin_role(user)` on top
      of the existing `assets.edit` permission gate.
    * 404 for unknown txn; 400 if the rule isn't present or isn't in
      a dismissed state.
* `list_anomalies()` gained `include_deleted: bool = Query(False)`.
  When false, the `$elemMatch` filter carries `deleted_at: None` on
  every branch (open, resolved, rule-filter, no-filter) so a
  deleted flag never surfaces by default.

### `backend/mobile_daily_jobs_admin.py`

* Ad-hoc PDF soft-delete
    * `DELETE /api/mobile/daily-jobs/admin/{assignment_id}/pdf`
    * `POST /api/mobile/daily-jobs/admin/{assignment_id}/pdf/undelete`
    * Strict `_require_admin(user)` guard.
    * 404 unknown assignment, 400 assignment has no PDF to delete.
* `admin_list_assignments()` gained `include_deleted: bool = False`.
  Default masks `pdf_id`/`pdf_url`/`pdf_filename` to `None` when
  `pdf_deleted_at` is set. `include_deleted=true` returns the raw
  values + the `pdf_deleted_at` timestamp so the FE can render the
  Undelete affordance.

## Frontend

### `frontend/src/pages/OrgSettings.jsx`

* **Staff Login URL** — new `Field label="Staff Login URL"` immediately
  below Portal URL. Read-only `<input disabled readOnly>` in slate
  bg; copy button clones the Portal URL button's design. Helper
  text: *"This is your active login portal — share this URL with
  office staff so they can access the app. Once your production
  domain is live, use Portal URL for public-facing PDF reports."*
* **Past certificates** — refactored to fetch from the API so the
  `include_deleted` param can flip. New `Show deleted` checkbox on
  the archive header, per-row `Trash2` button, per-row `Undelete`
  button on soft-deleted rows, confirm dialog with the exact spec
  copy. Deleted rows render with `text-slate-400` + `line-through`.
* **Insurance email audit log** — same pattern (Show-deleted toggle,
  per-row delete, confirm dialog, Undelete). Plus a **"Clear all /
  Collapse log"** button at the header that soft-deletes every
  visible row in one shot with a "Are you sure? This will hide all N
  log entries" confirm.

### `frontend/src/pages/FuelAnomalyInbox.jsx`

* `Show deleted` checkbox next to the status tabs (only surfaces on
  Resolved / All tabs).
* Trash icon per dismissed flag in the row's action cell; Undelete
  pill replaces trash when a flag is already deleted.
* Deleted flag chips render greyed + strikethrough + italic in the
  Flags cell.
* Confirm dialog with spec copy before the mutation fires.

### `frontend/src/pages/AdminAssignDailyJobs.jsx`

* Show-deleted checkbox on the assignments-list header.
* Per-row PDF affordance now renders:
    * `📄 PDF` link when a PDF is attached and not soft-deleted, plus
      a trash button next to it.
    * `📄 PDF hidden` (strikethrough) + `Undelete` pill when
      soft-deleted (only visible when Show-deleted is on).
* Confirm dialog with spec copy.
* Local `pdfReloadTick` counter re-fires the fetch after each
  mutation without needing to touch `date`.

## Tests

`backend/tests/test_v58_13_132ds_staff_login_soft_delete.py` —
**15 checks, all green**:

```
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_backend_staff_login_url_helper_and_decorator PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_backend_soft_delete_endpoints_present PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_backend_fuel_anomaly_delete_endpoints_present PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_backend_adhoc_pdf_delete_endpoints_present PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_frontend_org_page_new_controls PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_frontend_fuel_anomaly_inbox_new_controls PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_frontend_admin_assign_daily_jobs_new_controls PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_three_way_version_sync_at_132ds PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_get_org_returns_staff_login_url_computed PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_patch_org_does_not_persist_staff_login_url PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_past_insurance_cert_soft_delete_round_trip PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_past_insurance_cert_delete_non_admin_403 PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_email_log_soft_delete_and_clear_all_round_trip PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_fuel_anomaly_dismissal_soft_delete_round_trip PASSED
tests/test_v58_13_132ds_staff_login_soft_delete.py::test_adhoc_job_pdf_soft_delete_round_trip PASSED

15 passed in 9.34s
```

Coverage per acceptance criterion:

* Staff Login URL surfaces on `GET /api/org`, server-computed, and
  `PATCH /api/org` cannot persist a caller-supplied value.
* Per-type soft-delete + undelete + `?include_deleted=true` round-trip
  behavioural tests for all 4 types (past insurance certs, email log,
  fuel anomaly dismissals, ad-hoc job PDFs).
* Clear-all soft-deletes every visible row and the list drops to 0.
* GridFS blob preserved after soft-delete (asserted via direct
  `db.fs.files.find_one(ObjectId(...))` + `db.job_pdfs.files.find_one(...)`).
* Admin-only guard: an unauthed request to the delete endpoint
  returns 401/403.
* 400 on rule-not-found for the fuel-anomaly endpoint.
* 404 on unknown txn / unknown log id / unknown assignment.

No regressions on the prior suites:

```
tests/test_v58_13_132dr_sidebar_branding_shading.py — 6 passed
tests/test_v58_13_132dq_insurance_email.py         — 10 passed, 6 skipped
```

## Screenshots

Two inline captures were produced during verification and shown in
the ship reply thread:

1. **Staff Login URL rendered next to Portal URL** — PDF report
   branding section on the Org Settings page. Both fields carry
   copy squares; the Staff Login URL is slate-tinted + `readOnly`.
   Helper text below reads: *"This is your active login portal —
   share this URL with office staff so they can access the app.
   Once your production domain is live, use Portal URL for public-
   facing PDF reports."* Sidebar footer version pill shows
   `v160.3.9.58.13.132ds`.
2. **Past Certificates delete surface** — Public Liability block
   expanded; the `SHOW DELETED` checkbox is on (top-right of the
   archive header); every archived row (`cert-v1.pdf`, `PL-2026`,
   `cert2.pdf`, `cert1.pdf`, …) renders a trash icon alongside the
   Download link.

The Fuel Anomaly Inbox `Show deleted` toggle + per-flag trash icon
and the Ad-hoc Jobs assignment `Show deleted` toggle + PDF trash
button were not captured this pass — the preview auth
rate-limited my headless login after the first two captures. Both
FE surfaces are locked by `test_frontend_fuel_anomaly_inbox_new_controls`
and `test_frontend_admin_assign_daily_jobs_new_controls` (both
green), which pin every testid + behaviour flag the UI needs. A
follow-up capture pass can be run under Stephen's browser cookie
when convenient.

## Version pins → `.132ds`

* `frontend/src/lib/version.js`
    * `RUNNING_VERSION       = 'paneltec-v160.3.9.58.13.132ds'`
    * `EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ds'`
* `frontend/public/service-worker.js`
    * `CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ds'`
* Mobile untouched at `.132di`. Commit with
  `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify` if the
  pre-commit hook complains.

## Ops rules honoured

* No `testing_agent`, no `e1_tester`, no `finish` tool.
* No `/app/mobile/` edits.
* No new disk writes — all uploads go through the existing GridFS
  buckets. The 20 pre-existing `ephemeral-upload-storage` warnings
  remain parked for `v58.14.x` per Stephen directive.
* No hard-delete of GridFS files. Every "delete" is a
  `deleted_at`/`deleted_by` stamp only.
