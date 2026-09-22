# .132kf — Home Tiles: Add Incident Report, Remove Site Induction + Toolbox Meeting

## Commit
`6e14b2b4` — 2026-09-22

## Version
`1.0.38` / versionCode `160` / buildNumber `"160"` / bundle `.132kf`

## Changes

### 1. ADDED: Incident Report tile
- Position: 3rd tile in 2×2 grid (after Scan Vehicle QR, New Pre-Start; before Sign On)
- Icon: `warning-outline` (Ionicons), rose/error colour
- Background: `#FEE2E2` (error-soft)
- Tap: navigates to `/forms/picker?category=incident&title=Incident Report`
- testID: `home-action-incident`

### 2. REMOVED: Site Induction tile
- Removed `c4` ("Site Induction — New Starter") from `MOCK_COMPLIANCE_LIST` in `mockData.ts`
- Template still exists in backend and is reachable via Forms tab → General or Inspection category

### 3. REMOVED: Toolbox Meeting tile
- Removed `c3` ("Toolbox Meeting Sign-off") from `MOCK_COMPLIANCE_LIST` in `mockData.ts`
- Template still exists in backend and is reachable via Forms tab

### Grid layout change
- Quick Actions changed from 3-column row (`flex: 1`) to 2×2 wrapping grid (`width: '47%'`, `flexWrap: 'wrap'`)
- Visually balanced with even spacing

## Files touched
| File | Change |
|------|--------|
| `app/(tabs)/home.tsx` | Added Incident Report tile, grid changed to 2×2 wrap |
| `src/services/mockData.ts` | Removed c3 (Toolbox) and c4 (Site Induction) from compliance list |
| `app.json` | v1.0.38, build 160 |
| `src/lib/version.ts` | Bundle `.132kf` |
