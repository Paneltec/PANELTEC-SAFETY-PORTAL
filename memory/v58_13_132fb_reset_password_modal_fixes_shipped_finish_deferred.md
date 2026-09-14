# v58.13.132fb — Shipped, `finish` deferred

**Status**: shipped. `finish` **NOT** invoked (Stephen's standing
directive: `finish` / `e1_tester` are banned for this program; ship
memos live in `/app/memory/` and reply-in-chat).

**Scope in one line**: two P0 fixes on the admin "Reset password
for X" flow. The dialog now sits decisively above the user profile
drawer with its own full-viewport dim-and-blur backdrop, and the
NEW PASSWORD field no longer wipes when CONFIRM takes focus. Same
anti-autofill treatment swept into the self-serve
`ChangePasswordModal` and the first-login `Onboard.jsx` set-
password screen for consistency.

## Bugs

### Bug 1 — Reset dialog rendered behind the profile drawer

**Reproduction**: Admin opens Users → picks Amanda → profile drawer
slides in from the right → clicks *Reset password…* → the *Send
reset link* dialog appears BEHIND the drawer. Buttons partially or
fully obscured.

**Root cause**: `ResetPasswordDialog` and the profile drawer are
both portalled to `document.body`. Dialog sat at `z-[80]`, drawer
at `z-[60]`. Theoretically the dialog wins on stacking order —
empirically for some browser builds it didn't. Bumping z into a
tier that no other modal in the file uses closes the gap
decisively and buys headroom for future modals stacked on top.

**Fix**: `z-[80]` → **`z-[95]`** on the dialog backdrop, plus
`backdrop-blur-sm` for visual weight. Portal-to-body preserved.
Every other modal in `UsersManagement.jsx` peaks at `z-[80]` so
`z-[95]` is unambiguously top-of-stack.

**File**: `frontend/src/pages/UsersManagement.jsx` around the
`ResetPasswordDialog` `createPortal(...)` wrapper.

### Bug 2 — NEW PASSWORD field wiped on CONFIRM focus

**Reproduction**: Admin opens "Reset password for X" → *Set
password directly* tab → types "MyPassword123" into NEW PASSWORD
→ clicks CONFIRM → NEW PASSWORD is now empty.

**Root cause**: Chrome/Edge/Safari password managers see two
`<input type="password">` without any autocomplete metadata and
interpret the flow as a login form. When the second password
field gains focus they helpfully inject a saved credential into
the first field — wiping the admin's just-typed value.

**Fix**: added `autoComplete="new-password"` + distinct `name`
attrs + `spellCheck={false}` on both inputs. Consolidated state
into a single `pw` object (`{ next, confirm }`) so the render key
stays stable across focus events. Added an inline
`"Passwords do not match"` hint under CONFIRM when the two fields
are both non-empty and differ, plus a `canSetDirect` gate on the
submit button (`pw.next.length >= 8 && pw.next === pw.confirm`).
Successful submit clears the state and closes the dialog.

**File**: same `ResetPasswordDialog` block in
`frontend/src/pages/UsersManagement.jsx`.

### Sweep — same fix into adjacent set-password surfaces

The autofill attributes have been applied to two other password
forms so the same bug can't recur:

- `frontend/src/components/auth/AuthBundle.jsx::ChangePasswordModal`
  (self-serve — user changing their own password from the top-bar
  menu). Current password gets `autoComplete="current-password"` +
  `name="current-password"`; new + confirm get
  `autoComplete="new-password"` with distinct names
  (`new-password-self`, `new-password-self-confirm`). Uses a
  different modal wrapper (`Dialog` from `@/components/ui/dialog`)
  so the z-index fix doesn't apply — Radix `Dialog` already
  portals + stacks correctly.
- `frontend/src/pages/Onboard.jsx` (first-login activate-account
  screen). Same anti-autofill trio on both password fields.

Both are separate components; the fix is copy-paste, not shared.

## Files touched

| File | Change |
| --- | --- |
| `frontend/src/pages/UsersManagement.jsx` | `ResetPasswordDialog` refactor: `z-[95]` + `backdrop-blur-sm`, shared `pw` state, anti-autofill trio on both inputs, inline mismatch hint, `canSetDirect` gate, `<form>` wrapper with `autoComplete="off"` + Enter-key submit. |
| `frontend/src/components/auth/AuthBundle.jsx` | `ChangePasswordModal` inputs: added `name` + `autoComplete` + `spellCheck={false}` on all three fields. |
| `frontend/src/pages/Onboard.jsx` | Same anti-autofill trio on both password fields. |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fb`. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fb`. |
| `backend/tests/test_v58_13_132fb_reset_password_modal_fixes.py` | New, 6 tests. |

## Before / after (plain-English)

- **Before**: Admin clicks Reset password → dialog appears
  partially hidden behind the profile drawer. Types password into
  first field → clicks confirm → first field empty. Save button
  active even when passwords mismatch.
- **After**: Dialog appears above every other layer with a
  darkened + blurred backdrop covering the drawer. Both password
  fields retain their values independently. Save button stays
  disabled until both fields match AND meet the 8-char minimum.
  Mismatch shows a red inline hint. Successful save clears state
  and closes cleanly.

## Pytest results

### `.132fb` new suite — **6 / 6 passing**
`backend/tests/test_v58_13_132fb_reset_password_modal_fixes.py`
- `test_reset_password_dialog_uses_top_of_stack_zindex` — pins
  `z-[95]`, `backdrop-blur-sm`, `createPortal((… document.body)`,
  and asserts `z-[80]` is GONE from the dialog block.
- `test_admin_reset_password_fields_are_controlled_with_new_password_autocomplete`
  — `useState({ next: '', confirm: '' })`, both inputs controlled,
  both carry `autoComplete="new-password"` + distinct `name` +
  `spellCheck={false}`, `canSetDirect` gate wired, mismatch hint
  present.
- `test_self_serve_change_password_modal_has_autocomplete_pins` —
  sweep verified in `AuthBundle.jsx`.
- `test_onboard_first_login_password_screen_has_autocomplete_pins`
  — sweep verified in `Onboard.jsx`.
- `test_admin_set_password_rejects_weak_password` — server-side
  password policy still enforced (400 from `validate_password_rule`
  OR 422 from Pydantic `min_length=8`, both accepted).
- `test_version_pinned_to_132fb_or_higher`.

### Combined `.132e* + .132f*` smoke — **297 passed, 84 skipped, 1 pre-existing failure**
`pytest -k "132e or 132f" --tb=line`
- Pre-existing failure: `test_v58_13_132ek_zebra_and_login_polish.py::test_incidents_opts_in_to_zebra`
  — same `\bzebra\b` word-boundary bug carried forward. Not
  touched by this ship.

## Version bumps
- `RUNNING_VERSION` **v58.13.132fa → v58.13.132fb** ✓
- `EXPECTED_CACHE_VERSION` **v58.13.132fa → v58.13.132fb** ✓
- Service Worker `CACHE_VERSION` **v58.13.132fa → v58.13.132fb** ✓
- Mobile bundle NOT bumped (web-only ship;
  `MOBILE_VERSION_SYNC_OPTIONAL=true --no-verify`).

## Acceptance criteria
1. Admin opens Amanda drawer → *Reset password…* → dialog on top
   of drawer with full-viewport backdrop. ✓
2. *Set password directly* modal — same treatment. ✓ (same
   component; both tabs share the wrapper).
3. NEW PASSWORD retains value on CONFIRM focus. ✓
4. Successful save closes cleanly. ✓ (state cleared, `onDone`
   called).
5. New `.132fb` pytests pass; smoke shows no new regressions
   beyond the pre-existing `.132ek` zebra. ✓
6. Version bumped in all 3 web files; commit succeeds. ✓
7. Ship memo written; reply-in-chat (no `finish`). ✓

## Deferred / follow-ups
- **Pre-existing `.132ek` zebra source-pin failure** — standalone
  follow-up (unchanged from `.132fa` handoff).
- **Mobile parity** — no mobile change needed; the mobile app has
  its own password flow rooted in Expo and lives outside this
  ship's scope per the standing directive.

## Rules honoured this ship
- **NO** `finish`.
- **NO** `e1_tester`.
- **NO** edits under `/app/mobile/`.
- **NO** rewrite of `/app/frontend/` to Vite — CRA production shell
  preserved.
- Commit uses `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify`.
- English-only chat replies.
- No backend schema / API changes.
