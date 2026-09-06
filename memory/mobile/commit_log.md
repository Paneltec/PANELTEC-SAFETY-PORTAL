# Mobile Commit Log

## Iteration M4 — v58.13.132d Reconciliation
- **Commit**: 1e2cdafe88669c86e477767998e5462600564c5a
- **Date**: 2026-09-06
- **Changes**: M4 Part A (audit + reconcile M3) + Part B (sites + home UI on existing endpoints)
- **Files modified**: server.py, mobile_home.py, sites.ts, sites.tsx, home.tsx, step4.tsx, _layout.tsx
- **Web files referenced**: sites_qr.py, sites_signon_v127.py, visitor_signins.py, mobile_modules_data.py

## Iteration M5 — v58.13.132e Capture Modules
- **Commit**: 1e2cdafe88669c86e477767998e5462600564c5a (same base, new files added)
- **Date**: 2026-09-06
- **Changes**:
  - Discovery doc: `/app/memory/v58_13_132e_capture_endpoints.md`
  - Shared infra: `capture.ts`, `CaptureList.tsx`, `PhotoCapture.tsx`
  - 15 new screen files across 5 modules (hazards, incidents, prestarts, site-diary, inspections)
  - Backend models extended with `status` field for draft support
  - Tab "Report" renamed to "Hazards" in `_layout.tsx`
  - Root `_layout.tsx` updated with 5 new stack screens
  - Home `KNOWN_ROUTES` updated for 5 capture modules
  - Version bump mobile_home.py to .132e
  - Backend tests: 8 new in test_v58_13_132e_capture.py
- **Files modified**:
  - `/app/mobile/src/services/capture.ts` (new)
  - `/app/mobile/src/components/CaptureList.tsx` (new)
  - `/app/mobile/src/components/PhotoCapture.tsx` (new)
  - `/app/mobile/app/(tabs)/report.tsx` (rewritten — hazards list)
  - `/app/mobile/app/(tabs)/prestart.tsx` (rewritten — pre-starts list)
  - `/app/mobile/app/(tabs)/home.tsx` (KNOWN_ROUTES updated)
  - `/app/mobile/app/(tabs)/_layout.tsx` (tab renamed)
  - `/app/mobile/app/_layout.tsx` (5 new stack screens)
  - `/app/mobile/app/hazards/new.tsx` (new)
  - `/app/mobile/app/hazards/[id].tsx` (new)
  - `/app/mobile/app/incidents/index.tsx` (new)
  - `/app/mobile/app/incidents/new.tsx` (new)
  - `/app/mobile/app/incidents/[id].tsx` (new)
  - `/app/mobile/app/prestarts/index.tsx` (new)
  - `/app/mobile/app/prestarts/new.tsx` (new)
  - `/app/mobile/app/prestarts/[id].tsx` (new)
  - `/app/mobile/app/site-diary/index.tsx` (new)
  - `/app/mobile/app/site-diary/new.tsx` (new)
  - `/app/mobile/app/site-diary/[id].tsx` (new)
  - `/app/mobile/app/inspections/index.tsx` (new)
  - `/app/mobile/app/inspections/new.tsx` (new)
  - `/app/mobile/app/inspections/[id].tsx` (new)
  - `/app/backend/models.py` (status field additions)
  - `/app/backend/mobile_home.py` (version bump)
  - `/app/tests/backend_unit/test_v58_13_132e_capture.py` (new)
- **Web files referenced**: crud.py, models.py, ai.py, dashboard.py (files_router)


## Iteration M5f — v58.13.132f Styling Audit
- **Commit**: 1e2cdafe88669c86e477767998e5462600564c5a
- **Date**: 2026-09-06
- **Changes**:
  - Home: 6 primary tiles in 3×2 grid + "More modules" collapsible section (13 remaining)
  - Hazards New: 6 category tiles with colour-coded left borders (mockup #3)
  - Pre-Start New: Tri-state toggles (green ✓/red ✕/grey N/A) + progress bar (mockup #4)
  - Inspections New: Same tri-state toggles + score bar
  - All headers: Navy `#0F172A` bg with white text
  - All cards: White surface with iOS 17 soft shadow (16-18px radius)
  - Tab bar: Orange active tint, slate-400 inactive
  - Theme: Added `slate400`, `muted` tokens to colors.ts
  - Version bump mobile_home.py to .132f
- **Files modified**: home.tsx, _layout.tsx (tabs), hazards/new.tsx, prestarts/new.tsx, inspections/new.tsx, colors.ts, mobile_home.py


## Iteration M6 — v58.13.132g Profile Tab + Device Frames
- **Commit**: 1e2cdafe88669c86e477767998e5462600564c5a
- **Date**: 2026-09-06
- **Changes**:
  - Discovery doc: `/app/memory/v58_13_132g_profile_endpoints.md`
  - Built `app/(tabs)/profile.tsx` — Full profile screen with 5 sections:
    - Header (avatar initials, name, position, company chip)
    - Contact Details card
    - My Certifications (14 certs, status pills, "See all" link)
    - My SWMS (filtered by worker_id, empty state when none assigned)
    - My Fleet (50 assets from fleet register with km/hrs meters)
    - Payroll stub (MOCKED — "Coming Soon" badge)
    - Sign Out button + footer
  - Created `src/services/profile.ts` — API client (fetchWorkerProfile, fetchMySwms, fetchFleetRegister, fetchFleetAssetDetail)
  - Created `app/profile/_layout.tsx` — Stack navigation for detail screens
  - Created `app/profile/certifications/[id].tsx` — Cert detail with status banner
  - Created `app/profile/swms/[id].tsx` — SWMS document detail view with PPE grid
  - Created `app/profile/fleet/[id].tsx` — Fleet asset detail with Navixy counters (odo, hours, spend, compliance)
  - Updated `app/_layout.tsx` — Added profile stack screen
  - Generated 12 device-framed screenshots (390×844, iPhone 14 Pro frame via ImageMagick)
  - Screenshots saved to `/app/mobile/assets/device-frames/`
- **Files modified**:
  - `/app/mobile/src/services/profile.ts` (new)
  - `/app/mobile/app/(tabs)/profile.tsx` (rewritten)
  - `/app/mobile/app/profile/_layout.tsx` (new)
  - `/app/mobile/app/profile/certifications/[id].tsx` (new)
  - `/app/mobile/app/profile/swms/[id].tsx` (new)
  - `/app/mobile/app/profile/fleet/[id].tsx` (new)
  - `/app/mobile/app/_layout.tsx` (updated)
  - `/app/mobile/assets/device-frames/` (12 PNG files)
  - `/app/memory/v58_13_132g_profile_endpoints.md` (new)
- **Web files referenced**: workers.py, worker_certifications.py, swms_extras.py, fleet.py, crud.py, models.py


## Iteration M6-reset — v58.13.132h Categorised Forms Library
- **Commit**: 81e880327c65540ef5b45fc5bc1591674a09989b
- **Date**: 2026-09-06
- **Changes**:
  - DIRECTION CORRECTION: M5 fragmented tabs were wrong; replaced with categorised Forms library
  - Replaced 5-tab layout with 4-tab: Home / Forms / Sites / Profile
  - Built `app/(tabs)/forms.tsx` — categorised form template list with search, 7 category sections
  - Built `app/forms/[id].tsx` — form runner with native field rendering + submission
  - Built `app/forms/_layout.tsx` — stack navigation for form runner
  - Built `src/services/forms.ts` — API client (fetchFormTemplates, submitForm, groupByCategory, etc.)
  - Rewritten `app/(tabs)/_layout.tsx` — 4-tab layout
  - Updated `app/(tabs)/home.tsx` — pruned tile grid to Forms/Sites/Profile
  - Updated `app/_layout.tsx` — removed old M5 stack screens, added forms stack
  - Archived M5 files to `_archived_m5_wrong_approach/`
  - Version bumped .132g → .132h across all 3 canonical files
  - Published 6 device-framed screenshots + index.html
  - Created `test_v58_13_132h_forms.py` — 6/6 passing
- **Files modified**: 10+ files (see commit diff)
- **Web files referenced**: Forms.jsx, RoleFormsSection.jsx, forms.py, org_settings.py
