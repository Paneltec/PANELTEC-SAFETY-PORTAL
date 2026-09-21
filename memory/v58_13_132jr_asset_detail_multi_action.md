# .132jr — Asset Detail Multi-Action + Pre-Start Routing Fix + Kill Hardcoded Defaults

## Root Cause: Broken Pre-Start Button

The "Start Pre-Start on This" button in the Asset Detail sheet navigated to `/(screens)/qr-scan` — the QR barcode scanner screen. No asset context was passed. The QR screen then hardcoded `setAssetName('CAT 320 Excavator')` regardless of which asset was tapped.

**Before**: Tap asset → Open detail → "Start Pre-Start" → Opens QR scanner → Hardcodes "CAT 320 Excavator"
**After**: Tap asset → Open detail → Pick action → Category-filtered template picker with asset context → Open form with vehicle fields prefilled

## Actions Rendered (5/5 — all have matching templates)

| Action | Category/Filter | Templates matched | Icon | Stripe colour |
|---|---|---|---|---|
| Start Pre-Start | `pre_start` | 15 | clipboard-outline | #3B82F6 (blue) |
| Start a Service | name: `service\|maintenance\|equipment\|pre-operation\|pre-use` | 2+ | construct-outline | #10B981 (emerald) |
| Conduct Inspection | `inspection` | 4 | search-outline | #06B6D4 (cyan) |
| Report a Hazard | `incident` | 3 (incl. Hazard Reporting Form) | warning-outline | #EF4444 (red) |
| Add Site Diary Entry | `site_diary` | 1 | book-outline | #F59E0B (amber) |

Actions with zero matching templates are automatically hidden (none currently hidden — all categories populated).

## New Picker Screen

**Path**: `mobile/app/forms/picker.tsx` (NEW)

- File-based route at `/forms/picker`
- Accepts query params: `category`, `nameFilter`, `assetId`, `assetName`, `assetRego`, `assetTag`, `assetNavixyId`, `title`
- Shows filtered template list with LH colour stripes (reuses `categoryPalette()`)
- Asset context banner at top shows "for Volvo Tipper FM12 6 x 4 · A18DC · Tipper"
- Search bar (if >3 templates)
- Tap template → opens Form Runner with asset context forwarded

## Prefill in Form Runner

Field-name matching is **case-insensitive, underscore/space-stripped**:

| Pattern (normalized) | Prefill value | Field types matched |
|---|---|---|
| `vehicle_navixy` (field type) | `{ label, registration, id }` | The Navixy fleet picker widget |
| `rego\|registration\|plate\|vehiclereg` | `assetRego` | Text inputs |
| `vehiclename\|assetname\|equipment\|machine\|plantid\|plantname` | `assetName` | Text inputs |
| `\btag\b` | `assetTag` | Text inputs |

Fields are only prefilled if currently empty. Worker can override any prefilled value.

## Hardcoded Defaults Killed

| File | Line | Old value | New value |
|---|---|---|---|
| `app/(screens)/qr-scan.tsx` | 51 | `setAssetName('CAT 320 Excavator')` | `setAssetName('')` |
| `src/services/mockData.ts` | 68 | `title: 'CAT 320 Excavator'` | `title: 'Heavy Equipment Pre-Start'` |

## Files Modified
- **New**: `app/forms/picker.tsx` — Template picker with category filter + asset context
- **Modified**: `app/(tabs)/fleet.tsx` — AssetDetailSheet multi-action tiles
- **Modified**: `app/forms/[id]/index.tsx` — Asset context prefill logic
- **Modified**: `app/(screens)/qr-scan.tsx` — Killed CAT 320 hardcode
- **Modified**: `src/services/mockData.ts` — Killed CAT 320 hardcode
- **Modified**: `src/lib/version.ts`, `app.json` — v1.0.31 / build 153

## EAS Build
- **Build ID**: `cbabfe3f-02b5-41ae-b0db-660b184fd6c5`
- **Profile**: `preview-apk`
- **Commit**: `ad63f64f`
