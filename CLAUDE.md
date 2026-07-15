# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Paneltec Civil is a multi-tenant WHS/safety compliance platform for civil construction operations: AI-assisted document generation (SWMS, hazard reports, site diaries), daily pre-starts, incident/inspection reporting, a live compliance dashboard, contractor/supplier management, and worker certifications. It ships as three coordinated apps sharing one MongoDB-backed FastAPI service:

- **`backend/`** — FastAPI (Motor/async MongoDB), JWT auth, APScheduler
- **`frontend/`** — Create React App admin/office web portal (Tailwind, shadcn/ui, Fluent UI icons)
- **`mobile/`** — Expo React Native field-crew phone app (Expo Router, offline-capable)

Current shipped version: check `frontend/src/lib/version.js#RUNNING_VERSION` — it is the single source of truth (the top-level `README.md` and `memory/PROJECT_STATE.md` are frequently stale; do not trust their version numbers).

## Commands

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```
Run the full backend test suite (requires the backend running on `localhost:8001` — tests hit the live API, they are not unit tests against an in-process app):
```bash
python -m pytest backend/tests/ -v
```
Run a single test file / test:
```bash
python -m pytest backend/tests/test_worker_leaks.py -v
python -m pytest backend/tests/test_worker_leaks.py::test_worker_cannot_read_suppliers -v
```
`backend/tests/test_worker_leaks.py` is the security regression suite (42+ cases) — always green-check this after touching `permissions.py`, `permissions_middleware.py`, or any router's `require_permission`/`require_module` deps.

### Web frontend
```bash
cd frontend
yarn install       # Yarn 1.22 — do NOT use npm, only yarn.lock is maintained
yarn start          # dev server on :3000
yarn build
yarn test           # craco test (CRA/Jest)
```
Run a single frontend test:
```bash
yarn test isAnswerValid    # matches by filename substring, CRA/Jest interactive watcher
```

### Mobile (Expo)
```bash
cd mobile
yarn install
yarn start          # Metro on :3001 (dev container) with tunnel
yarn lint           # expo lint
```
After any config change or a frozen hot-reload, Metro must be restarted **and** its cache cleared, or stale bundles get served:
```bash
sudo supervisorctl restart mobile
rm -rf /tmp/metro-* /app/mobile/.expo /app/mobile/node_modules/.cache
```

### Dev container process management
All three services run under `supervisorctl` in the dev container (autoreload/HMR is on for backend/frontend, so restarts are usually only needed for config changes or mobile):
```bash
sudo supervisorctl restart backend
sudo supervisorctl restart frontend
sudo supervisorctl restart mobile
```

## Architecture

### Backend router aggregation
`backend/server.py` is a pure composition root: it imports every feature module's `router` (one Python file per domain — `assets.py`, `contractors.py`, `crud.py`, `forms.py`, `workers.py`, `ask.py`, etc.) and mounts them under a single `/api` `APIRouter`. There is no central models/routes file — to find where a resource is implemented, grep for its router import in `server.py`, then read that module directly. `crud.py` alone backs several resources (`diary_router`, `hazards_router`, `incidents_router`, `inspections_router`, `prestarts_router`, `swms_router`) since they share near-identical CRUD shape.

`db.py` exposes a single shared Motor client (`db = _client[DB_NAME]`) — every module imports `from db import db` rather than creating its own connection.

### Two-layer permission system
This is the most important architectural concept in the codebase (`backend/permissions.py`, `backend/permissions_middleware.py`, `backend/permission_presets.py`, `backend/mobile_modules.py`):

**System A — Mobile module allocator** (`mobile_modules.py`): coarse per-role boolean toggles for which mobile *tabs/features* exist at all (`swms`, `pre_start`, `hazard`, `ask_intel`, `plant_vehicles`, `contractors`, …), stored in `org_settings.mobile_modules`. The Expo client reads `GET /api/me/mobile-modules` on login/foreground to decide what UI to render. Gate a route dependency with `require_module(module_id)`.

**System B — Tri-state permission matrix** (`permissions.py`): fine-grained per-resource × per-action (`open · view · edit · delete · email · team_view · use`) checks. Each cell resolves as: (1) per-user override in `user_permissions.overrides`, (2) role default from `ROLE_DEFAULTS`, (3) deny. Gate an endpoint with `Depends(require_permission(resource, action))`. `PERMISSIONS_SCHEMA` in `permissions.py` is the resource catalog — add new resources there before wiring `require_permission` calls to them.

**Team scoping**: `TEAM_SCOPED_RESOURCES` in `permissions.py` lists resources (`swms`, `pre_starts`, `site_diary`, `hazards`, `incidents`, `inspections`, `inductions`, `workers`) where a caller lacking `team_view` is server-side auto-filtered to `created_by == user.id`, regardless of query params — this cannot be bypassed by dropping `?scope=me` client-side. Use `resolve_team_scope()` in new endpoints on these resources rather than trusting client-supplied scope.

Both systems are additive gates, not alternatives — a mobile screen can be hidden by the module allocator *and* its backend calls independently gated by the permission matrix. When adding a new mobile feature, wire both.

### Auth & request flow
JWT bearer auth (`auth.py`, `get_current_user` dependency). `permissions_middleware.py`'s `PermissionsMiddleware` runs before route-level dependencies and does path→resource / method→action inference for coarse-grained checks; `is_mobile_client(request)` in `permissions.py` distinguishes native app calls from the web portal (used to apply mobile-specific gating, e.g. phone lockdown).

### Version lockstep (cache-busting)
Three separate constants must be bumped together on every release, or the web/mobile clients will diverge from the server's expected build:
- `frontend/src/lib/version.js#RUNNING_VERSION`
- `frontend/public/service-worker.js#CACHE_VERSION`
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION`

The backend exposes `GET /api/settings/force-refresh-signal` with its expected version; if the web SPA's `RUNNING_VERSION` doesn't match, it hard-refreshes and evicts the service-worker cache. Do not add a `Clear-Site-Data` header on `/api/*` responses — this was tried and reverted (see the comment block in `backend/server.py`) because it raced with JWT storage and caused login loops.

### Comms Safe Mode
`COMMS_SAFE_MODE=on` (env var, `backend/comms_safe_mode.py`) disarms outbound email (M365) and SMS (TextMagic) integrations in dev/preview. Don't remove or bypass this in non-production environments.

### Frontend structure
- `frontend/src/pages/` — one file per major route/surface; `pages/settings/` holds admin settings sub-pages
- `frontend/src/components/` — grouped by domain (`swms/`, `workers/`, `certifications/`, `suppliers/`, `settings/`, `capture/`) plus a shared `ui/` (shadcn primitives)
- `frontend/src/lib/api.js` — the single Axios instance; JWT attached via request interceptor; only *platform*-JWT auth failures (`x-auth-reason` header in a known set) trigger auto-logout — upstream 401s from integrations must not log the user out
- `frontend/src/lib/permissions.js` / `swVersionGuard.js` — client-side mirrors of the permission/version-guard logic above

### Mobile structure
- `mobile/app/` — Expo Router file-tree; route groups `(auth)/` and `(tabs)/`, plus per-domain folders (`swms/`, `hazards/`, `forms/`, …) each with `index.tsx`, `[id].tsx`, `new.tsx`, `_layout.tsx`
- `mobile/src/lib/modules.ts` — client-side mirror of the module allocator, used to gate navigation before the API responds
- `mobile/src/lib/colors.ts` — the **"Industrial Materials"** design-token palette (`Colors.imBronze`, `Colors.imConcrete`, etc.) is the single source of truth for mobile colors. Never inline `#RRGGBB` hex in mobile JSX/stylesheets — add a token to `colors.ts` first and reference `Colors.<token>`.

## Conventions

- **Yarn only** for both `frontend/` and `mobile/` — do not introduce `package-lock.json`.
- **Brand colors (web)**: orange `#F97316` / dark slate `#0B1220`–`#1E293B` — do not introduce blue as a primary accent on the web portal, and don't change fonts without being asked.
- Do not migrate the web frontend off Create React App to Vite, and do not migrate it to TypeScript — this has been explicitly rejected in project history (`memory/PROJECT_STATE.md`); mobile is already TypeScript.
- `.env` files are always git-ignored; never commit secrets (JWT secret, Emergent LLM key, ngrok tokens). `memory/test_credentials.md` holds seeded dev-only credentials and is also git-ignored.
- Version-number comments in code (`v159.2`, `v160.0.1`, Phase numbers) are historical breadcrumbs left intentionally to explain *why* a piece of logic exists — follow that convention when adding non-obvious gating logic tied to a specific release.
- `memory/PRD.md` and `memory/PROJECT_STATE.md` are running project logs/handoff notes from prior agent sessions, not authoritative specs — useful for historical context but can lag the actual code by many versions; verify against source before relying on a claim there.
