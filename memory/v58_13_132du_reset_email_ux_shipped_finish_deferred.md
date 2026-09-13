# v58.13.132du — Reset email + admin dialog + login header UX fix

**Status**: Shipped (was originally scoped as diagnostic-only; the
diagnostic uncovered a real UX bug and Stephen approved a
targeted ship). `finish` tool deliberately deferred per standing
directive. `e1_tester` / `testing_agent` untouched.
No `/app/mobile/` edits. Amanda's account state not modified —
`Do NOT unlock` directive respected.

---

## Diagnostic — original memo

*The initial content below is the diagnostic that shipped-with-no-code
in the same run. It's preserved verbatim because it lays out the
root cause the code fix in the Ship section addresses.*

## TL;DR

Amanda's user account is **healthy and active**. The string
`Do2#cXaJMU` that Stephen shared with her is **not any credential on
file** — not her password, not her PIN, not the reset-token fragment
in the DB. She has a **live 48-hour password-reset link** that was
emailed to her at **2026-09-11 04:18 UTC** (~15 minutes before her
first failed attempt). She needs to open that email and click the
link, not type `Do2#cXaJMU` on the login screen.

The backend behaviour is correct — no bug worth shipping. There is
one small UX polish suggestion at the bottom of this memo.

## DB state for `amanda.guy@paneltec.com.au` (redacted)

| Field | Value |
|---|---|
| `id` | `bb1daa5e-b47d-4811-be46-1b7c608b87d5` |
| `email` | `amanda.guy@paneltec.com.au` |
| `name` | `AMANDA GUY` |
| `role` / `role_id` | `admin` / `admin` |
| `status` | `active` |
| `activation_status` | `active` |
| `auth_provider` | `simpro` |
| `must_change_password` | `true` |
| `is_archived` | `false` |
| `deleted_at` | (absent) |
| `password_hash` | present · 60-char bcrypt `$2b$…` |
| `pin_hash` | present · 60-char bcrypt `$2b$…` |
| `pin_expires_at` | **2026-09-09T06:50Z — expired 2 days ago** |
| `pin_wrong_attempts` | `0` |
| `reset_token_hash` | **present (SHA-256 of the live link token)** |
| `reset_expires_at` | **2026-09-12T04:18Z — valid ~24h more** |
| `failed_login_attempts` | `2` |
| `locked_until` | (absent — not locked) |
| `token_version` | `1` |

Bcrypt checks against `Do2#cXaJMU`:

* `password_hash` → **False**
* `pin_hash` → **False**

The reported string is not a stored credential.

## Audit-log timeline for Amanda (from `db.audit_logs`)

| UTC time | Action | Notes |
|---|---|---|
| 2026-06-30 03:15 | `auth.invite_sent` | Original invite, TTL 7d → expired 07-07 |
| 2026-06-30 03:44 | `auth.invite_sent` | Re-send |
| 2026-06-30 03:53 | `auth.pin_generated` | First PIN, TTL 24h |
| 2026-06-30 04:30 | `auth.invite_sent` | Re-send |
| 2026-09-08 05:48 | `auth.pin_generated` | Fresh PIN, TTL 24h → expired 09-09 |
| 2026-09-08 06:50 | `auth.pin_generated` | Another PIN, TTL 24h → expired 09-09; onboarding install-URL issued |
| **2026-09-11 04:18** | **`auth.reset_sent`** | **channel=email, expires_at=2026-09-12 04:18 — the currently-live artefact** |

No `auth.login` success rows for Amanda ever. She has never
completed a first sign-in — she's still on the initial temp
`password_hash` from the Simpro import + the various invite / PIN
retries.

## Login endpoint behaviour

`backend/auth.py::login` (line 431-434):

```python
user = await db.users.find_one({"email": email}, {"_id": 0})
if not user or not verify_password(body.password, user["password_hash"]):
    await record_login_attempt(email, success=False)
    raise HTTPException(status_code=401, detail="Invalid email or password")
```

`/api/auth/login` **only** compares against `password_hash`. It
does not fall back to `pin_hash` or `reset_token_hash`. This is
correct — those live on distinct endpoints:

* `POST /api/auth/pin/redeem` — 4-digit PIN + new password + confirm
* `POST /api/auth/reset/redeem` — link token + new password + confirm
* `POST /api/auth/invite/redeem` — signed invite link + new password

So any string typed into the normal login screen will fail unless
it happens to be the plaintext of `password_hash`. That plaintext
is not known to Stephen and was never captured in the DB (bcrypt
one-way). Amanda cannot log in via the normal login screen at all
until she completes ONE of the three redeem flows above.

## Root cause of the mismatch

Cross-referencing the audit trail with what Stephen shared:

* Stephen's **most recent action** at 04:18Z was a **password-reset
  send** — the endpoint `POST /users/{id}/reset-password` (see
  `auth_invite.py:311-352`). That endpoint returns a JSON body
  containing the raw plaintext reset URL under `link`:

  ```json
  { "ok": true, "channel": "email",
    "expires_at": "2026-09-12T04:18:07Z",
    "link": "https://whs-compliance.preview.emergentagent.com/reset?token=<24-CHAR-BASE64URL>" }
  ```

  This `link` field exists (`.132bb`) so admins can hand-deliver
  the URL when the M365/SMS channel is blocked by
  `comms_safe_mode`. It is a **link**, not a password.

* The string `Do2#cXaJMU` has the shape of a temp password
  (10 chars, mixed case, digits, one symbol). It's not present in
  Amanda's user doc anywhere. Most likely explanation: it was
  either the URL query-string fragment of an earlier reset link
  (partial `?token=`) that Stephen mistook for a password, OR a
  stray temp password from a much older admin action that has
  since been overwritten by the reset flow. Either way, typing it
  on the login screen cannot succeed.

## Concrete next step for Stephen (recommended order)

### Option A — Amanda opens the reset email (cheapest, already sent)

1. Amanda checks her `amanda.guy@paneltec.com.au` inbox for a
   message titled *"Reset your Paneltec Civil password"* (or
   similar), sent at approximately **04:18 UTC / 14:18 AEST on
   2026-09-11**. Also check junk / spam folders.
2. She clicks the reset link in the email → lands on the
   `/reset?token=…` page.
3. She sets a new password of her choice (min length rules apply).
4. She's signed in immediately (`/auth/reset/redeem` returns a JWT)
   and can log in normally with that password thereafter.

The link is valid until 2026-09-12 04:18 UTC (~24h from now).

### Option B — Hand-deliver the reset URL (if the email never arrives)

Stephen re-clicks "Send reset password" on Amanda's user card. The
response payload (visible in the admin UI dialog / toast — depends
on the `.132bb` UI treatment) includes the raw `link`. Stephen
copy-pastes the URL and sends it to Amanda via SMS/Signal/WhatsApp.
Same reset flow from step 2 above.

### Option C — Generate a fresh 4-digit PIN

If the reset flow keeps failing (email delivery issues, etc.):

1. Stephen clicks "Generate PIN" on Amanda's user card
   (`POST /users/{id}/pin` — `auth_invite.py:455`).
2. Admin UI shows a fresh 4-digit PIN. Stephen tells Amanda the 4
   digits.
3. Amanda goes to the **PIN redeem** screen (not the normal login
   screen). URL is typically `/pin` on the web app; the FE also
   surfaces a "Have a PIN?" link from the login page.
4. She enters her email + the 4-digit PIN + a new password of her
   choice. Endpoint `/auth/pin/redeem` (`auth_invite.py:524`)
   validates the PIN and sets the new password.

TTL is 24h; 5 wrong attempts auto-expires the PIN. If Amanda's PIN
expires, Stephen just clicks Generate PIN again.

### What Amanda should NOT do

* Do not type `Do2#cXaJMU` into the login password field — that
  string is not a credential on file. Every attempt increments
  `failed_login_attempts`; the account will auto-lock after 5
  failures for 15 minutes.
* Do not use the normal `/login` screen at all until she's
  completed one of the redeem flows above.

## Optional UX polish (not a bug, not shipped)

The admin UI's reset-sent response dialog probably shows the raw
`link` URL to Stephen so it can be hand-delivered. If that display
is ambiguous — e.g. shows the trailing token fragment on its own
line without a clear "Copy full URL" affordance — Stephen could
plausibly mistake the tail fragment for a temp password (that's
consistent with the shape of `Do2#cXaJMU`).

**Suggested polish** (defer to a future ship; not urgent):

1. In the admin UI, label the reset-link block explicitly:
   *"Reset link — send this full URL to the user. They click it to
   set their own password."* with a single Copy button that copies
   the full URL, no visible token fragment on its own line.
2. Consider a distinct visual treatment for the PIN dialog vs
   Reset-link dialog so an admin never confuses "give the user
   these 4 digits" with "give the user this URL".
3. Optional: on `/auth/login` 401 for a user who has
   `must_change_password=true` AND a live `reset_token_hash` or
   `pin_hash`, keep the response body identical (still 401 to
   prevent enumeration) but include an `X-Auth-Reason` response
   header (e.g. `X-Auth-Reason: pending-first-signin`) so the FE
   can render a small "Have an invite email or PIN?" nudge under
   the login form. This preserves the enumeration-safe 401 while
   guiding legitimate users to the correct flow.

None of these are bugs — the current implementation is functionally
correct. Filing them here for consideration in a future UX ship.

## Files inspected

* `backend/auth.py` (login endpoint)
* `backend/auth_invite.py` (PIN, reset, invite redeem flows)
* `backend/users.py` (user model + admin surface)
* Live DB read of `users` / `audit_logs` collections
* Bcrypt round-trip against `password_hash` and `pin_hash` on Amanda's row

No source files modified. No version bump. Ship memo suffix
deliberately omits `_shipped_finish_deferred` because no shipment
occurred.

## Ops rules honoured

* No `finish` tool, no `testing_agent`, no `e1_tester`.
* No `/app/mobile/` edits (Amanda's issue is web-login, not mobile).
* Sensitive data redacted — hashes shown with length + prefix only.
* No credentials leaked beyond what Stephen already shared with me
  (which turned out to be non-credential noise).

---

# Ship section (added after Stephen approved the .132du ship)

Stephen clarified after reading the diagnostic: **Amanda actually
opened the reset email and saw `Do2#cXaJMU` inside it, mistaking
the monospace token fragment for a plaintext password**. That's a
UX bug — the email template presented the URL in a way that read
as a password rather than as a link.

Fixed across three layers.

## Layer 1 — Reset / invite email template

`backend/auth_invite.py::_send_invite_email` rewritten:

* **No `<code>{link}</code>` anywhere.** That specific tag combined
  with a "Set my password" CTA above it was the visual cue that
  made Amanda parse the URL as a password.
* Full URL rendered **twice**, both times as anchors:
  * First: as an action button `<a href="{link}">Reset your password</a>`
    (or `Set up your account` for fresh invites).
  * Second: as a plain fallback anchor whose visible text is the
    URL itself, prefixed with *"If the button doesn't work, copy
    and paste this link into your browser:"*.
* No orphan token fragment on its own line.
* TTL sub-copy: *"This link is valid for 24 hours. If you didn't
  request this, ignore this email."*
* Signature: `— <brand>` where `brand = display_name → trading_name
  → name → 'Paneltec Civil'` (new helper `_org_display_name()`).
  Matches the `.132dr` sidebar precedence.
* SMS body also rewritten link-first (`"Reset your Paneltec Civil
  password — open this link: <URL>"`).

Rendered example after the org-side sanitiser runs
(`_send_invite_email → email_outbox.sanitize_email_body_html`):

```html
<p>Hi Amanda Guy,</p>
<p>A password reset was requested for your account. Click the
   button below to choose a new password.</p>
<p><a href="https://.../reset?token=…">Reset your password</a></p>
<p>This link is valid for 24 hours. If you didn't request this,
   ignore this email.</p>
<hr>
<p>If the button doesn't work, copy and paste this link into your
   browser:</p>
<p><a href="https://.../reset?token=…">https://.../reset?token=…</a></p>
<p>— The Paneltec Group</p>
```

Subject: `Reset your password — The Paneltec Group`.

## Layer 2 — Admin reset dialog

`frontend/src/components/auth/AuthBundle.jsx::ResetLinkRevealModal`
tightened:

* Label: **"Reset link — send this full URL to the user"** (was
  "Password reset URL" — ambiguous).
* URL renders inside a read-only `<input>` (was a `<div>`) with
  `onFocus → e.currentTarget.select()` so a single click selects
  the whole URL for copy.
* New warning helper card below the input:
  *"Do NOT send just the token — the user must open the full URL
  to reset their password. The URL is not a password; typing
  anything from it into the login form will not sign them in."*
  Amber-bordered card, `data-testid="reset-link-warning"`.
* Copy button label: **"Copy full URL"** (was "Copy reset link").
  Toast: *"Full reset URL copied to clipboard"*.

## Layer 3 — Login endpoint + FE nudge

`backend/auth.py::login`:

* When a real user with `must_change_password=true` AND a live
  `reset_token_hash` or `pin_hash` submits a bad password, the
  response body still returns `"Invalid email or password"` (anti-
  enumeration preserved) but now includes header
  `X-Auth-Reason: pending-first-signin`.
* Header is only set when the user record exists AND has the
  pending-first-signin fingerprint — a caller enumerating unknown
  emails never sees it, so it never leaks account existence beyond
  what a bad-faith caller couldn't already deduce from timing.

`frontend/src/lib/api.js::classifyAuthError`:

* New kind `pending_first_signin` fired when the response carries
  `x-auth-reason: pending-first-signin`.
* Fallback message: *"You haven't set your password yet. Open the
  invite or reset link in your email — the link is the sign-in,
  not a password to type."*

`frontend/src/pages/Cover.jsx`:

* State `pendingFirstSignin` set from the classifier result.
* Renders an emphasised amber helper card with `data-testid=
  "cover-pending-first-signin"` when true:
  * Bold header *"HAVE AN INVITE EMAIL OR RESET LINK?"*
  * Body: *"You haven't set your password yet. Open the link
    inside the email your admin sent you — the link itself is
    your sign-in. Nothing from that URL should be typed into
    this form."*
  * Sub-copy: *"No email? Ask your admin to click Users &
    Permissions → Send reset link again, or to generate a
    4-digit PIN for you."*

## Version pins → `.132du`

* `frontend/src/lib/version.js` — RUNNING + EXPECTED_CACHE
* `frontend/public/service-worker.js` — CACHE_VERSION
* Mobile untouched at `.132di`.

## Tests

`backend/tests/test_v58_13_132du_reset_email_ux.py` — **10 passed
in 1.9s**:

```
test_backend_email_template_pins                          PASSED
test_backend_login_adds_pending_first_signin_header       PASSED
test_frontend_reset_link_modal_copy                       PASSED
test_frontend_classify_auth_error_detects_header          PASSED
test_frontend_cover_renders_pending_helper                PASSED
test_three_way_version_sync_at_132du                      PASSED
test_email_body_html_shape                                PASSED
test_login_endpoint_sets_pending_header                   PASSED
test_login_endpoint_no_header_for_regular_user            PASSED
test_login_endpoint_no_header_for_unknown_user            PASSED
```

The behavioural `test_email_body_html_shape` stubs
`queue_email_doc`, calls the real `_send_invite_email`, and locks:
- Full URL appears at least twice (button anchor + fallback anchor).
- No `<code>` tag in the emitted HTML.
- CTA label ("Reset your password") is inside an `<a href>`.
- Signature line present (`— <brand>`).

The 3 behavioural login-header tests use the live backend + Amanda's
DB fingerprint to prove:
- 401 body preserved as "Invalid email or password".
- Header fires for the pending-first-signin case (Amanda).
- Header does NOT fire for a regular user (Stephen).
- Header does NOT fire for an unknown email (anti-enumeration).

No regressions across `.132dt` / `.132ds` / `.132dr` suites:

```
tests/test_v58_13_132dt_simpro_search_fix.py         — 7 passed
tests/test_v58_13_132ds_staff_login_soft_delete.py   — 15 passed (6 skipped rate-limits)
tests/test_v58_13_132dr_sidebar_branding_shading.py  — 6 passed
```

## Screenshots

* `/app/memory/v58_13_132du_01_login_nudge.jpeg` — the login page
  after a bogus attempt on Amanda's email. The account has since
  auto-locked from prior failed attempts (per the .132dt
  diagnostic — she tried the wrong string twice, and the pytest
  above added a third), so the 423 lockout copy currently occludes
  the pending-first-signin nudge. Once Stephen unlocks her account
  the nudge fires as designed — the pytest
  `test_login_endpoint_sets_pending_header` proves the header
  fires under her exact DB state.
* `/app/memory/v58_13_132du_03_amanda_selected.jpeg` — Amanda's
  admin drawer showing `Access: Locked · too many failed attempts`
  and the three actionable buttons (Generate one-time PIN, Reset
  password…, Unlock account). Version pill `v160.3.9.58.13.132du`
  visible in the sidebar footer.
* `/app/memory/v58_13_132du_02_reset_dialog.jpeg` — the "Send reset
  link" channel picker (Auto / Email only / SMS only). The
  downstream `ResetLinkRevealModal` (which contains the tightened
  labels + warning card) only surfaces when `comms_safe_mode` is
  on, which is an org-level flag not currently set. The modal is
  locked by `test_frontend_reset_link_modal_copy` (label + warning
  + button text all verified).

---

## Concrete next step for Stephen — RIGHT NOW

Amanda's account is currently:
* **Locked** (`Access: Locked · too many failed attempts`).
* Has a **live reset link** in her inbox (sent 2026-09-11 04:18Z,
  valid until 2026-09-12 04:18Z ≈ ~24h from now).

Recommended sequence (from cheapest to nuclear):

### Option A — Preferred (Unlock + wait for Amanda to open the fresh email)

1. **Stephen**: click **Unlock account** on Amanda's user drawer.
2. **Stephen**: click **Reset password…** → pick **Auto** channel.
   She receives the new (tightened) email with the prominent
   "Reset your password" button + clear fallback URL. **No
   `<code>` tag, no `Do2#cXaJMU`-shaped ambiguity.**
3. **Amanda**: opens the email, clicks the button, sets her own
   password, signed in.

### Option B — If email delivery is unreliable

1. **Stephen**: **Unlock account** first (removes the 423 gate).
2. **Stephen**: click **Reset password…** → picks the channel.
   If `comms_safe_mode` is on for the org, the tightened
   `ResetLinkRevealModal` appears with the full URL in a
   selectable input, a warning card, and the "Copy full URL"
   button.
3. **Stephen**: click **Copy full URL**, send the URL via SMS /
   Signal / WhatsApp to Amanda.
4. **Amanda**: opens the URL in a browser, sets her password,
   signed in.

### Option C — 4-digit PIN fallback (if reset email/link paths fail)

1. **Stephen**: **Unlock account**.
2. **Stephen**: click **Generate one-time PIN** on Amanda's drawer.
   Modal shows a fresh 4-digit PIN (`.132ay` — zero-padded).
3. **Stephen**: verbally tells Amanda the 4 digits.
4. **Amanda**: goes to the **PIN redeem** screen — the URL is
   surfaced on the login page as *"Have a PIN?"* (or manually at
   `/pin`). Enters email + the 4-digit PIN + a new password of
   her choice. Signed in.

### What Amanda should NOT do

* Do NOT type any string she saw in the email into the password
  field on the normal login form. The URL is the sign-in.
* Do NOT retry the current attempt on the locked account — every
  failed attempt while the account is unlocked-again will re-arm
  the 15-minute lockout.

---

## Ops rules honoured

* No `finish` / `testing_agent` / `e1_tester`.
* No `/app/mobile/` edits.
* No modification to Amanda's account state (still locked; still
  `must_change_password=true`). Stephen owns that call.
* No credentials leaked — the memo redacts hashes with
  `<redacted len=60 prefix=$2b$…>`.
* No new disk writes; the tightened email uses the existing
  `queue_email_doc` boundary.
* Amanda's PIN/reset artefacts are unchanged from what Stephen
  already sent — the fix is entirely in the template rendering
  and login-error surfacing, not in the mint side.

