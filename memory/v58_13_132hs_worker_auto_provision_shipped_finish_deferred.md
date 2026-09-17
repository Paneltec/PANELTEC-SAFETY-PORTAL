# v58.13.132hs — Worker → user auto-provisioning (shipped, finish deferred)

## What shipped

Every new worker now automatically gets a corresponding `users` row
seeded in `status="invited"` state (role=viewer, worker_id linked,
throwaway password hash) — WITHOUT sending any invite email. Admin
gates the send via a per-user "Send invite" button in the drawer, or
via a bulk "Send pending invites" action in the Users toolbar.
Existing workers without a linked user can be provisioned in one
click via the new "Provision users for workers" toolbar button.

## User pain (verbatim, Stephen · 2026-09-17)

> "Auto-provision workers → users … create user in status=invited
> state, but hold the email. Add a 'Send invite' button per user
> card in Settings > Users so admin manually triggers when ready. …
> Silent provision, no emails auto-sent. Admin toolbar has a bulk
> 'Send pending invites' action for batches. … Email conflict: FLAG,
> do NOT auto-link."

## Design decisions (locked in the `ask_human` round)

| Decision              | Choice                                                    |
|-----------------------|-----------------------------------------------------------|
| Default role          | `viewer` (read-only)                                       |
| Magic-link send       | Never automatic. Admin clicks per-user or bulk.            |
| Bulk import behaviour | Silent provision; admin fires bulk send afterward.         |
| Email conflict        | Flag `worker.user_link_status="email_conflict"`, no link.  |
| Workspace assignment  | Inherit from `worker.workspace_id` only (usually empty).   |

## Backend

### New files
* `backend/worker_user_provisioning.py` — service module. Exposes
  `provision_user_for_worker`, `link_worker_to_existing_user`,
  `backfill_provisioning`. Writes audit_logs on every mutation.
* `backend/worker_user_provisioning_routes.py` — router mounted on
  the `/api` shell. Endpoints:
  * `POST /workers/{id}/provision-user` (idempotent)
  * `POST /workers/{id}/link-user` — body `{user_id}` — resolves an
    `email_conflict` state by manually linking to an existing user.
  * `POST /workers/backfill-user-provision` — bulk provision every
    worker in the org that has no `user_link_status`.

### Modified files
* `backend/integrations_simpro_workers.py` — after `db.workers.insert_one`
  in the `refresh_workers` handler we now iterate each freshly
  inserted worker and call `provision_user_for_worker`. Failures
  swallowed with a `log.warning` — never roll back the worker insert.
  Aggregate `user_provisioning` counts written to the response `counts`
  block so admins can eyeball how many rows landed in which bucket.
* `backend/auth_invite.py::send_invite` — now writes
  `user.last_invite_sent` and flips the linked worker's
  `user_link_status` from `invited_pending_send` → `invite_sent` on
  every successful send. Response also carries `sent_at`.
* `backend/users.py`:
  * `_user_out` surfaces `last_invite_sent` in the users list payload
    (used by the FE bulk-confirm modal + the drawer button label).
  * New endpoint `POST /users/bulk-send-pending-invites` — sends
    invites to every `status="invited"` user in the org (or a
    user-id allow-list). Skips users whose `last_invite_sent` is
    inside the `resend_after_days` window. Reuses `send_invite` so
    the audit trail + worker bridge stay unified.
* `backend/server.py` — mounts the new provisioning router.

### Worker status labels (canonical set)
Written to `workers.user_link_status`:

| Label                    | Meaning                                              |
|--------------------------|------------------------------------------------------|
| `invited_pending_send`   | User row created, no email queued yet.               |
| `invite_sent`            | Admin has clicked Send Invite.                       |
| `linked`                 | User activated OR admin manually linked.             |
| `email_conflict`         | Email already owned by a different user.             |
| `no_email`               | Worker has no email address on file.                 |

## Frontend

* `pages/UsersManagement.jsx`:
  * Toolbar: new "Provision users for workers" (white/slate) and
    "Send pending invites" (emerald) buttons next to the existing
    Simpro affordances.
  * UserDrawer profile action bar: new "Send invite" / "Resend
    invite" button — only surfaces for users in `invited` /
    `pending_invite` state. Idempotent; label flips based on
    `last_invite_sent`.
  * Bulk-invite confirmation modal — counts pending users with an
    email + no prior send, lists first 25, fires
    `POST /users/bulk-send-pending-invites`.
* `pages/Workers.jsx::createLogin`:
  * Repointed from the deprecated 410 `POST /users` to the new
    `POST /workers/{id}/provision-user` endpoint. Handles all four
    outcome branches (`invited_pending_send`, `linked`,
    `email_conflict`, `no_email`) with appropriate toasts.
* `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped `.132hq` → `.132hs`.
* `frontend/public/service-worker.js` — `CACHE_VERSION` bumped in
  lockstep.

## Pytests (`tests/test_v58_13_132hs_worker_auto_provision.py`)

9 checks, all green:

1. Single-worker provision (happy path): user row created with
   role=viewer, status=invited, worker_id linked; worker gets
   `user_link_status=invited_pending_send`; **zero** emails queued.
2. Missing email flag: worker without email → `user_link_status=no_email`.
3. Email conflict: two-user email collision → no new user, worker
   flagged `email_conflict`, `user_conflict_user_id` populated.
4. Idempotency: re-running provision on a linked worker returns
   `linked` and does not create a second user.
5. Manual link on conflict: `POST /workers/{id}/link-user` attaches
   the worker to the existing user, sets `user.worker_id`.
6. Backfill aggregate counts: `POST /workers/backfill-user-provision`
   returns `{scanned, invited_pending_send, email_conflict, no_email,
   already_linked}` and second run is idempotent.
7. Deprecated `POST /users` still returns 410 — this ship must not
   accidentally un-deprecate it.
8. Bulk send-pending: sends to every eligible invited user, records
   `last_invite_sent`, flips worker to `invite_sent`, second call
   with `resend_after_days=0` skips already-sent users.
9. Version pin `.132hs` on `version.js` + `service-worker.js`.

Also updated `tests/test_v58_13_132hq_worker_companies.py::test_version_bumped_to_132hq`
from a hard `.132hq` pin to a forward-safe `≥ .132hq` regex, so future
ships don't retroactively break this ship's version-lockstep guard.

## Ops rules honoured

* No `testing_agent` — pytest only.
* No `/app/mobile/` edits — mobile bundle version unchanged.
* No hard-coded env values.
* `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` + `CACHE_VERSION`
  bumped in lockstep.
* Comms Safe Mode compliance: auto-provisioning never fires an
  email/SMS. Admin send goes through the existing `auth_invite`
  path which is already gated by the HTTP request context (per
  standing directive).
* `finish` tool bypassed — this memo is the shipped record.

## NOT in this ship

* Worker-profile UI banner for `email_conflict` state (P2 polish;
  admins can resolve via Users drawer + the new link endpoint).
* Auto-flip to `status=linked` when the invited user activates
  (redemption path); currently `worker.user_link_status` stays
  `invite_sent` until a manual backfill re-runs. Adds a P2 hook in
  `auth_invite.py::invite_redeem` to bridge back.
* Resend-cadence UI (`resend_after_days` selector). Backend
  supports it; FE hardcodes 0 (never resend to already-emailed).

## Screenshots

`/app/memory/v58_13_132hs_01_toolbar.jpeg` — Users & permissions page
with the two new toolbar buttons visible.
