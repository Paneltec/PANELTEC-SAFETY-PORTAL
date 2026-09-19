# Iteration 15 — Phase 4.12: Sites + QR Sign-On (Dependency Fix + Verification)

## What was done
- Installed `expo-location@19.0.8` (SDK 54 compatible version — v56 was auto-resolved but incompatible)
- Fixed missing StyleSheet entries in `(tabs)/_layout.tsx` for sign-off banner styles
- Restarted mobile service for plugin/dependency changes
- Verified full Phase 4.12 flow via screenshots

## Phase 4.12 Requirements Verified
1. QR scanner recognises site QR codes (`/scan/site/{token}`)
2. In-app sign-on: pre-filled worker name, GPS capture via expo-location, dynamic signon_questions, POST to backend, save signon_id to AsyncStorage
3. Persistent sign-off banner (orange) in tab layout when worker has active sign-on, with Sign Off action (POST `/api/me/signoff-active`)
4. Feature gated behind `modules.sign_on` flag

## Key Decisions
- Used `expo-location@19.0.8` instead of latest `@56.0.18` (SDK version compatibility)
- Sign-off banner uses PubSub pattern (`signon.ts`) to communicate between scanner component and tab layout without React Context

## Known Issues
- GPS chip shows "Location unavailable" on web (expected — GPS is a native-only feature)
- Cross-session banner persistence can't be verified in Playwright (uses fresh browser contexts), but same-session persistence confirmed working
- Worker test account (`worker_stephen@paneltec.com.au`) is disabled in backend — cannot test worker-specific flows

## Dependencies Installed
- `expo-location@19.0.8`

## Files Modified
- `/app/mobile/app/(tabs)/_layout.tsx` (sign-off banner styles)
- `/app/mobile/package.json` (expo-location)

## Files Created by Previous Agent (Verified Working)
- `/app/mobile/src/lib/signon.ts`
- `/app/mobile/src/components/scan/SiteScanResult.tsx`
- `/app/mobile/app.json` (permissions/plugins)
