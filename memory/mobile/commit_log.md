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

## Iteration 5 — Phase A-C Mobile Parity (Suppliers, Document Library, Users, Ask CRUD, Simpro Login)
- **Commit**: a59449127c9c83a8a3c56fb76496b8ef4d79fbb8
- **Date**: 2026-06-27T10:27:00Z
- **Changes**:
  - Wired `suppliers`, `document-library`, `users` Stack.Screens in root `_layout.tsx`
  - Created `SupplierDrawer.tsx` component with 4 panels (Tasks, Notes, Folders, Members) — full CRUD
  - Updated supplier card icon chips to open drawer on corresponding panel
  - Updated Compliance Hub: added Suppliers & Document Library links, renamed Contractors to Legacy
  - Rewrote `ask.tsx` with API-loaded suggestions CRUD (add/edit/delete) for admin/hseq_lead roles
  - Added `loginWithSimpro()` to `auth.ts` + "Sign in with Simpro" button in `login.tsx`
- **Files modified**:
  - `/app/mobile/app/_layout.tsx` (added Stack.Screen entries)
  - `/app/mobile/app/suppliers.tsx` (wired SupplierDrawer import + state)
  - `/app/mobile/src/components/SupplierDrawer.tsx` (NEW — 500+ line drawer component)
  - `/app/mobile/app/(tabs)/compliance.tsx` (added Suppliers + Document Library + renamed Contractors)
  - `/app/mobile/app/(tabs)/ask.tsx` (rewritten with suggestions CRUD)
  - `/app/mobile/app/(auth)/login.tsx` (added Simpro login button + divider)
  - `/app/mobile/src/lib/auth.ts` (added loginWithSimpro function)
- **Web files referenced**: Suppliers.jsx, SupplierDrawer.jsx, DocumentLibrary.jsx, UsersManagement.jsx, Ask.jsx, Login.jsx

## Iteration 5b — Dashboard Navigation + SupplierDrawer fixes
- **Commit**: ce234bb997e053d428981256afe7ce5431466fe8
- **Date**: 2026-06-27T10:30:00Z
- **Changes**:
  - Added MANAGE & COMPLY section to Dashboard with quick-access tiles for Suppliers, Document Library, Users, Compliance Hub
  - Fixed duplicate state declaration in suppliers.tsx (drawerSupplier/drawerPanel)
  - Created SupplierDrawer.tsx with full CRUD for Tasks/Notes/Folders/Members panels
- **Files modified**:
  - `/app/mobile/app/(tabs)/dashboard.tsx` (added MANAGE_TOOLS + nav tiles)
  - `/app/mobile/app/suppliers.tsx` (removed duplicate state)
  - `/app/mobile/src/components/SupplierDrawer.tsx` (new 500+ line component)
- **All screens verified**: Login, Dashboard, Suppliers, Document Library, Users, Ask Intelligence, Compliance Hub, Outbox

## Iteration 6 — Workers Feature (list + edit + client picker + sync)
- **Commit**: 1f49ee0e6c9b3b1b928e21459f9200ed84679523
- **Date**: 2026-06-27T11:05:00Z
- **Changes**:
  - Created Workers list screen (`/app/mobile/app/workers.tsx`) — sky pastel header, search, sync modal, add button, pull-to-refresh, empty state, worker card rows with active/inactive badge + company chip
  - Created WorkerEditModal (`/app/mobile/src/components/WorkerEditModal.tsx`) — full-screen sheet with 4 collapsible sections: Identity & contact (always open), Personal (birth date, country/state, address), Availability (7-day scheduler with time inputs + validation), Clients (multi-select from Simpro)
  - Created ClientPickerModal (`/app/mobile/src/components/ClientPickerModal.tsx`) — search, checkbox list, select/clear all, apply CTA
  - Registered `workers` Stack.Screen in root `_layout.tsx`
  - Added Workers link to Settings/Profile page (first item under SETTINGS)
  - Added Workers tile to Dashboard MANAGE & COMPLY section
- **Files modified**:
  - `/app/mobile/app/workers.tsx` (new)
  - `/app/mobile/src/components/WorkerEditModal.tsx` (new)
  - `/app/mobile/src/components/ClientPickerModal.tsx` (new)
  - `/app/mobile/app/_layout.tsx` (added Stack.Screen)
  - `/app/mobile/app/(tabs)/settings.tsx` (added Workers link + router)
  - `/app/mobile/app/(tabs)/dashboard.tsx` (added Workers to MANAGE_TOOLS)
- **Web files referenced**: `/app/frontend/src/pages/Workers.jsx`
- **All screens verified**: Workers list, Edit modal, Client Picker, Sync modal, Dashboard, Outbox (existing flow)
