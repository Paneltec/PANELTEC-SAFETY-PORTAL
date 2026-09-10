# v58.13.132cl — Mobile: Paneltec Group Header + "Welcome back" Flow

## Ship Memo

**Version**: v58.13.132cl  
**Date**: 2026-09-10  
**Author**: E1-Mobile Agent  
**Builds on**: v58.13.132cj (onboarding rewrite), v58.13.132ck (backend device-hint endpoint)

---

## What Was Shipped

### 1. "Paneltec Group" Brand Rename
Replaced "Paneltec Civil" with "Paneltec Group" (holding-company brand) across all surfaces:

| Surface | Before | After |
|---------|--------|-------|
| Wordmark component | PANELTEC CIVIL · FIELD | PANELTEC **GROUP** · FIELD |
| Welcome/QR screen title | "Device Setup" | "Paneltec Group" |
| Home screen header | (none) | "PANELTEC GROUP" subtitle above greeting |
| app.json launcher label | "Paneltec Civil Field" | "Paneltec Group Field" |

**Important**: Role chip on home still shows the user's actual `role_label` (Admin / Paneltec Civil / Viatec Traffic Solutions / External Contractor). Only the brand name changed.

### 2. "Welcome Back" Flow on PIN Screen
Uses `GET /api/auth/mobile/device-hint?device_id=<uuid>` (no auth, shipped in .132ck).

**Bound device** (`bound: true`):
- Title: "Welcome back {user_first_name}" (e.g. "Welcome back Stephen")
- Orange subtitle: "{role_label} · {org_name}" (e.g. "Admin · Paneltec Pty Ltd")
- Below: "Enter your 4-digit PIN to continue"
- "Not you? Sign in as a different user" link visible

**Unbound device** (`bound: false`):
- Title: "Enter your 4-digit PIN"
- Subtitle: "First-time setup — your device will be linked to your account after login"
- No "Not you?" link

### 3. Device-Hint Caching
- In-memory cache (`_hintCache`) keyed by `device_id`
- Cached for entire session — no re-fetch on re-render or navigation
- Cache cleared on: `clearSession()`, `fullWipe()`, successful `pinLogin()`
- Rate-limited (429) or network error → silent fallback to `{ bound: false }` (generic prompt)

### 4. "Not You?" Flow
- Tap "Not you? Sign in as a different user"
- Confirmation dialog: "This will unlink this device — you'll need to sign in fresh"
- On confirm: `fullWipe()` → clears device_id + session + hint cache
- Navigates to `(auth)/welcome` for re-provisioning
- After next successful PIN entry, device is claimed by the new user (backend does this on `/pin-login`)

---

## Files Modified

### Mobile App (`/app/mobile/`)
| File | Action | Description |
|------|--------|-------------|
| `app/(auth)/pin-entry.tsx` | REWRITE | Device-hint fetch, Welcome back greeting, Not you? link |
| `app/(auth)/welcome.tsx` | MODIFIED | Title → "Paneltec Group" |
| `app/(tabs)/home.tsx` | MODIFIED | Added "PANELTEC GROUP" brand text in header; role pill uses roleLabel |
| `app.json` | MODIFIED | name → "Paneltec Group Field" |
| `src/services/auth.ts` | MODIFIED | Added `fetchDeviceHint()`, `clearDeviceHintCache()`, `DeviceHintResponse` type |
| `src/components/Wordmark.tsx` | REWRITE | "PANELTEC CIVIL" → "PANELTEC GROUP" with orange accent |
| `src/lib/version.ts` | BUMPED | .132cj → .132cl |

### Frontend (`/app/frontend/`)
| File | Action |
|------|--------|
| `src/lib/version.js` | BUMPED .132ck → .132cl + changelog |
| `public/service-worker.js` | BUMPED .132ck → .132cl |
| `public/mobile-screenshots/index.html` | Updated for .132cl screenshots |

### Backend (`/app/backend/`)
| File | Action |
|------|--------|
| `mobile_home.py` | Version comment .132cj → .132cl |
| `scripts/check_version_files_v58_8_1.py` | Regex updated to accept alphanumeric version suffixes |

---

## Device-Hint Fetch Approach

```
mount pin-entry.tsx
  → getDeviceId() from secure-store
  → if device_id exists:
      → check _hintCache (in-memory)
      → if miss: fetch GET /api/auth/mobile/device-hint?device_id=<uuid>
          → 200 + bound:true → show "Welcome back {first_name}"
          → 200 + bound:false → show generic prompt
          → 429 → silent fallback to generic prompt
          → network error → silent fallback to generic prompt
      → cache result in _hintCache
  → else: show generic prompt (no device_id yet)
```

Cache is per-session (module-level variable). Invalidated on login/logout/wipe.

---

## Screenshots (3 device-framed)
1. **PIN bound**: "Welcome back Stephen" + "Admin · Paneltec Pty Ltd" + "Not you?" link
2. **PIN unbound**: "Enter your 4-digit PIN" + first-time setup hint
3. **Home branded**: "PANELTEC GROUP" header text + "Admin" role pill + 8-module grid

---

## Known Limitations
- CORS: PIN login (POST) still blocked on web preview. Device-hint (GET) works cross-origin.
- Device binding requires a successful pin-login call (which works natively, not on web preview).
- For screenshot testing: Stephen's PIN was set to "5050" and device was bound to "dev_screenshot_132cl" directly in MongoDB.
