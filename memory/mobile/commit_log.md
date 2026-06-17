## Iteration 1 — Phase 4 MVP (prior work)
- **Commit**: (see earlier commits)
- **Changes**: Built the 5-tab Expo app with 34 routes.

## Iteration 2 — Phase 8 scaffolding (prior work)
- **Commit**: (see earlier commits)
- **Changes**: Installed expo-file-system, expo-sharing. Created permissions.ts, PdfActions.tsx, EmailSendSheet.tsx, EmailButton.tsx, ReadOnlyBanner.tsx. Updated AuthContext for effective_permissions.

## Iteration 3 — Phase 8 Full Wiring
- **Commit**: 75480707926b90f48d7851296a8793ebffc08f50
- **Date**: 2026-06-17T08:35:00Z
- **Changes**:
  - Track 1 (Permissions): 
    - Wired `setForceLogoutHandler` in AuthContext.tsx → connects api.ts 401 interceptor to force-logout
    - Updated `(tabs)/_layout.tsx` to gate Capture tab via `hasAnyCaptureOpen(perms)`
    - Updated `(tabs)/capture.tsx` to filter tools by `can(resource, 'open')`
    - Gated Create/New buttons in all 6 index screens: swms, pre-starts, site-diary, hazards, incidents, inspections
  - Track 2 (PDF):
    - Wired `PdfActions` component into all 6 detail screens (swms/[id], pre-starts/[id], site-diary/[id], hazards/[id], incidents/[id], inspections/[id])
    - `ReadOnlyBanner` shown when user lacks edit permission
  - Track 3 (Email):
    - Wired `EmailButton` into all 6 detail screens, gated by `can(resource, 'email')`
    - Created Outbox tab at `(tabs)/outbox.tsx` with pull-to-refresh, status filters, retry/cancel, detail drawer
    - Added Outbox tab to tab bar in `_layout.tsx`
    - Added outbox badge count on Home tab
  - Track 4 (Polish):
    - Updated login.tsx to show specific "Account disabled" banner
    - Force-logout wired via api.ts interceptor + AuthContext
  - Created 5 new detail screens: pre-starts/[id].tsx, site-diary/[id].tsx, hazards/[id].tsx, incidents/[id].tsx, inspections/[id].tsx
  - Added list→detail navigation (onPress → router.push) for pre-starts, site-diary, hazards, incidents index screens
- **Files modified**:
  - `/app/mobile/app/(tabs)/_layout.tsx` (overwritten - added Outbox tab, permission gating, badge)
  - `/app/mobile/app/(tabs)/capture.tsx` (overwritten - permission-filtered tools)
  - `/app/mobile/app/(tabs)/outbox.tsx` (new - full outbox screen)
  - `/app/mobile/app/swms/[id].tsx` (overwritten - added PdfActions, EmailButton, ReadOnlyBanner)
  - `/app/mobile/app/pre-starts/[id].tsx` (new)
  - `/app/mobile/app/site-diary/[id].tsx` (new)
  - `/app/mobile/app/hazards/[id].tsx` (new)
  - `/app/mobile/app/incidents/[id].tsx` (new)
  - `/app/mobile/app/inspections/[id].tsx` (new)
  - `/app/mobile/app/swms/index.tsx` (added permission gating)
  - `/app/mobile/app/pre-starts/index.tsx` (added permission gating + detail nav)
  - `/app/mobile/app/site-diary/index.tsx` (added permission gating + detail nav)
  - `/app/mobile/app/hazards/index.tsx` (added permission gating + detail nav)
  - `/app/mobile/app/incidents/index.tsx` (added permission gating + detail nav)
  - `/app/mobile/app/inspections/index.tsx` (added permission gating)
  - `/app/mobile/app/(auth)/login.tsx` (disabled account banner)
  - `/app/mobile/src/lib/AuthContext.tsx` (force-logout handler registration)
- **Web files referenced**: Swms.jsx, PreStarts.jsx, SiteDiary.jsx, Hazards.jsx, Incidents.jsx, Inspections.jsx, Outbox.jsx, Login.jsx, App.js, permissions.js, PdfActions.jsx, EmailButton.jsx


## Iteration 4 — Phase 8 Track 4: Vehicles Screen
- **Commit**: 5543d9fe9d96b3fd1ac667ed68bdd893bbd5316c
- **Date**: 2026-06-17T10:17:00Z
- **Changes**:
  - Created `(tabs)/vehicles.tsx` — Full vehicles screen matching web Vehicles.jsx: tag picker, fleet list, empty states, pull-to-refresh
  - Created `src/components/VehicleMapModal.tsx` — Full-screen modal with Google Maps iframe/WebView, GPS status, coordinates strip, Directions + Navixy links
  - Updated `(tabs)/_layout.tsx` — Added Vehicles tab gated by `can('vehicles', 'open')` permission
- **Files modified**: vehicles.tsx (new), VehicleMapModal.tsx (new), _layout.tsx (updated)
- **Module count**: 1016 modules, all routes 200
