# v58.13.132cb — Workspaces / Sites merge · Phase A · SHIPPED (finish-deferred)

## Ship rules honoured
- `testing_agent` — NOT invoked.
- `e1_tester` — NOT invoked.
- `finish` tool — NOT invoked. Per standing directive, deployment finish is deferred to a later coordinated ship. This memo documents the ship in Stephen's finish-deferred convention.
- 20 pre-existing `ephemeral-upload-storage` warnings — untouched (parked for v58.14.x).
- No `/app/mobile/` code changes; `MOBILE_BUNDLE_VERSION` unchanged.

## User pain / goal
Stephen wants the admin **Workspaces** surface and the operational **Sites** register to be a single mental object (a depot / project site), backed by one canonical DB collection. Today they live in two DB collections (`workspaces` + `simpro_sites`) with two admin pages and a redundant sidebar entry.

## Why phased (Phase A vs Phase B)
The FK `workspace_id` is on **7 collections** (`pre_starts`, `swms`, `hazards`, `inspections`, `incidents`, `assets`, `site_diary_entries`, plus `audit_exports`) with `pre_starts.workspace_id` alone hitting **16,624 documents**, and is read/written by **40+ backend modules** and **~20 frontend files**.

Renaming that field in a single ship — under the pytest-only, no-testing-agent guardrail — is a hard-to-verify blast radius. The ship is therefore split:

- **Phase A (this ship)** — Populate the new canonical `sites` collection, retire the Workspaces frontend surface, expose a new admin router at `/api/sites/admin`. Zero FK renames. The blast radius is limited to net-new writes and additive route changes.
- **Phase B (`.132cb-b`, deferred)** — Field rename sweep + retire `/api/workspaces` + drop `db.workspaces` + drop `db.simpro_sites`. Will ship as its own coordinated release with a dedicated pytest bundle.

## What shipped

### Backend
- **`backend/scripts/merge_workspaces_into_sites_v58_13_132cb.py`** — Migration script. Default is DRY-RUN; `--commit` applies. Idempotent (audit stamp preserved on re-run). Actions:
  - Copies every `simpro_sites` row into `sites` with `id = simpro_site_id`, `source = "simpro"`.
  - Promotes every non-deleted `workspaces` row into `sites` with `source = "workspace_promoted"`, preserving `id` so existing `workspace_id` FKs still resolve.
  - Stamps `_workspace_migrated_at` audit field once per doc.
  - Sets each org's `default_site_id` to its `default_for_org=True` workspace id.
- **`backend/sites_admin.py`** — New admin CRUD router mounted at `/api/sites/admin` (chosen prefix so it does NOT collide with the pre-existing public site scan router at `/api/sites` in `sites_qr.py`). Endpoints:
  - `GET /api/sites/admin` — list sites for caller's org, includes `source` field so admins can distinguish simpro-imported from workspace-promoted.
  - `POST /api/sites/admin` — create a manual site (admin only, `source="manual"`).
  - `PATCH /api/sites/admin/{sid}` — admin only.
  - `DELETE /api/sites/admin/{sid}` — admin only, soft-delete.
- **`backend/server.py`** — Mounted `sites_admin_router` alongside `workspaces_router`.
- **`backend/settings_nav_registry.py`** — Kept the `workspaces` key with a deprecation comment so pre-.132cb saved nav-layout payloads still validate on `PUT /api/settings/nav-layout` during the grace window.

### Frontend
- **DELETED** `frontend/src/pages/Workspaces.jsx`.
- **`frontend/src/App.js`** — Removed `import Workspaces` and changed the `/app/settings/workspaces` route to redirect to `/app/settings/sites` (preserves old bookmarks).
- **`frontend/src/components/layout/AppShell.jsx`** — Removed the `Workspaces` entry from the Settings sidebar section.
- **`frontend/src/lib/settingsNavRegistry.js`** — Removed the `workspaces` registry entry. `SettingsNav.jsx` filters unknown keys via `SETTINGS_NAV_BY_KEY[key]` returning `undefined`, so pre-.132cb saved layouts referencing the retired key still render (silently skip).

### DB state (verified live)
```
BEFORE: workspaces_active=11, workspaces_total=16, simpro_sites=17, sites=0, orgs=11
AFTER : sites=27, orgs.default_site_id set for 1 org
```
Paneltec org (`3116f250-...`) now shows **3 sites** via `GET /api/sites/admin`:
- 2 × `source=simpro` (Paneltec Depot, New Paneltec Depot)
- 1 × `source=workspace_promoted` ("Work Admin", 19 Connector Park Drive)

### Version bump
- `frontend/src/lib/version.js` — `RUNNING_VERSION` bumped `.132ca` → `.132cb`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped `.132ca` → `.132cb`.
- `mobile/src/lib/version.ts` — untouched.

## Pytests (`backend/tests/test_v58_13_132cb_workspaces_sites_merge.py`)
13 checks, all green:
- Migration script exists with `--commit` and `--dry-run`; default is dry-run.
- Script upserts into `sites` from both sources and preserves the `_workspace_migrated_at` audit stamp on re-run.
- `sites_admin.py` mounted at prefix `/sites/admin`.
- `server.py` mounts both `sites_admin_router` (new) and `workspaces_router` (retained for Phase B).
- Frontend `Workspaces.jsx` deleted.
- Sidebar `Workspaces` entry retired (no `label: 'Workspaces'` and no `testid: 'nav-settings-workspaces'` in AppShell.jsx).
- Frontend registry no longer exports `workspaces` key.
- Backend registry keeps `workspaces` key (grace window).
- `App.js` redirects `settings/workspaces` → `/app/settings/sites` and does NOT import `pages/Workspaces` on any uncommented line.
- Version-sync forward-safe pins ≥ .132cb on both `version.js` and `service-worker.js`.
- Behavioural round-trip (marked `@pytest.mark.live_db_writes`): seed 1 active + 1 retired workspace + 1 simpro site in a scratch org, run `--commit`, confirm sites populated with correct `source` labels, retired workspace skipped, audit stamp preserved on re-run.

## Live curl trace
```
POST /api/auth/login {stephen} → token
GET  /api/sites/admin           → 3 rows [simpro, simpro, workspace_promoted]
```

## Screenshot
- `/tmp/132cb_after_redirect.jpeg` — `/app/settings/workspaces` → redirect fires → lands on `/app/settings/sites`; sidebar no longer shows the "Workspaces" entry.

## NOT changed
- `useWorkspace` / `wsParams` React context — untouched; every page still filters records by `workspace_id`.
- TopBar workspace switcher — untouched (already auto-hides at ≤1 workspace via `.132ak`).
- Public site scan flow (`sites_qr.py` at `/api/sites/{id}/scan-pdf`, `/api/scan/site/:token`) — untouched.
- Simpro sync path (`integrations_simpro.py` writes to `simpro_sites`) — untouched for Phase A. Phase B will retarget to `sites` and drop `simpro_sites`.
- `/api/workspaces` router — retained. Phase B retires it with 410.
- `db.workspaces` collection — retained. Phase B drops it.
- FK `workspace_id` on 7 collections — untouched. Phase B renames to `site_id`.
- `users.workspace_ids` — untouched. Phase B renames to `site_ids`.
- `/app/mobile/` code — untouched (only public site endpoints are consumed by mobile).
- 20 pre-existing `ephemeral-upload-storage` lint warnings — parked for v58.14.x.

## Phase B (`.132cb-b`) checklist for the next ship
1. Field-rename script `rename_workspace_id_to_site_id_v58_13_132cb_b.py` with `--commit` + per-collection idempotency guards.
2. Backend sweep across 40+ modules (see `.132cb` version comment in `version.js` for the full list).
3. Frontend sweep: `useWorkspace` → `useSite`, `wsParams` → `siteParams` across ~20 pages.
4. Retire `/api/workspaces` router with a 410 response.
5. Drop `db.workspaces` + `db.simpro_sites` collections.
6. Retire `workspaces` key from `backend/settings_nav_registry.py`.
7. Dedicated pytest bundle + version bump `.132cb-b`.

## finish tool
Deferred by design. Handed off to the next fork with this memo.
