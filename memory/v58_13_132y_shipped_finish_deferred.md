# v58.13.132y — SHIPPED (Simpro role-override protection + Expo MapView wire)

Status: **shipped, 5/5 pytest passing, 6 users protected via
back-fill, mobile map wired with graceful fallback.**

## Executive summary

- **FIX A (backend):** New `role_manually_set: bool` field on user
  docs guards against Simpro sync overwriting admin-assigned roles.
  Delta sync now skips the role-write branch when the flag is `True`;
  non-role fields (name, position, company) still sync. Manual PATCH
  via `PATCH /api/users/{id}` on `role_id` auto-sets the flag.
  Back-fill: **6 users** flagged (all 6 hotfixed activations from
  `.132s` — Josh, Adrian, Bobby McGowan, Brock Waterworth, Emma
  Nippers, Wayne Nippers).
- **FIX B (mobile):** `mobile/app/(tabs)/home.tsx` hero now uses a
  real `expo-maps` `MapView` with graceful fallback to the legacy
  static-tile-with-Ionicon-overlay when the module isn't bundled
  with the current Expo dev client. `expo-maps@~0.11.0` added to
  `package.json` (`yarn install` completed).
- Version bumps: `RUNNING_VERSION` + `MOBILE_BUNDLE_VERSION`
  `.132x → .132y`. **CACHE_VERSION NOT bumped** — no new web-frontend
  surface this batch (FIX A is backend, FIX B is mobile).

## FIX A — Simpro role-override protection

### Bug

Simpro daily sync's `sync_from_simpro_delta` position-change branch
was rewriting `role_id` on every run based on the user's Simpro
`Position`, blowing away admin-assigned buckets. The `.132s`
migration hardened this via a global `SIMPRO_POSITION_ROLES_DISABLED`
env flag, but that's an all-or-nothing gate — admins couldn't
protect *specific* users while leaving the position-mapping active
for the rest of the org (should they ever flip the global flag off).

### Fix

Per-user sticky flag `role_manually_set: bool`.

**Writer (backend/users.py):**
- `PATCH /api/users/{id}` — whenever the body contains `role_id`,
  the same `$set` update stamps `role_manually_set=True`. Documented
  in code with a v58.13.132y comment.
- Reset mechanism deferred: a future admin UI "Reset role to Simpro
  default" button will flip the flag back to `False` via a dedicated
  `reset_role_manually_set: true` PATCH body. Not in this batch.

**Reader (backend/simpro_import_users.py):**
- `sync_from_simpro_delta` — the role-rewrite branch now guarded by
  BOTH the global `_positions_disabled` env flag AND the per-user
  `_user_manual = bool(u.get("role_manually_set"))` check:
  ```python
  if position_changed and new_pos and not _positions_disabled and not _user_manual:
      ...role-rewrite logic...
  ```
- When the flag causes a skip, a `user_audit` row
  `action="role_write_skipped_manually_set"` is emitted so admins
  can see the sticky behaviour in the audit trail.
- The response payload for the sync endpoint now includes
  `manual_skips: int` alongside the existing `role_updates`,
  `lock_drifts`, etc.

**Back-fill:**

```
UPDATE users
SET role_manually_set = True, role_manually_set_at = now, role_manually_set_by = "script:v58.13.132y"
WHERE _created_by_hotfix = "v58.13.132r_workers_to_users" AND deleted_at IS NULL
→ 6 rows modified
```

The 6 protected users:

| Name | Email | Persisted role |
|---|---|---|
| JOSHUA DREW | joshua@paneltec.com.au | admin |
| ADRIAN MITCHELL | adrianmitchell283@gmail.com | paneltec_civil |
| BOBBY MCGOWAN | bobbylbp@hotmail.com | paneltec_civil |
| BROCK WATERWORTH | brock.w@hotmail.com | paneltec_civil |
| EMMA NIPPERS | emmanippers04@gmail.com | viatec_traffic |
| WAYNE NIPPERS | (no email) | viatec_traffic |

Tomorrow's Simpro cron will emit 6 `role_write_skipped_manually_set`
audit rows and preserve everyone's role.

### Tests

`backend/tests/test_v58_13_132y_role_manual_set.py` — **5 passed**:

- `test_six_hotfixed_users_are_role_manually_set` — back-fill verified.
- `test_josh_and_adrian_flagged` — spot-check.
- `test_admin_patch_role_flips_role_manually_set` — end-to-end
  HTTP PATCH → DB flag state.
- `test_delta_sync_skips_role_write_when_flag_set` — simulates the
  delta branch guard boolean.
- `test_delta_sync_rewrites_role_when_flag_off` — the other
  direction, guarding against regressions.

## FIX B — Expo MapView wire (mobile)

### Prior state

Home tab hero rendered a static OpenStreetMap tile as an `<Image>`
with an Ionicon "location" pin overlaid at the calculated fractional
pixel. Non-interactive, no user location, no other markers.

### New state

Home tab hero tries `require('expo-maps')` at module load. If the
module is available (i.e. the current Expo dev client bundles
`expo-maps`), it renders a real `MapView` centred on the site
coordinates with an orange-tinted marker. Camera is locked to the
site so the hero stays a compact preview — tapping the card still
routes to `onSignIn()` for the full-screen experience.

If the module is NOT available (stock Expo Go, or an older dev
client), the code falls back to the legacy static-tile-with-Ionicon
overlay. **No crash, no user-visible regression.**

### To activate the real map

Once locally:

```bash
cd /app/mobile
yarn install               # done in this batch
npx expo prebuild --clean  # regenerates native project with expo-maps
eas build --platform ios --profile development
eas build --platform android --profile development
# distribute new dev-client build to team via TestFlight / internal share
```

Every device that installs the fresh dev-client build will
automatically switch to the real `MapView` on next home-screen load.

### Fallback rationale

`expo-maps` is a **native module** and cannot be installed via a JS
OTA update — it requires a fresh dev-client build. Given this can't
happen in-server, the graceful fallback is the safe ship. The code
change is complete; activation is a build-and-distribute step.

### Files touched

| File | Change |
|---|---|
| `backend/simpro_import_users.py` | Delta guard + `manual_skips` counter |
| `backend/users.py` | PATCH sets `role_manually_set=True` on `role_id` change |
| `backend/tests/test_v58_13_132y_role_manual_set.py` | **NEW** — 5 tests |
| `mobile/app/(tabs)/home.tsx` | Dynamic `require('expo-maps')` + fallback |
| `mobile/package.json` | +`"expo-maps": "~0.11.0"` |
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132x → .132y` + ship-note block |
| `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` | `.132x → .132y` |

## Rollback

### FIX A

- Unset the field on the 6 protected users:
  ```python
  await db.users.update_many(
      {"role_manually_set_by": "script:v58.13.132y"},
      {"$set": {"role_manually_set": False}},
  )
  ```
- Remove the `role_manually_set=True` line from `users.py::update_user`.
- Remove the `and not _user_manual` clause from
  `simpro_import_users.py:sync_from_simpro_delta`.
- Undo the `manual_skips` counter additions.

### FIX B

- Revert `mobile/app/(tabs)/home.tsx` to the prior static-tile block.
- Remove `"expo-maps"` from `mobile/package.json` + `yarn install`.

The dynamic `require` guard means removing the module alone doesn't
crash the app — the fallback kicks in.

## Deferred / follow-ups

- **"Reset role to Simpro default" admin action** — mentioned in the
  brief as nice-to-have; UI + endpoint deferred. Estimated effort: **S**.
- **Expo dev-client rebuild + distribution** — user action; documented
  above.
- **Location-permission prompt + user-location pin** — the brief
  mentioned a permission-gated pin. Deferred: the `expo-maps` module
  handles this via its own permission flow once activated. Follow-up
  polish once the module is live in the dev client.
- **Marker for daily-jobs** — brief mentioned "markers for the user's
  assigned jobs today". The current wire is single-marker (the site
  coord). Extending to multi-job markers requires a small refactor
  once we have real map data flowing. Effort: **S** post-activation.

## User-visible next step

- **Backend:** Nothing user-visible. Tomorrow's Simpro cron will
  silently respect the 6 protected users and emit audit rows.
- **Mobile:** Users see no change until the Expo dev-client is
  rebuilt with `expo-maps` bundled. Then the home hero switches from
  a static tile to an interactive map on the next launch.
