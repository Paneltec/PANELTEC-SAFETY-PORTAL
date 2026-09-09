# v58.13.132r — Josh Drew visibility UI fix (SHIPPED)

## One-line root cause
Default status filter was `active` and the dropdown listed only
`['active', 'invited', 'disabled']`, so Simpro-hydrated users written by
`sync_workers_to_users_v58_13_132r_hotfix.py` with
`status='pending_invite'` / `activation_status='pending_activation'`
were silently hidden. The existing "Show pending users only →" hint
button targeted the wrong value (`'invited'`).

## Changes (all in `frontend/src/pages/UsersManagement.jsx`)
1. `STATUSES` now includes `'pending_invite'`.
2. `STATUS_LABELS` adds `pending_invite: 'Pending invite'`.
3. `StatusPill` renders `pending_invite` as an amber "Pending invite" pill.
4. Status filter `<select>` now iterates `STATUSES` + `STATUS_LABELS`, so
   the "Pending invite" option is user-selectable.
5. New hint next to the filter — mirrors the existing disabled hint —
   shows `· N pending hidden · show` when the active filter is on and
   pending users exist. Testids: `users-pending-hint`,
   `users-pending-hint-show`.
6. Fixed the pending-user banner CTA (was `status: 'invited'` →
   now `status: 'pending_invite'`).
7. Fixed the built-in "Pending inductees" saved view (was
   `status: 'pending_activation'` → now `status: 'pending_invite'`).

## Verification
- Logged in as admin (`stephen@paneltec.com.au`), navigated to
  `/app/settings/users`, selected "Pending invite" filter, searched
  "josh". `JOSHUA DREW` (`joshua@paneltec.com.au`) renders with:
    - Orange "PENDING" activation pill next to name
    - Role chip: **Operations Manager** (from Simpro position mapping)
    - Status pill: **PENDING INVITE**
- Screenshot: `/app/frontend/public/mobile-screenshots/v132r_josh_visible.png`

## Note on role
User brief mentioned "admin badge" for Josh, but his actual persisted
role is `custom_operations_manager` (from Simpro position "Operations
Manager"). The hotfix seeded him at his Simpro role — he was NOT one of
the 7 explicit admin overrides in the `.132r` role consolidation. If
`admin` is intended, promote him via the drawer or extend the admin
override list in a follow-up.

## Scope guards observed
- No touch to `service-worker.js` / `EXPECTED_CACHE_VERSION`.
- No touch to `Cover.jsx` or any landing/dashboard page.
- No touch to `ephemeral-upload-storage` warnings (parked for v58.14.x).
- No `testing_agent` invocations.

## Follow-ups (optional, not blocking)
- Line 511 "Archived only" built-in view uses `status: 'archived'`,
  which is not a valid `status` value (archived is `is_archived` bool).
  Same class of bug — left untouched for scope; flag for a future pass.
- Consider surfacing an "Import from Simpro" quick-action button
  directly on Users & Permissions header (already in the P2 backlog).
