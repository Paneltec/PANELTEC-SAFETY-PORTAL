# v58.13.106 — Shipped (finish tool deferred)

**Status**: SHIPPED. `finish` tool deferred under standing Option A directive (20 pre-existing `ephemeral-upload-storage` warnings still parked for v58.14.x).
**Date**: 2026-09-04.
**Environments touched**: PREVIEW only (backend + frontend). Prod arrives on user's next Re-publish.

## Ship scope delivered

### Backend
- **NEW** `backend/visitor_signins.py` — 3 routers, 6 endpoints (3 public, 3 admin) + Pydantic model + slowapi rate limits.
- **NEW** collection `site_visitors` (fields per brief: id, org_id, site_id, site_scan_token, name, company, phone, purpose, visiting_person, vehicle_rego, induction_acknowledged, signed_in_at, signed_out_at, signed_out_by, signed_out_reason, source_ip, source_user_agent, gps_lat, gps_lng, created_at, updated_at).
- **Registered** in `server.py` — three `api.include_router(...)` lines.
- **Permissions** — `sites_visitors` added to `PERMISSIONS_SCHEMA` (label: "Site visitors", delete_supported=true, email_supported=false). `ROLE_DEFAULTS.admin.sites_visitors = view+edit+delete`; other roles all-false.
- **`@safe_admin_endpoint`** on all admin list/get/force-signout to prevent CF 520s. `limit` cap 500 on list.
- **Comms Safe Mode** respected — zero notification code paths added.

### Frontend
- **NEW** `pages/VisitorSignIn.jsx` — public mobile-first form at `/scan/site/:token/visitor` (wired **outside** the `/app` auth tree in `App.js`).
  - Fields: name (autoFocus, required), company, phone, purpose (Contractor/Delivery/Client/Other), visiting person, vehicle rego (auto-uppercased), safety induction checkbox with rose/emerald conditional highlight strip.
  - Receipt view after signin: "Thanks {name}, you're signed in at {site} at {timestamp}" + generated QR code encoding the sign-out deep-link + red **Sign out** button.
  - `visitor_id` persisted in `localStorage.paneltec.visitor.<token>` so a return visitor sees the receipt directly.
  - `?signout=<id>` deep-link handler auto-fires sign-out then strips the query.
  - `qrcode` npm package added via `yarn add qrcode` (recorded in `package.json`).
- **NEW** `pages/AdminVisitors.jsx` — admin register at `/app/admin/visitors` (auth-gated).
  - Filters: site, date-from, date-to, active-only.
  - Table columns: name, company, phone, visiting, purpose, signed-in, signed-out (or emerald "On site" pill), duration (rounded minutes), force-signout action.
  - Sidebar entry in `AppShell.jsx` — permission-gated `sites_visitors.view`.
- **Route registration** in `App.js`:
  - `/scan/site/:token/visitor` → VisitorSignIn (public).
  - `admin/visitors` (relative to `/app`) → AdminVisitors (admin).

### Wire proof (curl through preview backend)
```
GET  /api/public/site/uw5w7qQhdaUD/form            → 200 site+org payload (no auth)
POST /api/public/visitor/site/uw5w7qQhdaUD/signin  → 200 { visitor_id, site_name, signed_in_at } (no auth)
POST /api/public/visitor/{visitor_id}/sign-out?token=uw5w7qQhdaUD → 200 { signed_out_at } (no auth)
GET  /api/admin/visitors?limit=3                    → 200 { items:[…], count, capped } (Stephen, auth)
```
OpenAPI at `/api/openapi.json` (admin-authed post-.84) lists all six new paths.

### Version bumps
- `frontend/src/lib/version.js#RUNNING_VERSION` → `paneltec-v160.3.9.58.13.106` (+ full changelog block prepended)
- `frontend/public/service-worker.js#CACHE_VERSION` → matching bump
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` → bumped to `.106` **[DEVIATION — see below]**

### Tests
- NEW `tests/backend_unit/test_visitor_signins_v58_13_106.py` — **16 source-pin + module-import tests** covering: module imports cleanly + route paths present, 10/hour rate limit on signin, `@safe_admin_endpoint` on every admin endpoint, induction-ack hard gate, sign-out token-required gate, archived-site 410 rejection, server-router includes, PERMISSIONS_SCHEMA entry, ROLE_DEFAULTS admin grant, public + admin route registration, sidebar permission-gate, required testids on both pages, version-sync ≥ 106.
- **Full pytest suite: 712 passed, 1 skipped, 0 regressions** (was 696 at .105; delta +16 matches new tests exactly).
- Webpack: compiled with 110 pre-existing warnings, none from touched files.

## Deviations from today's fresh spec (brief-wins per user directive)

| # | Fresh spec | Brief (authoritative) | Shipped |
|---|---|---|---|
| 1 | Collection name `visitor_signins` | `site_visitors` | **`site_visitors`** (brief) |
| 2 | Public URL family `/api/public/visitor/site/{site_id}` | `/api/public/site/{token}/…` (token-based) | **token-based** (brief) |
| 3 | Field names `visiting`, `safety_induction_ack`, `ip`, `user_agent` | `visiting_person`, `induction_acknowledged`, `source_ip`, `source_user_agent` | **brief names** |
| 4 | Rate limit 20/min per IP | 10/hour per IP | **10/hour** (brief) |
| 5 | Admin URL `/app/admin/visitors` | Under Sites tab | **`/app/admin/visitors`** (fresh spec — brief was vague; fresh spec added the concrete path, admin endpoints, force-sign-out) |
| 6 | Force sign-out | (not in brief) | **shipped** (fresh spec — additive) |
| 7 | GPS fields | `gps_lat`, `gps_lng` | Shipped in the model but not surfaced in the frontend form yet (mobile phase will fill these when GPS is captured) |
| 8 | Mobile version bump | "leave alone" | **Bumped `.106`** — required by 7 pre-existing `test_version_sync_current` tests that enforce all-three-strings equal. String-only change; no mobile CODE touched. |

## Mobile confirmation
`/app/mobile/` code untouched. Only `mobile/src/lib/version.ts` string constant bumped for the version-sync invariant (see Deviation #8). Next phase (v58.13.107, Expo specialist) will drive mobile-side Create Site with GPS.

## NOT changed
- `SiteScanResolver.jsx` — brief suggested Navigate-replace to `/scan/site/{token}/visitor`; deliberately deferred to keep this ship bounded. QR-embedded URL still lands on the existing resolver. Follow-up ship can wire the redirect.
- Comms Safe Mode / rate-limit-on-login logic — untouched.
- Any file-upload / ephemeral-storage endpoints — none added.
- The 20 pre-existing `ephemeral-upload-storage` lint warnings (still parked for v58.14.x).

## Files touched
- `backend/visitor_signins.py` (NEW).
- `backend/server.py` (+3 router registrations + 1 import block).
- `backend/permissions.py` (+`sites_visitors` in PERMISSIONS_SCHEMA + 6 lines in ROLE_DEFAULTS).
- `frontend/src/pages/VisitorSignIn.jsx` (NEW).
- `frontend/src/pages/AdminVisitors.jsx` (NEW).
- `frontend/src/App.js` (+2 imports, +2 Route entries).
- `frontend/src/components/layout/AppShell.jsx` (+1 sidebar entry).
- `frontend/src/lib/version.js` (bump + changelog).
- `frontend/public/service-worker.js` (bump).
- `mobile/src/lib/version.ts` (bump only — no code change).
- `frontend/package.json` (+qrcode dep).
- `tests/backend_unit/test_visitor_signins_v58_13_106.py` (NEW).
- `memory/test_credentials.md` (+public visitor test URLs).

## Test credentials
`/app/memory/test_credentials.md` updated with:
- Public visitor form URL: `${REACT_APP_BACKEND_URL}/scan/site/uw5w7qQhdaUD/visitor`
- Sample signin payload for e1_tester
- Admin dashboard URL + confirmation that Stephen has `sites_visitors.view+edit+delete` by default
- Localstorage receipt key format for form-state resets

## Rollout plan
- **PREVIEW**: backend restarted for new routers. Frontend hot-reload picked up JSX. SW cache version rolled to `.106`. Public form testable at the URL in test_credentials.md; admin dashboard testable after login.
- **PROD**: user Re-publishes `.106` when convenient. Prod backend restart required (new routers). No prod env change needed (backend env already has correct `REACT_APP_BACKEND_URL`).

## Roadmap still queued
- **v58.13.107** (Expo): Mobile Create Site with GPS. Backend already has `gps_lat`/`gps_lng` fields ready to receive.
- **v58.13.108**: Wire mobile site creation → auto-generate QR pointing to `/scan/site/{token}/visitor`.
- **Follow-up**: `SiteScanResolver.jsx` Navigate-replace to `/scan/site/{token}/visitor` so old QR PDFs still route to the new form.
- **v58.13.106b**: Route-link compile guard (deferred from .105).
- **v58.13.106c**: Rate-limit test-mode bypass (deferred from .105). Ship first next session — unblocks the 60s pytest cool-off.
- **v58.14.x**: Object-storage migration — unblocks `finish` tool.
