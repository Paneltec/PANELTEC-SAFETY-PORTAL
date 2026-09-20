# Ship Memo — v58.13.132jc: Wire Forms Tab to Form-Filling Screens

## Date: 2026-09-20
## Version: 1.0.20 / versionCode 142
## Bundle: paneltec-v160.3.9.58.13.132jc

## Root Cause

The Forms tab was already correctly wired for ALL categories except **SWMS**. 

### Routing table (category → destination)

| Category | Tap Category Card | Tap Form Card | Status |
|---|---|---|---|
| General (11 templates) | `/forms/category/general` | `/forms/[id]` (Form Runner) | ✅ Already worked |
| Pre-Start (15) | `/forms/category/pre_start` | `/forms/[id]` | ✅ Already worked |
| SWMS (2) | `/forms/category/swms` | **`/forms/[id]`** (FIXED) | ✅ **Fixed in .132jc** |
| Inspection (4) | `/forms/category/inspection` | `/forms/[id]` | ✅ Already worked |
| Incident (3) | `/forms/category/incident` | `/forms/[id]` | ✅ Already worked |
| Risk Assessment (1) | `/forms/category/risk_assessment` | `/forms/[id]` | ✅ Already worked |
| Site Diary | `/forms/category/site_diary` | `/forms/[id]` | ✅ Already worked |
| Toolbox | `/forms/category/toolbox` | `/forms/[id]` | ✅ Already worked |
| Admin | `/forms/category/admin` | `/forms/[id]` | ✅ Already worked |

### What was broken

**SWMS templates** were routed to `/profile/swms/[id]` — a path that **DOES NOT EXIST** in the mobile app. This caused a silent navigation failure (blank screen or redirect to root).

### Fix

Changed SWMS routing to use the standard form runner at `/forms/[id]` — same as every other template category. The form runner dynamically fetches the template by ID and renders all field types.

Two files patched:
1. `/app/mobile/app/forms/category/[key].tsx` — Category detail: form card tap handler
2. `/app/mobile/app/(tabs)/forms.tsx` — Forms tab: search result tap handler

### Generic form renderer

Already exists at `/app/mobile/app/forms/[id]/index.tsx` — handles ALL template field types dynamically:
- text, textarea, number, date, time, select, radio
- photo, signature, gps, compliance
- worker_picker, vehicle_navixy, customer_picker, site_picker, job_picker, asset_scan, contact_picker
- Fill → Review → Submit flow with progress bar
- Draft persistence via AsyncStorage

**No generic renderer needed to be built** — it was already complete.

### Categories that use dedicated screens vs generic renderer

**ALL categories** use the same generic form runner at `/forms/[id]`. There are no category-specific dedicated screens. The form runner is fully dynamic and handles everything.

### Categories that failed to wire

**None.** All 40 templates across 8 categories now route correctly.

## EAS Build
- Build ID: `0d8db108-d2e8-4ecf-aa39-2cf1e92062ff`
- Profile: preview-apk
- Version: 1.0.20 / versionCode 142
- Status: IN PROGRESS

## Files Touched
- `mobile/app/(tabs)/forms.tsx` — Fixed SWMS search result routing
- `mobile/app/forms/category/[key].tsx` — Fixed SWMS category list routing
- `mobile/app.json` — Version 1.0.20, versionCode 142
- `mobile/src/lib/version.ts` — 132jc
