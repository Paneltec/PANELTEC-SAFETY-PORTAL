# Ship Memo — v58.13.132jb: Mobile UX Overhaul

## Date: 2026-09-19
## Version: 1.0.19 / versionCode 141
## Bundle: paneltec-v160.3.9.58.13.132jb

## Summary

Complete UX restructure to make the app feel like a native phone app with proper bottom tab navigation, larger tap targets, mobile typography, and haptic feedback.

## Changes

### 1. Bottom Tab Navigation (5 tabs)
Restructured from 6-tab layout to a clean 5-tab bar:
1. **Home** — Dashboard with intelligence briefing, quick actions, compliance list, assignments
2. **Forms** — All 40+ form templates grouped by category (General, SWMS, Pre-Start, Inspection, etc.)
3. **Fleet** — Real fleet register from `GET /api/fleet/register` (50 assets), search, tap for detail modal, "Start Pre-Start" CTA
4. **Docs** — Real document library from `GET /api/document-library/folders`, nested folder navigation with breadcrumbs, file browser
5. **Settings** — Profile card, profile sub-screens (Personal Info, Certifications, Inductions, ID Card), My Records, Ask AI, Check for Updates, Admin Role Simulator, Sign Out

Moved non-tab screens (QR Scan, My Work, Ask AI, Outbox) to `(screens)` route group — accessible via deep links and navigation but not in the tab bar.

### 2. Fleet Tab — Real Data
- Calls `GET /api/fleet/register` — returns 50 assets (Volvo Tipper, Colorado Utility, Komatsu PC200, etc.)
- Search by name/rego/category
- Status pills (Active/Maintenance/Overdue)
- Pull-to-refresh
- Tap → detail modal with asset specs + "Start Pre-Start on This" button
- **Finding re: "only Cat 320 visible" bug**: Forms tab shows 15 Pre-Start templates, Fleet tab shows 50 assets. The "Cat 320 only" issue was likely about the QR Pre-Start screen (`qr-scan.tsx`) which hardcoded "CAT 320 Excavator" as the default asset name, not a filtering issue.

### Fleet API Response (logged for debugging)
```
[fleet] Fetched 50 assets from /api/fleet/register
```
Assets include: Volvo Tipper, Civil Service Truck, Colorado Service Utility, CAT 320 Excavator, Komatsu PC200, etc.

### 3. Docs Tab — Real Data
- Calls `GET /api/document-library/folders` — returns folders: SDS (312 files), Uncategorised (2), Administration, Compliance & Safety, Work, Training & Competency, IMS, Archives
- Nested navigation with breadcrumbs
- Files in folder via `GET /api/document-library/folders/{id}/files`
- Subfolders via `GET /api/document-library/folders/{id}/subfolders`
- Search within current folder
- Pull-to-refresh

### 4. Typography & Tap Targets
- Body text: 14-16pt (up from 11-13pt)
- Section headings: 18pt (up from 15pt)
- Card min-height: 56-72dp (up from none)
- List rows: min 56dp height with larger padding
- Action tiles: min 100dp height, 52dp icons (up from 48dp)
- Button touch targets: ≥48dp

### 5. Haptic Feedback
- `src/services/haptics.ts`: Light, Medium, Success, Warning, Error haptics
- Light impact on tab bar switch
- Medium impact on form submit success, role simulator change
- Warning on sign-out tap
- Skipped on web (Platform.OS check)

### 6. Settings Tab Consolidation
Merged old Profile tab content into Settings:
- Profile card with avatar, name, role, email
- PROFILE section: Personal Info, Certifications, Inductions, ID Card (deep links to `/profile/*`)
- APP section: My Records, Ask AI (deep links to `/(screens)/*`)
- Check for Updates (v1.0.19 · build 141, blue update dot indicator)
- Admin Role Simulator (preserved from .132ja)
- Sign Out with native modal confirmation

### 7. Routing Restructure
- `(tabs)/` — 5 visible tabs + profile (href:null)
- `(screens)/` — New route group for non-tab screens: qr-scan, my-work, ask-ai, outbox
- Root `_layout.tsx` — Added `(screens)` Stack.Screen

## EAS Build
- Build ID: `aa00d522-fba3-4cd0-92b5-cff68a064a64`
- Profile: preview-apk
- Version: 1.0.19 / versionCode 141
- Status: IN PROGRESS

## Files Touched

### New Files
- `mobile/app/(tabs)/docs.tsx` — Document library tab
- `mobile/app/(tabs)/settings.tsx` — Settings/profile tab
- `mobile/app/(screens)/_layout.tsx` — Screens group layout
- `mobile/src/services/haptics.ts` — Haptic feedback helpers

### Modified Files
- `mobile/app/(tabs)/_layout.tsx` — 5-tab layout, haptic listeners
- `mobile/app/(tabs)/home.tsx` — Typography, tap targets, route fixes
- `mobile/app/(tabs)/forms.tsx` — Typography, tap targets
- `mobile/app/(tabs)/fleet.tsx` — Full rewrite with real API
- `mobile/app/(tabs)/my-work.tsx` — Typography, tap targets
- `mobile/app/_layout.tsx` — Added (screens) route group
- `mobile/app.json` — Version 1.0.19, versionCode 141
- `mobile/src/lib/version.ts` — 132jb

### Moved Files
- `(tabs)/qr-scan.tsx` → `(screens)/qr-scan.tsx`
- `(tabs)/outbox.tsx` → `(screens)/outbox.tsx`
- `(tabs)/my-work.tsx` → `(screens)/my-work.tsx`
- `(tabs)/ask-ai.tsx` → `(screens)/ask-ai.tsx`

## Data Sources
- **Forms tab**: `GET /api/forms/templates` — 40 templates, 8 categories
- **Fleet tab**: `GET /api/fleet/register` — 50 assets
- **Docs tab**: `GET /api/document-library/folders`, `GET /api/document-library/folders/{id}/subfolders`, `GET /api/document-library/folders/{id}/files`
- **Settings**: `GET /api/auth/me` + stored user data

## Notes
- Previous build `6604e1b3` (.132ja) was superseded by this build
- Sentry auto-upload remains disabled in both `preview` and `preview-apk` profiles
- "Cat 320 only" issue is NOT a backend filter problem — all 50 fleet assets and 15 pre-start templates are returned. The issue was the QR pre-start screen hardcoding the asset name.
