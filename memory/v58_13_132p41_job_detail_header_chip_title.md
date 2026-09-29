# .132p41 — Job Detail header: green ACCEPTED chip + fix title truncation

## Fix 1 — ACCEPTED chip
Changed accepted chip config from `ACCEPTED · at 7:07am` (green-on-softgreen) to a clean `ACCEPTED` label with explicit green tokens: bg `#DCFCE7`, border `#86EFAC`, text `#065F46`. Matches the green palette used in acceptedPill lower in the screen.

## Fix 2 — Title truncation
- Added `minWidth: 0` to the title wrapper `<View>` to allow flexbox text truncation
- Added `flexShrink: 1, maxWidth: 120` to the chip container so it doesn't push the title off-screen
- Title still uses `numberOfLines={2}` with ellipsis

## Files touched
- `mobile/app/(tabs)/home.tsx` — chip config + flex fix
- `mobile/app.json` — v1.0.69 / versionCode 191
- `mobile/src/lib/version.ts` — .132p41
- `frontend/src/lib/version.js` — .132p41
- `frontend/public/service-worker.js` — .132p41
