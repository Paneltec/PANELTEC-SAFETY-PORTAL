# v58.13.132s — Pending-invite diagnosis (Problem A)

Status: **investigation only, no writes.** Complement to
`v58_13_132s_role_cleanup_discovery.md` (Problem B, awaiting green-light).

## Q1 — Josh's user doc (relevant fields)

```
email:              joshua@paneltec.com.au
name:               JOSHUA DREW
first_name/last:    JOSHUA / DREW
org_id:             3116f250-a4eb-43f3-98a5-2a3656d6cb63
role:               custom_operations_manager
role_id:            custom_operations_manager      # ← drift (see .132s memo)
simpro_position:    Operations Manager
simpro_employee_id: 1090
company_id:         2
worker_id:          571dc524-42df-4041-ab2a-1509267eacbe

status:             pending_invite                 # ← "PENDING INVITE" pill
activation_status:  pending_activation             # ← blocks login (auth.py:441)
password_hash:      None
invite_token_hash:  <not set>
invite_expires_at:  <not set>
invited_at:         <not set>
accepted_at:        <not set>
last_login_at:      <not set>
must_set_password:  <not set>
must_change_password: <not set>
is_active:          <not set>                      # field not used

created_at:         2026-09-07T02:40:46+00:00      # hotfix insert
role_assigned_at:   2026-09-07T02:47:05+00:00      # Simpro delta rewrote role
simpro_last_synced_at: 2026-09-07T02:47:05+00:00
_created_by_hotfix: v58.13.132r_workers_to_users
```

## Q2 — What sets `status=pending_invite`?

**Single writer:** `backend/scripts/sync_workers_to_users_v58_13_132r_hotfix.py:117`
hard-codes `"status": "pending_invite"` when inserting the user doc.

- No email invite was ever generated. `invite_token_hash` is null,
  `invited_at` is null, and Josh has no row in any invite/audit table
  tied to an invite send.
- The `pending_invite` string is a **synthetic placeholder** — a
  marker that the hotfix hydrated a stub from `workers` but never ran
  the actual invite flow (`POST /api/users/{id}/invite`).
- The frontend "PENDING INVITE" pill renders because of the
  `.132r` UI patch I added earlier
  (`UsersManagement.jsx` StatusPill — `pending_invite → 'Pending
  invite'`). Prior to that patch, the same status would have rendered
  as the raw string.

**Backend gate:** Login is blocked at `auth.py:441-445` for any user
with `activation_status="pending_activation"` — returns `HTTP 403`
with `X-Auth-Reason: activation-pending` and the message *"Your
account is being set up. Please contact your administrator to
activate it."*. Password check never reached.

## Q3 — Admin activation path (no email required)

Two viable admin-driven paths exist. Only one works cleanly under
Comms Safe Mode.

### Path A — `POST /api/users/{user_id}/set-password` ✅ RECOMMENDED

Source: `backend/users.py:548-587` (v160.3.9.32-4b).

- Admin supplies a password (min 8 chars, validated by
  `validate_password_rule`).
- Server sets `password_hash`, flips **both** `activation_status →
  active` and `status → active`, clears `must_change_password`,
  bumps `token_version`, writes `user_audit` row `admin_set_password`.
- **No email or SMS involved.** Not blocked by Comms Safe Mode.
- Admin conveys the initial password out-of-band (verbal / physical
  hand-off). User can then log in immediately.

Auth requirement on the endpoint: `require_permission("users", "edit")`.
The web UI already exposes this in the user drawer per
`UsersManagement.jsx:2168-2169` region ("Reactivate" flow). We can
promote a "Set password" affordance next to the pending pill.

### Path B — `POST /api/users/bulk-assign-role` (partial)

Source: `backend/users.py:880-1044`.

- Flips `activation_status=active`, `status=active`,
  `role_assigned_at=now`, `must_set_password=True` iff no password.
- **Does NOT set a password** — user still can't log in because
  `verify_password(body.password, None)` will 401.
- Useful only if paired with Path A afterwards.

### Path C — `POST /api/users/{user_id}/invite` ❌ BLOCKED under safe mode

Source: `backend/auth_invite.py:188-232`.

- Generates + stores `invite_token_hash` on the user, builds
  `${host}/onboard?token=${plaintext}` link, calls
  `_send_invite_email` / `_send_invite_sms`.
- **Under Comms Safe Mode (currently ON at the org level — see Q4),**
  the send is intercepted and logged as `comms.safe_mode_blocked`.
  The plaintext link is **not** returned in the response (endpoint
  returns only `{ok, channel, expires_at}`).
- Net effect under safe mode: token created but nobody has the URL.
  Admin has no way to hand it out. Dead end.
- Would work if we (a) toggled safe mode off temporarily for the
  send, or (b) added a `POST /users/{id}/invite?dry_run=true` mode
  that returns the plaintext link for admin copy-paste. Neither is
  in scope for `.132s`.

## Q4 — Comms Safe Mode state (current)

- Env `COMMS_SAFE_MODE`: `off` (not env-locked).
- `org_settings.comms_safe_mode` (org `3116f2…cb63`): **`on`**.
- Resolver: `comms_safe_mode.py:26-38` — env `"off"` does NOT force
  disable; falls through to org setting. **Effective safe mode: ON.**
- Consequence: every `send_email` / `send_sms` call routes through
  `send_or_shortcircuit` (`comms_safe_mode.py:56-95`), which no-ops
  the send and logs `comms.safe_mode_blocked`.

Additional hard blocks even if safe mode were off:
- `RESEND_API_KEY` not set (email provider creds missing).
- `TEXTMAGIC_USERNAME` not set (SMS provider creds missing).

So even path C wouldn't send under the current environment
regardless of the safe-mode flag.

## Q5 — Are the other 5 pending users in the same boat?

Yes. All 6 rows share the same fingerprint:

| Field | Value across all 6 |
|---|---|
| `_created_by_hotfix` | `v58.13.132r_workers_to_users` |
| `status` | `pending_invite` |
| `activation_status` | `pending_activation` |
| `password_hash` | `None` |
| `invite_token_hash` | `None` |
| `invited_at` | `None` |
| `accepted_at` | `None` |
| `last_login_at` | `None` |
| `must_set_password` | `None` |
| `created_at` | 2026-09-07T02:40:46 (batch insert) |
| `role_assigned_at` | 2026-09-07T02:47:05 (Simpro delta rewrote 2, left 4 alone) |

The 6 users, and their current `role_id`:

| Name | Email | company_id | role_id (current) | Target role_id (per `.132s`) |
|---|---|---:|---|---|
| JOSHUA DREW | joshua@paneltec.com.au | 2 | `custom_operations_manager` | **`admin`** |
| ADRIAN MITCHELL | adrianmitchell283@gmail.com | 2 | `custom_construction_worker_l2` | `paneltec_civil` |
| BOBBY MCGOWAN | bobbylbp@hotmail.com | 2 | `paneltec_civil` | `paneltec_civil` (no change) |
| BROCK WATERWORTH | brock.w@hotmail.com | 2 | `paneltec_civil` | `paneltec_civil` (no change) |
| EMMA NIPPERS | emmanippers04@gmail.com | 3 | `viatec_traffic` | `viatec_traffic` (no change) |
| WAYNE NIPPERS | (no email) | 3 | `viatec_traffic` | `viatec_traffic` (no change) — ⚠ no email means Path A activation only |

Every one of the 6 is a **synthetic stub** — a `workers` row that
never had a `users` counterpart until the hotfix. None of them ever
received an invite. All 6 need Path A (admin sets password) to
actually log in.

Also seen during the sweep (outside the 6-user pending set — for
completeness, not action-items):
- `pending-activation-fixture@paneltec.com.au` — `is_test_fixture=true`.
  Leave alone.
- `david@appzoola.com` — `deleted_at != null` (soft-deleted). Leave alone.
- 4 more users have odd `status/activation_status` combos (e.g.
  `status=None`, `status=disabled activation_status=pending_activation`).
  Unrelated to the current issue but worth a follow-up sweep — noted
  in the risks section below.

## Proposed bundle for `.132s` execution

Two orthogonal problems. Options for combining:

### Option 1 — Role fix only (safest, matches original scope)
- Rebucket Josh + Adrian per Table B in the `.132s` discovery memo.
- Leave `activation_status=pending_activation`, `status=pending_invite`
  untouched.
- Admin activates each user individually via the drawer (Path A: set
  password). Six click-throughs.

### Option 2 — Role fix + activation flip (bundled, no password) ⚠ misleading
- Rebucket the roles as in Option 1.
- Flip `activation_status → active`, `status → active`,
  `must_set_password → true`, `role_assigned_at → now` for all 6.
- Pill goes from "PENDING INVITE" to "ACTIVE" in the UI.
- **But** login still 401s because `password_hash` is null.
- Misleading — the UI would claim the user is active when they can't
  actually sign in.

### Option 3 — Role fix + activation flip + temporary password ✅ RECOMMENDED
- Rebucket the roles as in Option 1.
- For each of the 6, run Path A (`admin_set_password`) with a
  freshly-generated 16-char password.
- Print the six passwords to stdout at end of the migration script
  (also write to `/app/memory/v58_13_132s_temp_passwords_<batch>.txt`
  with mode `0600`); admin conveys them out-of-band, users must
  reset on first login (`must_change_password=True` gate lives in
  `auth.py`'s post-login redirect — need to confirm; if it doesn't,
  we add a `first_login_reset_required` flag).
- After sign-in, users go to `/app/settings/security` and pick their
  own password.
- Wayne Nippers has no email, so his password lives on the printout
  only — admin gets it to him physically.

## Green-light asks (Problem A)

Please pick one:

- **G1.** Option 1 (role fix only, activate one-at-a-time via drawer).
  ← lowest risk, most manual.
- **G2.** Option 3 (bundled: role fix + temp passwords printed to
  admin-only file, users forced-reset on first login). ← recommended.
- **G3.** Something else — e.g. bundle the role fix, keep pending flag,
  and add a Users-drawer button "Activate + set password" for admins
  to click through the 6 rows one-by-one. Same outcome as G1 but a
  nicer UI. Adds ~1 hour scope.

Also please confirm: **does the "must reset password on first login"
gate exist?** If yes, name the field
(`must_change_password` vs `must_set_password` — both appear in the
code); if no, do you want it added as part of `.132s` (recommended
regardless of G1/G2/G3)?

## Risks & follow-ups (Problem A only — Problem B risks stay in the other memo)

- **R-A1** No plaintext-invite path exists under Comms Safe Mode.
  Consider adding a `POST /users/{id}/invite?dry_run=true` that returns
  the plaintext link for admins to hand out. Non-blocking for `.132s`.
- **R-A2** Four other users have odd `status/activation_status` combos
  (2× `status=None`, 1× `status=disabled activation_status=pending_activation`,
  1× `status=active activation_status=pending_activation`).
  Recommend a data-hygiene sweep memo `v58_13_132t_user_status_sweep.md`
  after `.132s` ships.
- **R-A3** Wayne Nippers has no email. Any invite-based path is a
  dead end for him; Path A is the only option.
- **R-A4** `must_change_password` post-login enforcement — I have not
  yet verified whether `auth.py` gates the JWT-authenticated routes
  on this flag. If it doesn't, temp passwords from Option 3 are
  persistent (bad). Needs a code-read pass before we commit to G2.

## Files inspected

- `backend/auth.py:425-470` (login flow, `activation-pending` 403)
- `backend/auth_invite.py:120-232, 495-525` (invite send + access
  state)
- `backend/users.py:60-105, 520-587, 850-1046` (`_user_out` shape,
  set-password, bulk-assign-role)
- `backend/comms_safe_mode.py:20-95` (safe mode resolver + intercept)
- `backend/simpro_import_users.py:150-200, 380-431, 460-560` (Simpro
  new-user + delta writers)
- `backend/scripts/sync_workers_to_users_v58_13_132r_hotfix.py:1-128`
  (source of the 6 stub rows)

No DB writes performed.
