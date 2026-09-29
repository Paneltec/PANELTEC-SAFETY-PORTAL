# .132p3u — Fix SSRA missing from mobile Forms dropdown and view

## Root cause: E — zero templates tagged "ssra" in backend
- SSRA category was correctly defined in CATEGORY_ORDER, CATEGORY_PALETTE, CategoryIcon
- The dropdown modal already mapped CATEGORY_ORDER and showed SSRA (dimmed at opacity 0.35)
- BUT `groupByCategory()` in forms.ts filtered out categories with 0 forms — so SSRA tile never rendered
- AND `effectiveCat` fell back to null when persisted category had 0 matches — so selecting SSRA from dropdown immediately reset to "All categories"

## Fix (2 lines changed)
1. `forms.ts` groupByCategory: removed `(byKey[cat.key] || []).length > 0` filter — all CATEGORY_ORDER entries now render (empty categories show with 0 count)
2. `forms.tsx` effectiveCat: changed from count-based check to CATEGORY_ORDER membership check — selecting SSRA stays selected even with 0 forms

## Files touched
- `mobile/src/services/forms.ts` — groupByCategory filter fix
- `mobile/app/(tabs)/forms.tsx` — effectiveCat fallback fix
- `mobile/app.json` — v1.0.63, versionCode 185
- `mobile/src/lib/version.ts` — .132p3u
- `frontend/src/lib/version.js` — .132p3u
- `frontend/public/service-worker.js` — .132p3u
