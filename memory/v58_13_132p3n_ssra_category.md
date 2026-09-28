# Ship `.132p3n` — Add SSRA form category

## Category list (before → after)
**Before**: General, SWMS, Pre-Start, Inspection, Hazard, Near Miss, Incident, Risk Assessment, Site Diary, Toolbox, Admin Only
**After**: General, SWMS, Pre-Start, Inspection, Hazard, Near Miss, Incident, Risk Assessment, **SSRA**, Site Diary, Toolbox, Admin Only

Slug: `ssra` · Label: `SSRA` · Colour: **teal** (`#0D9488` stripe / `#CCFBF1` bg / `#115E59` text)

## Files touched (8 files, ~18 lines added)
| File | Change |
|------|--------|
| `mobile/src/services/forms.ts` | Added SSRA to `CATEGORY_ORDER` after risk_assessment |
| `mobile/src/lib/categoryColors.ts` | Added `ssra` to `CATEGORY_PALETTE` (teal) |
| `mobile/src/components/CategoryIcon.tsx` | Added `ssra` SVG icon (shield + lock) |
| `mobile/src/lib/version.ts` | Bumped to .132p3n |
| `frontend/src/pages/Forms.jsx` | Added SSRA to `CATEGORIES` after Pre-Start |
| `frontend/src/lib/version.js` | Bumped to .132p3n |
| `frontend/public/service-worker.js` | Bumped CACHE_VERSION |
| `backend/mobile_data.py` | Added `ssra` to `CATEGORY_LABELS` |

## Mobile tile colour
Teal — `#0D9488` stripe, `#CCFBF1` soft bg, `#115E59` text. Distinct from all 11 existing tiles.
