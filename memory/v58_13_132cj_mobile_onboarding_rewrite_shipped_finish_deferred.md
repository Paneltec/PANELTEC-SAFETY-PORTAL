# v58.13.132cj — Mobile Onboarding Rewrite: Kill Role-Picker, PIN → Role Auto-Detect

## Ship Memo

**Version**: v58.13.132cj  
**Date**: 2026-09-09  
**Author**: E1-Mobile Agent

---

## What Was Shipped

### 1. Division Picker ELIMINATED
The old "Choose Paneltec Civil / Viatec Traffic" `welcome.tsx` screen is gone. The backend now tells the app what role the worker has via the `POST /api/auth/mobile/pin-login` response.

### 2. New Onboarding Flow

**Step 1: QR-Scan Device Provisioning** (`(auth)/welcome.tsx`)
- First-launch only: scan QR code from web install landing page
- Stores `device_id` in expo-secure-store / AsyncStorage
- If already provisioned, auto-skips to PIN screen
- Web preview: manual text input fallback + "Quick setup" auto-generation
- If already logged in (has session_token), auto-skips to home

**Step 2: PIN Entry** (`(auth)/pin-entry.tsx`)
- 4-digit numeric keypad (PinPad component — big 76px circular touch targets)
- Submits `{pin, device_id}` to `POST /api/auth/mobile/pin-login`
- Handles:
  - 200 → stores session_token, role, user, org → navigates to home
  - 401 → inline error banner with shake animation ("Incorrect PIN" / "Account disabled" / "PIN expired")
  - 429 → countdown timer screen (rate limit tiers: 5→60s, 10→15min, 20→24h)
- Device ID shown at bottom footer (monospace, truncated)

**Step 3: Role Auto-Detection**
- Backend response includes `role_id` ∈ {admin, paneltec_civil, viatec_traffic, external_contractor}
- Stored in secure storage, read by home screen on mount

**Step 4: Role-Based Landing** (`(tabs)/home.tsx`)
- 4 distinct home screens based on `role_id`:
  - **admin**: Navy header. 8 modules (Forms Library, Workers, Sites, SWMS, Fleet, Reports, Settings, Audit Log). "Full system access" subtitle.
  - **paneltec_civil**: Navy header. 6 modules (Forms, Pre-Starts, My SWMS, Timesheets, Hazards, Incidents). "Civil & Construction" subtitle.
  - **viatec_traffic**: Purple header (Viatec brand). 6 modules (Forms, Site Scan, Pre-Starts, Incident Report, My SWMS, Timesheets). "Traffic Management" subtitle.
  - **external_contractor**: Navy header. 2 modules (Assigned SWMS, Acknowledgements). "Assigned work only" subtitle.
- Avatar initials from stored name. Pull-to-refresh.
- Info card at bottom describes access level.

**Step 5: Logout / Switch User**
- Profile tab "Sign Out" button clears session (clearSession)
- Navigates back to `(auth)/pin-entry` (device_id preserved)
- Long-press full wipe available via `fullWipe()` if needed

### 3. Session Management
- `session_token` from pin-login stored in expo-secure-store (native), AsyncStorage (web)
- Also stored in legacy `paneltec_jwt` key for backward compat with existing API services
- All existing services (forms, profile, sites, etc.) continue to work via `getStoredJwt()`
- Web preview session bypass retained (sessionStorage-based)

---

## Crash-Avoidance Strategy

### What Was Done
1. **Sentry native DISABLED**: `enableNative: false` + `enableAutoSessionTracking: false` in `_layout.tsx`. JS-level Sentry still captures React errors and unhandled promises.
2. **metro.config.js**: Already had the portable regex fix from .132ba (`/(^|\/)_archived_[^/]*\/.*/`). No changes needed.
3. **expo-notifications**: NOT removed from package.json (too risky). No auto-init code exists at module-import time in the onboarding path.
4. **Minimal onboarding path**: Splash → QR provisioning → PIN → Home. No heavy native module usage.

### Modules Stripped/Disabled
| Module | Action | Reason |
|--------|--------|--------|
| Sentry native | `enableNative: false` | Suspected Android pre-JS crash trigger |
| Sentry autoSessionTracking | Disabled | Native dependency |
| expo-notifications | No init in onboarding path | Suspected crash cause — deferred to later ship |

### Boot Verification
- Web preview: App boots and bundles successfully (1346+ modules)
- Screenshot verification: All 5 screens render correctly
- **Android native boot**: NOT YET VERIFIED (requires Stephen's EXPO_TOKEN for EAS build or physical device). The crash is pre-JS and may still occur.

---

## Files Modified

### Mobile App (`/app/mobile/`)
| File | Action | Description |
|------|--------|-------------|
| `app/_layout.tsx` | REWRITE | Sentry native disabled, simplified boot trace |
| `app/index.tsx` | REWRITE | New splash routing (session → home, provisioned → PIN, else → QR) |
| `app/(auth)/welcome.tsx` | REWRITE | QR device provisioning (was: division picker) |
| `app/(auth)/pin-entry.tsx` | REWRITE | PIN login via /api/auth/mobile/pin-login (was: create/verify local PIN) |
| `app/(auth)/login.tsx` | DELETED | Dead code |
| `app/(auth)/onboarding.tsx` | DELETED | Dead code |
| `app/(tabs)/home.tsx` | REWRITE | Role-based landing with 4 module configs |
| `app/(tabs)/profile.tsx` | MODIFIED | Logout uses clearSession → (auth)/pin-entry |
| `src/services/auth.ts` | REWRITE | pinLogin() via fetch, secure storage, role accessors |
| `src/lib/version.ts` | BUMPED | .132ba → .132cj |

### Frontend (`/app/frontend/`)
| File | Action | Description |
|------|--------|-------------|
| `src/lib/version.js` | BUMPED | .132ci → .132cj + changelog block |
| `public/service-worker.js` | BUMPED | .132ci → .132cj |
| `public/mobile-screenshots/index.html` | REWRITE | 5 new screenshots for .132cj |

### Backend (`/app/backend/`)
| File | Action | Description |
|------|--------|-------------|
| `mobile_home.py` | VERSION ONLY | Comment bump .132j → .132cj |

---

## Known Limitations
1. **CORS on web preview**: The Expo web preview (`.expo.preview.emergentagent.com`) cannot call the backend (`.preview.emergentagent.com`) due to CORS preflight failures. This is a preview-environment limitation — native apps don't have CORS. The PIN error shown in screenshots is "Network error" rather than "Incorrect PIN" for this reason.
2. **Android native boot NOT verified**: The suspected crash (pre-JS, in Sentry/Reanimated/expo-notifications native layers) may still occur. This ship disables Sentry native and avoids notification init, but a real device test is needed.
3. **QR camera scan**: Not functional on web preview. Manual text input fallback works. On native, expo-camera would handle the QR scan.
4. **Modules "Coming soon"**: Most module tiles in the role-based home are placeholders — only Forms Library has a real route. Other modules are skeleton-only for this ship.

---

## Screenshots (5 device-framed)
1. QR Device Setup (first-launch provisioning)
2. PIN Entry (4-digit keypad)
3. PIN Error Handling (inline error banner)
4. Admin Dashboard (8-module grid)
5. Viatec Traffic Home (purple header, 6 modules)
