# .132p3m — Remove DECLINE button on Job Detail

## Change
Removed the DECLINE button from the Job Detail "issued" state on the mobile home screen.
ACCEPT JOB button now spans full width (flex: 1 instead of flex: 1.6).

## Files touched
- `mobile/app/(tabs)/home.tsx` — removed DECLINE TouchableOpacity (10 lines), changed acceptBtnWrap flex from 1.6→1
- `mobile/app.json` — v1.0.59, buildNumber 181, versionCode 181
- `mobile/src/lib/version.ts` — MOBILE_BUNDLE_VERSION + SHIP_LABEL → .132p3m
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION → .132p3m
- `frontend/public/service-worker.js` — CACHE_VERSION → .132p3m

## Before
Two buttons side-by-side: DECLINE (white outline, flex:1) | ACCEPT JOB (green solid, flex:1.6)

## After
Single full-width button: ACCEPT JOB (green solid, flex:1, full row)

## What was NOT changed
- Navigate / Sign On At Site buttons (locked row) — untouched
- Declined state rendering — still present (for jobs declined before this change)
- handleDeclineJob function — left in code (dead code, harmless)
- No other screens, tabs, or components modified
