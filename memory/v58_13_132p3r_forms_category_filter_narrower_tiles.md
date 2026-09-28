# .132p3r — Forms tab: category filter dropdown + narrower tiles

## Changes

### 1. Category filter dropdown
- Pill button below search bar: "All categories (n)" or selected category name with coloured dot
- Taps opens bottom-sheet modal listing all CATEGORY_ORDER entries with counts + checkmarks
- Counts respect current search text (AND composition)
- Persisted to `@paneltec:formsLibrary:lastCategory` via AsyncStorage; restored on tab open
- Falls back to "All categories" if persisted category has 0 matches

### 2. Narrower tiles — 2-column grid
- Changed from full-width rows to 2-column flex-wrap grid (width: 48.5%, gap: 8)
- Reduced tile minHeight 68→52, icon wrap 44→32, icon size 22→16
- Reduced font sizes: title 16→13, count 13→11
- Stripe width 4→3, border radius 14→12, padding tightened
- All category colours, icons, and stripe design preserved

### Columns chosen: 2
- 3-column made titles unreadable at 13px on smaller phones
- 2-column compact grid shows ~5-6 categories per screen (up from 4 rows), good density

## Files touched
- `mobile/app/(tabs)/forms.tsx` — both changes
- `mobile/app.json` — v1.0.60, versionCode 182
- `mobile/src/lib/version.ts` — .132p3r
- `frontend/src/lib/version.js` — .132p3r
- `frontend/public/service-worker.js` — .132p3r

## AsyncStorage key
`@paneltec:formsLibrary:lastCategory`
