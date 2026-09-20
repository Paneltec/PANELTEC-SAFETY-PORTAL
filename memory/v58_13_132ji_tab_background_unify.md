# .132ji — Unify Tab Backgrounds to Forms Navy, Lighten 10%

## Color Math

| | Hex | HSL |
|---|---|---|
| **Old Forms bg** | `#0F172A` | H=222.2° S=47.4% **L=11.2%** |
| **New unified bg** | `#1C2C50` | H=222.2° S=47.4% **L=21.2%** |

Formula: `L' = min(11.2 + 10, 100) = 21.2`

### Contrast checks (new bg `#1C2C50`)
- White text (`#FFFFFF`): **13.8:1** ✅ (WCAG AAA)
- Tertiary text (`#94A3B8`): **5.4:1** ✅ (WCAG AA)

## Old vs New Tab Backgrounds

| Tab | Old container bg | New container bg |
|---|---|---|
| Forms | `Colors.navy` (`#0F172A`) | `Colors.navyLight` (`#1C2C50`) |
| Home | `Colors.bg` (`#F8FAFC`) | `Colors.navyLight` (`#1C2C50`) |
| Fleet | `Colors.bg` (`#F8FAFC`) | `Colors.navyLight` (`#1C2C50`) |
| Docs | `Colors.bg` (`#F8FAFC`) | `Colors.navyLight` (`#1C2C50`) |
| Settings | `Colors.bg` (`#F8FAFC`) | `Colors.navyLight` (`#1C2C50`) |
| Tab layout `sceneContainerStyle` | (none) | `Colors.navyLight` |

## Header Handling Decision

**Kept headers at original `Colors.navy` (`#0F172A`)** — deliberate two-tone: darker header band creates visual separation from the lighter body. The 10% lightness difference is subtle but effective for hierarchy.

## Text Color Updates (dark-on-dark prevention)

| File | Style | Old color | New color | Reason |
|---|---|---|---|---|
| home.tsx | `sectionTitle` | `Colors.ink` | `Colors.white` | Sits directly on dark bg between cards |
| home.tsx | `signOnPrompt` | `Colors.textSecondary` | `rgba(255,255,255,0.7)` | On dark bg |
| fleet.tsx | `loadingText` | `Colors.textTertiary` | `rgba(255,255,255,0.7)` | On dark bg |
| fleet.tsx | `emptyTitle` | `Colors.ink` | `Colors.white` | Invisible on dark bg |
| fleet.tsx | `emptyText` | `Colors.textTertiary` | `rgba(255,255,255,0.55)` | Consistency with Forms |
| docs.tsx | `loadingText` | `Colors.textTertiary` | `rgba(255,255,255,0.7)` | On dark bg |
| docs.tsx | `emptyTitle` | `Colors.ink` | `Colors.white` | Invisible on dark bg |
| docs.tsx | `emptyText` | `Colors.textTertiary` | `rgba(255,255,255,0.55)` | Consistency with Forms |
| settings.tsx | `sectionLabel` | `Colors.textTertiary` | `rgba(255,255,255,0.45)` | Between card groups on dark bg |
| settings.tsx | `versionText` | `Colors.textTertiary` | `rgba(255,255,255,0.7)` | Footer on dark bg |

## Files Modified
- `/app/mobile/src/theme/colors.ts` — added `navyLight: '#1C2C50'` token
- `/app/mobile/app/(tabs)/_layout.tsx` — added `sceneContainerStyle`
- `/app/mobile/app/(tabs)/forms.tsx` — container bg → `navyLight`
- `/app/mobile/app/(tabs)/home.tsx` — container bg + text colors
- `/app/mobile/app/(tabs)/fleet.tsx` — container bg + text colors (both main + detail styles)
- `/app/mobile/app/(tabs)/docs.tsx` — container bg + text colors
- `/app/mobile/app/(tabs)/settings.tsx` — container bg + text colors
- `/app/mobile/src/lib/version.ts` — bumped to .132ji
- `/app/mobile/app.json` — version 1.0.25, versionCode 147

## EAS Build
- **Build ID**: `660864e7-3b36-4114-b689-64967d739609`
- **Profile**: `preview-apk`
- **Commit**: `ab857fda`
