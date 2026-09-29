# .132p43 — Preview-mode accept fallback, bigger accept btn, forms filter reset

## Fix 1 — Accept/Decline with 403 fallback
Both `handleAcceptJob` and `handleDeclineJob` now fall back to optimistic local update on any error (including 403 Forbidden in Preview mode). No more Error alert — UI always transitions. Debug console.logs from .132p42 removed.

## Fix 2 — Accept button visual weight
`jd.acceptBtn`: paddingVertical 16→20, minHeight 56→60, added static shadow (green, radius 8, opacity 0.35, elevation 6).

## Fix 3 — Forms category filter resets on exit
Replaced AsyncStorage persistence with route params. SSRA tile now navigates with `{ params: { category: 'ssra' } }`. Forms tab reads `useLocalSearchParams` on mount. No persistence — defaults to "All categories" on normal tab switch. Removed dead AsyncStorage import and CAT_STORAGE_KEY.

## Files touched
- `mobile/app/(tabs)/home.tsx` — Fix 1 + Fix 2 + SSRA tile param
- `mobile/app/(tabs)/forms.tsx` — Fix 3 route params
- `mobile/app.json` — v1.0.71 / versionCode 193
- `mobile/src/lib/version.ts` — .132p43
- `frontend/src/lib/version.js` — .132p43
- `frontend/public/service-worker.js` — .132p43
