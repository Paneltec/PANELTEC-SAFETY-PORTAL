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


## Iteration M6i — v58.13.132i Profile: Worker Self-View
- **Commit**: e298ffbf3fa5b08866832544e64ceaedf5760572
- **Date**: 2026-09-06
- **Changes**:
  - Profile hub restructured: 8 nav rows
  - Personal Info screen: inline editable (whitelisted fields), NOK, emergency contact
  - Certifications list: full cert list with status pills, tap → detail
  - Inductions list: grouped by category from /api/workers/inductions/matrix
  - ID Card: digital wallet front+back with real QR from backend
  - Backend: PATCH /api/me/worker-profile (self-edit + worker_change_log audit trail)
  - Non-whitelisted field rejection verified
  - 5 device-framed screenshots published
  - 7/7 pytest passing + 6/6 M6h tests still green (13 total)
  - Version bumped .132h → .132i
- **Files modified**: workers.py (backend), 6 mobile screens, profileExtended.ts, _layout.tsx, version files
- **Web files referenced**: workers.py, workers_inductions.py, workers_qr.py

## Iteration 6 — v58.13.132cj: Mobile Onboarding Rewrite
- **Commit**: 4331ea2
- **Date**: 2026-09-09
- **Changes**:
  - Eliminated division picker ("Choose Paneltec Civil / Viatec Traffic") from launch
  - New QR-scan device provisioning screen (welcome.tsx → QR/manual device_id entry)
  - New PIN login screen hitting POST /api/auth/mobile/pin-login with 401/429 handling
  - Role auto-detected from backend response (admin/paneltec_civil/viatec_traffic/external_contractor)
  - 4 role-based home screen landings with filtered module grids
  - Sentry native DISABLED (enableNative: false) — crash-avoidance strategy
  - Session token in expo-secure-store (native) / AsyncStorage (web)
  - Logout clears session but preserves device_id (→ back to PIN screen)
  - Removed dead auth files: onboarding.tsx, login.tsx
  - 5 device-framed screenshots: QR setup, PIN entry, PIN error, admin home, viatec home
  - Version bumped .132ba → .132cj (mobile), .132ci → .132cj (web+SW)
  - Ship memo: /app/memory/v58_13_132cj_mobile_onboarding_rewrite_shipped_finish_deferred.md
- **Files modified**:
  - app/_layout.tsx (rewrite — Sentry native disabled)
  - app/index.tsx (rewrite — splash routing)
  - app/(auth)/welcome.tsx (rewrite — QR provisioning)
  - app/(auth)/pin-entry.tsx (rewrite — PIN login)
  - app/(auth)/login.tsx (DELETED)
  - app/(auth)/onboarding.tsx (DELETED)
  - app/(tabs)/home.tsx (rewrite — role-based landing)
  - app/(tabs)/profile.tsx (modified — logout → clearSession)
  - src/services/auth.ts (rewrite — pinLogin, session management)
  - src/lib/version.ts (bump)
  - frontend/src/lib/version.js (bump + changelog)
  - frontend/public/service-worker.js (bump)
  - backend/mobile_home.py (version comment)
- **Web files referenced**: None (backend contract from .132ci)

## Iteration 7 — v58.13.132cl: Paneltec Group header + "Welcome back" flow
- **Commit**: 99c5e03
- **Date**: 2026-09-10
- **Changes**:
  - Brand renamed from "Paneltec Civil" to "Paneltec Group" across Wordmark, welcome, home, app.json
  - PIN screen fetches GET /api/auth/mobile/device-hint on mount
  - Bound device → "Welcome back {first_name}" with role/org subtitle
  - Unbound device → generic "Enter your 4-digit PIN" with first-time hint
  - "Not you?" link: fullWipe() → re-provisioning via welcome screen
  - Device-hint cached in-memory per session, graceful fallback on 429/error
  - Home header shows "PANELTEC GROUP" brand; role pill preserves actual role_label
  - Version bumped to .132cl
  - 3 device-framed screenshots
- **Files modified**:
  - app/(auth)/pin-entry.tsx (rewrite — device-hint + welcome back)
  - app/(auth)/welcome.tsx (title → "Paneltec Group")
  - app/(tabs)/home.tsx (brand text in header)
  - app.json (name → "Paneltec Group Field")
  - src/services/auth.ts (fetchDeviceHint, clearDeviceHintCache)
  - src/components/Wordmark.tsx (rewrite — "PANELTEC GROUP")
  - src/lib/version.ts (bump)
  - frontend/src/lib/version.js (bump + changelog)
  - frontend/public/service-worker.js (bump)
  - backend/mobile_home.py (version comment)
  - backend/scripts/check_version_files_v58_8_1.py (regex fix for alphanumeric versions)

## Iteration 7 — v58.13.132cz: Total UI Replacement (8 screens, 7-tab nav)
- **Commit**: c89c8b396e361e9adf60d6ed3933e3cca1b40e76
- **Date**: 2026-04-16
- **Changes**:
  - Archived 26 old screens → `app/_archived_pre_132cz/`
  - Built 7-tab bottom nav: HOME · QR SCAN · OUTBOX · FLEET · MY WORK · PROFILE · ASK AI
  - 8 new screens: Home (briefing + compliance), My Records (grouped), QR Scan (pre-start form), Signed On, Job Detail, Profile, Ask AI, Outbox/Fleet placeholders
  - Created `src/services/mockData.ts` with RED-flagged mocked data
  - Version bumped `.132cz` across all 3 canonical files
  - MOCKED: /api/mobile/records/mine, /api/users/me, AI briefing, pre-start submission, sign-on, Ask AI
  - REAL: pin-login, device-hint, daily-jobs/today
- **Files modified**: (tabs)/_layout, (tabs)/home, (tabs)/qr-scan, (tabs)/outbox, (tabs)/fleet, (tabs)/my-work, (tabs)/profile, (tabs)/ask-ai, src/services/mockData.ts, _layout.tsx, src/lib/version.ts, frontend version files

## Iteration 8 — v58.13.132dc: Wire all mocked screens to real backend
- **Commit**: b67e939
- **Date**: 2026-04-16
- **Changes**:
  - Version bumped .132dc across 4 canonical slots (pre-commit 4-slot guard passed without escape hatch)
  - Created `src/services/apiClient.ts` — shared `authGet`/`authPost` with 401→redirect and 429→countdown
  - Fixed `/api/users/me` 401: root cause was wrong endpoint. Correct endpoint is `GET /api/auth/me`
  - Wired Profile to `GET /api/auth/me` — shows real user data with green "Live" banner
  - Wired My Records to `GET /api/mobile/records/mine` — shows 6 real groups, 187 total records
  - Wired Home AI Briefing to `GET /api/mobile/ai/briefing` — shows real briefing + severity badge
  - Wired Pre-Start Submit to `POST /api/mobile/prestart/submit` — returns real submission_id
  - Wired Ask AI to `POST /api/mobile/ai/ask` — real AI answers (confirmed via page.evaluate)
  - Wired Signed On to `POST /api/mobile/sites/{site_id}/sign-on`
  - Removed all red MOCKED banners/badges from wired screens
  - Fixed role_id vs role: all active screens use `user?.role_id || user?.role` pattern
- **Files modified**: apiClient.ts (new), home.tsx, profile.tsx, my-work.tsx, qr-scan.tsx, ask-ai.tsx, version.ts, version.js, service-worker.js

## Iteration 9 — v58.13.132di: role_id fix + CATEGORY_ORDER + version sync
- **Commit**: e43eb9d
- **Date**: 2026-04-16
- **Changes**:
  - Fixed role_id vs role bug: `forms.tsx` now reads `u?.role_id || u?.role` (was `u?.role` only, hiding Admin category)
  - Extended CATEGORY_ORDER: added `hazard`, `risk_assessment`, `site_diary` (3 previously invisible categories)
  - Restored Forms tab + forms route stack from archive (archived during .132cz)
  - Added Forms as 2nd tab in 8-tab layout
  - Version synced to .132di across all 4 slots (pre-commit passes without escape hatch)
- **Files modified**: forms.tsx (new), (tabs)/_layout.tsx, _layout.tsx, forms.ts (CATEGORY_ORDER), version.ts, version.js, service-worker.js, app/forms/ (6 restored route files)


## Iteration 10 — v58.13.132dp: Mobile Picker Parity (7 field types)
- **Commit**: 19472158f (same env, pre-commit)
- **Date**: 2026-09-18
- **Changes**:
  - Replaced 7 gray "fill on web app" stubs with real modal-based picker components
  - worker_picker (multi + company toggle), vehicle_navixy, customer_picker, site_picker (GPS), job_picker (dependsOn), asset_scan, contact_picker (text fallback)
  - Created PickerModal, PickerFields, pickerApi
  - Updated form runner FieldRenderer + ReviewField
- **Files modified**: src/components/pickers/PickerModal.tsx (NEW), src/components/pickers/PickerFields.tsx (NEW), src/services/pickerApi.ts (NEW), app/forms/[id]/index.tsx
- **Web files referenced**: frontend/src/components/forms/PickerFields.jsx, AssetScanField.jsx, pages/Forms.jsx

## Iteration 11 — v58.13.132dp: QR camera scan + time/date native pickers
- **Commit**: 1b10d876b0f3b7e0a0381e6954a27dc5bae3557f
- **Date**: 2026-09-18
- **Changes**:
  - AssetScanPicker: full QR camera scan via expo-camera CameraView + parseScanToken + /api/forms/assets/lookup confirmation card + permission denial graceful fallback
  - Time field: native @react-native-community/datetimepicker, clock icon trigger, default_now auto-seed, HH:MM 24h storage
  - Date field: upgraded from tap-for-today to real native DateTimePicker with formatted display
  - ReviewField: added time type
  - Version: 1.0.7 → 1.0.8, 132di → 132dp
- **Files modified**: src/components/pickers/PickerFields.tsx, app/forms/[id]/index.tsx, src/lib/version.ts, app.json
- **No regressions**: Metro bundles clean (1351 modules), no native crash, all lint passes



## Iteration 13 — v58.13.132dr: Mobile compliance question widget
- **Commit**: 88a00650464ecaf3152b1e1171fbe11823fddb18
- **Date**: 2026-09-18
- **Changes**:
  - New: src/components/forms/ComplianceQuestion.tsx — 3-state pill buttons (emerald/rose/slate), info alert, camera photo attach, inline notes textarea (2000 char cap + counter), photo thumbnail grid with lightbox preview
  - Updated: app/forms/[id]/index.tsx — compliance in FieldRenderer + unsupported filter + ReviewField + required-field check + outer label suppression
  - Version: 1.0.9 → 1.0.10, 132dq → 132dr
- **Files modified**: src/components/forms/ComplianceQuestion.tsx (NEW), app/forms/[id]/index.tsx, app.json, src/lib/version.ts
- **Web files referenced**: frontend/src/components/forms/ComplianceQuestion.jsx
- **No regressions**: Metro bundles clean, all lint passes, all prior features verified working



## Iteration 14 — v58.13.132dc: Restore 4 Profile sub-screens
- **Commit**: f8b45194f20ff5fa0803c206f4ae20579befe1be
- **Date**: 2026-09-18
- **Changes**:
  - Restored `personal.tsx` (Personal Info), `certifications.tsx` (My Certifications), `inductions.tsx` (My Inductions), `id-card.tsx` (Digital ID Card) from archive into `/app/mobile/app/profile/`
  - Created `profile/_layout.tsx` (Stack navigator) and `profile/certifications/[id].tsx` (detail screen)
  - Wired `onPress` handlers in `(tabs)/profile.tsx` → `router.push('/profile/personal')`, `/profile/certifications`, `/profile/inductions`, `/profile/id-card`
  - Registered `<Stack.Screen name="profile" />` in root `_layout.tsx`
  - Added preview-mode awareness to `personal.tsx`: disables editing, shows read-only fields + preview banner when `isPreviewSession()` is true
  - API calls use existing `fetchWorkerProfile()`, `fetchInductionMatrix()`, `fetchQrPngBase64()` which auto-scope via preview JWT
- **Files created**: app/profile/_layout.tsx, app/profile/personal.tsx, app/profile/certifications.tsx, app/profile/inductions.tsx, app/profile/id-card.tsx, app/profile/certifications/[id].tsx
- **Files modified**: app/(tabs)/profile.tsx, app/_layout.tsx
- **Web files referenced**: Archive: app/_archived_pre_132cz/profile_stack/*
- **No regressions**: Metro bundles clean, all lint passes, all 4 screens verified rendering with live API data



## Iteration 15 — v58.13.132iu: Admin Role Simulator
- **Commit**: 8a054849804893316fa2f46322ce24fa8ed6ddf2
- **Date**: 2026-09-19
- **Changes**:
  - New `src/services/simulateRole.ts` — get/set simulated role, persisted in AsyncStorage (`paneltec_simulate_role`), in-memory cache for header injection
  - `apiClient.ts` — `authGet` and `authPost` now call `getSimulateHeaders()` and merge `X-Simulate-Role` header into every request
  - `profile.ts` + `profileExtended.ts` — `authHeaders()` also merges simulate headers (axios-based calls)
  - `(tabs)/profile.tsx` — Admin Tools section with 4 pill buttons (Off / Paneltec Civil / Viatec Traffic / External Contractor), active state info banner
  - `_layout.tsx` — SimulateBanner component (violet bar at top: "⚡ SIMULATING: PANELTEC CIVIL") visible when role sim is active, polls cached value every 2s
  - Version bump: 132dx → 132iu
- **Files created**: src/services/simulateRole.ts
- **Files modified**: src/services/apiClient.ts, src/services/profile.ts, src/services/profileExtended.ts, app/(tabs)/profile.tsx, app/_layout.tsx, src/lib/version.ts
- **No regressions**: Metro bundles clean, all lint passes, toggle visible + functional in screenshot



## Iteration 16 — v58.13.132iu-publish: EAS Update for Expo Go
- **Commit**: b865080c5b72a6dcb863a604aac91b72c454b738
- **Date**: 2026-09-19
- **Changes**:
  - Created new Expo project under emergent account (old stephenguy project inaccessible from this container)
  - New project ID: 4bbf4e6f-83fc-4c31-992c-3e93ef1788b1
  - Installed expo-updates@29.0.20 (required for EAS Update)
  - Published Android bundle to branch `preview` — Update group ID: a3062642-0b32-4de6-a572-229006dc091d
  - app.json now owned by emergent account (required for publish auth)
  - Hermes bytecode skipped (container lacks compatible hermesc binary) — JS bundle used instead
- **Files modified**: app.json, package.json, yarn.lock
- **Note**: Original stephenguy project ID (df0c866d-b261-4aff-a724-afdd6420389a) was replaced. If Stephen needs to reclaim ownership, re-set owner + projectId in app.json.



## Iteration 17 — SDK 57 upgrade + EAS republish
- **Commit**: d3b99f6607b7ec36017cc0493b8e17def551a698
- **Date**: 2026-09-19
- **Changes**:
  - Upgraded Expo SDK 54 → 57: expo@57.0.24, react-native@0.86.3, react@19.2.3
  - All 39 Expo-managed dependencies updated to SDK 57 compatible versions
  - @react-native-community/datetimepicker 8.4.4 → 9.1.0 (onChange deprecated but backward-compat)
  - @sentry/react-native 6.14.0 → 7.11.0 (init API compatible, enableNative still false)
  - react-native-reanimated 4.1.7 → 4.5.1, react-native-worklets 0.5.1 → 0.10.1
  - typescript 5.9.3 → 6.0.3
  - Republished to EAS Update branch `preview` — Update group ID: e9945324-f741-49d6-95f1-2d238f5f8f9f
  - Version: v160.3.9.57.13.132iu
- **Breaking changes encountered**: None — all existing code compatible
- **Files modified**: package.json, yarn.lock, app.json (runtimeVersion added by eas), src/lib/version.ts



## Iteration 18 — v58.13.132iy: apiClient AbortController + Intelligence Briefing fallback
- **Commit**: 8ef19bc42e03c0735d7badf5b624ad626752f62a
- **Date**: 2026-09-19
- **Changes**:
  - Rewrote `apiClient.ts` with AbortController: authGet (20s default), authPost (45s default), overridable `{ timeoutMs }`, external signal chaining
  - Intelligence Briefing card: 45s timeout, "Briefing unavailable — tap to retry" fallback, console.warn on failure
  - Version: 1.0.17, versionCode 139, v160.3.9.57.13.132iy
  - EAS Build: ca208091-f293-4268-8535-c4b456ed149f
- **Files modified**: src/services/apiClient.ts, app/(tabs)/home.tsx, src/lib/version.ts, app.json
- **Ship memo**: memory/v58_13_132iy_mobile_abortcontroller_intel_fallback.md



## Iteration 19 — v58.13.132ja: EAS build fix + Update Banner + version sync
- **Commit**: 82f714b653c51aae470e096386fbecd6bceddfc2
- **Date**: 2026-09-19
- **Changes**:
  - Root-caused EAS build `ca208091` failure: Sentry Gradle plugin tried source map upload without org config. Profile `preview` lacked `SENTRY_DISABLE_AUTO_UPLOAD` env var.
  - Fixed eas.json: added `SENTRY_DISABLE_AUTO_UPLOAD=true` + `SENTRY_DISABLE_NATIVE_DEBUG_UPLOAD=true` to BOTH `preview` and `preview-apk` profiles
  - Created `.easignore` to exclude `android/`, `ios/`, `.expo/`, `node_modules/.cache/`, `*.map`
  - Updated runtimeVersion 1.0.16 → 1.0.18 in app.json
  - Synced MOBILE_BUNDLE_VERSION to `paneltec-v160.3.9.58.13.132ja`
  - Cancelled duplicate build `7ed7952f`
  - Kicked new EAS build: `6604e1b3-8ad6-4be6-8a82-1adb1fdf8e54` (preview-apk, v1.0.18/140)
  - In-app Update Banner + useUpdateCheck hook (implemented in prior iteration, verified here)
- **Files modified**: eas.json, app.json, .easignore, src/lib/version.ts
- **Ship memo**: memory/v58_13_132ja_mobile_update_banner.md

## Iteration 20 — v58.13.132jb: Mobile UX Overhaul
- **Commit**: 93da94871b573f7bb3644eede153cc6a7a5b203a
- **Date**: 2026-09-19
- **Changes**:
  - Restructured tab bar from 6→5 tabs: Home, Forms, Fleet, Docs, Settings
  - Created `(screens)` route group for non-tab screens (qr-scan, my-work, ask-ai, outbox)
  - Built real Fleet tab calling `/api/fleet/register` (50 assets)
  - Built real Docs tab calling `/api/document-library/folders` (nested navigation, breadcrumbs)
  - Built Settings tab merging profile, update check, admin tools, sign-out
  - Added haptic feedback on tab switch, form submit, sign-out
  - Increased typography: body 14-16pt, headings 18pt, section 26pt
  - Increased tap targets: card min-height 56-72dp, action tiles 100dp
  - Fixed react-hooks/rules-of-hooks violation in docs.tsx
  - Bumped to v1.0.19/141
  - EAS build kicked: aa00d522-fba3-4cd0-92b5-cff68a064a64 (preview-apk)
- **Files modified**: _layout.tsx, home.tsx, forms.tsx, fleet.tsx, my-work.tsx, docs.tsx (new), settings.tsx (new), haptics.ts (new), (screens)/_layout.tsx (new), _layout.tsx (root), app.json, version.ts
- **Ship memo**: memory/v58_13_132jb_mobile_ux_overhaul.md



## Iteration 21 — v58.13.132jc: Wire Forms Tab to Form-Filling Screens
- **Commit**: 04610f6d5c6228695ce2bbc180e63883003180d6
- **Date**: 2026-09-20
- **Changes**:
  - Fixed SWMS templates routing: changed from broken `/profile/swms/[id]` to working `/forms/[id]` (standard form runner)
  - Fixed in both: Forms tab search results (`forms.tsx`) and Category detail screen (`category/[key].tsx`)
  - All 40 templates across 8 categories now route correctly to the form runner
  - Bumped to v1.0.20/142
  - EAS build kicked: 0d8db108-d2e8-4ecf-aa39-2cf1e92062ff (preview-apk)
- **Files modified**: forms.tsx, category/[key].tsx, app.json, version.ts
- **Ship memo**: memory/v58_13_132jc_forms_tab_wiring.md


## Iteration 22 — v58.13.132jd: Fix Dead Signature Pad
- **Commit**: b504b65b48fbd7571fde6820e75cffc1b3982391
- **Date**: 2026-09-20
- **Changes**:
  - Root cause: Signature field was a static placeholder — no drawing canvas, no onPress handler. `react-native-signature-canvas` was installed but never used.
  - Created `SignatureField.tsx` with full-screen Modal + `react-native-signature-canvas`: tap to open → draw → Done saves base64 → preview shown
  - Replaced placeholder in Form Runner (`/forms/[id]/index.tsx`)
  - Updated review mode: "Signed ✓" / "Not signed" based on actual data
  - Added haptic: light on stroke end, medium on save
  - Bumped to v1.0.21/143
  - EAS build: 7056098d-32d6-4503-b8c8-df25d1eec613 (preview-apk)
- **Files modified**: SignatureField.tsx (new), forms/[id]/index.tsx, app.json, version.ts
- **Ship memo**: memory/v58_13_132jd_signature_fix.md
