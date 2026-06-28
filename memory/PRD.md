# 2026-02-18 — Phase 3: Service & Maintenance for Plant & Vehicles

## Backend (new `/app/backend/asset_service.py`)
- **Collections** (with indexes wired in `seed.ensure_indexes`):
  - `asset_service_schedules` — name, interval_kind (hours|km|calendar), interval_value, calendar_unit, last_done_at/value, computed next_due_at/value, status_cached, reminder_lead_*, status, soft delete.
  - `asset_service_records` — type (service|defect|meter_update), title, description, performed_at/by, hours_at/km_at, cost, technician, photo_file_ids, defect_severity, linked_hazard_id, schedule_id.
  - `asset_reminders_sent` — dedupe key (schedule_id, status, sent_at).
- **Endpoints under `/api/assets/{asset_id}/...`**: CRUD for schedules + records, `POST /meter` quick endpoint, `GET /records?type=`, `DELETE /records/{rid}` (admin only).
- **`POST /api/assets/service/scan-reminders`** — walks active schedules, computes due/overdue using `_compute_next_due`, queues M365 email via existing `email_outbox.queue_email_doc` and SMS via TextMagic API, deduplicates within 24h per (schedule, status).
- **`GET /api/assets/service/summary`** — dashboard payload: `{overdue, due_soon, items:[top-5]}`.
- **`POST /api/scan/quick-action`** — public-scan-driven endpoint (JWT) for the worker's three actions: `log_service` / `report_defect` / `update_meter`. Resolves token → asset and dispatches into `create_record`.
- **Defect → Hazard auto-link**: `_maybe_raise_hazard` checks workspace setting `settings.defectAutoCreatesHazard` (default true). Major/critical defects insert a `hazards` row with `source="asset_defect"`, `linked_asset_id`, severity mapped (critical→high, major→medium). The defect record stores `linked_hazard_id`.
- **Schedule recompute**: `create_record(type=service, schedule_id=…)` updates `last_done_at/value` and recomputes `next_due_*`. Meter-only updates also recompute *all* active schedules on the asset.
- Permissions middleware leverages existing `assets` resource gate; worker `POST /api/assets/{id}/schedules` → 403 (verified).

## Frontend
- **New `components/AssetServiceTabs.jsx`** — `ServiceSchedulesTab` (list with OK/DUE SOON/OVERDUE pills + add/edit modal) and `ServiceLogTab` (chronological feed with severity chips and `Hazard raised` badge linking to the auto-created hazard).
- **`AssetDrawer.jsx`** — added `Schedules` and `Service log` tabs.
- **`pages/ScanResolver.jsx`** — added `ScanQuickActions` panel: three buttons (Log service / Report defect / Update hours/km) rendered above the existing View / Copy actions. Slide-up form posts to `/api/scan/quick-action` and toasts "Done · added to {asset}" (or "Hazard raised" when applicable).
- **`pages/Dashboard.jsx`** — new `PlantDueWidget` next to the existing certs widget. Counts overdue + due-soon, lists top 5, links to `/app/vehicles`.
- Service worker bumped `paneltec-v41 → v42`.

## Workspace setting
- `workspaces.settings.defectAutoCreatesHazard` (bool, default true). Updated directly via MongoDB in this phase — UI toggle (Settings → Compliance) deferred to follow-up.

## Verification (curl + screenshots)
- **Schedule lifecycle**: POST `/api/assets/{id}/schedules` `{name:"250hr service",interval_kind:"hours",interval_value:250}` → status `ok` (cur=0, next=250). After POST `/meter {hours:260}` schedule cache flips to `overdue`. Dashboard summary now returns `overdue:1`.
- **Scan-reminders**: 1st call `{scanned:1, overdue:1, emails_sent:1+}`. 2nd call within 24h `{emails_sent:0}` (dedupe). ✓
- **Defect→Hazard**: critical defect via `/api/scan/quick-action` → hazards count 5→6, `linked_hazard_id` populated on the defect record. ✓
- **Toggle OFF** `defectAutoCreatesHazard=false`: critical defect → `linked_hazard_id:null`, hazards count unchanged. ✓
- **Worker (non-admin)**: `POST /api/assets/{id}/schedules` → 403. ✓
- Playwright screenshots (`/app/test_reports/p3_01..04_*.png`):
  - `p3_01_dashboard` — Plant due widget visible, counter "1 OVERDUE · 0 DUE SOON".
  - `p3_02_schedules_tab` — AssetDrawer Schedules tab with header and Add button.
  - `p3_03_service_log` — Service log tab with Log service + Report defect buttons.
  - `p3_04_scan_quick_actions` — `/scan/EFLdyI3Thc` page now shows three quick-action buttons above View / Copy.

## Out of scope (deferred)
- Plant & Vehicles list status chip per row + sort/filter by service status.
- Bulk "Scan reminders now" toolbar button in PlantVehicles header.
- Settings → Compliance UI toggle for `defectAutoCreatesHazard` (workspace-level direct DB update works today).
- Service-record PDF (acceptance criterion — falls back to existing `forms_pdf.py` for any forms attached, no separate `asset_service_pdf.py` yet).
- Worker / Site / Supplier QR (Phase 4) and UHF (Phase 5) — explicitly out of scope.


# 2026-02-18 — Phase 2: Scan-to-fill on Forms (`asset_scan` field)

## Backend
- `forms.py`:
  - `asset_scan` added to `ALLOWED_FIELD_TYPES`; `_clean_field` now preserves a `config` blob (per-field settings: `requireScan`, `kindFilter`, `autofillTargets`).
  - `GET /api/forms/assets/lookup?token=…` (JWT) — authed wrapper around the public scan resolver, also returns `vehicle_type_slug`, `last_known_lat/lng/at`, `odo_km`, `hours_meter`. 404 on unknown, 410 on retired.
  - `GET /api/forms/assets/picker?q=&kind=&asset_type=` (JWT) — trimmed picker list, workspace-scoped (org-wide Navixy + workspace manual assets).

## Frontend
- **New** `src/components/forms/AssetScanField.jsx`:
  - Segmented control with capability auto-detect (`'NDEFReader' in window`, `navigator.mediaDevices`, `'BarcodeDetector' in window`).
  - **QR Camera**: `BarcodeDetector` first, `jsQR` fallback on hidden canvas; environment-facing camera; overlay box and Start/Stop controls.
  - **NFC Tap**: `NDEFReader().scan()` listens for the first `url` record; abort-controller for clean stop; gracefully hides on unsupported browsers.
  - **Manual Pick**: debounced `/api/forms/assets/picker` calls.
  - Resolve flow: any input → `/api/forms/assets/lookup` → green confirmation card ("Resolved · PLANT · EXCAVATOR …") with **Use this** / **Scan again**.
  - On confirm, dispatches `paneltec:asset-autofill` event with target field values.
  - Exports `buildAutofillFromAsset(allFields, asset)` — maps vehicle_type/rego/gps/odo/hours into sibling field ids by label heuristics.
- `Forms.jsx`:
  - `FieldRunner` adds `asset_scan` case and routes the autofill event.
  - `FillOutModal` listens for the autofill event, locks affected fields, and renders an inline **Override** link to unlock individual fields.
  - URL handler: `?template={id}&scan={token}` auto-opens FillOutModal with `_initialValues` pre-set (asset card + dependent autofill applied).
- `pages/ScanResolver.jsx`:
  - When `?form={id}` is present **and** user is authed, the resolver stashes `{scan_token, form_id, at}` in `sessionStorage.paneltec.activeScan` and navigates to `/app/forms?template={id}&scan={token}` for a seamless landing.
- `components/forms/TemplateBuilder.jsx`:
  - `asset_scan` added to `FIELD_TYPES` palette.
  - Save payload now persists `config` per field.
- Service Worker bumped `paneltec-v40 → paneltec-v41`.

## Heavy Vehicle Daily Check migration
- Patched template `be6e01d5-1e98-4d81-bb4a-33fd607f0d20`: inserted an `asset_scan` field at position 0 ("Scan asset", `requireScan=false`, `kindFilter=any`). Field order: Scan asset → Date → Vehicle Type → Vehicle Rego.

## Dependencies
- `jsqr@1.4.0` added to `package.json` (`yarn add jsqr`).

## Verification
- curl smoke: `GET /api/forms/assets/lookup?token=EFLdyI3Thc` returns enriched payload (vehicle_type_slug: "excavator"); bad token → 404. `GET /api/forms/assets/picker?q=exc&kind=plant&limit=5` returns CAT 320.
- Playwright e2e (5 screenshots `/app/test_reports/p2_01..p2_05_*.png`):
  1. Heavy Vehicle Daily Check opens with Scan asset segmented control (QR Camera / Manual pick).
  2. Manual pick lists workspace assets.
  3. Search "CAT 320" → green Resolved card with Use this / Scan again.
  4. Use this → asset chip persisted ("via manual"); Vehicle Rego auto-filled to "CAT 320 Excavator (Yard) · EX-320-007" and shows **Override** link (locked).
  5. Deep-link `/scan/EFLdyI3Thc?form={tpl}` → modal auto-opens with asset chip pre-filled ("via qr").

## Deferred (out of scope for Phase 2)
- Vehicle Type auto-select when the template's `select` options don't include an "Excavator" / matching slug (autofill correctly no-ops). Templates that want auto-Vehicle-Type should add the matching option label.
- Service & Maintenance schedules (Phase 3).
- Worker/Supplier/Site QR (Phase 4).
- UHF sled (Phase 5).


# 2026-02-18 — Phase 1: Plant & Vehicles Register (Asset Register backbone)

## New backend module `/app/backend/assets.py`
- Collection `assets` indexed by `scan_token` (unique), `(org_id, kind)`, `navixy_device_id` (sparse), `nfc_uid` (sparse).
- Routes (under `/api/assets`):
  - `GET /` — list + backfill from Navixy on every call (idempotent on `navixy_device_id`). Filters: `kind`, `asset_type`, `q`.
  - `POST /` — create manual asset (admin/manager/hseq_lead via `assets.edit`).
  - `GET /{id}`, `PUT /{id}`, `DELETE /{id}` — read / update / soft-archive.
  - `GET /{id}/qr.png` — QR PNG encoding `${FRONTEND_PUBLIC_URL}/scan/{token}`.
  - `GET /{id}/label.pdf?layout=a6|avery_l7160|on_metal|combo&ids=…` — ReportLab labels.
  - `POST /{id}/nfc-pair` (workspace-scoped uid uniqueness → 409 on dup) + `DELETE /{id}/nfc-pair`.
  - `POST /{id}/uhf-pair` — Phase 5 stub.
  - `GET /scan/{token}` — **public, no JWT** (skipped in permissions middleware). Returns sanitised payload, `410` on retired, `404` on unknown.
- Navixy backfill uses `_classify_vehicle_type(label, tag_names)` from `forms.py` — vehicles inherit the same vac-truck/tipper classification.
- Rego parsed from Navixy labels with a regex heuristic (last alphanumeric token w/ ≥1 letter and ≥1 digit).

## Permissions
- `permissions.py`: added `assets` resource (`email_supported=False`). admin/hseq_lead: full edit; supervisor/worker/auditor: view-only.
- `permissions_middleware.py`: added `(/api/assets, "assets")` matcher and `^/api/assets/scan/` skip path for the public resolver.

## Frontend
- New `/app/frontend/src/pages/PlantVehicles.jsx` — unified register: filter chips (All / Vehicles / Plant / Tools / Containers), type sub-pills, search, list/map view, source badges (LIVE NAVIXY / MANUAL) + pairing chips (QR ✓ / NFC ✓ / UHF ✓), per-row actions (Locate, QR download, Print label, Edit, Archive), `+ Add Asset` and `Print Labels` (multi-select via layout picker).
- New `/app/frontend/src/components/AssetDrawer.jsx` — right-side drawer with Details / Pairing / Photo / Notes tabs. Pairing tab includes QR preview, label printers (a6/on_metal/combo/avery_l7160), Web NFC writing via `NDEFReader` with manual UID fallback, and UHF EPC field. Navixy-linked assets lock core fields ("Synced from Navixy").
- New `/app/frontend/src/pages/ScanResolver.jsx` at `/scan/:token` (public route) — anonymous-safe; redirects to `/login?next=…` for full access. Phase 2 will read `sessionStorage` form context to push the asset into an active form.
- Sidebar renamed "Vehicles" → **Plant & Vehicles** (still routed at `/app/vehicles`, legacy at `/app/vehicles-legacy`). Resource gate changed `vehicles` → `assets`.
- `lib/permissions.js` RESOURCE_LABELS/EMAIL_SUPPORTED updated.
- Service Worker bumped `paneltec-v38 → paneltec-v39`.

## Dependencies
- Added `qrcode==8.2` to `requirements.txt` (`pip install qrcode[pil]`). `reportlab` already present.

## Verification (curl + screenshot)
- Backend smoke: 72 Navixy vehicles backfilled, CAT 320 Excavator (Yard) created with token `EFLdyI3Thc`. PDF labels valid (`%PDF-`) at a6=14KB, combo=11KB, on_metal=18KB, avery_l7160=26KB (3 ids). QR PNG ~2KB, valid `\x89PNG`. NFC pair success + duplicate 409. Worker token: GET 200, POST 403.
- Frontend smoke: sidebar shows "Plant & Vehicles", page lists 73/73 (72 live · 1 manual), CAT 320 Excavator appears with MANUAL + QR ✓ + NFC ✓ chips. `/scan/EFLdyI3Thc` renders the resolver card with name + rego + actions.

## Phase 1 acceptance: all met
- GET /api/assets merges + backfills ✓
- POST creates with unique scan_token ✓
- /qr.png returns PNG that decodes to `${FRONTEND_PUBLIC_URL}/scan/{token}` ✓
- /label.pdf?layout=a6 returns PDF (14KB, well under 200KB cap) ✓
- avery_l7160 with `?ids=` lays 3-up ✓
- NFC duplicate → 409 ✓
- Plant & Vehicles page lists merged set with chips ✓
- Worker role hides create/edit/delete ✓
- /scan/{token} works end-to-end ✓

## Deferred to next phases
- Photo upload via doc_files (drawer accepts ID only for now)
- `asset_scan` form field (Phase 2)
- Service & Maintenance schedules (Phase 3)
- Worker/Supplier/Site QR (Phase 4)
- UHF sled integration (Phase 5)
- Expo mobile parity — dispatch `e1_expo_frontend_dev`


# 2026-02-18 — Vehicle Type → Filtered Navixy Fleet (verified)
- `_classify_vehicle_type(label, tag_names=None)` in `/app/backend/forms.py` now searches Navixy **tags first**, label second. This lifted vac-truck detection from 2 → 13 (Cap Recycler, Industrial, Cappelotto, RSP, VW Crafter, etc. all carry the "Vac Truck Dumping" tag but have free-form labels).
- `/api/forms/fleet/vehicles` proxy passes each vehicle's `tags[].name` array into the classifier.
- Frontend `Forms.jsx` `FieldRunner` was restored to its proper dispatch (the previous "duplicate cleanup" had accidentally left only the VehicleNavixyField body inside, breaking every non-vehicle field render). `FieldRunner` now correctly delegates `photo/signature/gps/vehicle_navixy/textarea/select/radio/date/number/text` and threads `allFields` + `allValues` into the vehicle picker.
- Service Worker bumped `paneltec-v37 → paneltec-v38`.
- Verified on **Heavy Vehicle Daily Check**:
  - Field order Date → Vehicle Type → Vehicle Rego (migration intact).
  - No selection → 72 vehicles shown.
  - "Vacuum Truck" → "Showing 13 vehicles matching Vacuum Truck" (Cap Recycler ✓, Industrial ✓, Cappelotto 1/2/3 ✓, Vacvator 1/2 ✓, RSP, VW Crafter CCTV, Kroll Recycler, DW FX50/FX60, "Other" w/ Vac tag).
  - "Tipper" → "Showing 11 vehicles matching Tipper" (UD/500/200/HINO/450 Tippers).
  - Clear filter → all 72 vehicles return.


# 2026-02-17 — PDF viewer Edge-block fix
- `POST /api/pdf-token` mints a 90s JWT (claims: sub/org_id/resource/record_id/action/exp, type=pdf-token).
- Each `/api/{resource}/{id}/pdf` accepts EITHER `Authorization: Bearer <user-jwt>` OR `?token=<pdf-token>`.
- Frontend `PdfActions.jsx` switched from blob+iframe to `window.open` + signed URL. `PdfViewerModal.jsx` deleted.
- Token is bound to the exact resource+record_id — mismatch → 403 `pdf-token-mismatch`; expired → 401 `pdf-token-expired`; garbage → 401 `pdf-token-invalid`.


# 2026-02-17 — User management opened to hseq_lead (verified)
- `hseq_lead` now has `users.{open,view,edit}=true` (still `email=false`). Confirmed via `/api/auth/me`.
- `GET /api/workspaces` (org-scoped list) wired and consumed by the user-edit drawer.
- `UsersManagement.jsx` user drawer now renders a functional workspace multi-select (checkboxes per workspace).
- Verified end-to-end as `hseq_lead`: invite → patch (rename + add workspace) → delete (soft-disable) → reactivate via PATCH status=active.
- Regression: `worker` token still returns 403 on `GET /api/users` and `POST /api/users` (lower roles untouched).


# Phase 5 — Permissions Matrix + Email Outbox (shipped 2026-02-17)

## Permission model
- 12 resources × 4 actions (open / view / edit / email). Vehicles, integrations and users have `email_supported: false`.
- Role defaults in `/app/backend/permissions.py::ROLE_DEFAULTS`. Per-user overrides stored in Mongo collection `user_permissions`. Explicit override always wins over the role default.
- `require_permission(resource, action)` FastAPI dep used directly in `crud.py`, `users.py`, `email_outbox.py`. A `PermissionsMiddleware` (`/app/backend/permissions_middleware.py`) auto-gates `/api/contractors`, `/api/renewals`, `/api/audit-exports`, `/api/integrations`, `/api/users` so we didn't have to touch those modules. 403 response always reads `{"detail":"Permission denied: <r>.<a>"}`.
- `GET /api/auth/me` now returns `effective_permissions` matrix for client-side gating.

## User management — admin only
- `GET /api/users`, `GET /api/users/{id}`, `PATCH /api/users/{id}`, `DELETE /api/users/{id}` (soft-disable)
- `GET /api/users/{id}/permissions`, `PUT /api/users/{id}/permissions`, `POST /api/users/{id}/permissions/reset`
- `POST /api/users` invites a new user (status=invited) and queues an invite email through the outbox

## Email + Outbox
- Mongo collection `outbound_emails`.
- `POST /api/email/send` — generic; checks `<resource_kind>.email` permission; if `integration_configs.kind=microsoft365` is `connected`, marks `sent` (real Graph call is a TODO at `https://graph.microsoft.com/v1.0/me/sendMail`); otherwise `queued` with note "Microsoft 365 not connected".
- `GET /api/email/outbox` + `GET /:id` + `POST /:id/retry` + `POST /:id/cancel`.
- Convenience routes (each gated by `<resource>.email`):
  - `POST /api/swms/{id}/email-for-review`
  - `POST /api/pre-starts/{id}/email`
  - `POST /api/site-diary/{id}/email-daily`
  - `POST /api/hazards/{id}/email`
  - `POST /api/incidents/{id}/email-summary`
  - `POST /api/inspections/{id}/email`
  - `POST /api/contractors/{id}/email`
  - `POST /api/renewals/{id}/email-link`
  - `POST /api/audit-exports/{id}/email`

## Frontend
- `PermissionsProvider` in `AppShell` hydrates from `/api/auth/me`.
- `useCan(resource, action)` + `<Can>` JSX guard in `/app/frontend/src/lib/permissions.js`.
- Sidebar items hide via `can(resource, "open")`.
- New pages: `/app/settings/users` (full matrix UX with tri-state cells, invite modal) and `/app/outbox` (status/retry/cancel + M365 not-connected banner).

## Seed
- `audit@paneltec.com` (auditor) gets one override: `audit_exports.edit = true` — shows the "Custom" pill on the user list and demonstrates the override flow.
- 5 sample outbox entries (queued / sent / failed / cancelled mix).

## Mobile (deferred)
TODO: thread `effective_permissions` into the Expo app's auth store and gate the same tabs / actions. Web frontend ships first.

# Paneltec Civil — PRD & Build Log

## Original problem statement
Build the **web frontend** for **Paneltec Civil**, a WHS (Work Health & Safety)
compliance platform for civil contracting / construction teams.

## Stack
- React 19 + CRA (craco) at `/app/frontend/` · Tailwind + shadcn/ui · React Router v7 · sonner toasts · lucide-react
- FastAPI + Motor (Mongo) at `/app/backend/` · UUID string IDs · ISO datetimes
- Auth: bcrypt + PyJWT (HS256, 7-day expiry) · Bearer in localStorage (`paneltec_token`)
- AI: emergentintegrations + Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- Fonts: Space Grotesk display, Inter body — Google Fonts

## User personas
- **HSE Manager / HSEQ Lead** — runs oversight: dashboard, SWMS review, audit exports
- **Site Supervisor** — captures pre-starts, hazards, SWMS drafts, incidents
- **Worker** — signs on at the site QR code, follows SWMS
- **Auditor** — read-only access to records and audit exports
- **Admin / Workspace owner** — manages org, workspaces, integrations, users

## Brand
Blue `#2C6BFF`, mint `#D1FAE5`, violet `#7C3AED`, amber `#F59E0B`, red `#EF4444`.

---

## Phase 1 — shipped 2026-02-17
Marketing landing, mock auth, app shell, dashboard, integrations register, 13 stub routes.

## Phase 2 — shipped 2026-02-17

### Backend (`/app/backend/`)
| File | Purpose |
|---|---|
| `server.py` | FastAPI app, mounts all routers under `/api`, runs `seed_all()` on startup, exposes `/api/openapi.json` |
| `db.py` | Shared Motor client, reads `MONGO_URL` + `DB_NAME` from env |
| `models.py` | Pydantic schemas — UUID-string IDs, ISO timestamps |
| `auth.py` | bcrypt + PyJWT, `get_current_user`, `/auth/signup` `/auth/login` `/auth/me` `/auth/logout` |
| `crud.py` | Generic CRUD factory used by all 6 entities + SWMS `/review` |
| `ai.py` | Claude Sonnet 4.5 wrappers: `/ai/swms-draft`, `/ai/diary-structure`, `/ai/hazard-vision` |
| `dashboard.py` | `/dashboard/metrics`, `/files/hazards/{name}` |
| `seed.py` | Idempotent — 1 org / 2 workspaces / 5 users / 46 capture records |

### Mongo collections
`users` · `orgs` · `workspaces` · `swms` · `pre_starts` · `site_diary_entries` · `hazards` · `incidents` · `inspections`

### API endpoints (43 routes, all under `/api`)
- **Auth**: `/auth/signup` `/auth/login` `/auth/me` `/auth/logout`
- **AI**: `/ai/swms-draft` `/ai/diary-structure` `/ai/hazard-vision`
- **Dashboard**: `/dashboard/metrics`
- **Files**: `/files/hazards/{name}`
- **CRUD** (`GET`, `POST`, `GET/{id}`, `PATCH/{id}`, `DELETE/{id}` for each of):
  `swms`, `pre-starts`, `site-diary`, `hazards`, `incidents`, `inspections`
- **SWMS review**: `POST /swms/{id}/review` (`hseq_lead` + `admin` only)
- **Misc**: `/`, `/health`, `/whoami`, `/openapi.json`

### Frontend (`/app/frontend/src/`)
| File | Purpose |
|---|---|
| `lib/api.js` | Axios instance, Bearer interceptor, 401 → `/login` redirect |
| `lib/auth.js` | `login` `signup` `fetchMe` `signOut` helpers, localStorage keys |
| `components/layout/AppShell.jsx` | Sidebar + topbar, `<Navigate to="/login">` gate |
| `components/capture/Ui.jsx` | Shared form helpers (PageHeader, AiButton, StatusBadge, etc.) |
| `pages/Dashboard.jsx` | Real metrics from `/api/dashboard/metrics` |
| `pages/Swms.jsx` | List + 2-step AI wizard (`SwmsNew`) + `SwmsDetail` with review actions |
| `pages/PreStarts.jsx` | Grid + create form with SWMS link checkboxes + sign-on rows |
| `pages/SiteDiary.jsx` | List + create with **Structure with AI** side-by-side panel |
| `pages/Hazards.jsx` | Gallery + photo-drop create form that auto-calls vision AI |
| `pages/Incidents.jsx` | Filtered list + create form with follow-up actions repeater |
| `pages/Inspections.jsx` | List + template picker → pass/fail/N-A checklist form |

### Routes shipped (all under `/app/*`)
`dashboard` · `swms` (+/new, +/:id) · `pre-starts` (+/new) · `site-diary` (+/new) · `hazards` (+/new) · `incidents` (+/new) · `inspections` (+/new) · `ask` · `contractors` · `renewals` · `audit-exports` · `settings/{org,workspaces,integrations,users}`

### Seed data (idempotent on every backend startup)
- Org: **Paneltec Civil Pty Ltd**
- Workspaces: **Sydney Metro**, **Newcastle Depot**
- Users (all `demo123`): `demo@paneltec.com` (hseq_lead), `worker@`, `super@`, `audit@`, `admin@`
- 8 SWMS · 12 pre-starts · 10 diary entries · 6 hazards · 4 incidents · 6 inspections

### Phase 2 acceptance — all green
- [x] JWT auth working end-to-end, mock auth removed
- [x] All 6 capture flows persist to Mongo
- [x] Dashboard pulls real metrics
- [x] 3 AI endpoints verified live (SWMS draft, diary structure, hazard vision)
- [x] OpenAPI at `/api/openapi.json`
- [x] `supervisorctl status` → backend + frontend RUNNING
- [x] Testing agent: backend 18/18, frontend critical flows all pass
- [x] No console errors

---

## Decisions on visual ambiguity (Phase 2)
- **AI buttons** use violet (`#7C3AED`) with a sparkle icon to differentiate from regular CTAs
- **Status palette** unified across entities — open/in_progress/closed/draft/submitted/approved use a shared `StatusBadge`
- **Workspace switcher** still local state — multi-tenancy filtering deferred to Phase 3
- **Photo upload** is single-file for hazards; Phase 3 will add multi-photo for incidents
- **SWMS detail review actions** only show for `submitted` status and `hseq_lead`/`admin` roles
- The dashboard metrics key is `attention_band` (not `band`) — frontend handles both for resilience


## Phase 3b — Navixy GPS integration — shipped 2026-02-17
- New collection `integration_configs` with masked secrets (`••••<last4>`).
- New backend module `/app/backend/integrations.py` mounts under `/api/integrations`.
- 4 connector cards on `/app/settings/integrations`; Navixy now routes to a real admin page; the other 3 still open the Phase-1 "request access" modal (MOCKED).
- Navixy v2 endpoints used: `/v2/user/auth`, `/v2/tracker/list`, `/v2/tracker/get_states`. Operator enters base URL, email, password in the UI — no credentials hardcoded.
- New routes: `/app/settings/integrations/navixy` (admin), `/app/vehicles` (live fleet list, map placeholder).
- Bug fix: `useWorkspace` import was missing in `/app/frontend/src/components/layout/AppShell.jsx` — added `import { useWorkspace } from '../../lib/workspace';`.

## Backlog

### P0 — Phase 3 next
- Workspace data scoping (the topbar switcher should actually filter all lists/metrics)
- Real **Ask Intelligence** RAG endpoint over captured records (currently MOCKED briefing copy)
- Contractor Register (`/app/contractors`) + Renewal Links (email-driven self-serve)

### P1 — Phase 3
- Audit Exports (PDF/ZIP packs for Comcare / SafeWork / client audits)
- Real integrations: Simpro user sync, M365 email, TextMagic SMS, Navixy GPS
- Role-based access enforcement on UI (worker shouldn't see SWMS review buttons; partly done)

### P2
- Multi-photo upload + EXIF GPS for hazards & incidents
- Notification system (in-app + email)
- Mobile-app (Expo) wiring to same backend

## Test credentials
See `/app/memory/test_credentials.md`. JWT auth — Bearer `paneltec_token` in `localStorage`.
All 5 seed accounts share password `demo123`. Idempotent seed re-applies on every backend startup.


# 2026-06-27 — Forms Library Phase 1 (shipped)
- **Backend** (`/app/backend/forms.py`): templates CRUD, JSON import (dedupe by lowercase name), submissions create/list/get.
  - `GET/POST /api/forms/templates`, `GET/PATCH/DELETE /api/forms/templates/{id}`
  - `POST /api/forms/templates/import` (idempotent — re-running skips existing names)
  - `GET/POST /api/forms/templates/{id}/submissions`, `GET /api/forms/submissions/{id}`
  - Field types: text, textarea, date, number, select, radio, photo, signature, gps. The last three are stored null in Phase 1.
  - Write actions gated to `admin` / `hseq_lead`.
- **Frontend** (`/app/frontend/src/pages/Forms.jsx`): list + category filter + search, detail drawer, fill-out runner modal, import/export JSON. Route `/app/forms`.
- **Seeded**: 10 templates imported into Stephen's org from `/app/memory/forms_import.json` — Incident Report, Daily Site Inspection, Toolbox Talk, Near Miss Report, Equipment Pre-Use Checklist, Test Hot Work Permit, site-safety-checklist, Vehicle Pre-Use Inspection, Plant Pre-Start Checklist, Heavy Vehicle Daily Check. User can paste/upload the remaining 12 via the in-app Import modal.
- **Verified**: import (10 created), re-import dedupe (0 created / 10 skipped), submission create + list, UI screenshots clean.
- **Service worker**: bumped to `paneltec-v29` earlier in session.

## Backlog (Forms Phase 2/3)
- Phase 2: real photo capture, signature pad, GPS picker, PDF export of submissions, submissions list page per template.
- Phase 3: mobile mirror, worker assignment, scheduled reminders.


# 2026-06-27 — Forms Library Phase 2 (shipped)

## Backend
- **Real field types**: photo upload (multipart, `POST /api/forms/submissions/{id}/photos`), signature (base64 PNG inline on field value), GPS (`{lat, lng, accuracy, captured_at}` dict).
- **PDF generation**: `GET /api/forms/submissions/{id}/pdf` supports Bearer AND signed pdf-token (`POST /api/forms/submissions/pdf-token`). PDF embeds photos inline, signature as image, GPS as key-value block + Google Maps link. New `/app/backend/forms_pdf.py` reuses the brand frame from `pdf_renderer.py`.
- **Submission status**: `complete` vs `draft` computed from required-field coverage (photo/signature/GPS counted as filled when present).
- **Photo serving**: new public route `/api/files/form_photos/{submission_id}/{name}` added to `dashboard.py` for PDF embedding + `<img>` thumbnails.
- **Delete**: submitter OR admin/hseq_lead can soft-delete their own submission.
- Worker permissions verified via curl: list ✓, fill-out ✓, create template → 403, delete template → 403.

## Frontend
- **Forms.jsx (rewrite)**: real `PhotoField` (camera + file picker, multi-photo grid with previews), `SignatureField` (react-signature-canvas, responsive width, clear button), `GpsField` (browser geolocation + embedded Google Maps + lat/lng/accuracy). Mobile-responsive fill-out (sticky bottom submit bar, 44px+ tap targets, native keyboard hints).
- **FormSubmissions.jsx (new)**: route `/app/forms/templates/:templateId/submissions` — banner uses category pastel, table with Status / Photos / Signature / GPS columns, View / PDF / Delete actions, status & search filters, CSV export, mobile-card stack below md breakpoint.
- **SubmissionViewModal** (exported from Forms.jsx): read-only view with embedded photos / signature / GPS map snippet.
- **PDF popup**: opens in the existing shared `paneltec-pdf` window via the form-specific pdf-token endpoint (preserves ad-blocker bypass).
- Library: installed `react-signature-canvas`.

## Nav & Dashboard
- Sidebar (`AppShell.jsx`): added **Forms** entry under the **Capture** group (sky pastel, ClipboardList icon) — sits after Inspection Reports.
- Dashboard CAPTURE_GROUPS: added `forms` key to the "Capture & Records" group, plus styling maps (tile bg + sky icon pastel).
- `mocks/dashboard.js`: `CAPTURE_TOOLS` includes a Forms Library tile that routes to `/app/forms`.

## SW
- Bumped `CACHE_VERSION` to `paneltec-v30`.

## Verified
- Curl: photo upload (2 saved / 0 rejected), submission with text+sig+GPS+photo (status=draft because 11 other required fields unfilled, photo_count=2, has_signature/has_gps=True), PDF via Bearer (4741 bytes, `%PDF-1.4` magic ✓), PDF via pdf-token (same), list submissions (1 returned), worker 403 on create/delete.
- UI: dashboard with Forms tile + Forms in sidebar, mobile fill-out modal at 375×812 with signature drawn, GPS captured (lat/lng visible on Google Map), photo button visible. Submissions table page with sub status pill, Photos/Signature/GPS columns and PDF action.

## 22-template seed (complete)
- Imported full 22 templates into Stephen's org:
  - Part 1 (10): Incident Report, Daily Site Inspection, Toolbox Talk, Near Miss Report, Equipment Pre-Use Checklist, Test Hot Work Permit, site-safety-checklist, Vehicle Pre-Use Inspection, Plant Pre-Start Checklist, Heavy Vehicle Daily Check
  - Part 2 (12): JSEA, SWMS Sign-On, Toolbox Talk Attendance, Hot Work Permit, Confined Space Entry Permit, Working at Heights Permit, Excavation / Trench Permit, Drug & Alcohol Test Record, Site Sign-In / Visitor Register, End of Day Site Sign-Off, Crane Lift / Rigging Plan, Asbestos Awareness / Class B Removal
- Distribution: general:10, inspection:7, toolbox:2, incident:2, near_miss:1

## Phase 3 backlog
- Worker assignment + scheduled reminders on submissions
- Mobile mirror (Expo specialist — dedicated turn)
- Pin / favourite templates per-worker


# 2026-06-27 — Forms UI restyle (shipped)
- **Page header** rewritten to match user references: title "Form Templates" + subtitle + 4-button toolbar (Import Civil Library / Export All Forms / **Build with AI** purple-pink gradient / **+ New Template** orange-amber gradient) + search + categorical dropdown showing "All categories (N)".
- **Template cards** redesigned: pastel category pill (incident blush, inspection sky, toolbox butter, near_miss peach, general slate) on top-left + 3 action icons (Phone/Edit/Trash) on top-right (Edit/Trash hidden for non-admins). Big title, description, "N fields" subtitle + optional "X sent" pill + "AI draft" badge. 2-col grid bottom CTAs: Preview (white, blue border) + Fill This Form (dark navy).
- **Coloured Yes/No/N/A radio buttons** in the Fill-Out modal: Yes=emerald, No=rose, N/A=slate, Other=slate. Selected state filled with matching pastel + ring.
- **Submit button** is now orange-amber gradient with CheckCircle2 icon.
- **GPS captured indicator** banner at the top of the modal (mint pill) shows lat/lng once captured.
- **Preview modal (NEW)**: read-only view of all fields with disabled inputs, "Preview · {name}" title + PREVIEW badge, "Fill out this form" CTA at the bottom.
- **Build-with-AI (NEW)**: backend `POST /api/forms/templates/ai-generate` uses existing `_claude_json` helper (Claude Sonnet 4.5 via emergentintegrations). Prompt + category in, persisted template with source='ai' out. Validated AI generated a 19-field Daily Scaffold Inspection. Permission-gated: workers get 403.
- SW bumped to `paneltec-v31`.
- All 5 reference screenshots verified at 1440×900 + mobile at 375×812.

## Forms backlog
- Inline template editor (toolbar "+ New Template" + card pencil icon currently toast "coming soon"). Add a builder modal with field add/remove/reorder.
- `vehicle_reg` field type with Navixy integration (deferred per scope).


# 2026-06-27 — Forms Template Builder (shipped)

## TemplateBuilder modal (`/app/frontend/src/components/forms/TemplateBuilder.jsx`)
- Full-screen modal with header strip (name + category + description), two-column body, and footer.
- Three entry points wired in `Forms.jsx`:
  1) "+ New Template" toolbar (orange-amber) → empty builder
  2) Per-card pencil icon → builder pre-populated from existing template
  3) Build with AI → on success the AI draft opens directly in the builder for refinement
- Left column: drag-reorderable field list using `@dnd-kit/sortable` (`PointerSensor` 5px activation + `KeyboardSensor`). Each field card: drag handle, label, type dropdown (text/textarea/date/number/select/radio/photo/signature/gps), Required toggle, placeholder (text-likes only), options textarea (select/radio), trash.
- Right column: sticky Live Preview pane reusing the exported `FieldRunner` in `readOnly` mode — the admin sees exactly what the worker sees.
- Validation: name + category required, ≥1 field, each field has label, select/radio need ≥2 options. Inline error highlight + toast.
- Saves via existing `POST /api/forms/templates` (new) or `PATCH /api/forms/templates/{id}` (edit). Both endpoints are admin/hseq_lead-gated (curl-verified — worker POST/PATCH return 403).

## Wiring
- `Forms.jsx`: exports `FieldRunner`, `CATEGORIES`, `CAT_PILL`, `categoryLabel`. Adds `builderTemplate` state and renders `TemplateBuilder` when set. Reads `?builder=ai` query param to auto-open the AI builder modal (used by the dashboard tile).
- `Dashboard.jsx` + `mocks/dashboard.js`: new `generate-ai` tile with Sparkles icon, lavender pastel, routes to `/app/forms?builder=ai`. Added to CAPTURE_GROUPS "Capture & Records" row.
- SW bumped to `paneltec-v32`.

## Verified
- Curl: admin POST + PATCH ✓; worker POST 403 + PATCH 403; admin DELETE 204.
- UI screenshots (1440×900): empty builder with live preview (date + radio Yes/No/N/A both rendering in preview), edit builder populated from Vehicle Pre-Use Inspection (18 fields visible + live preview), Dashboard with Capture column header.
- Lint clean.


# 2026-06-28 — Supplier + Document Library folder edit/delete (shipped)
- **SupplierDrawer**: per-folder card now has hover-revealed Pencil (rename) + Trash (delete) icons (admin/hseq_lead only). New `FolderCard` component supports inline rename (text input replaces the card, Enter saves / Esc cancels, blur also saves) and confirm-dialog delete with a warning when the folder has files. Calls `PATCH /api/document-library/folders/{id}` and `DELETE /api/document-library/folders/{id}` (existing endpoints — cascade soft-deletes files in `delete_folder`).
- **FolderFiles header**: same rename + delete affordances next to the folder title when an admin opens a folder to view its files. Delete returns the user to the folder list and refreshes counts.
- **DocumentLibrary subfolder cards** (per-worker Cert subfolders + any nested folders): hover-revealed rename + delete on each subfolder tile via new `SubfolderCard` component, mirroring the supplier pattern. Both fall back to the existing PATCH/DELETE endpoints, preserving the cascade-soft-delete-files behaviour.
- Worker role gets `403` on PATCH/DELETE per backend; UI hides the icons for non-admins so workers never see the affordance.
- SW bumped to `paneltec-v33`.

## Verified (this turn)
- Curl: create supplier folder (201), PATCH rename (200), upload file (1 saved), DELETE folder (204 cascade), list-after-delete (404), worker PATCH 403, worker DELETE 403.
- UI screenshots: default supplier folders panel, hover-revealed pencil+trash, inline rename input with helper text. The FolderFiles header rename/delete is wired but wasn't separately screenshotted (the existing folder selector changed when rename mode swapped the open button).


# 2026-06-28 — Renewal Links: edit + role gating (shipped)
- **Backend `renewals.py`**:
  - New `PATCH /api/renewals/{id}` — admin/hseq_lead only. Editable fields: contractor_id, doc_types_requested, subject, message, expires_at. **Public token is preserved** so the contractor's existing link keeps working. Rejects edits on `used` submissions (409). If `expires_at` is extended past now and the link was `expired`, it auto-flips back to `pending`.
  - Added `subject` + `message` fields to `RenewalCreate` and the persisted document (used as the default email subject/body when re-emailing the link).
  - Role gate (`admin` + `hseq_lead`) added to `POST /` (create), `POST /{id}/revoke`, `DELETE /{id}`. Workers get 403.
  - DELETE now also flips status to `revoked` alongside the soft-delete, so any cached token immediately stops working at the public endpoint.
- **Frontend `Renewals.jsx`** rewrite:
  - New `EditRenewalDialog` invoked by a Pencil icon on every editable row (admin/hseq_lead only). Lets the admin change contractor, subject/title, doc types, custom message, and expiry date. PATCHes the link and refreshes the table.
  - Table columns updated: "Subject / Docs" replaces "Docs requested" (subject bold, docs underneath).
  - Create modal also gains Subject + Custom message fields.
  - Non-admin/HSEQ users no longer see Create / Edit / Revoke / Delete buttons (UI gate matches backend).
- **SW** bumped to `paneltec-v34`.

## Verified
- Curl: admin PATCH (subject/message/doc_types/expires_at) returns 200 with new fields + unchanged token; worker PATCH 403; worker DELETE 403; worker revoke 403; admin DELETE 200 cleanup.
- UI screenshots: renewals table with new Subject/Docs column + pencil/trash icons; edit modal open with all 5 editable fields populated.


# 2026-06-28 — Renewal Doc Types: admin-managed registry (shipped)

## Backend (`renewals.py`)
- New collection `renewal_doc_types`: `{id, org_id, label, slug, description, active, sort_order, created_at, updated_at, deleted_at}`.
- New endpoints (admin/hseq_lead writes; org reads):
  - `GET    /api/renewals/doc-types` — seeds 6 standard types on first hit per org, then backfills any legacy slugs found in existing renewals.
  - `POST   /api/renewals/doc-types`   `{label, description?}` — auto-slugifies label, auto-increments sort_order +10.
  - `PATCH  /api/renewals/doc-types/{id}`  `{label?, description?, active?, sort_order?}`.
  - `DELETE /api/renewals/doc-types/{id}` — soft-delete; **blocks with 409** if any pending non-deleted renewal still references the slug, with a clear message.
- Standard seed (in order, sort 10–60): **Public liability** (`public_liability`), **Workers comp** (`workers_comp`), **White card** (`white_card`), **SafeWork licence** (`safework_licence`), **Induction** (`induction`), **Other** (`other`) — matches the existing hardcoded checkboxes.
- **Legacy backfill**: on seed, scans `renewal_links.doc_types_requested` for slugs not yet in the registry and creates active entries (label = `slug.title().replace("_"," ")`, description = "Legacy doc type — auto-imported…"). Existing data continues working seamlessly.
- One-time DB cleanup: removed the earlier (wrong) seeds `insurance/licence/whs_policy` from Stephen's org because nothing referenced them.

## Frontend (`Renewals.jsx`)
- New toolbar button **"⚙️ Manage doc types"** (admin/hseq_lead only) opens `ManageDocTypesDialog`.
- Modal rows: editable Label, optional Description, `active` toggle, **Save** per-row (only enabled when dirty), Trash icon. Bottom card to "Add a new doc type" with Label + optional Description + Add button.
- Create + Edit Renewal modals now load checkboxes from `GET /api/renewals/doc-types` (only `active=true`). Both refresh whenever doc types change.
- Renewal table now renders the slug chips using the live label map; **unknown/legacy slugs render with an amber HelpCircle icon** so admins can spot legacy data.
- Edit modal also exposes any legacy slug on the current record as a checkable (amber-styled) chip so the admin can keep or drop it.
- SW bumped to `paneltec-v35`.

## Verified
- Curl: GET seed (4 → 6 after update), POST custom (`Public Liability` → slug `public_liability`, sort=50), PATCH label + sort, DELETE blocked **409** when 2 pending links still reference the slug; admin DELETE 200 after revoke, worker POST/PATCH/DELETE all **403**.
- UI: Manage modal showing 6 seeds + the newly-added "Trade Licence"; Create modal showing all 7 active types as live checkboxes including the brand-new "Trade Licence" — proving the registry is genuinely dynamic.


# 2026-06-28 — Forms field type: `vehicle_navixy` (shipped)

## Backend
- `forms.py`: added `vehicle_navixy` to `ALLOWED_FIELD_TYPES`.
- `forms.py`: new `GET /api/forms/fleet/vehicles` — thin proxy to `integrations.navixy_vehicles`, accessible to **any authenticated org user** (so workers can fill vehicle forms even though `/integrations/navixy/*` is admin-gated).
- `forms_pdf.py`: vehicle_navixy fields render as "Vehicle: {label} · {registration}".
- Submission storage: value is a structured dict `{ navixy_id, label, registration }`. `navixy_id=null` indicates manual entry.

## Frontend
- `Forms.jsx`: new `VehicleNavixyField` component with:
  - "From fleet" / "Other (manual entry)" toggle (44px min targets).
  - Live search of the org's Navixy fleet (filtered by label or rego).
  - Selected chip with truck icon, label, rego, and ✕ to clear.
  - Read-only render (used by Preview + SubmissionViewModal).
- `TemplateBuilder.jsx`: added "Vehicle (Navixy)" to the field-type dropdown.

## Seeded templates upgraded
- ✅ **Heavy Vehicle Daily Check** · f2 "Vehicle Rego" → `vehicle_navixy`
- ✅ **Vehicle Pre-Use Inspection** · f2 "Vehicle Registration" → `vehicle_navixy`
- ✅ **Plant Pre-Start Checklist (Heavy Equipment)** · f4 "Plant Serial / Fleet #" → `vehicle_navixy`

## SW bumped to `paneltec-v36`.

## Verified
- Curl: GET /forms/fleet/vehicles returns 72 vehicles for Stephen's org; POST submission with structured vehicle value; GET submission round-trip preserves dict; PDF renders OK (2.8KB %PDF-1.4); worker DELETE/PATCH on template 403; worker on a non-Navixy org gets 400 "Navixy not connected" (correct).
- UI screenshots: Vehicle dropdown populated with live fleet, search filter ("Indus" → 1 result), selected chip with rego, plus coloured Yes/No radios + other field types intact.
