# Ship `.132p3o` — Fix Form Templates dropdown count + search filter

## Root cause
**Bug 1 — All categories count wrong**: `counts` (line 2282) was initialised with only 6 hardcoded categories `{ all, incident, inspection, toolbox, near_miss, general }`. All others (pre_start, ssra, swms, risk_assessment, site_diary, hazard, admin, plant_pre_start) were missing → individual counts showed 0 and the total `all` was stale.

**Bug 2 — Search doesn't update counts**: `counts` was computed from `rows` (all templates), not from the search-filtered subset. When user typed a search query, the grid narrowed correctly but the dropdown counts stayed at the unfiltered totals.

## Fix
Replaced the hardcoded category object with a dynamic one derived from `CATEGORIES` array. Both `counts` and `filtered` now share the same search logic (case-insensitive substring on `name + description + category label`). Counts reactively update on every keystroke.

## Files touched
| File | Change |
|------|--------|
| `frontend/src/pages/Forms.jsx` | Rebuilt `counts` + `filtered` useMemo blocks (~12 lines changed) |
| `frontend/src/lib/version.js` | Bumped to v58.13.132p3o |
| `frontend/public/service-worker.js` | Bumped CACHE_VERSION |

No backend changes needed — search is entirely client-side.
