# v58.13.132hu — Worker↔user auto-link + mirror-status pill (shipped)

## User pain (verbatim, 2026-09-17)

> "Settings > Users & Permissions is missing one worker from Settings
> > Workers. They want ALL workers mirrored, and a rule for
> auto-provision on new worker creation."
>
> "Missing worker: Glen — Walker Designs."

## Live audit before the fix

    workers (undeleted):   70
    linked:                 6
    email_conflict:        63    ← false positives
    no_email:               1

`.132hs`'s provisioning treated every same-email match as a hard
`email_conflict`. 63/70 of Stephen's workers were falsely flagged —
their matching users existed BEFORE `.132hs` shipped (Simpro's
legacy user path, admin-created accounts, pre-auto-provision
onboarding). The user IS the correct target; the `worker.user_id
↔ user.worker_id` two-way link just hadn't been attached.

## Refined policy (`.132hu`)

`provision_user_for_worker(worker, actor)` now:

  * **Auto-links** when a matching-email user has no `worker_id`
    set → `status="linked"`.
  * **Idempotent no-op** when a matching-email user's `worker_id`
    already points at THIS worker.
  * **Genuine `email_conflict`** ONLY when the matching-email user
    is already linked to a **different** worker (e.g. duplicate
    worker rows, Stephen's Amanda Guy case — two Amanda Guy workers
    with different `simpro_employee_id` values sharing the same
    email).

## Live backfill after fix

    scanned=70 · already_linked=68 · invited_pending_send=0 ·
    email_conflict=1 · no_email=1

  * **68 workers linked** (was 6 → +62 auto-heals).
  * **1 email_conflict** — genuine duplicate: two Amanda Guy
    workers (`simpro_employee_id` 50 and 1086) share the same
    email. Admin decision needed to pick the authoritative record.
  * **1 no_email** — Wayne Nippers has no email on file.

Glen — Walker Designs (`id=f053dfc5-6116-409a-8092-0a4a3eaf7415`,
simpro=1093, email=`glen@walkerdesigns.com.au`) is now
`user_link_status="linked"` after the same backfill run.

## Worker creation path audit

Grep for every `db.workers.insert` in the codebase:

    /app/backend/integrations_simpro_workers.py:437

**One and only one insert path** — `refresh_workers` in Simpro
integration. `.132hs` hooked it. `POST /workers` is 410-deprecated.
`simpro_zip_import.py` only UPDATES existing workers. No manual
"Add worker" endpoint exists. No systemic gap — the gap was in the
provisioning logic, not the create path.

## New endpoint — worker↔user mirror status

`GET /api/worker-user-mirror-status`

    {
      "workers_total":   int,
      "linked":          int,
      "invited_pending": int,
      "invite_sent":     int,
      "email_conflict":  int,
      "no_email":        int,
      "unset":           int
    }

Powers the Settings > Users toolbar pill:

    68/70 mirrored · 1 conflict · 1 no email

Fetched on mount + after every backfill / bulk-invite run.

**Path collision note:** the endpoint originally shipped at
`/workers/mirror-status` and `/users/mirror-status`; both collided
with FastAPI's `GET /workers/{worker_id}` and `GET /users/{user_id}`
catch-alls in earlier routers. Moved to `/worker-user-mirror-status`
to sit outside both namespaces.

## Files touched

* `backend/worker_user_provisioning.py` — refined `provision_user_for_worker`
  conflict → auto-link policy.
* `backend/worker_user_provisioning_routes.py` — new
  `GET /worker-user-mirror-status` endpoint.
* `frontend/src/pages/UsersManagement.jsx`
  - `mirrorStatus` state + `loadMirrorStatus()` fetcher (called on
    mount, after backfill, after bulk-invite).
  - Mirror pill rendered next to the segment counts in the page
    header. Testids: `users-mirror-pill`, `users-mirror-linked-count`,
    `users-mirror-conflict`, `users-mirror-noemail`,
    `users-mirror-pending`, `users-mirror-unset`.
  - **`statusMatches` predicate rewrite** — the default "Active"
    filter now surfaces both `status='active'` AND
    `status='invited'` rows. Before, Glen (status=invited via
    auto-provisioning) was invisible in every default view
    including search-when-Active-selected. The "Pending inductees"
    built-in view was ALSO broken (filtered on `pending_invite`
    which no user row ever holds); now aliased onto `invited` +
    `activation_status=pending_activation`.
  - `segments` + `searchSegments` recount `status='invited'` under
    the "pending" bucket so header counts + the "N pending hidden ·
    show" nudge stay consistent.
* `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped `.132ht` → `.132hu`.
* `frontend/public/service-worker.js` — `CACHE_VERSION` in lockstep.

## Tests (23 total across .132hs/.132ht/.132hu suites, all green)

`tests/test_v58_13_132hu_worker_user_auto_link.py` (6 new):

  1. Auto-link when the matching-email user has no `worker_id`.
  2. `email_conflict` only when the matching-email user is bound to
     a different worker.
  3. Idempotent when the user already points at this worker.
  4. Backfill auto-links every free email match in one call.
  5. `GET /worker-user-mirror-status` returns the expected shape
     and buckets sum to `workers_total`.
  6. Version pin `.132hu` (forward-safe regex).

The `.132hs::test_provision_email_conflict_does_not_create_user`
test was renamed + expanded into two tests (`_auto_links_when_user_free`
and `_flags_conflict_when_user_bound_to_other_worker`) that lock the
refined policy.

## Ops rules honoured

* No `testing_agent` / `e1_tester` / `finish` — pytest + Playwright
  reproduction only.
* No `/app/mobile/` edits.
* No hard-coded env values.
* Three-way version lockstep bumped.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Deferred

* **Amanda Guy duplicate resolution** — one of the two workers
  (`simpro_employee_id=1086`) is unlinked and flagged
  `email_conflict`. Admin needs to decide whether to archive one,
  or link the second worker to a different email.
* **Wayne Nippers no_email** — add an email address to his worker
  record and re-run the backfill.
* **Full purge of `worker_companies` collection** — still an open
  Q from `.132ht`.

## Screenshots

* `memory/v58_13_132hu_mirror_pill.jpeg` — Settings > Users
  toolbar with the new "68/70 mirrored · 1 conflict · 1 no email"
  pill.
