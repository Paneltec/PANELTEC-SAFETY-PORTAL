# v58.13.109 — Shipped (finish tool deferred)

**Status**: SHIPPED. `finish` tool deferred under standing user directive (20 pre-existing `ephemeral-upload-storage` warnings still parked for v58.14.x).
**Date**: 2026-09-04.
**Environments**: PREVIEW only (backend restarted; frontend hot-reload picked up). Prod on next Re-publish.
**Testing gate**: `testing_agent` NOT invoked per your standing rule. Self-verified via `curl` + `pytest` + Playwright screenshot for the sidebar badge.

## TL;DR
Full P2 + P3 backlog batched into one ship as a single `.109` bump (per your "bundle if code changes are all in .109" clause). 5 items, all landed cleanly. **983 passed / 2 skipped / 2 pre-existing failures** on the immutable mobile palette file.

## Task 1 — Rate-limit test-mode bypass
- **Files touched**: `backend/rate_limit.py`.
- **Change**: added `_is_prod()`, `_bypass_signals_present()`, `_resolve_bypass()`, module-init `_BYPASS_ACTIVE`. Both `limiter` and `user_limiter` now instantiate with `enabled=not _BYPASS_ACTIVE`.
- **Signals** (any triggers bypass): `TEST_MODE_BYPASS_RATE_LIMIT=true`, `ENV=test`, or `PYTEST_CURRENT_TEST` set by pytest itself.
- **Guardrail**: `ENV=prod` OR `IS_PROD=true` REFUSES bypass unconditionally + emits a `log.critical` line. Checked LAST so any conflicting env combo (e.g. `TEST_MODE_BYPASS_RATE_LIMIT=true` + `ENV=prod`) lands on "prod wins".
- **Pytests**: 6 in `test_rate_limit_bypass_v58_13_109.py` (bypass on w/ env var, disabled default, refused-in-prod covering both ENV=prod and IS_PROD=true, ENV=test signal, PYTEST_CURRENT_TEST signal, `Limiter.enabled` structural pin).

## Task 2 — Route-link compile guard
- **Files touched**: `frontend/scripts/check-routes.js` (NEW, 168 lines), `frontend/package.json` (+1 script entry).
- **Change**: Node CLI that parses `App.js` `<Route path="…">` registrations (depth-1 stitching of nested routes to `/app/{path}`), walks `frontend/src/` for six navigation-target patterns (`to="…"`, `to='…'`, template literals, `navigate("…")`, `navigate('…')`, backticked navigate). Cross-checks with React-Router-v6 `:param`-aware matching. Non-zero exit + human-readable diff on any dead link.
- **Wiring**: `yarn --cwd frontend check-routes`. INFO ONLY for this ship — not build-blocking yet.
- **Current preview state**: script correctly reports 4 dead-link findings (3 real `/app/settings` "Back to Settings" targets, 1 false positive from a comment in `version.js`) — all pre-existing tech debt, out of scope for .109.
- **Pytests**: 4 in `test_check_routes_script_v58_13_109.py` (file exists, shebang + main dispatch, package.json script entry, pattern-fragment source pin).

## Task 3 — Precast Panel role permissions
- **Finding**: NO drift. Direct DB inspection showed `custom_precast_panel_employee` already has 16 tokens byte-for-byte equal to `custom_construction_worker_l1`. The "empty permissions array" the brief referenced was a UI-label mismatch — the Roles Admin surface labels `permission_tokens[]` as "Permissions" (plural), and someone looking at the raw doc expected a top-level `permissions` field (singular) that doesn't exist.
- **Canonical storage path** (documented in `memory/v58_13_109_permissions_storage_trace.md`): `db.roles.permission_tokens[]`, keyed by `role_id`, tokens are `"{resource}.{action}"` strings matching `PERMISSIONS_SCHEMA × ACTIONS`.
- **Ship = regression-lock**: 4 pytests in `test_precast_panel_permissions_v58_13_109.py`:
  1. `test_canonical_storage_path_is_db_roles_permission_tokens` — storage path pin.
  2. `test_precast_panel_has_16_tokens` — count pin.
  3. `test_precast_panel_tokens_match_construction_worker_l1_exactly` — symmetric-difference diff on any drift.
  4. `test_precast_panel_carries_core_daily_loop_tokens` — spot-check on the six load-bearing daily-loop tokens.
- **Not touched**: no data migration, no seed script. Precast Panel state is correct as-is.

## Task 4 — Orphan maintenance vacuum
- **Files touched**: `backend/scripts/vacuum_orphan_maintenance_v58_13_109.py` (NEW, 200 lines).
- **Manual invocation only**. Two idempotent passes: (1) insert a minimal `assets` row per distinct orphan rego (kind="vehicle", source="orphan_backfill", unique scan_token per row so the existing `scan_token_1` unique index doesn't collide across backfills, orphan_backfill_run_id stamp), (2) set `plant_id` + `registration_matched=True` on every unparented plant_maintenance row whose registration_no now matches an asset.
- **Preview state at ship day**: 346 orphan rows across 54 distinct regos (brief said ~104 — the field-observed count is 54; noted). Script NOT run against prod data during this ship — that's a follow-up admin action.
- **Pytests**: 3 in `test_vacuum_orphan_maintenance_v58_13_109.py` — `_norm_rego` pure fn check, seed-3-and-verify end-to-end (with `TESTV13109_` rego prefix so it can't touch the 346 real orphans, plus scoped re-parent inline in the test), idempotency check. Bound to a fresh motor client per test-loop because the module-level `db.db` singleton is loop-bound and can't cross event loops.
- **Compliance**: no email/SMS, no scheduler hooks, no audit table writes.

## Task 5 — Sidebar Certifications badge
- **Files touched**:
  - `backend/worker_certifications.py` — new `GET /api/certifications/expiry-count?window_days=30` endpoint. `@safe_admin_endpoint` wrapped. Default window 30 (matches `EXPIRING_SOON_DAYS`), 1..365. Scope mirrors `list_all_certs`: privileged (admin/hseq_lead/supervisor) sees the org, everyone else auto-scoped to their own worker row. Returns `{expired, expiring_soon, window_days}`.
  - `frontend/src/components/layout/AppShell.jsx` — `certBadge` state + `useEffect` polling `/certifications/expiry-count` on mount + on every route change (no interval — pathname granularity is fine for a "second-opinion" pill). Threads `badges={{ certExpiry: certBadge }}` to `SidebarShell` (desktop) and the `<Sheet>` mobile drawer's `<SidebarNav>`.
  - `frontend/src/components/settings/SettingsNav.jsx` — new `SidebarBadgesContext` (module-scoped so we don't touch six function signatures for one feature). `SortableItem` reads the context and renders a red `bg-red-600` pill next to the label when the registry entry carries `badgeKey` AND the context has a positive total.
  - `frontend/src/lib/settingsNavRegistry.js` — added `badgeKey: 'certExpiry'` to the Certifications entry.
- **Curl proof (ship-day)**:
  - `GET /api/certifications/expiry-count` (default 30d, admin) → `{"expired":72,"expiring_soon":0,"window_days":30}`
  - `GET /api/certifications/expiry-count?window_days=90` (admin) → `{"expired":72,"expiring_soon":6,"window_days":90}`
  - Unauth → `401 {"detail":"Not authenticated"}`
  - `window_days=500` → `422 {"detail":"window_days must be in [1, 365]"}`
- **Screenshot proof (Playwright)**: sidebar renders `nav-settings-certifications-badge` = "72", tooltip = "72 expired · 0 expiring soon". Total >99 collapses to "99+". Silent zero on network failure (pill just vanishes).
- **Discovery-in-flight**: the Settings section is rendered by `SettingsNav.jsx` (draggable) from `settingsNavRegistry.js` — NOT the flat `NAV` array in `AppShell.jsx`. Wire had to be redone against the actual render path; badge context is the minimum-invasive fix.

## Version bumps confirmed
```
frontend/src/lib/version.js:       RUNNING_VERSION        = 'paneltec-v160.3.9.58.13.109'
mobile/src/lib/version.ts:         MOBILE_BUNDLE_VERSION  = 'paneltec-v160.3.9.58.13.109'
frontend/public/service-worker.js: CACHE_VERSION          = 'paneltec-v160.3.9.58.13.109'
```
One consolidated changelog block at the top of `version.js` (per your "bundle if all in .109" instruction). `/app/mobile/` code UNTOUCHED except the version constant.

## Full-suite state
**983 passed / 2 skipped / 2 pre-existing failures** (mobile-palette on the untouchable `/app/mobile/colors.ts` file — same as .106a/.107/.108).

## Pytest tally added by .109
- `test_rate_limit_bypass_v58_13_109.py` — 6 tests
- `test_check_routes_script_v58_13_109.py` — 4 tests
- `test_precast_panel_permissions_v58_13_109.py` — 4 tests
- `test_vacuum_orphan_maintenance_v58_13_109.py` — 6 tests (3 migration + 3 version-sync)
- **Total: 20 new pytests, all green.**

## Compliance rails (unchanged, still enforced)
- No `testing_agent` invocation.
- No background email/SMS. Regex-scanned mobile_sites/mobile-adjacent modules on prior ships; no comms paths added here.
- No new ephemeral-upload endpoints.
- 20 pre-existing `ephemeral-upload-storage` lint warnings deferred to v58.14.x.
- `/app/mobile/` code UNTOUCHED (only version constant).

## Next action items (rolled forward)
- **v58.13.107 (Expo hand-off)**: Build Mobile Create-Site screen against `/api/mobile/sites` endpoints from .107.
- **v58.13.109-followup**: Wire `check-routes` into a pre-commit or pre-build hook (currently informational only).
- **v58.13.109-followup**: Run `python -m backend.scripts.vacuum_orphan_maintenance_v58_13_109` against preview to clear the 346 real orphans (out of scope for this ship — deliberate).
- **v58.13.109-followup**: Consider fixing the 3 real `/app/settings` dead links `check-routes` surfaced (Ui.jsx:22, FormAssignmentsAdmin.jsx:387, SystemSettings.jsx:183) — pre-existing tech debt.
- **v58.14.x**: Object-storage migration to clear the 20 ephemeral-upload lint warnings.
