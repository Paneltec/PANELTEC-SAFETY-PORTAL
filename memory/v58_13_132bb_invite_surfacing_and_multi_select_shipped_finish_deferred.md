# v58.13.132bb — Invite / reset link surfacing + Workers multi-select print

Two-part web bundle. Mobile untouched (`.132ba` diagnostic APK is a separate ship on its own EAS timer).

## User pain (verbatim)

> "please ship: invite/reset link surfacing on the PIN modal, and multi-select print for Workers"

`comms_safe_mode = ON` blocks the M365 email path for invites and password resets, so the current flow generates a token/link on the backend and never surfaces it to anyone. Admins were manually forwarding PINs verbally and losing the mobile install URL entirely.

## Fix 1 — PIN reveal modal shows the mobile install link

### Backend — `auth_invite.py::generate_pin`

`POST /users/{user_id}/pin` now also mints a mobile onboarding install token (same shape as `.132ae`'s bulk-onboarding-cards flow) and returns `invite_url` in the response. Best-effort — if no worker record matches the target user's email, `invite_url` is null and the frontend hides the Copy-link CTA. Falls back gracefully with a `log.warning` on any exception (never breaks the PIN generation itself).

Response shape:
```json
{
  "pin": "6098",
  "expires_at": "2026-09-09T06:49:56...",
  "user_email": "stephen@paneltec.com.au",
  "invite_url": "https://whs-compliance.preview.emergentagent.com/m/onboard/XKtS5CaYh2NcUUlVI-Mgh8an6BPAVWNn?preload=civil"
}
```

Audit log gains `invite_url_issued: bool` so you can see later whether a URL was surfaced without leaking the URL itself.

### Frontend — `PinRevealModal` extended (AuthBundle.jsx)

Modal now accepts `pin`, `inviteUrl`, `userEmail`. Renders:
- Big orange 4-digit PIN (unchanged).
- **MOBILE INSTALL LINK** block below the PIN — mono-font URL in a slate-50 panel, `select-all` so a plain highlight-copy works even if clipboard permissions are locked down.
- Footer buttons:
  - **Copy PIN** — iframe-safe `copyToClipboard`.
  - **Copy invite link** — iframe-safe `copyToClipboard` (only rendered when `inviteUrl` is non-null).
  - **Email me this info** — `window.location.href = 'mailto:<user>?subject=Your Paneltec Civil access&body=<PIN + link>'`. Never touches our backend, so it slides past `comms_safe_mode` — the admin's own mailer sends.
  - **I've recorded this** — dismiss (label tightened from "I've recorded this PIN").

New data-testids: `pin-invite-url-block`, `pin-invite-url`, `pin-copy-link`, `pin-email-me`.

**Live confirmation**: opened kebab on Amanda Guy → Generate one-time PIN. Modal rendered PIN `4761` and MOBILE INSTALL LINK `https://whs-compliance.preview.emergentagent.com/m/onboard/21K-4N3bzJc3WSFzGz5RmPWVC507sVko?preload=civil`. All three action buttons present + I've-recorded-this in orange.

## Fix 2 — Reset link reveal modal

### Backend — `auth_invite.py::send_reset`

`POST /users/{id}/reset-password` now returns the raw reset link in `link`. The token was already minted server-side (and only its hash is stored on `users.reset_token_hash`); returning the plaintext in the response is safe because the caller has already authenticated as admin and the payload rides the same TLS connection they logged in on.

Response shape:
```json
{
  "ok": true,
  "channel": "email",
  "expires_at": "2026-09-09T06:49:57...",
  "link": "https://whs-compliance.preview.emergentagent.com/reset?token=eyJhbGci..."
}
```

Audit log entry (`auth.reset_sent`) unchanged — still records channel + expires_at, doesn't log the plaintext token.

### Frontend — new `ResetLinkRevealModal` (AuthBundle.jsx)

Sibling of PinRevealModal. Renders:
- Copy explaining "Comms Safe Mode is on — the automatic email may not have been delivered."
- The reset URL in a `select-all` panel.
- Footer buttons: **Copy reset link**, **Email me this info**, **Done**.

Wired into both `AccessSection` (drawer variant) and `AccessKebab` (per-row menu variant) — both surfaces call `POST /users/{id}/reset-password` and now surface the returned `link` automatically.

Data-testids: `reset-link-modal`, `reset-link-value`, `reset-link-copy`, `reset-link-email-me`, `reset-link-close`.

## Fix 3 — Workers page: multi-select print

### Frontend — `Workers.jsx` toolbar

New button next to "Print all onboarding cards":

```jsx
<button
  onClick={() => openBulkOnboardingConfirm([...selected])}
  disabled={onboardingBusy === 'selected'}
  data-testid="bulk-onboarding-selected-btn"
>
  Print selected onboarding cards ({selected.size})
</button>
```

- Rendered only when `canEdit && selected.size > 0` so the button materialises the moment the admin ticks the first row and disappears the moment they clear the selection.
- Solid-orange treatment (`bg-orange-500 text-white`) vs the outlined "Print all" so the selected-only path is the obvious click when checkboxes are populated.
- Reuses the existing `openBulkOnboardingConfirm(ids)` pipeline shipped in `.132ad`; hits `GET /mobile/onboarding/cards.pdf?worker_ids=id1,id2,...`. No backend changes.
- Row-level checkboxes already existed (`data-testid="select-{workerId}"` from `.132ad`) and were previously only used by the CSV export path.

## Version state

| Constant | Before | After |
|---|---|---|
| RUNNING_VERSION | `paneltec-v160.3.9.58.13.132az` | `paneltec-v160.3.9.58.13.132bb` |
| EXPECTED_CACHE_VERSION | `paneltec-v160.3.9.58.13.132az` | `paneltec-v160.3.9.58.13.132bb` |
| CACHE_VERSION | `paneltec-v160.3.9.58.13.132az` | `paneltec-v160.3.9.58.13.132bb` |
| MOBILE_BUNDLE_VERSION | `paneltec-v160.3.9.58.13.132at` | unchanged (mobile ship is `.132ba` in parallel) |

## Files changed

- `backend/auth_invite.py`
  - `generate_pin` — mints onboarding install token via `mobile_onboarding_cards._get_or_issue_token`, returns `invite_url`. Best-effort with try/except so a missing worker record doesn't fail the PIN.
  - `send_reset` — response now includes `link`.
- `frontend/src/components/auth/AuthBundle.jsx`
  - `PinRevealModal` — new `inviteUrl` + `userEmail` props, MOBILE INSTALL LINK block, Copy-link + Email-me buttons.
  - `ResetLinkRevealModal` — new component.
- `frontend/src/components/auth/AccessSection.jsx`
  - `genPin` captures `invite_url` + `user_email` from response.
  - `fireChannelAction` — captures `link` from reset-password response and opens `<ResetLinkRevealModal>` when present.
  - Renders both modals.
- `frontend/src/components/auth/AccessKebab.jsx`
  - `firePin` captures `invite_url` + `user_email`.
  - `fireResetChannel` captures `link`.
  - Renders both modals.
- `frontend/src/pages/Workers.jsx` — new "Print selected onboarding cards" toolbar button.
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION bump.
- `frontend/public/service-worker.js` — CACHE_VERSION bump.

## Pytest — 2/2 sanity-check passed

- `test_v58_13_132ay_one_time_pin_4digit.py::test_generator_emits_only_4_digit` — passes (guard against the new `_get_or_issue_token` code path regressing generator output).
- `test_v58_13_132ad_onboarding_cards.py::test_onboarding_cards_end_to_end` — passes (guard against the `_get_or_issue_token` import path breaking the bulk-cards ship).

Plus curl smoke on `/api/users/{id}/pin` + `/api/users/{id}/reset-password` — both return the new fields (`invite_url`, `link`) with real values.

## Security notes

- `invite_url` and reset `link` are only returned to authenticated admin callers (both endpoints already gate on `caller.role == 'admin'`). No public leakage.
- The mailto flow uses `window.location.href` — the admin's own mail client picks up the pre-filled draft. Nothing touches `comms_safe_mode` and no email leaves our backend.
- Onboarding token is single-use and expires per `_get_or_issue_token`'s TTL (default 60 days per `INVITE_TTL_DAYS`). If a link is intercepted, worker rotation via "Generate one-time PIN" revokes any prior token by minting a fresh one.

## Not in this ship

- **Mobile app** — untouched. `.132ba` diagnostic APK is on its own EAS timer (build id `2bd4545b-d255-47f1-b64c-2131d556d9da`).
- **Report Suspicious footer** on FuelTransactionDetailModal — explicitly declined by Stephen.
- **SmartFill `From/To Timestamp` param investigation** — explicitly declined.
- **BOM forecast, mobile home details modal** — declined until mobile is unblocked.

## Rollback

Frontend-only + additive backend response fields. Revert this commit; CACHE bump re-fires the "Update available" toast once as clients drop to `.132az`. Zero DB migrations, zero destructive writes.
