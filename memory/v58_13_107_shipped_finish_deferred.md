# v58.13.106a + v58.13.107 — Shipped (finish tool deferred)

**Status**: BOTH SHIPPED. `finish` tool deferred under standing user directive (Option A — 20 pre-existing `ephemeral-upload-storage` warnings still parked for v58.14.x object-storage migration).
**Date**: 2026-09-04.
**Environments touched**: PREVIEW only. Prod on next Re-publish.
**Testing gate**: `testing_agent` NOT invoked per user's explicit standing rule. Self-verified via curl + pytest (938 → 952 passing) + Playwright screenshots on the .106a route bounce.

---

## v58.13.106a — Public Visitor Route Guard (P0 close-out for the .106 ship)

### Frontend edits
- **`frontend/src/App.js`** — swapped registration order so `/scan/site/:token/visitor` is declared BEFORE the bare `/scan/site/:token`. Matches React Router v6's static-segment ranking and locks the pair against future codemod drift.
- **`frontend/src/pages/SiteScanResolver.jsx`** — added `Navigate` import + guard `if (!user) return <Navigate to={/scan/site/${token}/visitor} replace/>` placed AFTER every hook (rules-of-hooks invariant preserved). Old QR codes minted before .106 now bounce anon scanners straight to the .106 visitor form instead of dumping them into the SWMS-ack kiosk flow authored for workers. Authed users unchanged.

### Wire proof (Playwright screenshot on preview)
- `/scan/site/uw5w7qQhdaUD/visitor` (no auth) → VisitorSignIn renders with "Welcome to Paneltec Depot".
- `/scan/site/uw5w7qQhdaUD` (no auth) → immediately redirects (Navigate replace) to `/scan/site/…/visitor`; URL bar updated, no back-loop.

### Tests (all green)
- **NEW** `tests/backend_unit/test_route_guards_v58_13_106a.py` — 7 pytests: route-ordering pin, `Navigate` import, guard target + `replace` flag, guard placed after `useMemo(filteredWorkers)` hook, version-sync ≥ .106a.
- **Widened** the legacy version-sync regex `paneltec-v[\d.]+\.(\d+)` → `paneltec-v[\d.]+\.(\d+)[a-z]*` across 40 test files and the `CANONICAL_RE` in `tests/frontend_smoke/test_version_sync_v58_13_13.py`, so `.106a` / future `.NNN<letter>` hot-fix suffixes don't break the guardrail. Bulk-mechanical widening — no test semantics changed.

---

## v58.13.107 — Backend Prep for Mobile "Create Site with GPS"

### Backend
- **NEW** `backend/mobile_sites.py` (280 lines) exposing three authenticated endpoints under the shared `/mobile/sites` router:
  - `POST /api/mobile/sites` — create-or-dedupe. Body `{name, gps_lat, gps_lng, gps_accuracy_m?, address?, suburb?, state?}`. Response `{created:bool, site:{..., scan_token, visitor_url}}`. Uses a 50 m haversine dedupe against active sites in the caller's org. Pre-.106 rows without a `scan_token` get one lazily provisioned on the dedupe path so the mobile app always gets a usable QR.
  - `GET /api/mobile/sites/mine?active=true` — `@safe_admin_endpoint` wrapped. Sites scoped to `org_id + created_by=self`, sorted `created_at desc`, capped at 500.
  - `PATCH /api/mobile/sites/{id}/close` — `@safe_admin_endpoint` wrapped. Sets `closed_at` + `closed_by`, idempotent (`already:true` on re-close), 403 unless caller is creator OR admin.
- **`backend/server.py`** — 2 lines added: `from mobile_sites import router as mobile_sites_router` + `api.include_router(mobile_sites_router)`.
- **Storage**: rows go into the existing `simpro_sites` collection so mobile-created sites appear in SitesAdmin, SiteScanResolver, and the v58.13.106 visitor sign-in resolver with zero further wiring. Every mobile row carries `source: "mobile_create"` for admin-side filtering. `simpro_site_id` is set to `MOBILE-<first-12-of-id>` so downstream queries keyed on that field continue to work.

### Compliance rails (per today's directive)
- All three endpoints depend on `get_current_user` — no public path.
- GET + PATCH wrapped in `@safe_admin_endpoint` (regex-anchored to sit BELOW `@router.<verb>`); POST deliberately NOT wrapped so its 422 (pydantic validation) and 200-with-`created=false` (dedupe) responses stay part of the mobile-app contract.
- Zero comms side-effects. Pytest regex-scans mobile_sites.py source for `queue_email_doc / graph_send_mail / safe_send_sms / tm_send / outbound_emails / comms_outbox / notifications` — all absent. ContextVar HTTP gate respected by never firing any comms path in the first place.
- No APScheduler hooks. No background tasks.

### Haversine dedupe
- `DEDUPE_RADIUS_M = 50.0`. Pure-Python haversine, `_EARTH_RADIUS_M = 6_371_000`, `atan2`. Sanity pinned via a Sydney Opera-House → Sydney-Tower reference distance (~1.6 km ± 100 m tolerance) + a 40 m offset < radius invariant.

### Visitor URL shape
- Response `site.visitor_url` returns the absolute `{origin}/scan/site/{token}/visitor` URL so the Expo app can drop it straight into a `qrcode.toDataURL(...)` call without stitching a base URL client-side. Origin resolved via the same precedence chain as `qr_common.resolve_public_base()` — `REACT_APP_BACKEND_URL → PUBLIC_APP_URL → FRONTEND_PUBLIC_URL` — duplicated inline to sidestep a circular import.

### Wire proof (curl through preview backend, ship-day)
- Login stephen@paneltec.com.au → JWT.
- POST /api/mobile/sites (Sydney CBD, -33.865143 / 151.2099) → `created=true`, scan_token `IAft4komPywh`, `visitor_url: https://whs-compliance.preview.emergentagent.com/scan/site/IAft4komPywh/visitor`.
- POST /api/mobile/sites (+5 m offset) → `created=false`, same row returned.
- POST /api/mobile/sites (500 m south) → `created=true`, second row.
- GET /api/mobile/sites/mine?active=1 → count=3 (2 new + pre-existing Paneltec Depot).
- PATCH /{id}/close → `already=false`, closed_at stamped.
- PATCH /{id}/close (re-fire) → `already=true`, same closed_at.
- GET /api/mobile/sites/mine?active=0 → count=3 (closed sites still visible).
- Test rows cleaned up via `db.simpro_sites.delete_many({source:'mobile_create', name:{$in:['Mobile Test Alpha','Mobile Test Bravo']}})`.

### Tests (all green)
- **NEW** `tests/backend_unit/test_mobile_sites_v58_13_107.py` — 13 pytests: route registration (via APIRouter introspection), server.py wire-in, `@safe_admin_endpoint` ordering, POST auth-gated but NOT wrapped, no comms side-effects, DEDUPE_RADIUS_M=50 + haversine implementation, runtime haversine sanity, `visitor_url` shape, close idempotency + 403 gate, `source:"mobile_create"` marker, version-sync ≥ .107.

---

## Full test-suite state
- **952 passed / 2 skipped / 2 pre-existing failures** unrelated to either ship:
  - `test_civil_mobile_palette_v58_13_68` — mobile `colors.ts` file untouchable per user rule; pre-existing since the palette-refresh sweep never landed there.
  - (Recovered) The 10 collection ERRORs seen earlier in the session on `test_schedule_attachments_v58_13_14` + `test_schedule_delete_cascade_v58_13_16` cleared once the 5/min login rate limit cooled off.

## Version bumps (mandatory — done for BOTH ships in sequence)
- `frontend/src/lib/version.js` RUNNING_VERSION → `paneltec-v160.3.9.58.13.106a` → `paneltec-v160.3.9.58.13.107` (with a fresh changelog block prepended before each bump).
- `mobile/src/lib/version.ts` MOBILE_BUNDLE_VERSION → `.107` (constant only — `/app/mobile/` code untouched per user's absolute rule).
- `frontend/public/service-worker.js` CACHE_VERSION → `.107`.

## Files touched (both ships combined)
### v58.13.106a
- `frontend/src/App.js`
- `frontend/src/pages/SiteScanResolver.jsx`
- `frontend/src/lib/version.js` (changelog block + RUNNING_VERSION)
- `frontend/public/service-worker.js` (CACHE_VERSION only)
- `mobile/src/lib/version.ts` (constant only)
- `tests/backend_unit/test_route_guards_v58_13_106a.py` (NEW)
- 40 existing test files with the mechanical version-regex widening

### v58.13.107
- `backend/mobile_sites.py` (NEW)
- `backend/server.py` (2 lines)
- `tests/backend_unit/test_mobile_sites_v58_13_107.py` (NEW)
- `frontend/src/lib/version.js` (changelog block + RUNNING_VERSION)
- `frontend/public/service-worker.js` (CACHE_VERSION only)
- `mobile/src/lib/version.ts` (constant only)

## NOT changed
- Backend auth model / rate limits / interceptors / existing endpoints (both ships).
- `/app/mobile/` code — only the version constant string.
- Any comms / notifications / outbox / scheduler code paths.
- The 20 pre-existing `ephemeral-upload-storage` lint warnings — deferred to v58.14.x per user's standing rule.

## Next Action Items
- **v58.13.107 (Expo specialist hand-off — next session)**: Build the Mobile Create-Site screen. Consume POST /api/mobile/sites, render `visitor_url` as an on-screen QR, push to a LiveSites list, use GET /mobile/sites/mine + PATCH /{id}/close for daily close-out.
- **v58.13.108**: Wire mobile site creation to auto-generate QR pointing at `/scan/site/{token}/visitor` (already returned in the .107 response body — just needs Expo rendering).
- **v58.13.106b**: `frontend/scripts/check-routes.js` compile-time route-link validity guard.
- **v58.13.106c**: `TEST_MODE_BYPASS_RATE_LIMIT` env toggle in `backend/rate_limit.py` — unblocks the two schedule_attachments HTTP tests that currently flake under the 5/min login limit.
- **v58.14.x**: Object-storage migration to clear the 20 ephemeral-upload lint warnings.
