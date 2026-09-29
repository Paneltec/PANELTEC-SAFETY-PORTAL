# .132p42 — Nuclear fix: remove Animated.View wrapper around ACCEPT + reduce header title font

## Fix A — Remove Animated.View wrapper
Deleted `Animated.View` wrapper with pulsing shadow interpolation entirely. The animated layer intercepted touch events on web preview. Replaced with plain `TouchableOpacity` directly inside the decision row. Cleaned up dead code: `acceptPulseAnim` useRef, the useEffect driving the animation loop, `acceptBtnWrap` style, and unused `Animated`/`useRef` imports.

## Fix B — Reduce header title font
`jd.headerTitle` fontSize reduced from 20 to 16, lineHeight from 26 to 22. Gives more room for site name alongside the status chip.

## Fix C — Debug logs
Added `console.log('[132p42]')` to ACCEPT button onPress and inside `handleAcceptJob` to trace tap registration and mock/API path. To be stripped in a follow-up ship.

## Files touched
- `mobile/app/(tabs)/home.tsx`
- `mobile/app.json` — v1.0.70 / versionCode 192
- `mobile/src/lib/version.ts` — .132p42
- `frontend/src/lib/version.js` — .132p42
- `frontend/public/service-worker.js` — .132p42
