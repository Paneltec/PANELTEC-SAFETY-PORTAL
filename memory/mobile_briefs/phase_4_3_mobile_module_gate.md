# Phase 4.3 — Expo mobile hand-off brief

**Owner**: `e1_expo_frontend_dev` (mobile)
**Status**: Web + backend shipped on `paneltec-v103`. Mobile is the final piece.
**Hard rule**: Do NOT touch `/app/backend/` or `/app/frontend/`. Mobile-only.

## What changed in the backend (read-only context for you)

A new visibility gate has shipped. Admins toggle which modules appear in
the mobile app per role via the web "Permissions Matrix" page. Your job
on mobile is to consume the resulting boolean map and **hide** any tab /
drawer entry whose flag is `false`.

This phase is **visibility only** — do NOT block API calls. If the
module is on for the user's role, show it. If it's off, hide the
entry-point. The user can't navigate to what isn't rendered.

## API contract

Base URL = `EXPO_PUBLIC_BACKEND_URL` (same env var you already use).
All calls require the existing Bearer JWT.

### `GET /api/me/mobile-modules`

Returns the flat boolean map for the calling user's role:

```json
{
  "role": "worker",
  "modules": {
    "pre_start": true,
    "site_diary": true,
    "hazard": true,
    "incident": true,
    "inspection": true,
    "swms": true,
    "inductions": true,
    "plant_vehicles": true,
    "service_maintenance": false,
    "certifications": true,
    "ask_intel": false,
    "sign_on": true,
    "profile": true
  }
}
```

Behaviour to rely on:
- Endpoint is **always 200** for an authenticated user. Unknown roles
  silently fall back to the contractor row server-side — you do NOT
  need a client-side default.
- The map ALWAYS contains exactly these 13 keys. If a key is missing,
  treat it as `false` defensively.
- Admin users get all-true.

### `GET /api/settings/mobile-modules` (admin only — FYI, you won't call this)

Returns the full matrix. Only the web admin UI consumes it.

## Tasks

1. **Fetch on login**
   Right after the existing `/auth/login` success handler, fire
   `GET /api/me/mobile-modules`. Persist `modules` into your app store
   (Zustand / Redux / whatever is currently used — match existing
   patterns, don't add a new state library).

2. **Refresh on foreground**
   In the existing `AppState` listener (or equivalent on `focus`),
   re-fetch the map silently. If the response 401s, treat it like any
   other 401 and route to login.

3. **Gate the bottom-tab nav + drawer/menu**
   For each rendered nav entry, check the corresponding module flag.
   If `false` → omit the entry from the rendered array. Do NOT render
   then `display:none` — keep the nav tree clean so deep-link guards
   work naturally.

   Suggested mapping (module key → nav entry):
   - `pre_start`           → "Daily Pre-Starts" tab + new-pre-start FAB
   - `site_diary`          → "Site Diary" tab
   - `hazard`              → "Hazards" tab + "Report a hazard" FAB
   - `incident`            → "Incidents" tab + "Report incident" FAB
   - `inspection`          → "Inspections" tab + "Start inspection" FAB
   - `swms`                → "SWMS" drawer entry + "View my SWMS" home card
   - `inductions`          → "Inductions" drawer entry + "Complete induction" prompt
   - `plant_vehicles`      → "Plant & Vehicles" drawer entry + QR scanner
                              shortcut on home
   - `service_maintenance` → "Service & Maintenance" drawer entry
   - `certifications`      → "Certifications" drawer + expiry chip on home
   - `ask_intel`           → "Ask Intelligence" tab/screen
   - `sign_on`             → "Sign-on" tab + the main sign-on QR scanner
   - `profile`             → "My Profile" tab (NOTE: profile is the only
                              place to find the "Refresh modules" pull-to-
                              refresh action — never hide profile)

   Implementation tip: keep one source of truth (e.g.
   `const NAV_ITEMS = [{ key, label, icon, screen, moduleKey }, ...]`)
   and filter once on every render: `NAV_ITEMS.filter(i => modules[i.moduleKey])`.

4. **Pull-to-refresh on Profile screen**
   Add a small "Refresh modules" action (RefreshControl on the
   ScrollView, OR an explicit button — match whichever pattern is
   already used). On pull, re-fetch `/me/mobile-modules` and update
   the store. Show a transient toast "Modules updated." This lets an
   admin preview changes without forcing the worker to log out.

5. **Empty-state safety**
   If literally every module is off for a role (shouldn't happen
   normally — backend forces `admin` and seeds sensible defaults for
   the rest, but defend against a misconfig anyway): render a single
   screen with the Paneltec wordmark + "No mobile modules enabled for
   your role. Ask your admin to update your access." and a logout
   button. Use the existing brand orange `#F97316` + slate `#1E293B`.

## Acceptance

- Worker logs in → only modules toggled ON for `worker` are rendered.
- Admin toggles `hazard` OFF for worker on web → worker pulls-to-refresh
  on Profile → Hazards tab disappears within ~1s, no app reload needed.
- Admin user always sees all 13 modules (server-side guarantee).
- Foregrounding the app re-fetches and re-renders nav.
- No "white screen" if a module's screen is targeted by a stale deep
  link — fall back to the home screen with a small toast "That module
  has been turned off for your role."

## Out of scope for this phase

- API-level enforcement (we are NOT blocking POSTs when a module is
  off). Do not add 403 handling for module-gated routes — they remain
  open.
- Per-user overrides — only per-role this phase.
- Image-based sign-in / facial recognition — separate brief.

## When you're done

Hand back to `e1_dev` with:
- Screencast or screenshot of a worker session showing only their
  toggled-on modules.
- Confirmation that the Profile pull-to-refresh updates nav without
  re-login.
- Any blockers / API gaps you hit.
