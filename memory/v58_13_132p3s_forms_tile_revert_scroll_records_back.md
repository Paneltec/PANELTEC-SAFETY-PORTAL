# .132p3s — Forms tile revert, filter modal scroll, My Records back button

## Fix 1 — Reverted Forms tile size
- Restored full-width single-column tiles (pre-.132p3r layout)
- catGrid back to paddingHorizontal:16, catCard minHeight:68, icon 44px/22-size, fonts 16/13
- Category filter dropdown from .132p3r preserved intact

## Fix 2 — Category filter modal scrolls fully
- Wrapped modal rows in ScrollView with flexGrow:0 + bounces:false
- All 13 categories (12 + SSRA) now reachable by scrolling on any screen size

## Fix 3 — My Records back button
- Added chevron-back TouchableOpacity to header row in (screens)/my-work.tsx
- Navigates router.back() — matches Asset Detail pattern from .132p2j
- backBtn style: padding:4 for 44pt touch target with existing header gap

## Files touched
- `mobile/app/(tabs)/forms.tsx` — fixes 1 + 2
- `mobile/app/(screens)/my-work.tsx` — fix 3
- `mobile/app.json` — v1.0.61, versionCode 183
- `mobile/src/lib/version.ts` — .132p3s
- `frontend/src/lib/version.js` — .132p3s
- `frontend/public/service-worker.js` — .132p3s
