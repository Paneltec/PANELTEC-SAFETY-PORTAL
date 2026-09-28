# Ship `.132p3q` — SSRA deep persistence investigation

## Every write endpoint for form templates
1. `POST /api/forms/templates` (line 1039) — create. Uses `_norm_category()`.
2. `PATCH /api/forms/templates/{id}` (line 1064) — update. Uses `_norm_category()`.
Both call the SAME `_norm_category()` at line 148, which checks `ALLOWED_CATEGORIES`.

## Every place "general" is used as a fallback
- `forms.py:150` — `_norm_category()`: `return c if c in ALLOWED_CATEGORIES else "general"` — the ONLY coercion point. `.132p3p` already added `"ssra"` to this set.
- `forms.py:1045` — create endpoint: `_norm_category(body.category)` — calls same function.
- `forms.py:1072` — update endpoint: `_norm_category(payload["category"])` — calls same function.
- `asset_service.py:584` — asset category inference, NOT form template writes.

## Root cause
**The `.132p3p` backend fix WAS correct.** `"ssra"` was added to `ALLOWED_CATEGORIES` and both curl AND the actual browser UI round-trip work:

1. PATCH `{"category":"ssra"}` → response: `category: "ssra"` ✓
2. GET after PATCH → `category: "ssra"` ✓
3. Full Playwright UI test: edit template → select SSRA → save → toast "Saved Drain Cleaning SSRA" → card shows SSRA pill ✓

The user's "still reverting" was caused by **stale service worker cache** serving the pre-`.132p3n` JS bundle (when SSRA wasn't in the frontend dropdown at all). The version bump in this ship forces cache invalidation.

## User instructions
If the user still sees the old behaviour after this deploy:
1. Hard refresh: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
2. Or: DevTools → Application → Service Workers → Unregister, then reload

## Files touched
- `frontend/src/lib/version.js` — bumped to v58.13.132p3q (forces cache bust)
- `frontend/public/service-worker.js` — bumped CACHE_VERSION
