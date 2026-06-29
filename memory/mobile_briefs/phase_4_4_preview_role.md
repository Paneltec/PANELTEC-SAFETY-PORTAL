# Phase 4.4 — Expo mobile hand-off: preview-role query params

**Owner**: `e1_expo_frontend_dev` (mobile)
**Status**: Web + backend shipped on `paneltec-v104`. This is a small
mobile-side adjustment so the new admin "Live Preview" iframe in the
web Permissions Matrix works end-to-end.
**Hard rule**: web-only behaviour. **Native builds (iOS/Android) MUST
ignore both query params entirely** — they shouldn't even read them.

## What changed on the web side (read-only context)

Admins on the web app now see a phone-bezel iframe next to the Mobile
App Modules grid. The iframe `src` is the Expo web build with two new
query params:

```
https://whs-compliance.expo.preview.emergentagent.com/?preview_role=contractor&preview_token=<admin_jwt>&_t=<cachebust>
```

The web side already extracts the admin's current JWT from
`localStorage` and stuffs it in `preview_token`. It picks the role from
a dropdown (Worker / Supervisor / Contractor / Admin) and updates the
iframe `src` on change or reload.

## Backend already supports this

```
GET /api/me/mobile-modules?as_role=<role>
```

- If the calling JWT belongs to an **admin** AND `as_role` is one of
  `worker | supervisor | contractor | admin`, the response is the
  matrix row for the requested role.
- Otherwise `as_role` is silently ignored and the caller's own role is
  used (non-admin guarantee).
- Response shape is unchanged except for two new fields:
  ```json
  { "role": "contractor", "actual_role": "admin",
    "previewed": true, "modules": { ... } }
  ```
  You can use `previewed` to render a small "Preview mode · <role>"
  ribbon at the top of the mobile UI if you want — optional polish.

## Tasks (mobile only — keep tiny)

1. **Read query params, web-only**
   On app boot (only when `Platform.OS === 'web'`):
   ```js
   const params = new URLSearchParams(window.location.search);
   const previewToken = params.get('preview_token');
   const previewRole  = params.get('preview_role');
   ```
   Stash both in module-level constants / Zustand non-persisted slice.
   **Do NOT** write either to AsyncStorage / localStorage / SecureStore.

2. **Use `preview_token` instead of stored JWT (web only, if present)**
   In your existing auth interceptor (Axios/fetch wrapper):
   - If `previewToken` is set, attach `Authorization: Bearer ${previewToken}`
     and skip the stored-token lookup entirely.
   - Do NOT refresh / rotate / persist this token. If it expires the
     iframe will just 401 — the admin will reload the iframe and the
     web side will pass a fresh JWT.

3. **Append `as_role` only when admin is previewing**
   In the existing `/me/mobile-modules` fetch call:
   ```js
   const url = `/api/me/mobile-modules${previewRole ? `?as_role=${previewRole}` : ''}`;
   ```
   The backend handles the auth check (non-admin tokens silently get
   their own row), so you don't need to gate this client-side. Just
   forward the param.

4. **Skip the AsyncStorage write of the modules result while previewing**
   When `previewRole` is set, don't persist the modules map to local
   storage. Otherwise an admin previewing as Contractor would corrupt
   their own cached worker map for the next real-app session.

5. **Tiny preview ribbon (optional but nice)**
   If `previewed === true` on the modules response, render a 24-px tall
   orange ribbon at the very top of the layout reading
   `Preview mode · <role>` on slate text. Sits above the bottom-tab nav
   on web only.

## Acceptance

- Admin opens Permissions Matrix → Mobile App Modules → bezel renders
  the real mobile app, authenticated as the admin but showing only the
  Worker module set (default).
- Admin changes the role dropdown to Contractor → bezel reloads →
  shows the contractor module set (typically just sign-on, SWMS,
  inductions, profile).
- Admin closes the web tab → opens the native iOS/Android app → sees
  their own admin modules (preview params had zero effect on native).
- Admin opens the standalone Expo web URL (no query params) → behaves
  exactly as before, no regressions.

## Out of scope

- Persisting preview tokens.
- Per-user overrides — per-role only.
- Native preview mode — web is enough for the admin tool.

## When done

Hand back to `e1_dev` with:
- Screencast or screenshot of the bezel in the web Permissions Matrix
  showing the contractor module set rendered inside the Expo app.
- Confirmation that native builds are unaffected.
