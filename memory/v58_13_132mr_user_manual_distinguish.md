# v58.13.132mr — Differentiate the two "User Manual" surfaces

## Why
Two affordances in the web app both said "User Manual":

1. **Dashboard greeting-band pill** (`Dashboard.jsx`, `.132kt`) — orange
   gradient, admin-only, opens `/manuals/admin?ctx=admin` in a new tab.
2. **Sidebar row under Settings** (`AppShell.jsx`, v121 Phase 4.11) —
   lavender pastel, routes to `/app/help`.

Users kept conflating them. Support confusion: "why is it in two places",
"which one is for me". This ship visually separates them without touching
routes.

## Scope
UI-only. Labels + styling. Routes UNCHANGED. Icons matched to the
existing `@fluentui/react-icons` set (codebase convention, not lucide-
react — kept consistent).

## Changes

### 1. Dashboard button — "Worker Quick Guide"
File: `frontend/src/pages/Dashboard.jsx`

Before:
```
<a className="btn-primary-gradient ... px-4 py-2 rounded-lg text-xs sm:text-sm">
  <BookOpen20Regular />
  User Manual
</a>
```

After:
```
<a className="... bg-teal-500 hover:bg-teal-400 text-white border border-teal-400/60 ...">
  <BookOpen20Regular className="shrink-0" />
  <span className="flex flex-col items-start leading-tight">
    <span className="text-xs sm:text-sm font-semibold">Worker Quick Guide</span>
    <span className="text-[10px] opacity-85">Quick reference for field workers</span>
  </span>
</a>
```

- Label: "User Manual" → **"Worker Quick Guide"**
- Palette: orange gradient → **teal-500** (readable on the dark navy hero,
  reads as a friendly quick-reference).
- Subtitle: "Quick reference for field workers".
- Icon: retained `BookOpen20Regular` (fluentui).
- Route `/manuals/admin?ctx=admin` and the `isAdminRole(getUser())` gate
  are **unchanged** per user brief.
- Testid `dashboard-user-manual-btn-v157` retained (renaming would break
  any existing test wiring; the testid is a stable ID, not a label).

### 2. Sidebar entry — "Admin User Manual"
Files:
- `frontend/src/lib/settingsNavRegistry.js` (**real** sidebar row — the
  draggable Settings sub-nav renders from this registry per v160.3.8.1).
- `frontend/src/components/layout/AppShell.jsx` (legacy flat NAV array;
  no longer rendered for Settings but updated for consistency in case
  the legacy path is ever re-enabled).

Before:
```
{ to: '/app/help', label: 'User Manual', icon: BookOpen24Regular,
  iconActive: BookOpen24Filled, testid: 'nav-help', pastel: 'lavender' }
```

After:
```
{ to: '/app/help', label: 'Admin User Manual',
  icon: BookInformation24Regular, iconActive: BookInformation24Filled,
  testid: 'nav-help', pastel: 'slate',
  description: 'Complete guide for administrators' }
```

- Label: "User Manual" → **"Admin User Manual"**.
- Pastel: `lavender` → **`slate`** (matches every other Settings-section
  item — admin territory tone).
- Icon: `BookOpen24{Regular,Filled}` → **`BookInformation24{Regular,Filled}`**
  (formal "book-with-info-dot" glyph). Import added.
- Route `/app/help` **unchanged**.

Renderer tweak (minimal): the NavLink `title` attribute now falls back to
`it.description` when the sidebar is expanded, so hovering the row shows
"Complete guide for administrators" as a native tooltip. This keeps the
sidebar row single-line (no layout change) while still delivering the
subtitle the user asked for.

### 3. Version bumps
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132mr`
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132mr`

## Files intentionally NOT touched
User brief: "Leave others alone (only touch tile + admin nav entry)."

- `frontend/src/pages/UserManual.jsx` (H1 on the manual page itself).
- `frontend/src/components/help/UserManualDownloader.jsx` (unrelated PIN-
  gated `.docx` downloader; superseded by `.132kt` but still lives in tree).
- `frontend/src/components/permissions/RoleMatrixEditor.jsx` ("Help /
  User Manual" permission label — describes the permission, not a nav
  entry).
- `frontend/src/lib/appFeatureRegistry.js` (auto-generated Feature Index
  entry inside the manual page — self-reference; leaving as "User Manual"
  reads correctly in-context).
- Backend `settings_nav_registry.py` (ships stable `key` strings only, no
  labels — no rename needed).

## Verification
- `grep -rn '"User Manual"' frontend/src --include=*.jsx --include=*.tsx`:
  the two canonical hits (`Dashboard.jsx:696`, `AppShell.jsx:267`) are
  replaced. Remaining hits are in the scope-excluded files above.
- Screenshots captured:
  - Dashboard greeting band shows teal "Worker Quick Guide" pill with
    subtitle.
  - Admin sidebar under Settings shows slate "Admin User Manual" row
    with `BookInformation` glyph.
- Frontend hot-reload only (no restart, no backend change).

## Notes / caveats
- The dashboard button remains **admin-role-gated** (`isAdminRole`). If
  the user later wants field workers themselves to see a "Worker Quick
  Guide" tile on their landing page, that will need a separate ship
  (widen the gate + point at a non-admin manual). Out of scope here.
- The dashboard button's testid (`dashboard-user-manual-btn-v157`) was
  NOT renamed — testids are stable IDs, not labels. Anything driving
  automation off it keeps working.

## Ship discipline
- Defensive git-reset pattern applied before commit (parallel actor
  stowaways in the index unstaged).
- No `/app/mobile/*` touched.
- No `testing_agent`, no `finish` tool.
- Frontend hot-reload only (no backend restart, no mobile restart).
