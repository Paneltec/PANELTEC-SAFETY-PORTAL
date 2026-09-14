# v58.13.132fy — Show inactive workers + Restore · SHIPPED (finish deferred)

## Scope
Admin flow: surface soft-deleted / deactivated workers on the Workers
list via a "Show inactive" toggle, and let an admin one-click restore
them.

## Backend changes
- `backend/workers.py`
  - `GET /api/workers?include_inactive=true` (from previous session)
    — admin-only clamp, drops the `deleted_at: None` filter when the
    caller is admin/hseq_lead **and** the query param is set.
  - **NEW** `POST /api/workers/{worker_id}/restore`
    - Gate: `require_permission("workers", "delete")` + hard-clamp to
      `role == "admin"` (HSEQ Lead can archive but not resurrect).
    - Clears `deleted_at`, `deactivated_at`, `soft_deleted`; forces
      `active=True`; stamps `updated_at`.
    - Writes one `archive_audit` row (`module="workers"`,
      `action="restore"`, `actor_user_id`, `actor_email`, `reason`,
      `criteria.item_id`, `timestamp`).
    - Idempotent — a call against an already-active worker returns
      `{worker_id, already_active: true}` without a second audit row.
    - 404 on missing/foreign worker (org scoping preserved).

## Frontend changes
- `frontend/src/pages/Workers.jsx`
  - New `showInactive` state (default off) + `restoring` state.
  - `load()` now sends `?include_inactive=true` when the toggle is
    on AND the viewer is admin. Refetches on toggle flip.
  - New toolbar `<label data-testid="show-inactive-toggle">` with
    `data-testid="show-inactive-checkbox"` — admin-only.
  - Row-level `isInactive = deleted_at | deactivated_at |
    soft_deleted | active===false`. Inactive rows carry
    `data-inactive="true"`, dim to `opacity-60` on a slate wash,
    render an "Archived" pill next to the Active/Inactive badge,
    and swap the whole action cluster for a single Restore button
    (`data-testid="restore-<id>"`).
  - `restore(w)` → `POST /workers/${id}/restore` → success toast +
    reload. "Already active" toast when idempotent.

## Version bumps (lockstep)
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fy`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132fy`.

## Pytest (`tests/test_v58_13_132fy_show_inactive_workers.py`)
7 checks — all green:
```
tests/test_v58_13_132fy_show_inactive_workers.py::test_list_workers_accepts_include_inactive_param PASSED
tests/test_v58_13_132fy_show_inactive_workers.py::test_restore_endpoint_registered              PASSED
tests/test_v58_13_132fy_show_inactive_workers.py::test_frontend_show_inactive_toggle_pins       PASSED
tests/test_v58_13_132fy_show_inactive_workers.py::test_frontend_inactive_row_dimming_and_badge  PASSED
tests/test_v58_13_132fy_show_inactive_workers.py::test_include_inactive_behavioural             PASSED
tests/test_v58_13_132fy_show_inactive_workers.py::test_restore_404_on_unknown_worker            PASSED
tests/test_v58_13_132fy_show_inactive_workers.py::test_version_bumped_to_132fy                  PASSED

============================== 7 passed in 3.07s ===============================
```
Behavioural test picks a live admin-visible active worker, soft-deletes
via `DELETE /workers/{id}`, verifies it drops from the default list,
verifies `?include_inactive=true` re-surfaces it with `deleted_at`
populated, `POST /restore` brings it back, and a second `POST /restore`
returns `already_active: true`.

## Playwright (`scripts/verify_132fy.py`)
```
picked worker: {'ok': True, 'id': 'f80a2fb0-eef5-4c9d-bfcf-bdd60502f850', 'name': 'RICK ANTRIM'}
soft-delete: {'status': 204}

=== v58.13.132fy verification ===
STATUS: PASS
Show-inactive toggle + Restore round-trip verified.
```
Screenshots dropped:
- `memory/v58_13_132fy_01_toolbar.png` — toolbar showing the toggle.
- `memory/v58_13_132fy_02_inactive_row.png` — dimmed inactive row
  with Archived pill + Restore button.
- `memory/v58_13_132fy_03_restored.png` — worker back in default list.

## NOT changed
- `/app/mobile/` — untouched. `MOBILE_BUNDLE_VERSION` unchanged.
- HSEQ Lead permissions — still can archive, still cannot restore.
- Bulk-restore — deliberately not shipped (one-at-a-time is the
  admin-safe path per soft-delete precedent).
- The 20 pre-existing `ephemeral-upload-storage` lint warnings —
  still parked for `v58.14.x`.
- `finish` / `testing_agent` / `e1_tester` — none used, per standing
  directive.

## Next
Rolling into **v58.13.132fz** — Legacy template matcher additions
(Excavator Pre-Start, Trailer Pre-Start, Drain Cleaning SSRA,
Excavation Permit).
