# .132p3z — Remove SIGN ON AT SITE from pre-accept locked row + accept button investigation

## Fix 1 — Remove SIGN ON AT SITE from locked row (pre-accept state)
Removed only the SIGN ON AT SITE `<View style={jd.lockedBtn}>` sub-block from the locked row. Kept the greyed NAVIGATE button. Updated caption from "Accept to unlock Navigate and Sign On.\nThe office is notified straight away." to "Accept to unlock Navigate.\nThe office is notified straight away."

## Fix 2 — Accept button investigation
All bare `job` references inside `if (viewMode === 'job_detail')` were already correctly renamed to `activeJob` in `.132p3y`. The `handleAcceptJob(activeJob)` call site at line 471 is correct. The `handleAcceptJob`/`handleDeclineJob` function declarations use `job` as their own parameter — that's a scoped local, correct. Root cause of user's non-response: **stale Metro bundle** from `.132p3y` not being picked up by Phone Preview. The version bump forces a fresh bundle.

## Files touched
- `mobile/app/(tabs)/home.tsx` — removed locked row + caption update
- `mobile/app.json` — v1.0.67 / versionCode 189
- `mobile/src/lib/version.ts` — .132p3z
- `frontend/src/lib/version.js` — .132p3z
- `frontend/public/service-worker.js` — .132p3z
