# Mobile app — inventory of the current Expo build

Snapshot date: 2026-09-06. App slug `mobile` (Expo Router v6). Bundle version `paneltec-v160.3.9.58.13.131k`. Redesign source-of-truth.

## 1 · Screens inventory

Every routable file under `/app/mobile/app/`. `_layout.tsx` are route groups, not screens — listed separately at the end. Endpoint lists come from a grep of `api.{get,post,put,patch,delete}` inside the file.

### Auth (`(auth)/`)

| File | Route | Purpose | Endpoints | Gate | State |
|---|---|---|---|---|---|
| `(auth)/login.tsx` | `/login` | Email/password + Simpro OAuth-style login | `POST /auth/login`, `POST /auth/login-with-simpro` | public | working |
| `(auth)/signup.tsx` | `/signup` | New-org signup | `POST /auth/signup` | public | working |
| `(auth)/pin-redeem.tsx` | `/pin-redeem` | PIN-based invite redemption | `POST /auth/logout` (fallback) | public | working |
| `(auth)/onboard.tsx` | `/onboard` | Post-signup org profile prompt | reads `/auth/me` | authed | working |

### Tabs (`(tabs)/`)

Bottom-tab bar with 5 slots (see screenshot 02).

| File | Route / Tab label | Purpose | Endpoints | Module gate | State |
|---|---|---|---|---|---|
| `(tabs)/dashboard.tsx` | `Home` | Intelligence briefing + Compliance Snapshot chips + "Forms & Compliance" nav grid | `GET /ask/briefing`, `GET /dashboard/metrics`, `GET /me/mobile-modules`, `GET /me/suspicious-alerts`, `GET /me/worker-profile` | none (always visible) | working |
| `(tabs)/compliance.tsx` | `Compliance` | Legacy queue view. Superseded by Home but still routable. | `GET /dashboard/metrics` | `compliance_snapshot` | working but redundant |
| `(tabs)/qr-signon.tsx` | `QR Scan` | Universal QR scanner (site / worker / supplier). Camera on native, URL paste on web. | `GET /scan/{kind}/{token}`, `POST /scan/site/{token}/sign-on`, `POST /scan/worker/{token}/site-signin`, `POST /scan/supplier/{token}/complete-induction`, `GET /assets/scan/{token}` | `sign_on` | working (paste-only on web preview) |
| `(tabs)/vehicles.tsx` | `Fleet` | Vehicle picker — filter Navixy fleet by tag. **Empty state today** (see screenshot 03): "Select one or more tags to view your fleet." No default tag → 0 vehicles land until user taps a chip. | `GET /integrations/navixy/tags`, `GET /integrations/navixy/vehicles?...`, `GET /assets/{id}/meter-trends`, `GET /assets/{id}/trip-summary` | `plant_vehicles` | usable, empty-state UX is friction (needs "All" default) |
| `(tabs)/settings.tsx` | `Profile` | User profile + session timeout + password change + Settings menu (My Profile, Certifications, Workers, Compliance Queue, Organisation, Users, Compliance Hub) + theme switch | `GET /settings/session-timeout/me`, `PATCH /settings/session-timeout/me`, `POST /auth/logout`, `POST /auth/change-password`, `GET /me/suspicious-alerts`, `PATCH /me/suspicious-alerts` | `profile` (always on) | working |
| `(tabs)/ask.tsx` | `Ask AI` | Natural-language Q&A over records. Preset questions + recent-question list. | `POST /ask`, `GET /ask/history`, `GET /ask/suggestions`, `POST /ask/suggestions`, `PATCH /ask/suggestions/{id}`, `DELETE /ask/suggestions/{id}`, `GET /ask/briefing` | `ask_intel` | working |

### Capture (top-level routes under `/app/`)

Each capture module has index + new + `[id]` detail.

| File | Route | Purpose | Endpoints | Module gate | State |
|---|---|---|---|---|---|
| `pre-starts/index.tsx` + `new.tsx` + `[id].tsx` | `/pre-starts` | Pre-start checklists | `GET/POST/GET /pre-starts` | `pre_start` | working |
| `site-diary/index.tsx` + `new.tsx` + `[id].tsx` | `/site-diary` | Daily site diary. Uses `POST /ai/diary-structure` for AI clean-up. | `GET/POST /site-diary`, `POST /ai/diary-structure` | `site_diary` | working |
| `hazards/index.tsx` + `new.tsx` + `[id].tsx` | `/hazards` | Hazard reports with photo + AI vision auto-classify | `GET/POST /hazards`, `POST /ai/hazard-vision` | `hazard` | working |
| `incidents/index.tsx` + `new.tsx` + `[id].tsx` | `/incidents` | Incident reports | `GET/POST /incidents` | `incident` | working |
| `inspections/index.tsx` + `new.tsx` + `[id].tsx` | `/inspections` | Inspection records | `GET/POST /inspections` | `inspection` | working |
| `swms/index.tsx` + `new.tsx` + `[id].tsx` | `/swms` | SWMS list · new · detail · review (approve/reject). Includes paste-import + photo-scan. | `GET /swms`, `POST /swms`, `POST /swms/from-paste`, `POST /swms/from-scan`, `POST /ai/swms-draft`, `POST /swms/{id}/review`, `POST /swms/bulk-delete` | `swms` | working |

### Forms & Docs

| File | Route | Purpose | Endpoints | Module gate | State |
|---|---|---|---|---|---|
| `forms/library.tsx` | `/forms/library` | Template catalogue for fillable forms + AI builder | `GET /forms/templates`, `POST /forms/templates`, `POST /forms/templates/ai-generate`, `POST /forms/templates/import`, `PATCH/DELETE /forms/templates/{id}` | `forms` | working |
| `forms/index.tsx` | `/forms` | Assigned forms grouped by category | `GET /forms/templates` | `forms` | working |
| `forms/category/[key].tsx` | `/forms/category/[key]` | One-category listing | `GET /forms/templates` | `forms` | working |
| `forms/[id].tsx` | `/forms/[id]` | Template preview + start | `GET /forms/templates/{id}`, `GET /forms/templates/{id}/access-check` | `forms` | working |
| `forms/fill/[id].tsx` | `/forms/fill/[id]` | Fillable form runtime (renders template, submits with signature+photos+GPS) | `GET /forms/templates/{id}`, `POST /forms/templates/{id}/submissions`, `POST /forms/submissions/{id}/photos` | `forms` | working |
| `forms/submissions/[templateId].tsx` | `/forms/submissions/[templateId]` | Submissions per template | `GET /forms/templates/{templateId}/submissions` | `forms` | working |
| `forms/submission/[id].tsx` | `/forms/submission/[id]` | Single submission view + PDF | `GET /forms/submissions/{id}`, `POST /forms/submissions/pdf-token`, `POST /pdf-token` | `forms` | working |
| `document-library.tsx` | `/document-library` | Company-wide folders + files. Search. Upload + delete. | `GET /document-library/folders`, `POST /document-library/folders`, `GET /document-library/folders/{id}/files`, `POST /document-library/folders/{id}/files`, `DELETE /document-library/files/{id}`, `DELETE /document-library/folders/{id}`, `GET /document-library/search` | `document_library` | working |

### People / Suppliers / Contractors

| File | Route | Purpose | Endpoints | Module gate | State |
|---|---|---|---|---|---|
| `sites/index.tsx` + `create.tsx` | `/sites` | Site register (create + close). Simpro-customer picker. | `GET /mobile/sites/mine`, `POST /mobile/sites`, `PATCH /mobile/sites/{id}/close`, `GET /integrations/simpro/customers?company=both` | `sign_on` | working |
| `workers.tsx` | `/workers` | Field crew (Simpro-sync + manual). Certs, reminders, delete. | `GET /workers`, `POST /workers/sync-from-simpro`, `GET/POST/DELETE /workers/{id}/certifications`, `POST /workers/{id}/certifications/upload`, `POST /workers/certifications/{id}/send-reminder`, `DELETE /workers/{id}` | `workers` | working |
| `my-certifications.tsx` | `/my-certifications` | Self-service cert list | `GET /me/worker-profile` | `certifications` | working |
| `certifications.tsx` | `/certifications` | Admin cert directory | `GET /workers/certifications` | `certifications` | working |
| `contractors/index.tsx` + `new.tsx` + `[id].tsx` | `/contractors` | Contractor register with docs upload | `GET /contractors`, `POST /contractors`, `GET /contractors/{id}`, `DELETE /contractors/{id}/documents/{docId}` | `contractors` | working |
| `suppliers.tsx` | `/suppliers` | Suppliers directory + members + notes + tasks + renewal-link workflow | `GET/POST /suppliers/*`, `PATCH /suppliers/*`, `DELETE /suppliers/*`, `POST /integrations/simpro/suppliers/sync`, `POST /suppliers/{id}/send-renewal` | `suppliers` | working |
| `users.tsx` | `/users` | Org user directory + Simpro import + force sign-out | `GET /users`, `POST /users/import-from-simpro`, `POST /users/{id}/force-signout`, `DELETE /users/{id}` | `users_directory` | working |
| `my-profile.tsx` | `/my-profile` | Editable personal profile | `GET /auth/me` | `profile` | working |
| `index.tsx` | `/` | Splash / decide (auth → tabs) | `GET /auth/me` | — | working |

### Layout files (not user-facing screens)
`app/_layout.tsx`, `app/(auth)/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/contractors/_layout.tsx`, `app/forms/_layout.tsx`, `app/forms/fill/_layout.tsx`, `app/forms/submission/_layout.tsx`, `app/forms/submissions/_layout.tsx`, `app/hazards/_layout.tsx`, `app/incidents/_layout.tsx`, `app/inspections/_layout.tsx`, `app/pre-starts/_layout.tsx`, `app/site-diary/_layout.tsx`, `app/sites/_layout.tsx`, `app/swms/_layout.tsx`.

Screen count: **44 routable screens** across 11 modules.

---

## 2 · Modules (from `/app/mobile/src/lib/modules.ts` + defaults from `/app/backend/mobile_modules_data.py`)

| Module key | Screen count | Description |
|---|---:|---|
| `sign_on` | 3 | QR scan tab, sites index/create |
| `profile` | 3 | Settings tab, my-profile, my-certifications |
| `pre_start` | 3 | pre-starts index/new/detail |
| `site_diary` | 3 | site-diary index/new/detail |
| `hazard` | 3 | hazards index/new/detail |
| `incident` | 3 | incidents index/new/detail |
| `inspection` | 3 | inspections index/new/detail |
| `swms` | 3 | swms index/new/detail |
| `inductions` | 0 | (module flag; UX embedded inside contractors / suppliers workflows) |
| `plant_vehicles` | 1 | Fleet tab (vehicles.tsx) |
| `certifications` | 2 | certifications.tsx, my-certifications.tsx |
| `ask_intel` | 1 | Ask AI tab |
| `forms` | 8 | forms/library, forms/index, forms/category/[key], forms/[id], forms/fill/[id], forms/submissions/[templateId], forms/submission/[id] |
| `document_library` | 1 | document-library.tsx |
| `contractors` | 3 | contractors index/new/detail |
| `suppliers` | 1 | suppliers.tsx |
| `workers` | 1 | workers.tsx |
| `users_directory` | 1 | users.tsx |
| `compliance_snapshot` | 1 | Compliance chip row on Home (embedded), Compliance legacy tab |

Retired keys (silently dropped on read): `service_maintenance` (rolled into `plant_vehicles` in v158).

---

## 3 · Data-source inventory (API endpoints hit by the mobile app)

### Reads (`GET` — 47 unique)
```
/ask/briefing                                  /forms/templates
/ask/history                                   /forms/templates/{id}
/ask/suggestions                               /forms/templates/{id}/access-check
/assets/{id}                                   /forms/templates/{id}/submissions
/assets/{id}/meter-trends                      /hazards
/assets/{id}/trip-summary                      /hazards/{id}
/assets/scan/{token}                           /incidents
/auth/me                                       /incidents/{id}
/contractors                                   /inspections
/contractors/{id}                              /inspections/{id}
/dashboard/metrics                             /integrations/navixy/tags
/document-library/folders                      /integrations/navixy/vehicles{qs}
/document-library/folders/{id}/files           /integrations/simpro (list + customers + employees + suppliers)
/document-library/search                       /me/mobile-modules
/forms/fleet/vehicles                          /me/suspicious-alerts
/forms/pickers/sites                           /me/worker-profile
/forms/submissions/{id}                        /mobile/sites/mine
/org/companies                                 /pre-starts
/pre-starts/{id}                               /scan/site/{token}
/scan/supplier/{token}                         /scan/worker/{token}
/settings/session-timeout/me                   /site-diary
/site-diary/{id}                               /suppliers/meta
/suppliers/{id}/folders                        /suppliers/{id}/members
/suppliers/{id}/notes                          /suppliers/{id}/tasks
/swms                                          /swms/{id}
/users                                         /workers
/workers/{id}/certifications
```

### Writes (`POST`/`PUT`/`PATCH`/`DELETE` — 48 unique)
POST: `/ai/diary-structure`, `/ai/hazard-vision`, `/ai/swms-draft`, `/ask`, `/ask/suggestions`, `/auth/change-password`, `/auth/login`, `/auth/login-with-simpro`, `/auth/logout`, `/auth/signup`, `/contractors`, `/document-library/folders`, `/document-library/folders/{id}/files`, `/forms/submissions/pdf-token`, `/forms/submissions/{id}/photos`, `/forms/templates`, `/forms/templates/ai-generate`, `/forms/templates/import`, `/forms/templates/{id}/submissions`, `/hazards`, `/incidents`, `/inspections`, `/integrations/simpro/suppliers/sync`, `/me/signoff-active`, `/mobile/sites`, `/pdf-token`, `/pre-starts`, `/scan/{site,supplier,worker}/{token}/...`, `/site-diary`, `/suppliers/{id}/{folders,members,notes,tasks}`, `/suppliers/{id}/send-renewal`, `/swms`, `/swms/bulk-delete`, `/swms/from-paste`, `/swms/from-scan`, `/swms/{id}/review`, `/users/import-from-simpro`, `/users/{id}/force-signout`, `/workers/{id}/certifications`, `/workers/{id}/certifications/upload`, `/workers/certifications/{id}/send-reminder`, `/workers/sync-from-simpro`.

PATCH: `/ask/suggestions/{id}`, `/forms/templates/{id}`, `/me/suspicious-alerts`, `/mobile/sites/{id}/close`, `/settings/session-timeout/me`, `/suppliers/{id}/meta`, `/suppliers/members/{id}`.

DELETE: `/ask/suggestions/{id}`, `/contractors/{id}/documents/{docId}`, `/document-library/{files,folders}/{id}`, `/forms/templates/{id}`, `/suppliers/{members,notes,tasks}/{id}`, `/users/{id}`, `/workers/{id}`, `/workers/certifications/{id}`.

---

## 4 · Web-side Permissions Matrix admin (source of truth for the mobile module allocator)

| Concern | Where |
|---|---|
| Web route | `/app/settings/permission-presets` |
| Web page | `/app/frontend/src/pages/PermissionPresetsAdmin.jsx` |
| Sub-tab in page | `MobileModulesSection` (mobile-modules allocator per role) — imported from `/app/frontend/src/components/settings/MobileModulesSection.jsx` |
| Web permission gate | `useCan('users','view')` — read; `useCan('users','edit')` — write |

### Backend endpoints
```
GET    /api/settings/mobile-modules                     — read the matrix + defaults version
PATCH  /api/settings/mobile-modules/overrides           — per-role overrides
DELETE /api/settings/mobile-modules/overrides/{role_id} — reset a role to defaults
PUT    /api/settings/mobile-modules                     — bulk-write full matrix
GET    /api/me/mobile-modules                           — hydrated per-user result (mobile app reads this on login)

GET    /api/permission-presets                          — 6 built-in + N custom
POST   /api/permission-presets                          — create custom
PATCH  /api/permission-presets/{id}                     — rename/edit custom
DELETE /api/permission-presets/{id}                     — delete custom
```
Module list source: `/app/backend/mobile_modules_data.py::MODULE_KEYS` (19 keys).

### Mongo shape (org_settings.mobile_modules)
```jsonc
{
  "org_id": "…",
  "matrix": {
    "worker":     { "pre_start": true, "site_diary": true, ... },
    "supervisor": { … all-on except users_directory },
    "contractor": { … pre_start:false, hazard:true, swms:true, sign_on:true, forms:true, document_library:true, contractors:true },
    "admin":      { … all-on }
  },
  "defaults_version": "v160.0.2",
  "updated_at": "…"
}
```
Stored on `db.org_settings` (see `mobile_modules_data.py::_load_matrix` — reads with the same key). `_normalise()` drops retired module keys silently on read.

### Built-in role presets (from `backend/permission_presets.py::BUILT_IN_PRESETS`)
`full_admin` · `site_manager` · `hseq_officer` · `field_supervisor` · `read_only_auditor` · `field_worker`.

Each preset has a permissions matrix (resource × action grid: `open`, `view`, `edit`, `delete`, `email`, `team_view`) — that's DIFFERENT from the mobile-module allocator. Two systems, same page:
- **Permission Presets** → resource-level web permissions
- **Mobile Modules** → which module tiles a user sees on the phone

### Default mobile-module matrix (v160.0.2)
```
              worker  supervisor  contractor  admin
pre_start        ✓        ✓          ·          ✓
site_diary       ✓        ✓          ·          ✓
hazard           ✓        ✓          ✓          ✓
incident         ✓        ✓          ✓          ✓
inspection       ✓        ✓          ·          ✓
swms             ✓        ✓          ✓          ✓
inductions       ✓        ✓          ✓          ✓
plant_vehicles   ·        ✓          ·          ✓    ← worker OFF as of v159.0 audit §3
certifications   ✓        ✓          ·          ✓
ask_intel        ·        ✓          ·          ✓
sign_on          ✓        ✓          ✓          ✓
profile          ✓        ✓          ✓          ✓
forms            ✓        ✓          ✓          ✓
document_library ·        ✓          ✓          ✓
contractors      ·        ✓          ✓          ✓
suppliers        ·        ✓          ·          ✓
workers          ·        ✓          ·          ✓
users_directory  ·        ·          ·          ✓
compliance_snapshot·      ✓          ·          ✓
```

---

## 5 · Brand + visual

### Palette — `/app/mobile/src/lib/colors.ts` (Modern Light theme)
```
bg              #F9F7F2   (paper-warm neutral)
surface         #FFFFFF
border          #E5E7EB
ink / text      #111827
placeholder     #9CA3AF
primary blue    #2563EB   (⚠ two keys: `orange` AND `blue` both hold #2563EB — historical rename artefact)
accent violet   #6D5CC8
gold / warning  #F59E0B
success emerald #10B981
error red       #EF4444
info            #2563EB
```
Web app palette (from `.131i` frontend) uses `#2C6BFF` primary — the mobile is 3 shades warmer (`#2563EB`). Not aligned. Any redesign should re-unify.

Alternate themes in `/app/mobile/src/lib/palettes.ts`: `modern_light`, `charcoal`, `desert`, `forest` (theme switcher visible under `Profile › Appearance` — see screenshot 04).

### Typography
- Only bundled font: `SpaceMono-Regular.ttf` — used only for numeric strings; UI uses the OS default (SF on iOS / Roboto on Android / system-sans-serif on web).
- Web preview inherits the browser's default sans stack.

### Logos & icons — `/app/mobile/assets/images/`
```
icon.png             ← App icon (Expo)   ./assets/images/icon.png
adaptive-icon.png    ← Android adaptive
splash-image.png     ← Splash
favicon.png          ← Web favicon
app-image.png        ← Marketing / onboarding
partial-react-logo.png · react-logo{,@2x,@3x}.png   ← Expo default (unused, safe to delete)
```
Wordmark rendered on Login: shield glyph + `PANELTEC` (bold) + `CIVIL` (blue) — hard-coded in `(auth)/login.tsx`, not an SVG file. See screenshot 01.

### App metadata (`/app/mobile/app.json`)
```
name:              "mobile"        ← generic; should become "Paneltec Civil"
slug:              "mobile"
icon:              ./assets/images/icon.png
splash:            (none configured; expo-splash-screen falls back to icon)
splash bgColor:    (none)
```

---

## 6 · Screenshots (6 captured — all under `/app/memory/mobile_inventory_current_*.jpeg`)

| # | File | Content |
|---|---|---|
| 01 | `mobile_inventory_current_01_login.jpeg` | Login screen · brand shield + `PANELTEC CIVIL` wordmark · "Build Safer. Build Smarter. Build Together." tagline · Real-time Compliance / AI-Powered Insights / Cert Tracking / Live Analytics chips · demo creds banner · SIGN IN button · Sign in with Simpro fallback · "Have a PIN?" link |
| 02 | `mobile_inventory_current_02_home.jpeg` | Home tab · "PANELTEC CIVIL · paneltec-v160.3.9.58.13.131k" version badge · Intelligence Briefing block ("No Critical Management Actions Required This Week") with 3 cited-evidence chips · Compliance Snapshot chip row (AI SWMS 10, Pre-starts 0, Site diary 0, Hazards 0, Incidents 0, Inspections 0) · Forms & Compliance nav grid (My Sites, Forms Library, Workers, …). Bottom tabs: Home / QR Scan / Fleet / Profile / Ask AI |
| 03 | `mobile_inventory_current_03_fleet.jpeg` | Fleet tab · title "FLEET · Live fleet from Navixy GPS" · TAGS row (empty on this account) · 0 vehicles · **empty-state UX**: "Select one or more tags to view your fleet." — friction point (no default "All" tag) |
| 04 | `mobile_inventory_current_04_profile.jpeg` | Profile tab · avatar + name + ADMIN pill + last-login placeholder · Session Timeout selector (15m / 30m / 1h / 8h / Off) · Suspicious Login Alerts selector · Active Sessions accordion · CHANGE PASSWORD · Settings menu (My Profile, Certifications, Workers, Compliance Queue, Organisation, Users, Compliance Hub) · Appearance / theme picker |
| 05 | `mobile_inventory_current_05_qrscan.jpeg` | QR Scan tab · camera-reticle placeholder ("Camera scanning is available on native devices — use the URL field") · paste-token input · 3 scan-type tiles (Site sign-on / Worker check / Supplier induction) |
| 06 | `mobile_inventory_current_06_askai.jpeg` | Ask AI tab · natural-language Q&A prompt · 6 suggestion chips ("What are the recurring incident categor…", "Show me open hazards by severity.", "Which inspections are overdue?", …) + editable + delete + Add question chip · Ask button · Recent Questions log |

Native-only features (barcode camera on QR Scan tab, biometric auth, background location, expo-camera) don't render in the Expo web preview — that's expected and documented on the QR Scan screen itself.

---

## 7 · Pain points from prior notes

Grep of `/app/memory/*.md` for mobile issues:

| Recurrence | Note |
|---|---|
| **#1 — recurring** (6× per `PRD.md:6226`) | "Mobile preview broken after a bulk mobile edit." Root cause pattern: a mid-edit syntax break OR a deleted-but-still-imported module. Metro bundler fails silently on web preview. "Stale CI bundle" framing is misleading — the fix has always been a bad edit. **Guardrail for any redesign: run `expo start --web` after each bulk edit, tail `/var/log/supervisor/mobile.err.log`, don't declare done until the preview lands.** |
| Fleet tab empty state | Screenshot 03 shows "Select one or more tags" — no default "All" — user friction. Not yet marked as a bug in `/app/memory/`, flagging now. |
| Palette drift | Mobile primary `#2563EB` vs web primary `#2C6BFF` — small visual inconsistency. |
| `app.json` metadata | `name: "mobile"` (generic) instead of `Paneltec Civil`. Also no splash config → falls back to icon. |
| Duplicate colour keys | `colors.ts` has both `orange` and `blue` mapped to the same `#2563EB` — historical rename artefact, no code appears to consume `orange` any more. |
| Retired module key still on some cached devices | `service_maintenance` — silently dropped by `_normalise()` in `mobile_modules_data.py`. Recovery path is exercised in every module fetch; not a bug, just needs to stay in place for the redesign. |
| No accessibility audit | No `accessibilityLabel` audit found for touchables (grep of `accessibilityLabel` returns ~40 hits across 44 screens — sparse). Not raised by user but worth flagging for redesign. |

No `TODO.*mobile`, `FIXME.*mobile`, or explicit "mobile broken" markers besides the PRD recurrence note.

## Redesign recommendations (for the incoming design pass — not built here)

1. **Unify colour system** — pick `#2C6BFF` from the web app; retire the `#2563EB` mobile primary and the ambiguous `orange` key.
2. **Real splash + real app name** — set `app.json/expo/name = "Paneltec Civil"` and configure `splash.image` + `backgroundColor`.
3. **Fleet tab default `All`** — auto-select all tags on first visit so the tab isn't empty out of the box.
4. **Wordmark → SVG** — extract the current login-only shield+text into a reusable `<Wordmark />` React component so future palette bumps flow through.
5. **Bottom-tab count** — 5 slots today (Home, QR Scan, Fleet, Profile, Ask AI). Capture-heavy modules (Pre-starts, Hazards, SWMS) live one level below Home. Redesign could promote 1-2 of those into the tab bar or use a floating action button.
