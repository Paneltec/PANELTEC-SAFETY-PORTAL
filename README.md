# Paneltec Civil — WHS Compliance Platform

Multi-user WHS / safety compliance platform for civil construction operations, with authentic role-based access, AI-assisted document generation, live compliance dashboard, and full offline-capable mobile workflow.

- **Current version:** `paneltec-v160.0.1`
- **Stack:** FastAPI · React (CRA) · MongoDB · Expo React Native
- **Status:** Active development · dev + preview environments only (not production-hardened)

---

## Features

- **AI SWMS Generator** — Claude-assisted Safe Work Method Statements with edit + review + PDF export
- **Daily Pre-Starts** — Crew pre-start checks with signatures, GPS, photos
- **Site Diary AI** — Auto-summarise field notes into daily diary entries
- **Hazard Reports from Photos** — Snap-a-hazard AI classification + severity scoring
- **Incident Reports** — Structured incident capture with follow-up workflow
- **Inspection Reports** — Site walks, plant, working-at-height inspections
- **Live Compliance Dashboard** — Attention score, records-needing-attention feed, workspace filters
- **Ask Intelligence** — Claude-powered natural-language queries over org records with cited evidence
- **Contractor / Supplier Management** — Register, renewal links, credential expiry tracker
- **Document Library** — Folder-based document store with per-user access restriction
- **Forms Library** — Fillable templates with signature, photo, GPS capture
- **Worker Certifications** — Inductions matrix, cert expiry tracking, reminder scans
- **LAN Backup Agent** — On-prem Python agent for offsite backups (`scripts/paneltec_backup_agent.py`)
- **Two-layer Permission System** — see [Permission model](#permission-model) below
- **Mobile app** — Expo React Native, offline-capable, own-data-only for non-privileged roles (v159.x → v160.0.1 phone lockdown sweep)

---

## Tech stack

- **Backend:** FastAPI, Motor (async MongoDB), APScheduler, JWT auth, Pydantic v2, `emergentintegrations` (Claude, GPT-Image, Sora 2, Whisper via Emergent Universal Key)
- **Web frontend:** Create React App, TailwindCSS, shadcn/ui, Fluent UI icons, Recharts, `pdfjs-dist`, Sonner toasts
- **Mobile:** Expo SDK 54, React Native, Expo Router, AsyncStorage, Ionicons
- **Integrations:**
  - Claude AI (via Emergent Universal LLM Key)
  - Microsoft 365 — email outbox (opt-in, currently Safe-Mode disarmed)
  - TextMagic — SMS notifications (opt-in, Safe-Mode disarmed)
  - Navixy — GPS / telematics for plant & vehicles
  - Simpro — contractor / supplier / staff sync

---

## Directory layout

```
/app/
├── backend/          FastAPI service (/api routes, MongoDB models, schedulers)
│   ├── server.py     — router aggregation
│   ├── permissions.py — Two-layer permission engine (module allocator + tri-state matrix)
│   ├── mobile_modules.py — per-role mobile feature toggles
│   ├── ask.py, dashboard.py, crud.py, worker_certifications.py, email_outbox.py, …
│   └── tests/test_worker_leaks.py — 42+ regression tests
├── frontend/         Web React app (admin/office portal)
│   ├── src/pages/    — one page per major surface
│   ├── src/components/settings/ — permission preset, mobile-modules, integrations UIs
│   ├── src/lib/version.js — RUNNING_VERSION (paired with service-worker.js)
│   └── public/service-worker.js — CACHE_VERSION cache-buster
├── mobile/           Expo React Native app (field crew phone)
│   ├── app/          — Expo Router file-tree (tabs, dynamic routes, capture flows)
│   └── src/lib/modules.ts — client-side module-allocator gating
├── scripts/          Utilities
│   ├── paneltec_backup_agent.py — LAN backup runner
│   └── dedup_org_settings.py — one-time migration for org_settings duplicates
├── memory/           PRD, changelog, and this project's memory files
│   ├── PRD.md
│   └── test_credentials.md (git-ignored — dev only)
└── tests/            End-to-end test scaffolding
```

---

## Setup

Services are **supervisor-managed** in the dev container. Local Docker/host setup steps below.

### Prerequisites
- Node 20+ and Yarn 1.22 (NOT npm — Yarn locks used throughout)
- Python 3.11+
- MongoDB 6+ running on `mongodb://localhost:27017`
- (Optional) Expo CLI for mobile: `npm i -g @expo/cli`

### Backend
```bash
cd /app/backend
pip install -r requirements.txt
# Fill in the environment variables (see .env.example if provided, or Environment section below)
cp .env.example .env  # if example exists, otherwise create manually
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

### Web frontend
```bash
cd /app/frontend
yarn install
# Ensure REACT_APP_BACKEND_URL points at your backend
yarn start   # dev server on :3000
```

### Mobile (Expo web preview)
```bash
cd /app/mobile
yarn install
yarn start   # opens Metro on :3001 with tunnel
```

### Supervisor (dev container)
Everything runs under supervisor. To restart a service:
```bash
sudo supervisorctl restart backend    # picks up backend/*.py changes (autoreload also on)
sudo supervisorctl restart frontend   # picks up frontend/*.jsx changes (webpack HMR also on)
sudo supervisorctl restart mobile     # required after Expo config or hot-reload freeze
```
After a Metro restart, always clear the Expo cache:
```bash
rm -rf /tmp/metro-* /app/mobile/.expo /app/mobile/node_modules/.cache
```

---

## Environment variables

**Never commit `.env` files.** All three services read from local `.env`:

### `backend/.env`
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=test_database
CORS_ORIGINS=*
JWT_SECRET=<random 64-char hex>
EMERGENT_LLM_KEY=<from Emergent Profile → Universal Key>
DEMO_PASSWORD=<any dev password>
COMMS_SAFE_MODE=on   # disarms outbound email/SMS integrations
```

### `frontend/.env`
```
REACT_APP_BACKEND_URL=<public backend URL>
WDS_SOCKET_PORT=443
```

### `mobile/.env`
```
EXPO_PUBLIC_BACKEND_URL=<public backend URL>
EXPO_PACKAGER_PROXY_URL=<Expo tunnel URL>
NGROK_AUTHTOKEN=<if using ngrok tunneling>
```

---

## Test credentials (development only)

These match the **seeded dev database** and are safe to share for local testing. They are **not** production credentials — `memory/test_credentials.md` is `.gitignore`d.

| Role   | Email                             | Password         |
|--------|-----------------------------------|------------------|
| admin  | `stephen@paneltec.com.au`         | `Mcgstephen50#`  |
| worker | `worker_stephen@paneltec.com.au`  | `WorkerTest123!` |

Seeded via `python backend/seed_stephen.py`.

---

## Permission model

Paneltec ships a **two-layer permission system**:

### System A — Mobile App Modules (per-role feature visibility)
Boolean toggles per role × mobile feature (`ask_intel`, `plant_vehicles`, `document_library`, `users_directory`, `swms`, `pre_start`, `hazard`, `incident`, `inspection`, `site_diary`, `forms`, `workers`, `inductions`, `certifications`, `suppliers`, `contractors`). Managed at **Settings → Mobile App Modules**.

### System B — Tri-state Permission Matrix (per-resource × action)
Six actions: `open · view · edit · delete · email · team_view`. Each cell is **inherit** (preset default), **allow** (explicit override), or **deny** (explicit block). Managed at **Settings → Permission Matrix** (per-user modal opens from Users & permissions list).

**Team scoping (v159.2+):** workers/contractors/auditors lacking `team_view` on the six team-scoped resources (`swms`, `pre_starts`, `site_diary`, `hazards`, `incidents`, `inspections`, `inductions`) auto-filter to `created_by == user.id`. `?scope=me` / `?scope=team` query params override the default.

**Phone lockdown (v160.0+):** worker phones never see WATCH card, org-wide compliance snapshot chips, Compliance Hub tile, Ask AI tab, Fleet tab, or admin settings tiles. Outbox is filtered to messages the caller sent or was addressed to.

---

## Security model (in short)

- **All sensitive endpoints** gated with `require_permission(resource, action)` (v159.0+).
- **Worker role auto-scoped** to own records on team-scoped resources server-side — no client can trick the API by dropping `?scope=me` (v159.2+).
- **Deep-link protection** — detail routes (`GET /api/{resource}/{id}`) return 403 when a non-privileged caller opens a record they didn't create.
- **Cache-buster** — `service-worker.js#CACHE_VERSION` and `frontend/src/lib/version.js#RUNNING_VERSION` are bumped in lockstep every release so browsers never serve a stale UI shell.
- **42+ regression tests** in `backend/tests/test_worker_leaks.py` cover every gated endpoint against admin + worker credentials.
- **`.env` files** always `.gitignore`d — never commit real JWT secrets, Emergent LLM keys, or ngrok tokens.

Run the security regression suite locally:
```bash
cd /app
python -m pytest backend/tests/test_worker_leaks.py -v
```

---

## Changelog (recent releases)

Full changelog lives in [`memory/PRD.md`](memory/PRD.md).

- **v160.0.1** (2026-07-04) — Compliance Hub tile hidden for workers regardless of child modules; COMPLIANCE SNAPSHOT chip row also hidden. Visually confirmed on the Expo preview.
- **v160.0** — Phone-app own-only sweep. WATCH card `attention_band='hidden'` for non-privileged. Email Outbox auto-scoped by `created_by == me OR to contains me.email`. Settings tab admin tiles hidden for workers. Inductions added to team-scoped resources.
- **v159.4** — Frontend wire-up: per-user Permissions modal with override-count chip, `team_view` column, effective-value chip. Doc Library bulk-restrict modal. Preset-delete confirmation with assignees warning.
- **v159.3** — Preset cloning (`POST /permission-presets/{id}/duplicate`), preset assignees, bulk-restrict endpoint (`POST /permissions/bulk-restrict`), `team_view` column in web matrix.
- **v159.2** — `team_view` action added to `PERMISSIONS_SCHEMA` for six resources. Server-forced own-only for workers on `/incidents`, `/hazards`, `/inspections`, `/pre-starts`, `/site-diary`, `/swms`. `?scope=me`/`?scope=team` query params. `resolve_team_scope()` helper. `org_settings` deduped with unique index.
- **v159.1** — Structural mobile gates: Ask AI, Fleet, Users tile, Compliance Hub tile hidden by module allocator. Certifications force `?scope=me` for non-privileged. New `users_directory` module. "New hardened defaults available" banner in Web Admin.
- **v159.0** — Backend security gates on `/api/suppliers`, `/api/assets`, `/api/documents/*` with worker-leak regression test suite (initial 12 cases).

For earlier history (v96.x cache-buster work, v157–v158 UI/UX polish), see the PRD.

---

## Notable subsystems

### LAN Backup Agent
`scripts/paneltec_backup_agent.py` is a long-running Python agent designed to be deployed on the customer's LAN. It polls the backend for pending backup jobs, streams local file trees back to the cloud, and reports health. Configure via CLI flags — no secrets baked into source.

### Cache-buster
Web SPA can strand users on old JS bundles when a service worker caches aggressively. Paneltec pairs two version strings:
- `frontend/public/service-worker.js#CACHE_VERSION` — bumped every release
- `frontend/src/lib/version.js#RUNNING_VERSION` — read by the app at boot
- Backend endpoint `GET /api/settings/force-refresh-signal` returns the server's expected version. If the SPA's `RUNNING_VERSION` differs, the app hard-refreshes and evicts the SW cache.

### Metro cache freshness (mobile)
Expo Metro on the dev container occasionally serves a stale bundle even after a code push. The tested reset is:
```bash
sudo supervisorctl restart mobile
rm -rf /tmp/metro-* /app/mobile/.expo /app/mobile/node_modules/.cache
# wait ~30s for Metro to re-bundle, then hard-reload the preview iframe
```

---

## License

**All Rights Reserved © Paneltec Civil.** Placeholder — replace with the appropriate license before any external distribution.

---

## Contact / Support

_Placeholder — populate with the project owner's preferred contact channel before opening the repo._
