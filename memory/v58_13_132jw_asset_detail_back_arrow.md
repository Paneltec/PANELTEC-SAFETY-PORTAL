# .132jw — Add Back-Arrow Escape on Asset Detail Header

## Commit
`459ba73e` — 2026-09-21

## EAS Build
`da85a6aa-7cbf-4030-8f81-f56bcec32f98` (preview-apk, v1.0.34 build 156)
Cancelled: `362b2214` (v1.0.33)

## Change
Added `chevron-back` icon (26pt, muted grey) on the left side of the Asset Detail header.

**Before**: `Asset Detail [X]`
**After**: `[←] Asset Detail [X]`

Both buttons call `onClose()` (same dismiss behaviour). Both have 44×44dp minimum tap targets.

## File
`app/(tabs)/fleet.tsx` — lines 527-533 (header row in `AssetDetailSheet`)

## Styles added
- `backBtn`: `{ padding: 4, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }`
- `closeBtn`: updated to match same 44dp target sizing
