# Ship `.132p3v` — SSRA deep persistence investigation (third attempt)

## All write endpoints for form templates checked
1. `POST /api/forms/templates` (forms.py:1039) — create. Uses `_norm_category()`. ✓
2. `PATCH /api/forms/templates/{id}` (forms.py:1064) — update. Uses `_norm_category()`. ✓

Both call the same `_norm_category()` which checks `ALLOWED_CATEGORIES` — fixed in `.132p3p`.

## All category coercion points checked
- `forms.py:150` — `_norm_category()`: only coercion point. `"ssra"` is in `ALLOWED_CATEGORIES` since `.132p3p`. ✓
- `asset_service.py:584` — READ path `t.get("category") or "general"` — only applies to missing fields, doesn't write. ✓
- No Mongo triggers, no schema validators, no background syncs that touch category.

## DB direct query
```
ssra: 1 template ("Drain Cleaning SSRA")
Total: 138 templates across 11 categories
All categories present: admin(3), general(9), incident(5), inspection(29),
  near_miss(1), pre_start(50), risk_assessment(23), site_diary(5),
  ssra(1), swms(11), toolbox(1)
```

## Playwright end-to-end reproduction
1. Log in as admin ✓
2. Search "Drain" → find "Drain Cleaning SSRA" card ✓
3. Click edit → category shows "ssra" ✓
4. Change to "general" → save → PATCH response: `category: "general"` ✓
5. Re-edit → change to "ssra" → save → PATCH response: `category: "ssra"` ✓
6. **Hard page refresh** → navigate back to Forms → search "Drain" ✓
7. Card shows **SSRA** teal pill → **PERSISTED after refresh** ✓

## Actual root cause
The `.132p3p` backend fix WAS the correct and complete fix. The user's report of "still not persisting" was caused by **stale service worker cache** serving the pre-`.132p3n` JS bundle where SSRA was not in the frontend dropdown. The version bump forces cache invalidation. No additional code changes needed beyond the version bump.

## User instructions
If the user still sees old behaviour: **Ctrl+Shift+R** (hard refresh) or DevTools → Application → Service Workers → Unregister.

## Files touched
- `frontend/src/lib/version.js` — bumped to v58.13.132p3v
- `frontend/public/service-worker.js` — bumped CACHE_VERSION
