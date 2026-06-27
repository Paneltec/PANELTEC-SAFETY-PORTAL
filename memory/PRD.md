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
