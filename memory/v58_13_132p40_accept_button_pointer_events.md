# .132p40 — Fix ACCEPT JOB button not registering taps on web

## Bug
`Animated.View` wrapper with pulsing shadow interpolation (`acceptPulseAnim`) intercepted touch events on web/preview. The animated shadow layer sat on top of the `TouchableOpacity` child, swallowing taps.

## Fix
Added `pointerEvents="box-none"` prop to the `Animated.View` wrapper so it passes touches through to the child `TouchableOpacity`. One-line change.

## Files touched
- `mobile/app/(tabs)/home.tsx` — added `pointerEvents="box-none"`
- `mobile/app.json` — v1.0.68 / versionCode 190
- `mobile/src/lib/version.ts` — .132p40
- `frontend/src/lib/version.js` — .132p40
- `frontend/public/service-worker.js` — .132p40
