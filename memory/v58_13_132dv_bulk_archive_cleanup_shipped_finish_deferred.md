# v58.13.132dv — Bulk cleanup of test archived certificates + inline delete in Email popup

**Status**: Shipped. `finish` tool deliberately deferred per standing
directive. `e1_tester` / `testing_agent` untouched. No `/app/mobile/`
edits. No hard-delete of GridFS files (soft-delete only). Migration
is idempotent + fully audited.

## Scope shipped

1. **Migration script** — one-shot bulk soft-delete of the test-shaped
   archived certificates that accumulated on Stephen's org across
   `.132dp/.132dq/.132ds/.132du` pytest runs.
2. **Bulk backend endpoint** —
   `POST /api/org/insurance/{policy_type}/history/clear-all` — powers
   the per-policy-type "Clear all archived (N)" button.
3. **Inline delete in Email popup** — trash icon per archived row +
   per-policy Clear all + confirm dialogs. Wired to existing
   `.132ds` DELETE + new `.132dv` clear-all endpoints.
4. **Filter deleted rows** in the Email popup so the soft-deleted
   migration output disappears from the picker immediately.
5. **Verified inline delete on Org Settings Past Certificates
   folder** — `.132ds` already shipped this; no code change here.

## Migration audit log

Full DRY-RUN + APPLY output at
`/app/memory/v58_13_132dv_migration_audit.log`. Summary:

```
ORG: Paneltec Pty Ltd (3116f250-a4eb-43f3-98a5-2a3656d6cb63)  dry_run=False
  public_liability:      soft-deleted 16 row(s)  (APPLIED)
  workers_comp:          soft-deleted  0 row(s)  (APPLIED)   [already 0 live]
  general_cover:         soft-deleted  4 row(s)  (APPLIED)
  professional_indemnity:soft-deleted  3 row(s)  (APPLIED)
TOTAL soft-deleted: 23
```

Idempotent re-run immediately after: `TOTAL soft-deleted: 0` — every
row already carries `deleted_at`, script correctly skips them.

23 soft-deleted rows (audited by certificate_id, filename, uploaded_at,
archived_at, policy_number, expiry_date):

| # | policy_type | certificate_id | filename | uploaded_at |
|---|---|---|---|---|
| 1 | public_liability | 6aa36ce0bcffcca90f35d9f2 | pl.pdf | 2026-09-11T02:52:16 |
| 2 | public_liability | 6aa36e9aa73f136a3364bdb5 | cert-v1.pdf | 2026-09-11T02:59:38 |
| 3 | public_liability | 6aa36e9aa73f136a3364bdb7 | cert-v2.pdf | 2026-09-11T02:59:38 |
| 4 | public_liability | 6aa36ea0a73f136a3364bdc9 | pl.pdf | 2026-09-11T02:59:44 |
| 5 | public_liability | 6aa36eb650a01f858d2a8afb | cert-v1.pdf | 2026-09-11T03:00:06 |
| 6 | public_liability | 6aa36eb750a01f858d2a8afd | cert-v2.pdf | 2026-09-11T03:00:07 |
| 7 | public_liability | 6aa36ebc50a01f858d2a8b0f | pl.pdf | 2026-09-11T03:00:12 |
| 8 | public_liability | 6aa37a2bdef2d0dabc0c978a | cert1.pdf | 2026-09-11T03:48:59 |
| 9 | public_liability | 6aa37a2bdef2d0dabc0c978c | cert2.pdf | 2026-09-11T03:48:59 |
| 10 | public_liability | 6aa37a2ddef2d0dabc0c9794 | pl.pdf | 2026-09-11T03:49:01 |
| 11 | public_liability | 6aa37a85def2d0dabc0c97a0 | cert1.pdf | 2026-09-11T03:50:29 |
| 12 | public_liability | 6aa37a85def2d0dabc0c97a2 | cert2.pdf | 2026-09-11T03:50:29 |
| 13 | public_liability | 6aa37a87def2d0dabc0c97aa | pl.pdf | 2026-09-11T03:50:31 |
| 14 | public_liability | 6aa37a93def2d0dabc0c97b6 | cert-v1.pdf | 2026-09-11T03:50:43 |
| 15 | public_liability | 6aa37a94def2d0dabc0c97b8 | cert-v2.pdf | 2026-09-11T03:50:44 |
| 16 | public_liability | 6aa37e6c37a7516b51a73207 | cert1.pdf | 2026-09-11T04:07:08 |
| 17 | general_cover | 6aa36cdebcffcca90f35d9ef | cert-v2.pdf | 2026-09-11T02:52:14 |
| 18 | general_cover | 6aa36e9da73f136a3364bdbf | cert-v1.pdf | 2026-09-11T02:59:41 |
| 19 | general_cover | 6aa36e9da73f136a3364bdc1 | cert-v2.pdf | 2026-09-11T02:59:41 |
| 20 | general_cover | 6aa36eb950a01f858d2a8b05 | cert-v1.pdf | 2026-09-11T03:00:09 |
| 21 | professional_indemnity | 6aa36e9fa73f136a3364bdc4 | cert-v1.pdf | 2026-09-11T02:59:43 |
| 22 | professional_indemnity | 6aa36e9fa73f136a3364bdc6 | cert-v2.pdf | 2026-09-11T02:59:43 |
| 23 | professional_indemnity | 6aa36ebb50a01f858d2a8b0a | cert-v1.pdf | 2026-09-11T03:00:11 |

Every row soft-deleted with `deleted_by = "migration:v58.13.132dv"`.
`workers_comp` had 0 live archives already (all 11 rows there were
soft-deleted earlier by the `.132ds` `test_past_insurance_cert_delete_non_admin_403`
seed — those rows are also preserved in the audit trail with
`deleted_by = <admin_user_id>`).

## Reversal path

If Stephen wants any specific certificate back:

1. Open **Org Settings → Insurance → Public liability (or other
   policy) → Past certificates (0)** (folder still shows 0 by
   default — migration hid all of them).
2. Toggle **"Show deleted"** checkbox at the folder header. All 23
   soft-deleted rows re-appear, greyed out with strikethrough.
3. Click **Undelete** on the specific row(s) to bring them back into
   the visible list.

Nothing in this ship touches GridFS — every original PDF is still on
disk and every archived row's download link still resolves.

## Backend

### `backend/org_settings.py`

New endpoint:

```python
@router.post("/insurance/{policy_type}/history/clear-all")
```

* Admin-only (`_is_admin(user)` → 403).
* Iterates `previous_certificates[]` and stamps `deleted_at` +
  `deleted_by = user.id` on any row without an existing `deleted_at`.
* Idempotent — a re-run over an already-cleared policy returns
  `{"ok": True, "cleared": 0}` and doesn't touch the doc.
* Returns `{"ok": True, "cleared": N, "policy_type": kind}` so the FE
  can toast `"Cleared N archived certificates"`.

### `backend/scripts/cleanup_test_archives_v58_13_132dv.py`

* Runnable via `python -m scripts.cleanup_test_archives_v58_13_132dv`.
* `--org-id <uuid>` overrides the default Stephen-tenant target.
* `--dry-run` prints what would be soft-deleted without mutating.
* Every row soft-deleted logged as a JSON audit line (persisted in
  `/app/memory/v58_13_132dv_migration_audit.log`).
* Uses the same `deleted_at`/`deleted_by` shape as the API endpoint
  so admin surfaces treat migration-hidden rows identically to
  user-hidden rows (Undelete works on both).

## Frontend — `frontend/src/pages/OrgSettings.jsx::InsuranceEmailModal`

* New state:
  * `hiddenCerts` — per-kind set of certificate_ids soft-deleted from
    within this popup session; hides the row immediately without
    needing a doc refetch.
  * `confirmDelCert` — per-row delete confirm modal (kind + row).
  * `confirmClearKind` — bulk clear-all confirm modal (kind).
* Handlers:
  * `doDeleteArchived(kind, row)` → hits `DELETE
    /api/org/insurance/{kind}/history/{file_id}`, snaps the row into
    `hiddenCerts`, drops the id from `archivedSelections`.
  * `doClearAllArchived(kind)` → hits new `POST /clear-all`
    endpoint, marks all archived ids for that kind hidden, resets
    the selection.
* Rendering:
  * Archived list filters out rows where `a.deleted_at` OR
    `hiddenCerts[kind]` contains the id — so soft-deleted rows
    never render.
  * Per-row trash button `insurance-email-arch-delete-<id>`.
  * Per-policy header pill `insurance-email-clear-archived-<kind>`
    (only visible when `archived.length > 0`) reads
    `Clear all archived (N)`.
  * Both actions gate through a confirm modal with spec copy:
    * Row: *"Are you sure you want to delete this past certificate?
      It will be hidden from view but preserved in the audit
      trail. Continue?"*
    * Bulk: *"Delete all N archived certificates for {label}? They
      will be hidden from view but preserved in the audit trail.
      Continue?"*

## Tests

`backend/tests/test_v58_13_132dv_bulk_archive_cleanup.py` — **7
passed in 7.7s**:

```
test_backend_clear_all_endpoint_present                       PASSED
test_migration_script_shape                                   PASSED
test_frontend_email_popup_has_inline_delete                   PASSED
test_three_way_version_sync_at_132dv                          PASSED
test_clear_all_soft_deletes_and_gridfs_preserved              PASSED
test_clear_all_admin_only                                     PASSED
test_migration_soft_deleted_stephen_org                       PASSED
```

Coverage per acceptance criterion:

* Migration script has the exact shape (default org, audit tag,
  4-kind coverage, idempotent-skip, `--dry-run` flag).
* Bulk endpoint is admin-only (401/403 for unauth'd) + idempotent
  re-run returns `cleared: 0`.
* Behavioural round-trip: seed 2 archived certs → call clear-all →
  live list returns 0 → `?include_deleted=true` returns them with
  `deleted_at` populated → GridFS `db.fs.files.find_one(ObjectId(...))`
  still returns the blob.
* Persistence lock on Stephen's org: `/history` returns `total: 0`
  for all 4 policy types after the migration.
* FE popup pins: trash button per row + per-kind Clear-all + both
  confirm dialogs + `!a.deleted_at` filter + `hiddenCerts` state.
* 3-way version pin at `.132dv`.

No regressions across the earlier suites:

```
tests/test_v58_13_132du_reset_email_ux.py           — 10 passed
tests/test_v58_13_132dt_simpro_search_fix.py        —  7 passed
tests/test_v58_13_132ds_staff_login_soft_delete.py  — 15 passed (rate-limit skips)
tests/test_v58_13_132dr_sidebar_branding_shading.py —  6 passed
= 30 passed, 8 skipped
```

## Screenshot

`/app/memory/v58_13_132dv_01_cleaned_popup.jpeg` — the Insurance
Certificates Distribution popup on Stephen's org, post-migration.
All four policy types (`Public liability`, `Workers compensation`,
`General cover`, `Professional indemnity`) now render as compact
single-line rows with **no archived certificates listed underneath**.
Version pill `v160.3.9.58.13.132dv` visible in the sidebar footer.

Compare to the pre-migration state referenced in the brief (30+
archived `pl.pdf` / `cert-v1.pdf` / `cert-v2.pdf` / `cert1.pdf` /
`cert2.pdf` / `cert-a.pdf` / `cert-b.pdf` rows across three policy
types).

## Version pins → `.132dv`

* `frontend/src/lib/version.js` — RUNNING + EXPECTED_CACHE
* `frontend/public/service-worker.js` — CACHE_VERSION
* Mobile untouched at `.132di`.

## Ops rules honoured

* No `finish` / `testing_agent` / `e1_tester`.
* No `/app/mobile/` edits.
* No hard-delete of GridFS files. Every "delete" is a
  `deleted_at`/`deleted_by` stamp on the array-entry.
* No new disk writes.
* Migration is idempotent + audit-logged in
  `/app/memory/v58_13_132dv_migration_audit.log` and the table
  above.
