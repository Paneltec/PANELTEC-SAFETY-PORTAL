# v58.13.132av — UI bundle (Fuel Reports nav restyle + Admin PIN UI)

## What shipped in this batch

1. **Fuel Reports header button** — bigger, bolder, amber-500 with `Fuel` bowser icon. Restyle only, same route + permission gate.
2. **MyProfile → Admin console PIN section** — admin-role-only card: Status pill, "Last set" timestamp, "Set PIN" / "Change PIN" button that opens a 4-digit modal with rotate/set-new UX.
3. **Users Management → AccessKebab → Clear admin console PIN** — new menu row that opens a confirmation modal requiring the acting admin's own PIN, wires to the `.132as` backend endpoint.

Deferred from `.132as` → `.132au`, now closed in `.132av`. No new backend routes — this bundle is the UI half of endpoints that shipped in `.132as`.

## Version state

| Constant | Before | After |
|---|---|---|
| RUNNING_VERSION (`frontend/src/lib/version.js`) | `paneltec-v160.3.9.58.13.132au` | `paneltec-v160.3.9.58.13.132av` |
| EXPECTED_CACHE_VERSION | `paneltec-v160.3.9.58.13.132au` | `paneltec-v160.3.9.58.13.132av` |
| CACHE_VERSION (`frontend/public/service-worker.js`) | `paneltec-v160.3.9.58.13.132au` | `paneltec-v160.3.9.58.13.132av` |
| MOBILE_BUNDLE_VERSION (`mobile/src/lib/version.ts`) | `paneltec-v160.3.9.58.13.132at` | unchanged |

CACHE bumped so every open tab reloads once into the new button treatment + new profile card.

## Fix 1 — Fuel Reports header button (Stephen's ask)

**File:** `frontend/src/pages/FleetRegister.jsx`

Before: small pill (`px-3 py-1.5 text-sm`), neutral grey, `BarChart3` icon at 13 px.

After: prominent CTA — `px-4 py-2 text-base font-bold uppercase tracking-wide`, `bg-amber-500 text-white`, `ring-1 ring-amber-300 shadow-sm`, `Fuel` icon from lucide-react at 18 px. `hover:bg-amber-600`. Sits between the register hero card and the "Import Fuel CSV" (blue) + "Print labels" (outlined) buttons in the header — clear visual hierarchy without disturbing them.

Data-testid preserved (`fleet-fuel-reports-btn`).

**Visual proof:** `/app/memory/screens/v58_13_132av_fleet_fuel_reports_btn.png` — captured post-deploy. Button reads "FUEL REPORTS" with the bowser icon, amber-500 fill, ring-1 in amber-300. Sits alongside blue "Import Fuel CSV" and outlined "Print labels" — clear visual hierarchy.

No mobile equivalent — the Fuel Reports entry lives inside the desktop FleetRegister header only.

## Fix 2 — MyProfile "Admin console PIN" section

**File:** `frontend/src/pages/MyProfile.jsx`

New `<AdminPinCard>` sub-component rendered as Card 3 (after Change Password), gated on `me.role === 'admin'`.

On mount → `POST /api/auth/admin-console/status` → `{ has_pin, set_at }`. Renders:
- Copy explaining the glance-shield purpose.
- Status pill: green "PIN SET" or amber "NOT YET SET".
- Last set: `DD/MM/YYYY HH:mm` formatted locally.
- Amber button — "Set PIN" (first time) / "Change PIN" (rotate).

Button opens a modal with three 4-digit fields when rotating (current, new, confirm) or two fields when first-time (new, confirm). Fields use `inputMode="numeric" pattern="[0-9]*" maxLength=4`, monospace centred with letter-spacing so the four digits read like a lock code. Submit → `POST /api/auth/admin-console/set-pin` with the correct payload shape (`{ pin, current_pin? }`). Success toast, closes modal, reloads status so "Last set" updates.

Wrong current PIN increments the same `admin_console_pin_attempts` counter used by the header unlock — 3/30s + 6/15min lockout tiers already enforced backend-side.

**Data-testids added:**
- `profile-admin-pin-card`
- `profile-admin-pin-status`
- `profile-admin-pin-set-at`
- `profile-admin-pin-open`
- `profile-admin-pin-modal`
- `profile-admin-pin-current` / `-new` / `-confirm`
- `profile-admin-pin-cancel` / `-submit`

**Visual proof:** `/app/memory/screens/v58_13_132av_myprofile_admin_pin.png` — captured post-deploy. Card shows amber Shield icon in header, green "PIN SET" pill in Status, "08/09/2026 04:46" in Last set (matches the pytest set at that time), amber "Change PIN" button in footer.

## Fix 3 — Users Management "Clear admin console PIN"

**File:** `frontend/src/components/auth/AccessKebab.jsx`

The AccessKebab is the per-row three-dot menu on the Users & Permissions table. Added:

1. **New menu item** — "Clear admin console PIN…" (amber-800 text) with data-testid `access-kebab-clear-admin-pin-{userId}`.
2. **Confirmation modal** — same structure as MyProfile's PIN modal. Asks for the acting admin's OWN 4-digit PIN. Warning card explains lockout policy + points to Profile → Admin console PIN if the acting admin hasn't set theirs yet.
3. **Wires to** `POST /api/users/{userId}/admin-console/clear-pin` with body `{ acting_pin }`. Success toast, closes modal, fires `onAfterAction?.()` so the parent Users table refreshes.

The endpoint (shipped in `.132as`):
- Gates on `_require_admin` (role=='admin') → non-admin caller → 403 (before the acting PIN is even checked).
- Verifies the acting admin's own PIN via bcrypt against `users.admin_console_pin_hash`.
- Uses the shared lockout ledger → same 3/30s + 6/15min tiers, no separate brute-force surface.
- Unsets `admin_console_pin_hash` + `admin_console_pin_set_at` on the target user; wipes their attempts row.
- Writes `user_audit` row: `action='admin_console_pin_cleared_by_admin'`, `acting_user_email`, `target_user_email`, `timestamp`.

**Data-testids added:**
- `access-kebab-clear-admin-pin-{userId}` (menu item)
- `access-kebab-clear-admin-pin-modal-{userId}` (modal root)
- `access-kebab-clear-admin-pin-acting-{userId}` (PIN input)
- `access-kebab-clear-admin-pin-cancel-{userId}` / `-confirm-{userId}`

**Visual proof:** `/app/memory/screens/v58_13_132av_users_clear_pin_modal.png` — captured after clicking the first admin's kebab → Clear admin console PIN…. Modal shows amber `ShieldOff` icon, the "confirm with your own admin console PIN" input, amber warning card with lockout copy, Cancel + "Clear PIN" (amber) buttons.

## Pytest coverage

New file: `backend/tests/test_v58_13_132av_clear_admin_pin.py` — 5 asserts.
- Correct acting PIN → 200, target's `admin_console_pin_hash` removed, `user_audit` row written.
- Wrong acting PIN → 401.
- Malformed acting_pin (`abcd`, too short, too long, empty) → 400/422.
- Non-admin caller → 403.
- Missing target user id → 404.

Full run across the affected surface:
```
tests/test_v58_13_132av_clear_admin_pin.py .....           [ 20%]  ← 5 new
tests/test_v58_13_132au_dedupe.py ........                 [ 52%]  ← 8 regression
tests/test_v58_13_132am_admin_console_pin.py ....          [ 68%]  ← 4 pre-existing
tests/test_v58_13_132ap_smartfill_sync_fix.py ....         [ 84%]  ← 4 pre-existing
tests/test_v58_13_132ar_smartfill_pagination_and_prices.py [100%]  ← 4 pre-existing
======================== 25 passed, 1 warning ========================
```

## Files changed

- `frontend/src/pages/FleetRegister.jsx` — bigger amber Fuel button (import + JSX).
- `frontend/src/pages/MyProfile.jsx` — new `<AdminPinCard>` sub-component + `<PinField>`.
- `frontend/src/components/auth/AccessKebab.jsx` — new menu item + confirmation modal.
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION bump.
- `frontend/public/service-worker.js` — CACHE_VERSION bump.
- `backend/tests/test_v58_13_132av_clear_admin_pin.py` — new (5 pytest).

Backend endpoints untouched — everything the frontend calls was shipped in `.132am` / `.132as`.

## Not in this ship

- **Mobile app** — nothing touched. `.132at` APK (Sentry) is installed on-device and waiting for Stephen to reproduce the launch crash + share the Sentry event URL. Any mobile action happens in `.132aw` after Stephen's Sentry dump.
- **SmartFill `From/To Timestamp` param spelling** — still parked (P1).
- **Workers multi-select + print selected cards** — parked (P2).
- **BOM forecast on mobile home / OSM → Google Street View** — parked (P2, mobile-side).

## Rollback

Frontend-only surface — no DB writes, no schema shape changes. To revert:

```bash
git revert <commit-of-.132av>
```

Version constants roll back automatically; the SW `CACHE_VERSION` roll-back will re-fire the "Update available" toast one more time as clients drop into `.132au`.

## Security note

`AccessKebab` intentionally renders the "Clear admin console PIN…" item for every row — the backend's `_require_admin` dep rejects non-admin callers with 403 before it even reads the acting PIN. The menu item is UX affordance only; there's no way for a non-admin viewer to actually clear anyone's PIN even if the DOM shows the option. Same shape as the existing "Unlock account" row.
