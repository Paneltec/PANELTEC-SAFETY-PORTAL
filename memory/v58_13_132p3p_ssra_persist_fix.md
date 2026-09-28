# Ship `.132p3p` — Fix SSRA category not persisting on form template update

## Root cause: **B** — `ALLOWED_CATEGORIES` in `backend/forms.py` line 82
The SSRA slug was added to the UI (`.132p3n`) but not to `ALLOWED_CATEGORIES` in `backend/forms.py`. The `_norm_category()` function (line 148) silently coerces any unknown category to `"general"`, so PATCH requests with `category: "ssra"` were written as `"general"`.

## Fix
Added `"ssra"` to `ALLOWED_CATEGORIES` set in `backend/forms.py` (2 lines).

## Curl verification
```
PATCH /api/forms/templates/<id> {"category":"ssra"} → category: "ssra" ✓
GET   /api/forms/templates/<id>                      → category: "ssra" ✓
```

## Files touched
- `backend/forms.py` — added `"ssra"` to `ALLOWED_CATEGORIES` (2 lines)
- `frontend/src/lib/version.js` — bumped to v58.13.132p3p
- `frontend/public/service-worker.js` — bumped CACHE_VERSION
