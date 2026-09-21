# .132jm — Coloured Category Icons + LH Stripe on Forms Tiles

## Icon Files

| Category | File | Size | Dimensions |
|---|---|---|---|
| pre_start | `assets/icons/categories/pre_start.png` | 82.4 KB | 256×256 |
| general | `assets/icons/categories/general.png` | 66.3 KB | 256×256 |
| inspection | `assets/icons/categories/inspection.png` | 68.7 KB | 256×256 |
| admin | `assets/icons/categories/admin.png` | 75.1 KB | 256×256 |
| incident | `assets/icons/categories/incident.png` | 66.3 KB | 256×256 |
| swms | `assets/icons/categories/swms.png` | 71.1 KB | 256×256 |
| risk_assessment | `assets/icons/categories/risk_assessment.png` | 56.3 KB | 256×256 |
| site_diary | `assets/icons/categories/site_diary.png` | 54.4 KB | 256×256 |

**Total bundle impact**: ~541 KB (8 PNG icons, 256×256 LANCZOS downscaled from 1024×1024 originals)

## Palette Module

**Path**: `mobile/src/lib/categoryColors.ts`

| Category | Stripe | ChipBg | ChipText | Icon |
|---|---|---|---|---|
| `pre_start` | `#3B82F6` | `#EFF6FF` | `#1D4ED8` | pre_start.png |
| `general` | `#94A3B8` | `#F1F5F9` | `#334155` | general.png |
| `inspection` | `#06B6D4` | `#ECFEFF` | `#0E7490` | inspection.png |
| `admin` | `#94A3B8` | `#F1F5F9` | `#334155` | admin.png |
| `incident` | `#EF4444` | `#FEF2F2` | `#B91C1C` | incident.png |
| `swms` | `#8B5CF6` | `#F5F3FF` | `#6D28D9` | swms.png |
| `risk_assessment` | `#EAB308` | `#FEFCE8` | `#A16207` | risk_assessment.png |
| `site_diary` | `#F59E0B` | `#FFFBEB` | `#B45309` | site_diary.png |
| `plant_pre_start` | `#3B82F6` | `#EFF6FF` | `#1D4ED8` | pre_start.png |
| `hazard` | `#F43F5E` | `#FFF1F2` | `#BE123C` | general.png* |
| `near_miss` | `#F59E0B` | `#FFFBEB` | `#B45309` | general.png* |
| `toolbox` | `#10B981` | `#ECFDF5` | `#047857` | general.png* |
| Fallback | `#94A3B8` | `#F1F5F9` | `#334155` | general.png |

*Uses general.png as placeholder — future categories can get custom icons.

## Tile Design

### Category Card
- `<View style={catCard}>` — white card, `overflow: 'hidden'`, 16px radius
  - `<View style={catStripe}>` — 8dp wide, full height, `backgroundColor: palette.stripe`
  - `<View style={catContent}>` — flex row: Image + text wrap + chevron
    - `<Image source={palette.icon}>` — 48×48, 12px borderRadius
    - Category name in `palette.chipText` colour, form count in grey
    - Chevron arrow

### Search Result Card
- Same LH stripe pattern but 6dp wide (smaller card = thinner stripe)
- Category label uses `palette.chipText` colour

## Contrast Check
All stripe colours are clearly visible against:
- White tile bg (`#FFFFFF`) — high contrast ✅
- Navy body bg (`#1C2C50`) — high contrast ✅
- No per-category width adjustments needed — all 8 stripes read clearly at 8dp

## Fleet Tab
Fleet tab does NOT have category tiles (flat asset list) — skipped as instructed.

## Files Touched
- **New**: `mobile/src/lib/categoryColors.ts` (palette module)
- **New**: `mobile/assets/icons/categories/*.png` (8 icon files)
- **Modified**: `mobile/app/(tabs)/forms.tsx` (CategoryCard + SearchResultCard redesigned)
- **Modified**: `mobile/src/lib/version.ts`, `mobile/app.json` (version bump)

## EAS Build
- **Build ID**: `baa0ccf3-2743-40a6-af5e-9de5e142c333`
- **Profile**: `preview-apk`
- **Commit**: `f4034af1`
