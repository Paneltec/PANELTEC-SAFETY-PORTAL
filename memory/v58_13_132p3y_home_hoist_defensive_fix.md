# .132p3y — Defensive hoist of job-detail computed vars

## Bug
Home screen crashes with `Cannot access 'isAccepted' before initialization` on some devices. The source declared `isAccepted`, `isDeclined`, `isIssued` correctly inside the `if (viewMode === 'job_detail')` block, but Babel/HMR TDZ artefacts from block-scoped consts caused a phantom crash.

## Fix
Hoisted 5 `const` declarations out of the `if` block to the top of `HomeScreen()`, right after the last `useCallback`. Renamed to `activeJob*` prefix to avoid shadowing:

- `job` → `activeJob`
- `isMocked` → `activeJobIsMocked`
- `isAccepted` → `activeJobIsAccepted`
- `isDeclined` → `activeJobIsDeclined`
- `isIssued` → `activeJobIsIssued`

All JSX and logic references inside the `if (viewMode === 'job_detail')` block updated to use the new names. No bare `isAccepted`/`isDeclined`/`isIssued`/`isMocked` remain.

## Files touched
- `mobile/app/(tabs)/home.tsx` — hoist + rename
- `mobile/app.json` — v1.0.66 / versionCode 188
- `mobile/src/lib/version.ts` — .132p3y
- `frontend/src/lib/version.js` — .132p3y
- `frontend/public/service-worker.js` — .132p3y

## Version
- Mobile: v1.0.66 / versionCode 188
- Frontend: v58.13.132p3y / v162
