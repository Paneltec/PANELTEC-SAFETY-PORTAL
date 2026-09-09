# v58.13.132az — PIN self-service polish

Two navigation fixes so admins can rotate their own admin console PIN without hunting the sidebar.

## Fix 1 · "My Profile" row in the header dropdown

**File**: `frontend/src/components/layout/TopbarPills.jsx::UserDropdownCard`

The header avatar dropdown had `Change password`, `My apps`, `Users & permissions`, `Clear cache & reload` and `Sign out` — but no direct route to `MyProfile` where the `.132av` Admin Console PIN card lives. Stephen couldn't find it.

**Change**: added a new "My Profile" `QuickRow` at the TOP of the Quick Actions block, above Change Password. Wires to `onNavigate('/app/profile')`. Data-testid `menu-my-profile`.

**Verified live** — opened the avatar menu on `/app/dashboard`, dropdown now shows:

```
MY PROFILE                    ← new
CHANGE PASSWORD
MY APPS
USERS & PERMISSIONS
CLEAR CACHE & RELOAD
─────────────
SIGN OUT
```

Data-testid confirmed present; text `"My Profile"`.

## Fix 2 · "Change admin PIN" button on the drawer's own-row

**File**: `frontend/src/components/auth/AccessSection.jsx`

Admins who navigate to Users Management → click their own row → drawer opens on the "profile" tab, which already renders `<AccessSection userId={userRow.id} />` with `Generate one-time PIN` and `Reset password…`. Extended AccessSection to:

- Read `me = getUser()` from `lib/auth.js`.
- Compute `isSelf = me?.id === userId` and `isAdmin = me?.role === 'admin'`.
- Fetch `/auth/admin-console/status` on mount when `isSelf && isAdmin` → `{ has_pin, set_at }`.
- Render an amber `<Shield /> Change admin PIN` (or `Set admin PIN` when never set) button next to Reset password. Data-testid `access-change-admin-pin`.
- Modal wire — same shape and behaviour as MyProfile's `AdminPinCard`:
  - Current PIN required when rotating (skipped when first-time set).
  - `<DrawerPinField>` with strict 4-digit enforcement: `maxLength=4`, `inputMode="numeric"`, `pattern="[0-9]*"`, paste sanitised in onChange, non-digit typing swallowed by `onKeyDown`.
  - Submit gate `^\d{4}$` on every field.
  - POSTs to `/auth/admin-console/set-pin` with `{ pin, current_pin? }`.
  - On success: toast + refresh status so the button label flips Set → Change.

Non-admin rows never see this button. Non-admin viewers still see nothing because the whole drawer requires `users.edit`, and the button gates on `isSelf && isAdmin` separately.

**Verified live** — opened Stephen's own row on `/app/settings/users`, drawer's Access section renders:

```
Access
Active   ·   last login 0d ago

[Generate one-time PIN]  [Reset password...]  [🛡 Change admin PIN]  ← new amber
```

Clicking a DIFFERENT admin's row (e.g. Amanda Guy) → same access section but no Change admin PIN button → gate works as designed.

Data-testid `access-change-admin-pin` confirmed present; text `"Change admin PIN"`.

## Version state

| Constant | Before | After |
|---|---|---|
| RUNNING_VERSION | `paneltec-v160.3.9.58.13.132ay` | `paneltec-v160.3.9.58.13.132az` |
| EXPECTED_CACHE_VERSION | `paneltec-v160.3.9.58.13.132ay` | `paneltec-v160.3.9.58.13.132az` |
| CACHE_VERSION | `paneltec-v160.3.9.58.13.132ay` | `paneltec-v160.3.9.58.13.132az` |
| MOBILE_BUNDLE_VERSION | `paneltec-v160.3.9.58.13.132at` | unchanged |

## Files changed

- `frontend/src/components/layout/TopbarPills.jsx` — new `<QuickRow icon={<Person20Regular />} label="My Profile">` at the top of Quick Actions.
- `frontend/src/components/auth/AccessSection.jsx` — `getUser()` import, `isSelf`/`isAdmin` detection, `pinStatus` fetch, `Change admin PIN` button + modal, `<DrawerPinField>` helper.
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION bump.
- `frontend/public/service-worker.js` — CACHE_VERSION bump.

## Not in this ship

- Backend — untouched. The endpoint `/auth/admin-console/status` + `/auth/admin-console/set-pin` were shipped in `.132am`; this bundle only surfaces a second frontend affordance for them.
- Mobile — untouched. Still waiting on Stephen's Sentry event URL from the `.132at` APK.

## Pytest

No new tests. The endpoint behaviour is exercised by `.132am`'s `test_v58_13_132am_admin_console_pin.py` (`set_pin_then_unlock`, `three_wrong_pins_returns_429_with_retry_after`, `non_admin_gets_403`, `bad_pin_shape_returns_400`) and `.132ax`'s parametrised regex tests. Both suites remained green after this ship (verified during the .132ax run).

## Rollback

Frontend-only. Revert this commit; CACHE bump re-fires the "Update available" toast one more time as clients drop to `.132ay`. No DB writes.
