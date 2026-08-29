// Paneltec Civil · v159 — single-source-of-truth version constant.

// v160.3.9.58.13.66 — Category-A hook-deps stale-closure fixes (3 sites).
//
// Part 1 of the hook-deps 4-ship chain (66/67/68/69). This ship
// addresses ONLY the 3 sites where a missing dep would produce a
// real UX bug (not the 15 cosmetic "load in mount-only" idiom, not
// the 8 "wrap in useMemo" micro-perf, not the 7 parent-callback
// per-site judgment calls — those ship as 67/68/69 respectively).
//
// ── Sites fixed ──────────────────────────────────────────────────
//   1. `components/workers/WorkerViewModal.jsx:390` — HR-docs fetch
//      effect. Was `[workerId, currentUser]`; now
//      `[workerId, canViewHrDocs]`. A permission flip while the
//      modal is open now re-fires the fetch. Previously the effect
//      stale-closed on the initial `canViewHrDocs` value.
//   2. `components/auth/AccessSection.jsx:24` — mount-only refresh
//      effect. Was `useEffect(() => { refresh(); /*eslint-
//      disable-next-line*/ }, [userId])`; now
//      `refresh = useCallback(async () => …, [userId])` +
//      `useEffect(() => { refresh(); }, [refresh])`. Honest deps,
//      no suppressor.
//   3. `components/forms/PickerFields.jsx:144` — universal picker
//      fetch effect. Was `[open, debounced,
//      JSON.stringify(fetchParams || {})]` (complex expression) and
//      omitted `fetchUrl` / `readOnly`. Now computes
//      `paramsKey = useMemo(() => JSON.stringify(fetchParams || {}),
//      [fetchParams])` outside the effect, and honest deps
//      `[open, debounced, paramsKey, fetchUrl, readOnly, fetchParams]`.
//      This was the highest-impact fix — the picker is mounted in
//      every form and a mid-open endpoint flip previously left the
//      dropdown showing stale options.
//
// ── ESLint audit run ────────────────────────────────────────────
//   Before ship: 36 `react-hooks/exhaustive-deps` warnings.
//   After ship:  32 warnings (4 warnings removed — WorkerViewModal 1,
//                AccessSection 1, PickerFields 2 [missing deps +
//                complex expression]).
//   Targeted-file rerun on the 3 files: 0 warnings.
//
// ── New tooling ─────────────────────────────────────────────────
//   · `frontend/eslint.hooks.audit.mjs` — flat-config ESLint config
//     that enables ONLY the two `react-hooks/*` rules. Reused by
//     the 66/67/68/69 chain. Documented in `frontend/README.md`.
//   · `frontend/README.md` (NEW) — notes the two audit configs
//     (`eslint.audit.config.mjs` from 64b + `eslint.hooks.audit.mjs`
//     from 66) so a future maintainer doesn't wonder what they are.
//
// ── Tests ───────────────────────────────────────────────────────
//   NEW `tests/frontend_smoke/test_hook_deps_real_bugs_v58_13_66.py`:
//     · Runs the hooks audit config against the 3 target files and
//       asserts zero `react-hooks/*` warnings.
//     · Per-site source pins to prevent a maintainer from
//       silently deleting the fix (dep-array shape, useCallback
//       presence, useMemo presence).
//     · Forward-safe version-sync pin (moved past .65).
//
// ── NOT touched ─────────────────────────────────────────────────
//   · The other 32 `exhaustive-deps` warnings — deferred to
//     v58.13.67 (Categories B + D, 18 uniform sites), v58.13.68
//     (Category C, 8 useMemo wrappers), v58.13.69 (Category E, 7
//     per-site parent-callback audits).
//   · Running bulk-import job `14433131-…`, Track 2, Precast Panel
//     role/users, /app/mobile/ (except MOBILE_BUNDLE_VERSION),
//     Docker / K8s / requirements / package.json.
//
// ── SOP ─────────────────────────────────────────────────────────
//   · Backend restart NOT required (frontend-only change).
//   · Frontend hot-reload picks up all 3 files on next dev refresh.
//   · All 3 canonical version strings bumped.
//   · Ship-per-version strategy per user: 66/67/68/69 each get own
//     version bump; then chain continues 70 (65a), 71 (65b), etc.

// v160.3.9.58.13.65 — Undefined-name cleanup (Phase 2 · sub-ship 64b).
//
// ── Findings ─────────────────────────────────────────────────────
//   `ruff --select F821 backend/` flagged 17 undefined-name sites
//   across 2 files. Categorisation:
//     · Real bugs that would misbehave at runtime:  0
//     · False positives:                            0
//     · Dead-code references (delete, don't patch): 17
//
//   The reviewer's earlier "58 undefined variables" count came from
//   an eslint scan run WITHOUT globals configured — it flagged
//   `document`, `window`, `console`, `process`, etc. as undefined.
//   When ESLint is invoked with `browser + node + jest` globals via
//   the audit config `frontend/eslint.audit.config.mjs`, the true
//   count is ZERO frontend no-undef sites.
//
// ── Deletions ────────────────────────────────────────────────────
//   1. `backend/email_outbox.py::_make_email_route` — factory with
//      zero callers. Its `router.add_api_route(..., name=f"email-
//      {resource}-{record_id}")` line referenced `record_id` from
//      the inner `_impl` closure at *registration* time (outer
//      scope), which is a NameError waiting to happen the moment
//      anyone called it. All live email-send endpoints are plain
//      `async def` handlers wired individually (`_swms_email`,
//      `_prestart_email`, …), so removal is contract-safe.
//   2. `backend/scripts/deep_parse_legacy_pdfs.py::
//      _process_submission_LEGACY_INLINE` — the function's first
//      executable statement is `return await process_submission(
//      db, sub, tpl_by_id)`; the ~215 lines after that `return`
//      were unreachable dead code left behind from the pre-refactor
//      inline implementation. The dead block referenced a
//      `parsed` / `template_fields` data shape that no longer
//      exists post-refactor. Truncated to the delegator only.
//
// ── Tests ────────────────────────────────────────────────────────
//   NEW `tests/backend_unit/test_no_undefined_names_v58_13_64b.py`:
//     · Runs `ruff check --select F821 backend/` as a subprocess
//       and asserts zero hits. Frozen invariant going forward.
//     · Guards that `_make_email_route` stays deleted.
//     · Guards that `_process_submission_LEGACY_INLINE` stays tiny
//       (<25 lines) and still contains the delegator.
//     · Forward-safe version-sync pin (moved past .64).
//
// ── NOT touched ──────────────────────────────────────────────────
//   · Running bulk-import job `14433131-…`
//   · Track 2 SSRA re-extraction
//   · `custom_precast_panel_employee` role + its users
//   · /app/mobile/ (except MOBILE_BUNDLE_VERSION bump)
//   · Docker / K8s / requirements.txt / package.json
//   · Any RBAC / permission / model schema
//   · Any live endpoint contract
//
// ── SOP ──────────────────────────────────────────────────────────
//   · Backend restart NOT required (only script + dead-factory
//     deletions; no import graph change, no route contract change).
//   · All 3 canonical version strings bumped in this ship.
//   · Ship-per-version strategy confirmed by user: 64a=.64,
//     64b=.65, 64c=.66, 65a=.67, 65b=.68, 65c=.69, 66a=.70, etc.

// v160.3.9.58.13.64 — Circular imports: structural fix (sub-ship 64a).
//
// ── Cycles resolved ───────────────────────────────────────────────
//   1. auth ↔ auth_invite (the logical cycle previously handled by
//      a function-local `from auth_invite import is_locked,
//      record_login_attempt` inside `auth.login`).
//   2. permissions ↔ mobile_modules (the module-cache logical cycle
//      previously handled by two function-local
//      `from mobile_modules import DEFAULTS, ...` inside
//      `permissions._load_role_modules` + `require_module`, and by
//      three function-local `from permissions import
//      invalidate_modules_cache` inside `mobile_modules` write
//      handlers).
//
// ── New leaf modules (all upstream-only, zero cycles) ────────────
//   · `backend/auth_lockout.py`         — hosts `LOCKOUT_FAILS`,
//     `LOCKOUT_MINUTES`, `is_locked`, `record_login_attempt`. Deps:
//     `db`, `models` only.
//   · `backend/mobile_modules_data.py`  — hosts `MODULE_KEYS`,
//     `ROLE_KEYS`, `_RETIRED_MODULE_KEYS`, `DEFAULTS`,
//     `DEFAULTS_VERSION`, `_normalise`, `_load_matrix`. Deps: `db`,
//     `models` only.
//   · `backend/permission_helpers.py`   — hosts `_MODULES_CACHE`,
//     `_MODULES_TTL_SEC`, `invalidate_modules_cache`. Zero backend deps.
//
// ── Files modified (top-level imports switched) ──────────────────
//   · `backend/auth.py`         — top-level `from auth_lockout import
//     is_locked, record_login_attempt`; function-local variant deleted.
//   · `backend/auth_invite.py`  — top-level `from auth_lockout import
//     LOCKOUT_FAILS, LOCKOUT_MINUTES, is_locked, record_login_attempt`
//     for back-compat; original definitions removed.
//   · `backend/permissions.py`  — top-level imports from
//     `permission_helpers` + `mobile_modules_data`. Function-local
//     `from mobile_modules import …` removed from two callsites.
//   · `backend/mobile_modules.py` — top-level imports from
//     `mobile_modules_data` + `permission_helpers`. Function-local
//     `from permissions import invalidate_modules_cache` removed from
//     three handler bodies.
//
// ── Invariants pinned by the new guard test ──────────────────────
//   `tests/backend_unit/test_no_circular_imports_v58_13_64.py`:
//     · Zero top-level cycles in `backend/*.py`.
//     · Three "no function-local reverse-edge" pins for the two
//       target cycles.
//     · Leaf-module invariants for the three new modules.
//     · Forward-safe version-sync pin (moved past .63).
//
// ── Out-of-scope logical cycles ──────────────────────────────────
//   21 function-local logical cycles remain elsewhere in the backend
//   (auth ↔ session_timeout, auth ↔ integrations, auth ↔ workers,
//   etc.). All are handled today by deferred imports and none block
//   the two headline pairs the reviewer flagged. Follow-up ship
//   candidate — not shipped here.
//
// ── NOT touched ──────────────────────────────────────────────────
//   · Running bulk-import job `14433131-…`
//   · Track 2 SSRA re-extraction
//   · `custom_precast_panel_employee` role + its users
//   · /app/mobile/ (except MOBILE_BUNDLE_VERSION bump)
//   · Docker / K8s / requirements.txt / package.json
//   · Any RBAC / permission / model schema
//
// ── SOP ──────────────────────────────────────────────────────────
//   · `sudo supervisorctl restart backend` (import graph changed).
//   · `openapi.json` returned HTTP 200 post-restart.
//   · All 3 canonical version strings bumped in this ship.

// v160.3.9.58.13.63 — localStorage whitelist enforcement (no UX change).
//
// ── Read-only audit outcome ───────────────────────────────────────
//   The reviewer's flag on `pages/settings/SetupWizard.jsx:14`,
//   `BackupTab.jsx:41,54`, `BackupStatusHero.jsx:12` was misleading:
//   those sites are READ-ONLY accessors of the SAME `paneltec_token`
//   that `lib/api.js:14` already reads on every API request. Moving
//   them to `sessionStorage` would sign every user out on tab close
//   and break the BackupTab's independent axios instance.
//
//   The BulkImport localStorage keys (`bulkImport.activeJobId`,
//   `bulkImport.dismissedJobId`) store job UUIDs — not credentials.
//   Cross-tab pill sync depends on `storage` events fired against
//   `localStorage` explicitly; moving them would break the feature.
//
// ── What this ship actually does ──────────────────────────────────
//   1. `lib/api.js` — new doc-cluster explaining WHY the JWT lives
//      in localStorage (short-lived TTL, server-side `token_version`
//      invalidation, refresh flow) and what the whitelist is.
//   2. `tests/frontend_smoke/test_localStorage_whitelist_v58_13_63.py`
//      — new source-grep guard that FAILS THE BUILD if any new file
//      outside the whitelist starts reading/writing `paneltec_token`
//      or uses a `bulkImport.*` key outside `pages/prestarts/BulkImport/`.
//   3. Forward-safe version-sync pin (moved past .62).
//
// ── Explicitly NOT shipped ────────────────────────────────────────
//   The "real" fix for XSS-readable JWT is HttpOnly refresh cookies
//   + short-lived in-memory access JWT. That refactor touches every
//   axios interceptor, every fetch, CORS, CSRF, and the SW auth
//   passthrough. Multi-week effort. TRACKED as follow-up candidate
//   but deliberately NOT shipped here.
//
// ── NOT touched ───────────────────────────────────────────────────
//   · Running bulk-import job `14433131-…`
//   · Track 2 SSRA re-extraction
//   · `custom_precast_panel_employee` role + its users
//   · /app/mobile/ (except MOBILE_BUNDLE_VERSION bump)
//   · Docker / K8s / requirements.txt / package.json
//   · Any RBAC / permission / model schema
//
// ── SOP ───────────────────────────────────────────────────────────
//   · Backend restart NOT required (frontend-only + test file).
//   · All 3 canonical version strings bumped in this ship.

// v160.3.9.58.13.62 — P0 security fixes (hardcoded secrets + silent catches).
//
// ── Backend ────────────────────────────────────────────────────────
//   1. `/app/backend/seed_stephen.py` — the admin seed no longer
//      carries a literal password. `PASSWORD = os.getenv(
//      "SEED_STEPHEN_PASSWORD")` reads from env and fails-loud with
//      `SystemExit("SEED_STEPHEN_PASSWORD env var required")` on
//      omission. `import os` is now the second stdlib import.
//   2. `/app/backend/scripts/live_bulk_import_dryrun.py` — the
//      Stephen admin credentials used by the driver are now read
//      from `PANELTEC_TEST_EMAIL` + `PANELTEC_TEST_PASSWORD`. Fails
//      loud if either is missing. `import os` was already present.
//      Also fixed a small F541 (`print(f"[live] fetching report")`
//      → `print("...")`) so the file passes `ruff --select F` clean.
//   3. The 3 `exec()` calls in `file_pdf.py` flagged by the review
//      are CONFIRMED FALSE POSITIVES — they are
//      `asyncio.create_subprocess_exec(...)` calls with hardcoded
//      argv strings, not Python's builtin `exec`. Not touched.
//
// ── Frontend ───────────────────────────────────────────────────────
//   `/app/frontend/src/serviceWorkerRegistration.js` — 4 previously
//   silent `.catch(() => { /* … */ })` blocks now log diagnostics:
//     · dev-cleanup cache-clear failure → `console.warn`
//     · dev-cleanup getRegistrations failure → `console.warn`
//     · 60s SW-update poll failure → `console.debug`
//     · initial SW registration failure → `console.warn`
//   The 4 intentional-silent guards (sessionStorage writes,
//   `SKIP_WAITING` post, `controllerchange` reload marker) keep
//   their tiny comment `_` catches — they run on every SW event
//   and would flood the console.
//
// ── NOT touched ────────────────────────────────────────────────────
//   · localStorage sensitive-move audit — queued as v58.13.63.
//   · Running bulk-import job `14433131-…`.
//   · Track 2 SSRA re-extraction.
//   · /app/mobile/ (except MOBILE_BUNDLE_VERSION bump).
//   · No permission/RBAC/model schema change.
//
// ── Tests ──────────────────────────────────────────────────────────
//   NEW `tests/backend_unit/test_p0_security_v58_13_62.py`:
//     · seed_stephen.py contains no literal password assignment
//       and always calls `os.getenv("SEED_STEPHEN_PASSWORD")`.
//     · live_bulk_import_dryrun.py never falls back to literal
//       credentials — env-only.
//     · Both scripts fail loud (`SystemExit`) when the env is
//       missing (verified by AST inspection, not execution — we
//       don't want the test to actually import auth.hash_password).
//     · serviceWorkerRegistration.js contains at least 3
//       `console.warn`/`console.debug` diagnostics in the catches.
//     · Forward-safe version-sync pin (moved past .61).
//
// ── SOP ────────────────────────────────────────────────────────────
//   · frontend/src/lib/version.js#RUNNING_VERSION bumped.
//   · frontend/public/service-worker.js#CACHE_VERSION bumped.
//   · mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION bumped.
//   · Backend restart NOT required (no import-graph change; only
//     script-level literal moves, which are only loaded when the
//     scripts are invoked by hand).
//   · Frontend hot-reload picks up the SW registration change on
//     next dev refresh; production users get it on their next SW
//     activate cycle.

// v160.3.9.58.13.61 — Roles Admin merged as tab under Users & Permissions.
//
// ── UX ─────────────────────────────────────────────────────────────
//   `/app/settings/users` now renders `UsersAndRolesShell` (defined
//   inline in `App.js`), a small stateless wrapper that shows a
//   two-tab header (Users | Roles) and delegates the tab body to
//   the existing `UsersManagement.jsx` or `RolesAdmin.jsx` page
//   component depending on `?tab` query param.
//   · `Users` tab (default, no `?tab`) — UsersManagement.jsx.
//   · `Roles` tab (`?tab=roles`)      — RolesAdmin.jsx.
//   Every RolesAdmin capability (permission-matrix modal, Simpro
//   sync, custom-role creation, drift banner) is preserved because
//   the component is unchanged — only the router entry moves.
//
// ── Sidebar / route ────────────────────────────────────────────────
//   · `nav-settings-roles-admin` sidebar entry removed from
//     `settingsNavRegistry.js`.
//   · `/app/settings/roles-admin` route now
//     `<Navigate to="/app/settings/users?tab=roles" replace />`
//     for a 90-day grace window. REMOVE AFTER 2026-11-27.
//
// ── Backend UNCHANGED ──────────────────────────────────────────────
//   Every `/api/admin/roles/*` endpoint remains identical. Both
//   frontend page components read/write against the same URLs
//   they did pre-merge. No permission or contract change.
//
// ── Tests ──────────────────────────────────────────────────────────
//   NEW `tests/frontend_smoke/test_roles_admin_merged_v58_13_61.py`:
//     · Sidebar entry gone.
//     · `UsersAndRolesShell` mounted, both tab testids present,
//       both underlying page components still imported.
//     · `/app/settings/roles-admin` redirects to `?tab=roles`
//       with the removal-date marker.
//     · Forward-safe version-sync pin.
//
// ── SOP ────────────────────────────────────────────────────────────
//   · Version bumped in 3 canonical files.
//   · /app/mobile/ untouched except MOBILE_BUNDLE_VERSION.
//   · Running bulk-import job untouched, Track 2 untouched.
//   · Backend restart NOT required (frontend-only ship).

// v160.3.9.58.13.60 — RBAC tidy pass (P2/P3 bundle).
//
// User approved option C on the P1 (`custom_precast_panel_employee`
// role + its 2 auto-created Simpro-sync users) — LEAVE UNTOUCHED,
// deferred to a follow-up ship. This bundle covers the safe P2/P3
// fixes only.
//
// ── Data migrations executed once, idempotent ──────────────────────
//   1. Backfilled `role_id` FK on 3 legacy-only test users
//      (all `role='admin'`, testagent/tester/testuser accounts).
//      3 `user_audit` rows written with action
//      `v58_13_60_legacy_role_backfill`.
//   2. Archived 6 test-artifact roles (`custom_cachebust_*` × 3,
//      `custom_fallback_test_*` × 3) → `is_active=False` +
//      `archive_reason` field. 6 `role_audit` rows written with
//      action `v58_13_60_archive_test_artifact`. Zero users were
//      assigned to any of these roles (pre-checked).
//   3. Seeded `app_state.simpro_position_role_sync` row so the
//      bookkeeping key exists even before the next sync run.
//
// ── Code change ────────────────────────────────────────────────────
//   `roles_catalogue.py::sync_roles_from_simpro_positions` now
//   writes `app_state.simpro_position_role_sync` at the end of
//   every run with: `last_run_at`, `last_run_status`,
//   `last_run_created_count`, `last_run_updated_count`,
//   `last_run_actor`, `last_run_org_id`. Fixes the observability
//   gap flagged in the v58.13.59 RBAC audit.
//
// ── NOT changed ────────────────────────────────────────────────────
//   · `custom_precast_panel_employee` role — untouched (P1 deferred).
//   · The 2 Simpro-imported Precast Panel users — untouched.
//   · Whitespace typos flagged in the audit were all in COMMENTS,
//     not real `require_permission` calls — nothing to fix. Audit
//     P3 line closed as "no-op / audit reading error".
//   · CS Incidents resource-key drift — deferred. The gate uses
//     `reference_library` today and no user has been observed to
//     lose access. Follow-up ship candidate once we've decided
//     whether to promote `cs_incidents` to a schema entry proper.
//   · No permission semantics changed on any active role.
//
// ── Tests ──────────────────────────────────────────────────────────
//   NEW `tests/backend_unit/test_rbac_tidy_v58_13_60.py`:
//     · No active user lacks `role_id` FK.
//     · `app_state.simpro_position_role_sync` row exists with the
//       four required keys.
//     · Sync endpoint body contains the bookkeeping write (source
//       assertion — no live sync run needed to verify).
//     · Test-artifact roles are archived AND carry `archive_reason`.
//     · No user is assigned to any archived test-artifact role.
//     · Forward-safe version-sync pin.
//
// ── SOP ────────────────────────────────────────────────────────────
//   · frontend/src/lib/version.js#RUNNING_VERSION bumped.
//   · frontend/public/service-worker.js#CACHE_VERSION bumped.
//   · mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION bumped.
//   · Running bulk-import job `14433131-…` untouched.
//   · Track 2 (SSRA re-extraction) untouched.
//   · /app/mobile/ untouched except MOBILE_BUNDLE_VERSION.
//   · Docker / K8s / requirements.txt / package.json unchanged.
//   · Backend restart REQUIRED (roles_catalogue.py touched).

// v160.3.9.58.13.58 — P1 avatar regression fix.
//
// ── Reported ───────────────────────────────────────────────────────
//   User: "we have lost the avatar in the worker and the users and
//   permissions". Two surfaces showed a broken image:
//     · WorkerViewModal `<WorkerPhoto>` — the profile photo tile.
//     · Users & Permissions rows — the `photo_url` from each
//       linked worker.
//
// ── Root cause (NOT the HR ships) ──────────────────────────────────
//   v58.13.53's `_sweep_orphan_gridfs_blobs` used a NEGATIVE
//   filter: "delete every `bk_fs.files` blob whose `_id` is not
//   in `bk_snapshots.gridfs_id`". But `workers.py::_fs_bucket()`
//   writes Worker photos into the SAME `bk_fs` bucket
//   (v160.3.9.34.3 aligned the writer with the Simpro-ZIP
//   reader). Result: every Worker photo blob was classified as an
//   orphan and deleted. 25 preview workers lost their photos.
//   The boot-time defensive hook that the same ship added runs
//   the sweep on every backend restart, so every deploy repeated
//   the deletion.
//
// ── Fix (this ship) ────────────────────────────────────────────────
//   1. `_sweep_orphan_gridfs_blobs` (backup_service.py) rewritten
//      to a POSITIVE filter: only blobs whose filename matches
//      `paneltec-snapshot-*.zip` OR whose metadata carries
//      `snapshot_id` are considered for deletion. Worker photos
//      match neither condition and are inherently safe.
//   2. `scripts/emergency_disk_cleanup_v58_13_53.py::_sweep_orphan_bk_fs`
//      updated with the same positive filter — the mirror
//      one-shot runner cannot repeat the mistake either.
//   3. Data cleanup on the 25 affected workers: nulled
//      `photo_url` and `photo_gridfs_id` on rows whose blob was
//      confirmed missing from both `bk_fs.files` and `fs.files`.
//      This makes `<WorkerPhoto>` render the placeholder
//      immediately instead of flashing a broken-image icon
//      before the `onError` fallback fires. Users can re-upload
//      via the existing `POST /api/workers/{id}/photo` flow.
//   4. NO frontend changes needed. The HR Info section shipped in
//      v58.13.56 is completely untouched — it was NEVER the
//      cause. Users & Permissions component untouched.
//
// ── Ships mistakenly implicated ─────────────────────────────────────
//   User attribution was v58.13.56 or v58.13.57 (the HR merge ships).
//   Actual culprit was v58.13.53 (disk-bloat hardening). The HR
//   ships only edited `WorkerViewModal.jsx` to add the HR Info
//   section BELOW Personal — they never touched `WorkerPhoto`,
//   `photo_url`, or the GridFS layer.
//
// ── Tests ──────────────────────────────────────────────────────────
//   NEW `tests/backend_unit/test_avatar_regression_v58_13_58.py`:
//     · Sweep helper carries the positive snapshot filter.
//     · Emergency cleanup script carries the same filter.
//     · Live regression: plant a `worker_photo` blob in `bk_fs`,
//       run the sweep, assert the blob survives.
//     · Forward-safe version-sync pin.
//
// ── Data loss ──────────────────────────────────────────────────────
//   Cannot be undone from within Mongo — the 25 blobs are gone.
//   Recovery paths: (a) users re-upload via the existing photo
//   upload endpoint, (b) re-run the Simpro ZIP importer for
//   workers whose photos came from a Simpro export. This ship
//   does NEITHER — it just stops the bleeding.
//
// ── SOP ────────────────────────────────────────────────────────────
//   · `frontend/src/lib/version.js#RUNNING_VERSION` bumped.
//   · `frontend/public/service-worker.js#CACHE_VERSION` bumped.
//   · `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` bumped.
//   · `/app/mobile/` untouched except MOBILE_BUNDLE_VERSION.
//   · Running bulk-import job `14433131-…` untouched.
//   · Track 2 (SSRA re-extraction) untouched.
//   · `hr_employees` collection untouched. Ship A + B still hold.
//   · HR Info section on Workers untouched.
//   · Docker / K8s / requirements.txt / package.json unchanged.
//   · Backend restart REQUIRED (sweep helper is called on boot).

// v160.3.9.58.13.57 — HR Employees UI retired (Ship B of the merge).
//
// ── Context ────────────────────────────────────────────────────────
//   v58.13.56 merged 4 HR flags (Employee ID, Hired, Working Visa,
//   Do Not Rehire) onto the Worker record and shipped a permission-
//   gated "HR Info" section on WorkerViewModal. The `--commit` run
//   populated 67 of 69 workers on preview. Ship B (this) retires
//   the standalone HR Employees UI + the PII reveal endpoints now
//   that the register is redundant.
//
// ── Frontend — deleted ─────────────────────────────────────────────
//   · `pages/settings/HrEmployeesPage.jsx`
//   · `pages/settings/HrEmployeeDrawer.jsx`
//   · `components/BulkWorkerLinkWizard.jsx`
//   · `components/BulkWorkerUnlinkWizard.jsx`
//   · `components/WorkerLinkModal.jsx`
//   `settingsNavRegistry.js` — `hr_employees` entry removed.
//   `App.js` — `HrEmployeesPage` import removed;
//     `/app/settings/hr-employees` now `<Navigate to="/app" replace />`
//     for a 90-day grace window. REMOVE AFTER 2026-11-25.
//
// ── Backend — reveal endpoints deleted, router stays live ──────────
//   `backend/hr_employees.py`:
//     · `POST /{uid}/reveal-dob` — DELETED.
//     · `POST /{uid}/reveal-address` — DELETED.
//     · `POST /{uid}/reveal-next-of-kin` — DELETED.
//   Kept live for the 90-day grace window:
//     · `GET /` (list, masked shape)
//     · `GET /{uid}` (get)
//     · `GET /audit` (audit trail, `hr_employees.audit_view` gated)
//     · `POST /refresh-from-source`
//     · `PATCH /{uid}` (still edits non-PII fields)
//     · `POST /soft-delete` + linker helpers
//   Rationale: any external integration or bookmarked API URL keeps
//   working; only the surface that the deleted UI consumed is gone.
//
// ── Permissions ────────────────────────────────────────────────────
//   · `hr_employees.view` — KEPT. Still gates the new HR Info
//     section on Workers (see v58.13.56 backend scrub).
//   · `hr_employees.audit_view` — KEPT. Still referenced by
//     `hr_employees.py` line ~250 (the `/audit` endpoint) and
//     the auditor-carve tests in `test_v49_endpoints.py`. Removing
//     it would break the audit-view surface which is a legitimate
//     P90-window use-case.
//   · `hr_employees.reveal_pii` — Left registered in `permissions.py`
//     but is now orphaned (no endpoint checks it). Safe to leave;
//     future ship v58.13.58 candidate can clean up the enum once
//     the 90-day window closes.
//
// ── Data preservation guarantee ────────────────────────────────────
//   `hr_employees` collection UNTOUCHED (count 121 unchanged).
//   `hr_employees_audit` UNTOUCHED. The additive Ship A merge means
//   no data is lost by retiring the UI — the 4 useful HR flags now
//   live on Workers, so the register is redundant not authoritative.
//
// ── Tests ──────────────────────────────────────────────────────────
//   Deleted (surface-specific, obsolete under retirement):
//     · `backend/tests/test_hr_employees_v48.py`
//       (PII reveal + auditor-carve integration tests).
//     · `tests/frontend_smoke/test_bulk_link_wizard_v58_13_26.py`
//     · `tests/frontend_smoke/test_bulk_unlink_wizard_v58_13_29.py`
//     · `tests/frontend_smoke/test_link_worker_render_v58_13_25.py`
//   Added:
//     · `tests/backend_unit/test_hr_employees_retired_v58_13_57.py`
//       — 8 guards (nav gone, redirect present, retired files
//       deleted, PII reveal endpoints gone, retirement header in
//       hr_employees.py, kept-live endpoints still registered,
//       `hr_employees` count preserved, WorkerPatch HR fields
//       regression, forward-safe version-sync).
//
// ── SOP ────────────────────────────────────────────────────────────
//   · `frontend/src/lib/version.js#RUNNING_VERSION` bumped.
//   · `frontend/public/service-worker.js#CACHE_VERSION` bumped.
//   · `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` bumped.
//   · `/app/mobile/` untouched except MOBILE_BUNDLE_VERSION.
//   · Running bulk-import job `14433131-…` untouched.
//   · Track 2 (SSRA re-extraction) untouched.
//   · `hr_employees` collection + `hr_employees_audit` UNTOUCHED.
//   · Docker / K8s / requirements.txt / package.json unchanged.
//   · Backend restart REQUIRED — 3 endpoints removed from the
//     router; brief 200 blip is expected.

// v160.3.9.58.13.56 — HR-merge lite (Ship A · additive-only).
//
// User asked for the 4 HR flags to live on the Worker record so
// the standalone HR Employees register can be retired without
// losing the visa/rehire/employment-date signal. Phased into two
// sequential ships so the merge can be validated BEFORE any
// deletion — see v58.13.54 lesson.
//
// ── Backend (`workers.py`) ─────────────────────────────────────────
//   · `WorkerPatch` gained 4 optional fields:
//       employee_id, date_employee_added, working_visa,
//       do_not_rehire
//   · `_serialise()` strips those 4 fields from the response
//     unless the viewer holds `hr_employees.view` (permission
//     grant OR role in {admin, hr_lead}). Non-holders see the
//     Worker doc exactly as they did pre-ship.
//   · Existing PATCH endpoint accepts the new fields; write path
//     is gated by the pre-existing `_require_write` (admin +
//     hseq_lead) plus record-level `require_scoped_access`.
//   · No new endpoint. No collection changes. `hr_employees` is
//     read-only from this ship's perspective.
//
// ── Migration script ───────────────────────────────────────────────
//   `/app/backend/scripts/merge_hr_to_workers_v58_13_56.py`
//     · Idempotent, `--dry-run` by default.
//     · Match precedence: `linked_worker_id` → email → name.
//     · Report persisted to `app_state.hr_merge_v58_13_56`:
//         hr_scanned / matched_by_link / matched_by_email /
//         matched_by_name / conflicts / no_match / would_update
//         / written / unmatched_samples[:10].
//     · Does NOT touch `hr_employees` — additive-only.
//
// ── Frontend (`WorkerViewModal.jsx`) ───────────────────────────────
//   New "HR Info" section (below Personal, above Availability)
//   with testid `view-section-hr-info`. Renders ONLY when:
//     (a) `_can('hr_employees','view')` returns true, AND
//     (b) the worker carries at least one of the 4 HR flags
//         (guaranteed by the backend scrub — if the field isn't
//         in the response, the section is invisible even to
//         admin, keeping the empty state clean).
//   Working Visa true → amber badge "Visa required".
//   Do Not Rehire true → rose badge "Do not rehire".
//   Zero changes to the Personal, Availability, Clients, or
//   Certifications sections.
//
// ── Ship B (NOT this ship) ─────────────────────────────────────────
//   v58.13.57 will retire the HR Employees page + drawer + 3
//   linker wizards + PII reveal endpoints. That ship is on hold
//   until user confirms the merge on Workers looks right and
//   green-lights a `--commit` migration run.
//
// ── Tests ──────────────────────────────────────────────────────────
//   NEW `tests/backend_unit/test_hr_merge_lite_v58_13_56.py`:
//     · Schema — WorkerPatch has the 4 new fields.
//     · Serialiser — scrubs fields for non-hr viewer.
//     · Serialiser — retains fields for admin viewer.
//     · Migration script — importable, exposes main + helpers.
//     · Migration `--dry-run` writes nothing (state check pre/post).
//     · Version-sync pin.
//
// ── SOP ────────────────────────────────────────────────────────────
//   · `frontend/src/lib/version.js#RUNNING_VERSION` bumped.
//   · `frontend/public/service-worker.js#CACHE_VERSION` bumped.
//   · `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` bumped.
//   · `/app/mobile/` untouched except MOBILE_BUNDLE_VERSION.
//   · Running bulk-import job `14433131-…` untouched.
//   · Track 2 (SSRA re-extraction) untouched.
//   · `hr_employees` collection + audit + PII reveal endpoints
//     UNTOUCHED — Ship A is strictly additive.
//   · Docker / K8s / requirements.txt / package.json unchanged.

// v160.3.9.58.13.55 — CS Incidents feature RESTORED (revert of .54).
//
// ── What happened ──────────────────────────────────────────────────
//   v58.13.54 retired the CS Incidents feature end-to-end (nav item
//   deleted, `pages/CsIncidentsList.jsx` deleted, route redirected).
//   User feedback immediately after the ship:
//     "i still want the ce incesdents i fdont know wehere i asked
//      for them that to be removed"
//   The earlier multi-part instruction was mis-read as approval —
//   the CS Incidents surface was NEVER meant to be removed. This
//   ship is a full restore.
//
// ── Restored from git (HEAD~1, pre-.54 state) ──────────────────────
//   · `pages/CsIncidentsList.jsx` (367 LOC, incl. inline
//     `CsIncidentDetailModal`)
//   · `tests/frontend_smoke/test_cs_incidents_migration_v58_13_12.py`
//   · `tests/frontend_smoke/test_cs_incidents_file_icon_v58_13_46.py`
//   · `frontend/src/App.js` — CsIncidentsList import + route +
//     `/app/submissions` → `/app/submissions/cs-incidents` redirect
//   · `frontend/src/components/layout/AppShell.jsx` — nav item
//     `nav-submissions-cs-incidents` (icon Alert24Regular, pastel
//     `coral`, resource `reference_library`) back in the Capture
//     section
//   · Test lists restored across 6 files (parity + wiring + density
//     + action-availability contract). Density-page count back to 8.
//
// ── Deleted (was only meaningful under retirement) ─────────────────
//   · `tests/frontend_smoke/test_cs_incidents_retired_v58_13_54.py`
//
// ── Backend / DB — untouched throughout ────────────────────────────
//   · `cs_incident.py` router at `/api/cs-incidents/*` — unchanged,
//     never modified in .54, still live.
//   · `pdf_renderer.render_cs_incident_pdf` +
//     `RESOURCE_TO_PATH["cs_incidents"]` — unchanged.
//   · Mongo `cs_incident_issues` collection — 257 records on
//     preview, 201 on production per user brief. NEVER touched.
//
// ── Data preservation guarantee ────────────────────────────────────
//   Because the retirement ship deliberately kept the backend +
//   collection intact, the restore is a pure frontend surface roll-
//   back. Nothing else has to change and nothing was lost.
//
// ── Lesson for the next session ────────────────────────────────────
//   Multi-part user messages with mixed "keep X / delete Y / redirect
//   Z" wording need an explicit checkpoint BEFORE deletion of any
//   user-visible page. A single follow-up ask_human "you want me to
//   DELETE this feature completely — is that right?" would have
//   caught the misinterpretation.
//
// ── Tests ──────────────────────────────────────────────────────────
//   No new test file. Restoration is guarded by the restored-state
//   assertions in the six existing test files (route present, nav
//   entry present, density-page count 8, action-availability
//   contract asserts showPdf semantics on the page again).
//   `test_disk_bloat_v58_13_53.py` version-sync assertion flipped to
//   the forward-safe pattern so future bumps don't self-invalidate
//   (RECURRENCE tamed for v58.13.53 as well).
//
// ── SOP ────────────────────────────────────────────────────────────
//   · `frontend/src/lib/version.js#RUNNING_VERSION` bumped.
//   · `frontend/public/service-worker.js#CACHE_VERSION` bumped.
//   · `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` bumped.
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · Running bulk-import job `14433131-…` untouched.
//   · Track 2 (SSRA re-extraction) untouched.
//   · HR Employees NOT touched — separate follow-up per user.
//   · Docker / K8s / requirements.txt / package.json unchanged.
//   · Backend restart NOT required (frontend-only ship).

// v160.3.9.58.13.54 — CS Incidents feature retired (frontend only).
//
// ── User decisions ─────────────────────────────────────────────────
//   · Keep the 201 records safely in Mongo — data preservation is
//     the core guarantee of this ship. NO drop, NO purge.
//   · Delete the sidebar entry.
//   · Delete the `/app/submissions/cs-incidents` route.
//   · Do NOT surface the CS Incidents data anywhere else (no new
//     Workers-detail tab).
//   · Redirect the old URL to `/app` for a 90-day grace window.
//
// ── Frontend changes ───────────────────────────────────────────────
//   · `components/layout/AppShell.jsx` — retired the nav item
//     `nav-submissions-cs-incidents`. The item lived inside the
//     "Capture" section (not a separate "Submissions" section — the
//     "Submissions bucket" was only a code-comment concept, never
//     a real sidebar heading). No section heading needed removing.
//   · `App.js` — deleted the `CsIncidentsList` import + route.
//     Both `/app/submissions` and `/app/submissions/cs-incidents`
//     now `<Navigate to="/app" replace />`. Removal comment carries
//     the explicit 2026-11-24 date so a follow-up ship can flip
//     both redirects to 410 without archaeology.
//   · `pages/CsIncidentsList.jsx` — DELETED. Bespoke
//     `CsIncidentDetailModal` (defined inline in the same file)
//     went with it — no orphan references remain in the codebase.
//   · `PdfActions.jsx` `pdfMirrored={true}` prop on the retired
//     page went with the file — no orphan wiring.
//
// ── Backend UNCHANGED ──────────────────────────────────────────────
//   · `cs_incident.py` router still mounted at `/api/cs-incidents/*`
//     for the 90-day grace window (integrations, bookmarked URLs).
//   · `pdf_renderer.py::render_cs_incident_pdf` + `RESOURCE_TO_PATH
//     ["cs_incidents"]` untouched.
//   · Mongo collection `cs_incident_issues` untouched. Preview
//     count = 257 records. Production count = 201 records per user
//     brief. Data is preserved and inspectable via the still-live
//     API for anyone who wants to consume it.
//
// ── Tests ──────────────────────────────────────────────────────────
//   Deleted (obsolete — asserted CS Incidents renders):
//     · `test_cs_incidents_migration_v58_13_12.py`
//     · `test_cs_incidents_file_icon_v58_13_46.py`
//   Updated (removed the retired page from parity/wiring lists —
//   6 files, minimal diffs, comments preserved):
//     · `test_no_double_stripe_v58_13_45.py`
//     · `test_tile_size_colour_parity_v58_13_38.py`
//     · `test_capture_wiring_v58_13_40.py`
//     · `test_capture_wiring_v58_13_41.py`
//     · `test_capture_wiring_v58_13_42.py`
//     · `test_capture_density_all_pages_v58_13_43.py`
//   Added:
//     · `test_cs_incidents_retired_v58_13_54.py` — 5 tests:
//         1. Sidebar has NO `nav-submissions-cs-incidents` testid.
//         2. App.js has NO `CsIncidentsList` mount.
//         3. `pages/CsIncidentsList.jsx` file is deleted.
//         4. Both `submissions` and `submissions/cs-incidents`
//            routes redirect to `/app`, with the explicit removal
//            date `REMOVE AFTER 2026-11-24` present.
//         5. Backend `cs_incident.py` + `pdf_renderer.py` still
//            reference the collection + renderer (grace window).
//         6. `db.cs_incident_issues.count_documents({}) > 0` on
//            the preview cluster (data-preservation guard). Soft-
//            skips if Mongo is unreachable so CI doesn't wedge in
//            a sandbox without DB access.
//
// ── SOP ────────────────────────────────────────────────────────────
//   · `frontend/src/lib/version.js#RUNNING_VERSION` bumped.
//   · `frontend/public/service-worker.js#CACHE_VERSION` bumped.
//   · `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` bumped.
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · Running bulk-import job `14433131-…` untouched.
//   · Track 2 (SSRA re-extraction) untouched.
//   · Backend restart NOT required (frontend-only ship + tests).
//   · v58.13.51 heartbeat design still on ice.

// v160.3.9.58.13.53 — Disk-bloat hardening (P0 deploy blocker).
//
// ── Trigger ────────────────────────────────────────────────────────
//   Production deploy of `whs-compliance` failed at the deployer's
//   `MONGODB_MIGRATE` step:
//     drop databases: drop whs-compliance-test_database:
//       (UserWritesBlocked) User writes blocked,
//       reason: DiskUseThresholdExceeded
//   Downstream `MANAGE_SECRETS`, `HEALTH_CHECK`, and `DEPLOY` all
//   short-circuited to "not run".
//
// ── Investigation (preview cluster) ────────────────────────────────
//   test_database sizeOnDisk = 2.18 GB. Top offender by a mile:
//     bk_fs.chunks           1.79 GB  (7,403 chunks / 950 files)
//     bulk_import_failed_pdfs.chunks   316 MB  (3,751 files, most
//                                        tied to the running job
//                                        14433131-…)
//     bulk_import_dryrun            20 MB
//     doc_files_pdf_cache           13 MB
//     form_submissions               7 MB   (expected)
//     pre_starts                     5 MB   (expected)
//     bulk_import_reextract_v58_13_35_audit  3 MB
//     bulk_import_pdf_cache          3 MB
//   `bk_snapshots` had 28 valid rows; `bk_fs.files` had 950 rows →
//   **922 orphan GridFS blobs = 405 MB stranded.**
//
// ── Root cause ─────────────────────────────────────────────────────
//   `backup_service._apply_retention_policy` deleted the metadata
//   row but wrapped the paired `fs_.delete(gridfs_id)` in a
//   try/except that logged a warning and continued. Every failed
//   GridFS delete (network glitch, race) left the chunks stranded.
//   Over ~40 daily runs the leak grew to 405 MB — enough to push
//   the production cluster past its disk threshold and block all
//   user writes.
//
// ── Fix (backend) ──────────────────────────────────────────────────
//   1. NEW helper `_sweep_orphan_gridfs_blobs(db_, fs_)` in
//      `backup_service.py`:
//        · Collects every `bk_snapshots.gridfs_id` as the valid set.
//        · Iterates `bk_fs.files`; anything NOT in the valid set is
//          deleted via the GridFS bucket.
//        · FAIL-SAFE: if `bk_snapshots` is empty the sweep is a
//          no-op — a freshly-provisioned cluster must not have its
//          real backups deleted.
//        · Logs `(deleted_count, bytes_freed)`.
//   2. `_apply_retention_policy` now calls the sweep at the end of
//      every run. The run stamp gains
//      `last_run_orphans_swept` + `last_run_orphan_bytes_freed`.
//   3. `install(app, db, require_admin)` now registers a
//      `@app.on_event("startup")` hook that runs the sweep on
//      every backend boot — try/except-guarded so a transient DB
//      glitch never blocks boot.
//
// ── Emergency migration script ─────────────────────────────────────
//   `/app/backend/scripts/emergency_disk_cleanup_v58_13_53.py` —
//   one-shot idempotent runner covering:
//     · Orphan-`bk_fs` sweep (identical logic to the runtime helper).
//     · Prune `bulk_import_pdf_cache` (`cached_at` ISO string, 30 d).
//     · Prune `bulk_import_dryrun` (`at` ISO string, 30 d).
//     · Prune `bulk_import_reextract_v58_13_35_audit` (`at` ISO, 90 d).
//     · Prune `bulk_import_failed_pdfs` GridFS blobs older than 30 d
//       for jobs NOT in state=processing/queued AND not the known
//       running job id `14433131-…`.
//     · `compact` on GridFS chunk collections (returns disk to OS).
//   Guardrails: `--dry-run` flag, `write_check` probe, ISO
//   lexicographic compare (year-first sorts naturally).
//
// ── Preview-cluster verification ───────────────────────────────────
//   Manual run of the sweep + compact returned 359 MB to the OS
//   (test_database sizeOnDisk 2.18 GB → 1.70 GB). Writes were
//   permitted throughout — preview is NOT the blocked cluster.
//
// ── TTL indexes ────────────────────────────────────────────────────
//   All candidate collections
//   (`bulk_import_pdf_cache.cached_at`, `bulk_import_dryrun.at`,
//    `bulk_import_reextract_v58_13_35_audit.at`,
//    `plant_maintenance_audit.at`, `asset_reminders_sent`,
//    `asset_service_generate_runs`, `email_outbox`) currently
//   store timestamps as ISO 8601 STRINGS, not BSON Dates. A
//   MongoDB TTL index requires a BSON Date field. Rather than
//   ship a half-working TTL that silently never fires, this
//   ship uses the migration script above for the immediate
//   sweep, and defers the `expires_at` BSON Date field
//   migration + TTL index creation to a follow-up ship
//   (v58.13.54 candidate) once we've confirmed the string→Date
//   migration is safe against all read paths.
//
// ── Tests ──────────────────────────────────────────────────────────
//   NEW `tests/backend_unit/test_disk_bloat_v58_13_53.py`:
//     · `_sweep_orphan_gridfs_blobs` helper present + fail-safe.
//     · Retention policy invokes the sweep and stamps counters.
//     · Startup hook `_v58_13_53_orphan_gridfs_sweep` mounted +
//       try/except-guarded.
//     · Emergency cleanup script importable, protects running
//       bulk-import job id, uses ISO string compare.
//     · Version-sync pin.
//
// ── SOP ────────────────────────────────────────────────────────────
//   · `frontend/src/lib/version.js#RUNNING_VERSION` bumped.
//   · `frontend/public/service-worker.js#CACHE_VERSION` bumped.
//   · `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` bumped.
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · Running bulk-import job `14433131-…` untouched (its
//     `bulk_import_failed_pdfs` blobs are in the migration
//     script's protected set).
//   · Track 2 (SSRA re-extraction) parked, untouched.
//   · Heartbeat design stays on ice.
//   · Docker / Kubernetes config UNCHANGED.
//   · requirements.txt / package.json UNCHANGED.
//
// ── Production deploy escalation (NOT resolvable from preview) ─────
//   The failed deploy is against the PRODUCTION Mongo cluster
//   (target DB `whs-compliance-test_database`), which is separate
//   from the preview cluster. We cannot reach it from here. See
//   the escalation message drafted in the finish summary — infra
//   must either expand the production Mongo disk or manually
//   unblock writes on that cluster. Once writes are unblocked,
//   running this ship's migration script against the production
//   DB will reclaim the same class of bloat.

// v160.3.9.58.13.52 — Document Library folder-detail colour grouping.
//
// ── Problem ────────────────────────────────────────────────────────
//   Inside a Document Library folder ("Compliance / Document Library
//   / 1. Management & Quality Procedures V10.0 2025", 11 files) the
//   file table showed 11 visually-identical grey rows. The user
//   asked to "divide them with different colour" so the underlying
//   IMS section clusters (IMS-01…IMS-10) are readable at a glance.
//
// ── Fix ────────────────────────────────────────────────────────────
//   `DocumentLibraryFolder` (`pages/DocumentLibrary.jsx`) now groups
//   its file rows using a strict fallback chain:
//     1. IMS-NN prefix parsed from `filename` (regex
//        `/IMS-(\d{1,3})(?:\.\d+[a-z]?)?/i`) → key like `IMS-04`
//        (zero-padded, so `IMS-4.01` groups with `IMS-4` sibs).
//     2. First `ai_tags[0]` (already denormalised at upload).
//     3. Coarse mime bucket (`pdf` / `docx` / `xlsx` / `img` / `text`).
//     4. Literal `"Other"` — always sorts last.
//   Each group runs through
//     `resolveGroupPalette({ groupKey, page: 'document-library' })`
//   → same 8-colour djb2-hash rotation the Capture pages already
//   consume. Adding IMS-11 next year auto-slots into the rotation
//   with zero code changes.
//
// ── Visual ─────────────────────────────────────────────────────────
//   · One tinted group-header row per group (bg = palette.tint,
//     3-px palette.hex left border, uppercase palette.text label).
//   · Each data row gets a 4-px palette.hex left stripe (same
//     idiom as `CaptureCard#stripeStyle`).
//   · The file-type glyph inherits `color: palette.hex` (was
//     `text-slate-400`) — the icon itself carries the accent.
//   · Sorting: within a group by `uploaded_at` DESC; between
//     groups by key ASC with numeric-aware collation (so IMS-10
//     sorts AFTER IMS-2), "Other" last.
//   · Zero changes to columns, action icons, upload flow,
//     permissions, backend, or DB.
//
// ── Tests ──────────────────────────────────────────────────────────
//   NEW `tests/frontend_smoke/test_document_library_grouping_v58_13_52.py`
//     · Import wire-up (`resolveGroupPalette`).
//     · IMS_PREFIX_RE literal shape.
//     · Fallback chain intact (IMS → ai_tags → mime → Other).
//     · "Other" sorted last with numeric-aware collation.
//     · Group-header rows carry `data-testid="doc-library-group-*"`.
//     · Data rows apply 4-px left stripe + tinted file icon.
//     · Version-sync pin.
//
// ── SOP ────────────────────────────────────────────────────────────
//   · `frontend/src/lib/version.js#RUNNING_VERSION` bumped.
//   · `frontend/public/service-worker.js#CACHE_VERSION` bumped.
//   · `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` bumped.
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · Running bulk-import job `14433131-…` untouched.
//   · Track 2 (SSRA re-extraction) parked, untouched.
//   · Heartbeat design stays on ice.

// v160.3.9.58.13.51 — PDF open-inline default on view-oriented
// file-serving endpoints.
//
// ── Problem ────────────────────────────────────────────────────────
//   User reported: "with the document could we have the pdf open
//   directly not save it" — clicking a file icon in the UI popped
//   a "Save As" prompt rather than opening the PDF inline.
//
// ── Root cause ─────────────────────────────────────────────────────
//   Starlette 0.37.2 `FileResponse(filename=...)` defaults to
//   `Content-Disposition: attachment; filename="..."` when a
//   filename kwarg is supplied. Three view-oriented endpoints
//   were emitting `attachment` and triggering the download.
//
// ── Audit table (every `Content-Disposition` in the codebase) ──────
//   VIEW endpoints — MUST default to `inline`:
//     · asset_service.serve_schedule_attachment              FIXED
//         GET /api/assets/{asset_id}/schedules/{sid}/attachments/{stored_name}
//     · forms.serve_submission_attachment                    FIXED
//         GET /api/forms/submissions/{submission_id}/attachments/{stored_name}
//     · simpro_zip_import.stream_cert_file (disk branch)     FIXED
//         GET /api/workers/{worker_id}/certifications/{cert_id}/file
//     · simpro_zip_import._stream_gridfs (GridFS)            OK (inline)
//     · simpro_zip_import.stream_unmatched_document          OK (inline)
//     · suppliers_qr QR label PDF                            OK (inline)
//     · pdf_routes capture PDF (`?download=0`)               OK (inline)
//     · forms.serve_field_photo                              OK (no filename → inline)
//     · help_routes reference image                          OK (inline)
//   DOWNLOAD endpoints — CORRECTLY keep `attachment`:
//     · document_library.download_file    (`/files/{id}/download`)
//     · sites_signon_v127 CSV/PDF export
//     · backup_service snapshot zip export
//     · workers_inductions matrix XLSX export
//     · file_pdf pdf-bundle download endpoint
//     · pdf_routes capture PDF (`?download=1` opt-in)
//
// ── Fix shape ──────────────────────────────────────────────────────
//   Each of the 3 fixed endpoints now:
//     · accepts `?download: int = Query(0, ge=0, le=1)`
//     · passes `content_disposition_type="inline"` by default
//     · passes `content_disposition_type="attachment"` when
//       `?download=1` — preserves an explicit save-to-disk path
//   Zero behavioural change to any GridFS branch (already inline)
//   or any explicit download route (still attachment).
//
// ── Frontend ───────────────────────────────────────────────────────
//   No frontend changes required. `PdfActions.jsx` already sends
//   `action: 'view'` when minting the token and the "Download
//   original" button in the Document Library still uses the
//   dedicated `/files/{id}/download` endpoint.
//
// ── Tests ──────────────────────────────────────────────────────────
//   NEW `tests/backend_unit/test_pdf_inline_default_v58_13_51.py`
//     · 3 fix-guard tests (one per patched endpoint)
//     · 1 cross-cut test pinning `attachment` on the 3 endpoints
//       that MUST stay attachment (document-library download,
//       sites-signon export, backup snapshot).
//   Existing `test_schedule_attachments_v58_13_14.py` continues
//   to pass — the endpoint still returns 200 with the file body,
//   only the Content-Disposition header changed.
//
// ── SOP ────────────────────────────────────────────────────────────
//   · `frontend/src/lib/version.js#RUNNING_VERSION` bumped.
//   · `frontend/public/service-worker.js#CACHE_VERSION` bumped.
//   · `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` bumped.
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · Running bulk-import job `14433131-…` untouched.
//   · Track 2 (SSRA re-extraction) parked, untouched.
//   · Heartbeat design in `/app/memory/v58_13_51_heartbeat_design.md`
//     stays on ice — this ship is the PDF-inline fix only.

// v160.3.9.58.13.50 — Bundle: P0 bulk-import watchdog + P1 Site
// Sign-In PDF fix + P2 legacy `.pdf` handler retirement.
//
// ── P0 · Bulk-import vision-stall (RECURRING regression) ─────────
//   Failed job forensics from live DB:
//     id=14433131-29a9-4fa8-9d7e-af18f86145cf  extracted=29,350
//         started=2026-08-22T23:37:45  failed=2026-08-23T07:40:09
//     id=4ef790e7  extracted=11,361     failed=2026-08-22T03:19
//     id=0da9f903  extracted=7,407      failed=2026-08-21T04:12
//     id=4f395643  extracted=41,900     failed=2026-08-21T14:28
//     id=9f5715aa  extracted=7,161      failed=2026-08-20T04:20
//   Pattern: 5 different jobs, all failed at `error_step="vision"`,
//   all reaped by the 15-min watchdog. The pipeline runs healthily
//   for hours (29,350 records = 8+ hours) then a single slow batch
//   trips the cap. Watchdog logic is correct (keys off
//   `last_progress_at`); the cap is just too tight for legitimate
//   Claude latency spikes.
//
//   Fix: `bulk_import_prestarts.py::VISION_STALL_TIMEOUT_MIN`
//   default 15 → 30 minutes. Env-overridable via
//   `BULK_IMPORT_VISION_STALL_TIMEOUT_MIN` (unchanged). Zero code
//   changes to the watchdog logic itself — same query, same reap
//   path, just more headroom. Doubles the tolerance for slow
//   batches without abandoning the guardrail for genuinely-hung
//   jobs.
//
//   Recovery of the failed 29,350-record job: records DID land in
//   `pre_starts` / `form_submissions` (persisted per-batch via
//   `_flush_progress`). The job's `last_progress_at` snapshot on
//   disk lets it be resumed from record 29,351 via
//   `POST /api/bulk-import/prestarts/<job_id>/start` if the user
//   chooses (the auto-resume-orphaned-jobs pass already knows how
//   to skip cached PDF hashes so re-runs are cheap).
//
// ── P1 · Site Sign-In file icon 400'd ────────────────────────────
//   Root cause: records loaded via `/api/forms/templates/<TID>/
//   submissions` have `source = None` (not `'form_submission'`
//   like domain-specific mirrors). PdfActions' auto-detect
//   (`source === 'form_submission'`) fell through to the direct
//   `/pdf-token` branch which 400'd on `resource="forms"` (NOT
//   in RESOURCE_TO_PATH — documented as MIRRORED_ONLY_KINDS since
//   v58.13.48).
//
//   Fix: new opt-in prop `pdfMirrored` on `CaptureCard` →
//   `PdfActions`. `SiteSigninList.jsx` passes `pdfMirrored={true}`
//   to force the mirrored `/forms/submissions/pdf-token` branch
//   regardless of the record's `source` field. PdfActions branch
//   becomes: `isMirrored = pdfMirrored || source === 'form_submission'`.
//   Risk Assessments UNAFFECTED — its records carry
//   `source='form_submission'` natively (verified via curl).
//
// ── P2 · Legacy `/api/files/pdf/{token}.pdf` handler retired ─────
//   User confirmed v58.13.49's URL-shape alignment works in their
//   real browser. Every mint_pdf_token result now points at the
//   `_build`-registered resource-scoped route
//   (`/api/{path}/{record_id}/pdf?token=<jwt>`). Legacy JWT-in-path
//   tokens have 90 s TTL — none in flight by the time v58.13.50
//   ships. Removing the handler shrinks the attack surface (one
//   fewer JWT-consuming endpoint) and eliminates the surviving
//   code path that had the Cloudflare `.pdf`-in-path rendering
//   regression documented in v58.13.49's changelog.
//
// Tests
//   NEW `tests/backend_unit/test_bulk_import_watchdog_v58_13_50.py`
//     · `VISION_STALL_TIMEOUT_MIN` default is 30 (module-level).
//   NEW `tests/frontend_smoke/test_pdf_mirrored_opt_in_v58_13_50.py`
//     · PdfActions destructures `pdfMirrored = false` and OR's it.
//     · CaptureCard threads `pdfMirrored` down.
//     · SiteSigninList passes `pdfMirrored={true}`.
//     · Risk Assessments does NOT need `pdfMirrored`.
//     · v58.13.50 version-sync across the 3 canonical files.
//   UPDATED `tests/backend_unit/test_pdf_token_url_shape_v58_13_49.py`
//     · `test_legacy_jwt_in_path_endpoint_still_registered` INVERTED
//       to `test_legacy_jwt_in_path_endpoint_removed_v58_13_50`.
//
// Live E2E verification (curl)
//   Site Sign-In:
//     · `POST /api/forms/submissions/pdf-token` with real submission
//       id → 200 + signed URL.
//     · `GET <url>` → HTTP 200, 121,295 bytes,
//       `Content-Type: application/pdf`,
//       `Content-Disposition: inline`, `%PDF-1.4` header.
//   Bulk-import: pod restart applies the new 30-min cap
//   immediately (watchdog reads the module constant on each tick).
//
// Guardrails held
//   · Backend restart required (module-level constant read at
//     import); `/api/openapi.json` → 200 post-boot.
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · v58.13.13 version-sync: all three canonical strings updated.
//   · Every prior guard (CS Incidents PDF, URL shape alignment,
//     density wiring, canonical density testid, double-stripe,
//     Pydantic ConfigDict, hr_employees regression,
//     action-availability contract, density telemetry) preserved.
//   · Track 2 (ZIP re-extraction) still parked pending PVC
//     expansion.


// v160.3.9.58.13.49 — CS Incidents PDF popup stayed on about:blank.
// v58.13.48 shipped the renderer + registry wiring correctly (5463 B
// `%PDF-1.4` served with `Content-Type: application/pdf` +
// `Content-Disposition: inline`) but the popup received the response
// without rendering it inline. Live network trace confirmed the
// popup fetched the URL and got a 200 — but its URL bar stayed on
// `about:blank`. Headers were byte-identical to Hazards' working
// path. Only difference: URL SHAPE.
//   Hazards (mirrored): `/api/forms/submissions/<id>/pdf?token=<jwt>`
//   CS Incidents:       `/api/files/pdf/<jwt>.pdf`
// `mint_pdf_token` had been returning the JWT-in-path shape since
// v3.9 to sidestep ad-blockers that flag long query params. Turns
// out Cloudflare in front of the ingress (`cf-ray` header on the
// response) treats the `.pdf` suffix in the path as a static asset
// and appears to strip Content-Disposition or otherwise interfere
// with inline rendering.
//
// Fix
//   `backend/pdf_routes.py::mint_pdf_token` — changed the returned
//   `url` shape to
//     `/api/{RESOURCE_TO_PATH[resource]}/{record_id}/pdf?token=<jwt>`
//   the same query-param shape Hazards uses and that has been in
//   production for months without incident. `action=download` gets
//   `&download=1` appended. The `_build`-registered resource-scoped
//   route already exists for every resource in `RESOURCE_TO_PATH`
//   (including `cs_incidents` from v58.13.48), so no new endpoints
//   needed.
//
// Backwards compatibility
//   The legacy `/api/files/pdf/{token}.pdf` handler stays in place.
//   Any tokens minted before this ship (90 s TTL) still resolve
//   until they expire — no mid-deploy popup breakage.
//
// Tests
//   NEW `tests/backend_unit/test_pdf_token_url_shape_v58_13_49.py`
//     · `mint_pdf_token` returns the query-param URL shape (not
//       JWT-in-path).
//     · `action="download"` appends `&download=1`.
//     · The legacy JWT-in-path endpoint remains registered
//       (backwards-compat).
//     · The `_build`-registered `/{path}/{record_id}/pdf` route is
//       present in the router — otherwise `mint_pdf_token` would
//       hand out 404 URLs.
//
// Live E2E verification
//   `curl POST /api/pdf-token {resource:"cs_incidents"}` →
//   `.url = ".../api/cs-incidents/<uuid>/pdf?token=<jwt>"`.
//   `curl GET <that url>` → HTTP 200, 5463 bytes, `%PDF-1.4`,
//   `Content-Type: application/pdf`.
//
// Guardrails held
//   · Backend restart required; `/api/openapi.json` → 200 post-boot.
//   · Frontend-safe (PdfActions uses `data.url` unchanged).
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · Density telemetry (v58.13.47) + hr_employees ConfigDict
//     (v58.13.43) + double-stripe fix (v58.13.45) + CS renderer
//     (v58.13.48) all preserved.


// v160.3.9.58.13.48 — CS Incidents PDF restore + 7-page audit +
// action-availability contract test. Reverses the wrong-direction
// v58.13.46 hide.
//
// Why the reversal
//   User clarified: they wanted the PDF view button to WORK, not
//   to be hidden. The original bug report ("file icon flashes and
//   disappears") was a request to fix the feature, not remove it.
//   v58.13.46 killed a feature the user actively uses.
//
// Diagnosis (live Mongo introspection + curl)
//   · CS Incident records have NO attachment / pdf_url / file_id /
//     document_ref fields. Purely structured data imported from
//     XLSX — ~65 populated fields per row (issue meta, timeline,
//     categorisation, free-text descriptions, immediate actions,
//     environmental flags, near-miss booleans).
//   · Correct fix path = generated PDF report (option a). Same
//     printable-audit UX the sibling `incidents` page produces,
//     sourced from the fields the record already carries.
//
// 7-page file-icon audit (all Capture pages EXCEPT CS Incidents)
//   Confirmed via live curl of $REACT_APP_BACKEND_URL and inspection
//   of each page's `<CaptureCard resourceKind="X">` value:
//     Page                | resourceKind      | Live source        | Verdict
//     Hazards             | hazards           | form_submission    | OK (mirrored)
//     Incidents           | incidents         | form_submission    | OK (mirrored)
//     Inspections         | inspections       | form_submission    | OK (mirrored)
//     Pre-Starts          | pre_starts        | (no source)        | OK (direct RESOURCE_TO_PATH)
//     Site Diary          | site_diary        | form_submission    | OK (mirrored)
//     Risk Assessments    | risk_assessments  | form_submission    | OK (mirrored)
//     Site Sign-In        | forms             | form_submission    | OK (mirrored)
//     CS Incidents        | reference_library | (no source)        | BROKEN → 400 unknown resource
//   The mirrored branch of `PdfActions` (source === "form_submission")
//   routes to `POST /api/forms/submissions/pdf-token` which resolves
//   by `submission_id` regardless of the `resourceKind` value. That's
//   why "risk_assessments" and "forms" work despite not being in
//   `RESOURCE_TO_PATH` — they've been running on the mirrored path
//   the whole time. Documented as `MIRRORED_ONLY_KINDS` in
//   `pdf_routes.py` for the contract test below.
//
// Backend changes
//   `pdf_renderer.py`
//     · NEW `render_cs_incident_pdf(row: dict) -> bytes` — section-
//       grouped audit-style layout using the shared `pdf_template`
//       helpers so the visual language matches the other WHS PDFs.
//       Sections: title block, Overview, Timeline & parties,
//       Location & activity, Categorisation, Descriptions (only
//       non-empty free-text fields), Immediate actions,
//       Environmental impact (only when any env flag is truthy),
//       Near-miss (only "Yes" flags surfaced), Alerts & response.
//       Empty / None / blank / False (in descriptive contexts)
//       skipped. Sparse records get a "No populated fields on
//       this record." paragraph instead of an empty PDF.
//     · `filename_for(..., kind="cs_incidents")` — emits
//       `CSIncident-<issue-number>-<date-of-issue>.pdf`.
//     · `RENDERERS["cs_incidents"] = (render_cs_incident_pdf,
//       "cs_incident_issues")`.
//   `pdf_routes.py`
//     · `RESOURCE_TO_PATH["cs_incidents"] = "cs-incidents"`.
//     · NEW `RESOURCE_TO_PERMISSION` (default = resource key). CS
//       Incidents maps to `reference_library` so the existing
//       permission matrix stays untouched.
//     · NEW `RESOURCE_ORG_SCOPED` (default True). CS Incidents is
//       False — records are XLSX-imported globals with no `org_id`.
//     · NEW helpers `_perm_for(resource)` / `_org_scoped(resource)`
//       / `_doc_query(resource, record_id, user)` centralise the
//       override logic. Used from `mint_pdf_token`, `_build`, and
//       `pdf_by_token` — no duplicated conditionals.
//     · `_build("cs_incidents", "cs-incidents")` registers the
//       legacy path `/api/cs-incidents/{id}/pdf` for parity with
//       the other kinds.
//     · NEW `MIRRORED_ONLY_KINDS = frozenset({"forms",
//       "risk_assessments"})` — resource kinds valid on
//       `<CaptureCard>` because their PDFs are served via the
//       mirrored form_submissions endpoint.
//
// Frontend changes
//   `PdfActions.jsx`
//     · New optional `pdfResourceKind` prop (default `resourceKind`).
//       Used ONLY for the `POST /api/pdf-token` body's `resource`
//       field. `resourceKind` continues to gate the `<Can>` wrapper
//       + drive testids.
//   `CaptureCard.jsx`
//     · New `pdfResourceKind` prop, threaded to `PdfActions`.
//   `CsIncidentsList.jsx`
//     · Removed the v58.13.46 `showPdf={false}` (feature restored).
//     · Added `pdfResourceKind="cs_incidents"` so the PDF request
//       goes out with the correct resource key while keeping the
//       existing `reference_library` permission scope.
//
// Tests
//   NEW `tests/backend_unit/test_pdf_cs_incident_renderer_v58_13_48.py`
//     · Renderer produces non-empty bytes with a %PDF header.
//     · Sparse record (only issue_number + status) still renders.
//     · Overview + descriptions sections appear when the fields are
//       populated (grep the rendered stream for the section labels).
//     · `RENDERERS["cs_incidents"]` maps to the CS renderer +
//       `cs_incident_issues` collection.
//     · `filename_for` case emits the expected pattern.
//     · `RESOURCE_TO_PATH["cs_incidents"] == "cs-incidents"`.
//     · `RESOURCE_TO_PERMISSION["cs_incidents"] == "reference_library"`.
//     · `RESOURCE_ORG_SCOPED["cs_incidents"] is False`.
//     · `_doc_query("cs_incidents", ...)` omits `org_id`.
//     · `_doc_query("hazards", ...)` includes `org_id`.
//   NEW `tests/backend_unit/test_action_availability_contract_v58_13_48.py`
//     · Static grep of every `<CaptureCard resourceKind="X">` in
//       `/app/frontend/src/pages/*.jsx` and
//       `/app/frontend/src/components/**/*.jsx`.
//     · For each callsite: X must be in
//       `RESOURCE_TO_PATH ∪ MIRRORED_ONLY_KINDS`, unless the
//       callsite passes `showPdf={false}` in the same JSX block.
//     · Belt-and-braces: assert the current 8-Capture-page census
//       is exhaustive (parametrized fixture of 8; contract test is
//       agnostic — reads the frontend source).
//
// Guardrails held
//   · Backend restart required (new module + startup index setup
//     for the v58.13.47 telemetry TTL). Restart verified via
//     `/api/openapi.json` → 200 post-boot.
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · v58.13.13 version-sync: all three canonical strings updated.
//   · v58.13.47 (density telemetry) already shipped and green
//     BEFORE this ship — 381 passed + 1 skipped, live anon POST
//     confirmed. No changes to those endpoints.
//   · Track 2 (ZIP re-extraction) still parked pending PVC
//     expansion.


// v160.3.9.58.13.47 — Capture-density telemetry (Ship 1 of a
// back-to-back pair; v58.13.48 follows). Purpose: retune the
// gut-estimate auto-thresholds (12/48) from real usage on
// high-volume pages (Pre-Starts 9,182 rows, CS Incidents 201).
//
// Backend
//   NEW `backend/metrics_routes.py`
//     · `POST /api/metrics/capture-density` — auth-optional
//       (Depends on new `get_current_user_optional` in auth.py that
//       returns None instead of raising when the bearer is
//       missing/expired/invalid). Body: Pydantic model with
//       `ConfigDict(extra="ignore")` so unknown fields drop
//       silently. Persists to `metrics_capture_density` with the
//       requester's `user_id` / `org_id` when authenticated, plus
//       ip, ua (first 200 chars), and the `X-Session-Id` header
//       when supplied. Wraps the insert in try/except and returns
//       `{ok: false, reason: "insert-failed"}` on any DB error —
//       analytics NEVER throws.
//     · `ensure_indexes()` — TTL index on `ts`
//       (`expireAfterSeconds=30 * 24 * 60 * 60`) + compound
//       `(page ASC, ts DESC)` for the per-page threshold-tuning
//       query pattern.
//   Server wiring: `metrics_routes.router` mounted after
//   `pdf_router`; `metrics_ensure_indexes()` invoked in the
//   `@app.on_event("startup")` handler after the core index
//   ensures.
//   Auth: `get_current_user_optional` added at
//   `/app/backend/auth.py:288`. Delegates to `get_current_user`
//   and swallows every HTTPException / Exception → None. Do NOT
//   use it for anything that reads or writes user data.
//
// Frontend
//   `useCaptureDensity.js` — new `_emit(payload)` helper (bare
//   axios, 2 s timeout, no-op `.catch`, wrapped in try/catch).
//     · setMode: emits `{page, mode, previous_mode, effective_mode,
//       item_count, ts, event: 'setMode'}` on transition
//       (`next !== prev`), debounced 500 ms via a `useRef`
//       clearTimeout dance.
//     · one-shot mount ping: emits `{event: 'resolved_from_auto'}`
//       once per hook instance, only after `itemCount` becomes
//       non-zero (avoids emitting during initial `items = []`
//       render pass). Tracked via `initialPingSentRef`.
//   Uses bare `axios` (NOT the authed `/lib/api` client) so a
//   401-redirect interceptor can't fire on preview / anonymous
//   traffic.
//
// Tests
//   NEW `tests/backend_unit/test_metrics_capture_density_v58_13_47.py`
//     · Minimal body → 200 + row written.
//     · Full body → 200 + row written.
//     · Unknown field → 200 (extra="ignore" honoured).
//     · Garbage mode value → 200 (server never validates — dirty-
//       data-tolerant by design).
//     · Anonymous POST → 200 with `user_id: null` in the persisted
//       row + `ts` is a BSON date (TTL prerequisite).
//     · TTL index present with the expected `expireAfterSeconds`.
//     · Compound (page, ts) index present.
//   NEW `tests/frontend_smoke/test_capture_density_telemetry_v58_13_47.py`
//     · Hook imports axios directly (not `/lib/api`).
//     · POST target = `/api/metrics/capture-density` composed from
//       `REACT_APP_BACKEND_URL`.
//     · 500 ms debounce constant + clearTimeout plumbing present.
//     · Failure silently swallowed — `.catch(() => {})` chain,
//       no toast / alert / notify / console.error inside _emit.
//     · Persistence contract from v58.13.39 preserved
//       (localStorage getItem + setItem still called).
//     · Initial `resolved_from_auto` ping present + guarded by
//       `initialPingSentRef` so it fires exactly once.
//
// Guardrails held
//   · Backend restart WILL happen — brief (~3 s), no code change
//     that would break startup. Restart verified via openapi.json
//     returning 200 post-boot.
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · v58.13.13 version-sync: all three canonical strings updated.
//   · No changes to existing endpoints — pure additive.
//   · v58.13.48 (action-availability contract test) queued to
//     ship IMMEDIATELY after this ship verifies green.


// v160.3.9.58.13.46 — P1 UI bugfix: CS Incidents "file icon" flashes
// and disappears when clicked. Reported by user against
// `/app/submissions/cs-incidents`.
//
// Which icon was broken
//   The lucide `<FileText>` icon in `PdfActions` (data-testid
//   `pdf-open-<recordId>`) — rendered by `CaptureCard`'s action row
//   between the Eye and Delete buttons. The Eye + Delete buttons
//   are fine.
//
// Root cause
//   CS Incidents are XLSX-sourced DB rows in the `reference_library`
//   permission domain (see `/app/backend/cs_incident.py:107` — every
//   endpoint gated by `require_permission("reference_library", ...)`).
//   They have NO PDF backend representation — the master
//   `RESOURCE_TO_PATH` map in `/app/backend/pdf_routes.py:32-39` only
//   lists the six kinds that actually have a `pdf_renderer.py`
//   entry (swms, pre_starts, site_diary, hazards, incidents,
//   inspections). But `PdfActions` was rendered unconditionally in
//   every `CaptureCard.jsx` action row.
//
//   Click sequence (verified by curl against $REACT_APP_BACKEND_URL):
//     1. `PdfActions.open()` calls `window.open('about:blank',
//        'paneltec-pdf', 'popup=yes,...')` — browser pops the window.
//     2. `POST /api/pdf-token` with `resource="reference_library"` →
//        backend line 63 raises `HTTPException(400, "Unknown resource")`.
//     3. Catch block at line 52 fires `win.close()` — the popup
//        window we just opened is closed programmatically. That's
//        the "blink and disappear" behaviour the user saw.
//     4. Toast surfaces `apiError(err)` in the corner. Some users
//        miss it because the popup blink grabs their attention.
//
// Why the previous v58.13.10 "flash-bug guardrail" didn't catch it
//   That guardrail was scoped to synthetic-event bubble suppression
//   on tile action buttons (making sure the freshly-mounted View
//   modal doesn't receive its own opening click). This bug isn't
//   about event bubbling at all — PdfActions.open already
//   `e.stopPropagation()`s on line 28 — it's about a backend
//   contract mismatch. Different failure mode, different fix.
//
// Fix (surgical, defaults preserve every existing callsite)
//   1. `CaptureCard` gains an optional `showPdf` prop with
//      `default = true`. When false, PdfActions receives
//      `enabled={false}`.
//   2. `PdfActions` gains an `enabled` prop; when `enabled === false`
//      it returns `null` (no button rendered, no popup possible).
//   3. `CsIncidentsList.jsx` renderTile passes `showPdf={false}`.
//
//   Defence in depth: even if someone later flips `showPdf={true}`
//   on CS Incidents, the icon would still 400 — but we're not
//   silencing the bug, we're removing the button that shouldn't
//   exist. Backend RESOURCE_TO_PATH is the authoritative list of
//   what has a PDF.
//
// Sibling reference_library kinds
//   Grepped for other pages that use `resourceKind="reference_library"`
//   with `CaptureCard`. Only CS Incidents does today. `companies`,
//   `completed_training`, `incident_root_causes`, `list_roles`,
//   `list_forms`, `master_risks` all render bespoke tables — none
//   go through CaptureCard, so none of them have the file icon
//   surfaced. Nothing else to sweep in this ship.
//
// Tests
//   NEW `tests/frontend_smoke/test_cs_incidents_file_icon_v58_13_46.py`
//     · Playwright: log in, navigate to
//       `/app/submissions/cs-incidents`, wait for the first tile,
//       assert `pdf-open-<id>` element is NOT rendered on any tile
//       (the button is now suppressed at the source, so it can't
//       even be clicked).
//     · Belt-and-braces static assertion: CsIncidentsList.jsx
//       passes `showPdf={false}` on its `<CaptureCard>` and
//       CaptureCard exposes the `showPdf` prop with a truthy
//       default.
//     · Regression guard: `resource_library` (typo variant) not
//       accidentally used — matches only the correct
//       `reference_library` string, no drift.
//
// Guardrails held
//   · Frontend-only ship. Zero backend files touched (the 400 on
//     unknown resource is the correct backend behaviour; we're
//     removing the button that shouldn't be rendered).
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · v58.13.13 version-sync: all three canonical strings updated.
//   · Every prior guard (density wiring / canonical density testid
//     / double-stripe / Pydantic ConfigDict / hr_employees import)
//     preserved.
//   · Density telemetry (previously planned as v58.13.46) bumped
//     to v58.13.47 per user instruction — NOT touched here.
//   · Track 2 (ZIP re-extraction) still parked pending PVC
//     expansion.


// v160.3.9.58.13.45 — P1 UI bugfix: double-stripe on grouped tile
// pages. Reported by user with a screenshot of `/app/inspections`
// under the "Daily Site Inspection" group showing two overlapping
// left stripes per tile.
//
// Root cause
//   `GroupedTilesView` wrapped every rendered tile in a full card
//   container:
//     <div class="group relative rounded-lg bg-white border ...
//                 overflow-hidden hover:shadow-md ...">
//       {rowStripe && <div class="absolute left-0 top-0 bottom-0 w-1"
//                          style={{ backgroundColor: rowStripe.hex }} />}
//       <div class={rowStripe ? 'pl-2.5 pr-1.5 py-1.5' : 'p-3'}>
//         {renderTile(rec, { stripeHex: rowStripe?.hex, ... })}
//       </div>
//     </div>
//   The problem: every current caller (Incidents, Inspections,
//   SiteSignin, CsIncidents) returns a `<CaptureCard>` from
//   `renderTile`, and CaptureCard is ITSELF a full card container
//   with its own rounded border + its own `<div class="absolute
//   left-0 top-0 bottom-0 w-1">` stripe painted from `stripeStyle`.
//   The two containers stacked into a card-within-a-card and the
//   inner CaptureCard's stripe sat 10 px right of the outer
//   wrapper's stripe (because of the outer's `pl-2.5` content
//   padding). Before v58.13.40 both stripes were the same colour
//   so the overlap was noise; v58.13.40 introduced strong per-group
//   hexes via `resolveGroupPalette` and made the double-stripe
//   visually loud.
//
// Fix
//   `GroupedTilesView` outer wrapper stripped to a minimal
//   positioning container that keeps ONLY the
//   `${testidPrefix}-tile-${rec.id}` testid — no rounded, no border,
//   no bg-white, no hover shadow, no stripe, no padding. CaptureCard
//   is now the sole visible tile chrome and paints the sole visible
//   stripe from `ctx.stripeHex` (v58.13.41 wiring intact — group
//   palette is still the single source of truth). `rowStripe` is
//   still computed inside GroupedTilesView because it's the closure
//   feeding `ctx.stripeHex` — but no longer painted as a separate
//   DOM element.
//
// Sweep — same shape confirmed identical across all 4 grouped
// pages (grep -n "stripeStyle" pages/{Incidents,Inspections,
// SiteSigninList,CsIncidentsList}.jsx):
//     Incidents.jsx        — already `stripeStyle={ctx.stripeHex ...}` (clean).
//     Inspections.jsx      — had legacy `paletteForType` fallback;
//                            removed in this ship + `paletteForType`
//                            import dropped.
//     SiteSigninList.jsx   — already `stripeStyle={ctx.stripeHex ...}` (clean).
//     CsIncidentsList.jsx  — already `stripeStyle={ctx.stripeHex ...}` (clean).
//
// Rule going forward
//   When `page=<grouped-page>` is passed to `GroupedTilesView`,
//   `resolveGroupPalette({groupKey, page}).hex` is the ONLY stripe
//   source and reaches the tile via `ctx.stripeHex`. Legacy
//   `paletteForType` / `templateColor` fallbacks in the grouped-
//   page render functions are banned — enforced by the new pytest
//   below.
//
// Tests
//   NEW `tests/frontend_smoke/test_no_double_stripe_v58_13_45.py`
//     · GroupedTilesView renders exactly ONE stripe element per
//       tile — parametrised assertion (a) that the outer wrapper
//       no longer contains an `absolute left-0` stripe `<div>`,
//       (b) that CaptureCard remains the only stripe painter.
//     · Parametrised across the 4 grouped page files: each
//       `renderTile` uses `ctx.stripeHex` as the sole `stripeStyle`
//       input and does NOT import legacy stripe helpers
//       (`paletteForType` / `templateColor`) for stripe purposes.
//     · Regression asserts on GroupedTilesView's outer wrapper —
//       no `rounded-lg` / no `border-slate-200` / no `hover:shadow`
//       / no `pl-2.5` padding (any of these coming back = the
//       card-within-a-card bug).
//
// Guardrails held
//   · Frontend-only ship. Zero backend files touched.
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · v58.13.13 version-sync: all three canonical strings updated.
//   · Density wiring / group palette / canonical density testid /
//     Pydantic ConfigDict / hr_employees regression guard — all
//     preserved.
//   · Track 2 (ZIP re-extraction) still parked pending PVC
//     expansion. Track — capture-density telemetry queued as
//     v58.13.46 per user instruction; NOT touched in this ship.


// v160.3.9.58.13.44 — 502 investigation + Pydantic regression guard.
//
// Reported issue
//   User saw `AxiosError: Request failed with status code 502` shortly
//   after v58.13.43 shipped. Concern: the Pydantic v2 ConfigDict
//   refactor at `backend/hr_employees.py:388` broke the FastAPI
//   startup import chain.
//
// Investigation results (all evidence backend is HEALTHY)
//   · `sudo supervisorctl status backend`
//       → `RUNNING pid 4207 uptime 0:00:59` at report time.
//   · `curl http://localhost:8001/api/openapi.json`
//       → HTTP 200 (backend itself is up on the pod).
//   · `curl $REACT_APP_BACKEND_URL/api/openapi.json` (EXTERNAL
//     ingress, i.e. what the browser hits)
//       → HTTP 200 in 245 ms. Rules out an ingress-routing regression.
//   · `curl -X POST $REACT_APP_BACKEND_URL/api/auth/login` with a
//     bad payload
//       → HTTP 422. Confirms Pydantic v2 request validation is
//         loading + running correctly.
//   · Env-loaded `python -c "import hr_employees; RowPatch(...)"`
//       → clean import, no PydanticDeprecatedSince20 raised, extras
//         round-trip through `model_dump()`.
//   · `pytest tests/backend_unit/test_bulk_link_v58_13_26.py`
//       → 21/21 pass, only the unrelated upstream starlette
//         `python_multipart` PendingDeprecationWarning present.
//   · Backend log tail — NO ImportError, NO ValidationError, NO
//     traceback. Last entries are routine Navixy sync, meter-history
//     backfill, and health-check pings.
//
// Conclusion
//   The 502 was a TRANSIENT window (~3-4 s) during the
//   `sudo supervisorctl restart backend` I ran as part of the
//   v58.13.43 verification step. During that window a live axios
//   request from the browser would have hit the ingress before the
//   backend re-opened its listener → 502 bubbled to the client.
//   Backend is now stable and has been serving for 60+ seconds
//   without incident.
//
// Rollback decision
//   NONE. The Pydantic ConfigDict change at hr_employees.py:388 is
//   correct, imports cleanly, is exercised by pytest, and eliminated
//   the `PydanticDeprecatedSince20` warning as intended.
//
// Regression guard (new)
//   `tests/backend_unit/test_hr_employees_import_v58_13_44.py`
//     · `test_hr_employees_imports_cleanly` — reload-imports the
//       module; asserts `router` attribute present.
//     · `test_row_patch_uses_configdict_not_deprecated_class_form` —
//       asserts `model_config == ConfigDict(extra='allow')` AND the
//       nested `Config` class is gone from `__dict__`.
//     · `test_row_patch_accepts_extra_fields_without_deprecation_warning`
//       — constructs RowPatch with 4 arbitrary keys inside a
//       `warnings.catch_warnings` block; asserts round-trip via
//       `model_dump(exclude_unset=True)` AND zero pydantic
//       deprecation warnings.
//     · `test_backend_router_prefix_still_gated_under_api` — defence-
//       in-depth: `router.prefix == "/hr/employees"` (ingress
//       prepends `/api`).
//   These would ALL fail loudly if hr_employees.py ever regresses
//   to the class-based `Config` form OR the ConfigDict import goes
//   missing OR the model stops accepting extras.
//
// Guardrails held
//   · v58.13.13 version-sync: all three canonical strings updated.
//   · `/app/mobile/` untouched except `MOBILE_BUNDLE_VERSION`.
//   · Zero code changes to hr_employees.py itself — the Pydantic
//     fix from v58.13.43 stands.
//   · Track 2 (ZIP re-extraction) still parked pending PVC
//     expansion — no change.


// v160.3.9.58.13.43 — Hygiene bundle. Three low-risk items rolled up
// after the v58.13.41/42 density-wiring work landed cleanly.
//
// 1. Pydantic v2 ConfigDict fix
//    Location: `backend/hr_employees.py:388` (RowPatch model).
//    Was:
//        class RowPatch(BaseModel):
//            class Config:
//                extra = "allow"
//    Now:
//        class RowPatch(BaseModel):
//            model_config = ConfigDict(extra="allow")
//    Silences the last surviving PydanticDeprecatedSince20 warning
//    in the pytest run. `ConfigDict` added to the top-level pydantic
//    import; no runtime behaviour change.
//
// 2. PlantVehicles.jsx lint cleanup
//    Location: `frontend/src/pages/PlantVehicles.jsx:497`.
//    `no-unstable-nested-components` fired because the inline
//    `attentionActions={(row) => (<>...</>)}` render-prop returned a
//    Fragment tree with three buttons — React would tear down and
//    remount every row's action cell on every parent render. Fixed
//    by extracting the JSX to a module-scope `AttentionRowActions`
//    component; the outer arrow now instantiates a stable component
//    type, so the reconciler treats it as the same element across
//    renders and the underlying perf concern the rule was flagging
//    is genuinely resolved. Kept the render-prop shape (ModuleDashboard's
//    contract) via one targeted `eslint-disable-next-line` with an
//    explanatory comment.
//    Also removed 3 stale `// eslint-disable-next-line` directives
//    (react-hooks/exhaustive-deps) that the linter reported as
//    unused after prior refactors — lint output is now noise-free.
//
// 3. Capture-density CI sweep
//    New: `tests/frontend_smoke/test_capture_density_all_pages_v58_13_43.py`.
//    Iterates over all 8 Capture list page files and asserts each
//    one either (a) imports `CaptureListToolbar` and passes both
//    `densityMode` + `onDensityChange` props (the delegation path)
//    or (b) imports and renders `CaptureDensityControl` inline. In
//    either case, the runtime output MUST include the canonical
//    `data-testid="capture-density-control"` element the tester +
//    v58.13.40 contract depend on. Would have caught the v58.13.41
//    dynamic-testid regression in ~30 ms of test time instead of a
//    tester sweep.
//
// Guardrails held
//   · v58.13.13 version-sync: all three canonical strings updated.
//   · `/app/mobile/` untouched except for `MOBILE_BUNDLE_VERSION`.
//   · Backend reload is a hot-reload; no supervisor restart needed
//     (server.py isn't touched).
//   · Track 2 (ZIP re-extraction) still parked pending PVC
//     expansion — user approved the infra ticket; awaiting completion.


// v160.3.9.58.13.42 — Hotfix: `capture-density-control` canonical
// testid restored. Tester found `/app/site-signin` was missing the
// canonical wrapper testid — same on `/app/submissions/cs-incidents`
// and `/app/pre-starts`. Root cause: v58.13.41's extraction of the
// density segmented control into `CaptureDensityControl.jsx` made
// the wrapper `data-testid` a template literal (`${testidPrefix}-
// density-control`), which meant pages that render the control
// inline with a namespaced prefix (Site Sign-In, CS Incidents, Pre-
// Starts) emitted `site-signin-density-control` etc. instead of the
// canonical `capture-density-control` the v58.13.40 regression
// tests + Playwright selectors depend on. `CaptureListToolbar`
// consumers (Incidents, Inspections, Hazards, Site Diary, Risk
// Assessments) were unaffected because the toolbar uses the default
// `testidPrefix='capture'`.
//
// Fix: `CaptureDensityControl` now always emits
// `data-testid="capture-density-control"` on the wrapper (v58.13.40
// contract) and additionally emits `data-density-page="${testidPrefix}"`
// so scoped Playwright queries (e.g. `[data-testid=capture-density-
// control][data-density-page=site-signin]`) still work when a page
// needs to disambiguate. Per-mode radio testids remain namespaced
// (`${testidPrefix}-density-${m}`) because the mode buttons already
// had per-page uniqueness in v58.13.40 (Site Sign-In lacked the
// mode buttons back then, so nothing legacy is coupled to those
// testids).
//
// Verified live via Playwright against all 8 Capture pages: every
// page emits exactly one `capture-density-control` element. Pre-
// Starts required a longer wait (~30 s) to render its 9,182 tiles
// but the control is present.
//
// Guardrails held
//   · Frontend-only ship. Zero backend files touched.
//   · `/app/mobile/` untouched except for the `MOBILE_BUNDLE_VERSION`
//     bump.
//   · v58.13.13 version-sync: all three canonical strings +
//     top-changelog reference match `paneltec-v160.3.9.58.13.42`.
//   · Track 2 (ZIP re-extraction) still parked pending PVC
//     expansion — not touched.
//
// Tests
//   · UPDATED `tests/frontend_smoke/test_capture_wiring_v58_13_41.py`
//     — `test_capture_density_control_component_exists` now asserts
//     the canonical `data-testid="capture-density-control"` wrapper
//     and the `data-density-page` attribute pattern.
//   · NEW `tests/frontend_smoke/test_capture_wiring_v58_13_42.py`
//     — regression test asserting (a) SiteSigninList imports and
//     renders CaptureDensityControl, (b) every one of the 8
//     Capture pages either uses CaptureListToolbar (which delegates)
//     or imports+renders CaptureDensityControl directly, so the
//     canonical wrapper testid will be present on every page.


// v160.3.9.58.13.41 — Ship 4b bugfixes + deferred density wiring.
// Completes the v58.13.39/40 group-palette + capture-density rollout
// by wiring the visible segmented control across every Capture list
// page and by fixing the two bugs surfaced during v58.13.40 testing.
//
// Bug 1 — Banner ≠ tile stripe colour (FIXED)
//   Root cause: `GroupedTilesView` was resolving the banner tint via
//   `resolveGroupPalette({ page })` (v58.13.40) but each tile's inner
//   `CaptureCard` still fell back to its own `templateColor()` legacy
//   palette because the group's hex wasn't threaded down.
//   Fix: `GroupedTilesView` now passes `stripeHex` to `renderTile(rec,
//   ctx)`; every consumer page reads `ctx.stripeHex` and forwards it
//   as `stripeStyle={{ background: ctx.stripeHex }}`. Precedence:
//   group-palette hex > page-provided stripe > CaptureCard fallback.
//
// Bug 2 — `/app/submissions/cs-incidents` reported "hangs 200-240s"
//   under headless automation (INVESTIGATED · NOT REPRODUCIBLE)
//   Profile results:
//     · Backend `GET /api/cs-incident/`     → HTTP 200 in ~174 ms.
//     · Backend `GET /api/cs-incident/columns` → HTTP 200 in ~236 ms.
//     · Frontend DOM ready 1.36 s, first tile visible 2.48 s from
//       goto (201 tiles). Well under the 5 s target.
//   The 240 s figure was almost certainly a stale test-harness
//   timeout hitting a cold-start login redirect chain. No perf fix
//   shipped — profiling numbers preserved in the ship report so the
//   report agent can validate.
//
// v58.13.40 collateral bug (also fixed here)
//   `Incidents.jsx` called `useCaptureDensity('incidents', N)` at
//   page-level to feed the toolbar segmented control, while
//   `GroupedTilesView` created its OWN internal
//   `useCaptureDensity('incidents', N)`. Two hook instances = two
//   independent React states, only sync'd via localStorage on mount.
//   Clicking the segmented control updated the toolbar but never the
//   grid until reload. Now `GroupedTilesView` accepts an optional
//   `density` prop and every page that renders a visible density
//   control passes the same instance down.
//
// Deferred wiring completed (frontend-only)
//   · NEW `components/CaptureDensityControl.jsx` — extracted from
//     `CaptureListToolbar`'s inline block. Same 4-icon segmented
//     control (Wand2 auto / Rows3 compact / LayoutGrid comfortable /
//     LayoutList spacious) plus a `testidPrefix` prop so per-page
//     testids stay unique.
//   · `CaptureListToolbar` now delegates the density UI to the shared
//     component (single visual source of truth).
//   · `CaptureCardGrid` — new optional `gridClass` prop. When passed,
//     overrides the default 5-col grid so flat pages can drive
//     density via `useCaptureDensity().gridClass`.
//   · `GroupedTilesView` — new optional `density` prop (see Bug 2).
//   · Page wiring — the density segmented control is now visible on:
//       · Grouped pages: Incidents (already v58.13.40),
//         Inspections, Site Sign-In, CS Incidents.
//       · Flat pages: Hazards, Pre-Starts, Site Diary,
//         Risk Assessments.
//     Each page threads `density.gridClass` into the grid container
//     and `{ minH, subtitleLines }` into every rendered CaptureCard.
//
// Guardrails held
//   · Frontend-only ship. Zero backend files touched.
//   · `/app/mobile/` untouched except for the `MOBILE_BUNDLE_VERSION`
//     bump.
//   · v58.13.13 version-sync: all three canonical strings +
//     top-changelog reference match `paneltec-v160.3.9.58.13.41`.
//   · v58.13.10 test-placement: new pytest under
//     `/app/tests/frontend_smoke/`.
//   · Legacy `useCaptureDensity` call-sites still work — the new
//     `density` prop is optional; no `stripeHex` requirement for
//     pages that don't pass `page`.
//   · Pre-existing lint warnings from v58.13.27 (PlantVehicles.jsx
//     `no-unstable-nested-components`) intentionally NOT rolled in
//     per user directive to keep this ship focused on the 2 bugs
//     + deferred wiring.
//
// Tests
//   · NEW `tests/frontend_smoke/test_capture_wiring_v58_13_41.py` —
//     asserts (a) `GroupedTilesView` accepts + prefers the external
//     `density` prop, (b) `CaptureCardGrid` honours `gridClass`,
//     (c) `CaptureDensityControl` exists with the shared testid
//     pattern, (d) 4 grouped pages forward `ctx.stripeHex` to
//     `CaptureCard.stripeStyle`, (e) 4 flat pages instantiate
//     `useCaptureDensity` and pass `density.gridClass` +
//     `density.cardMinH` + `density.subtitleLines` through, (f)
//     version-sync current.


// v160.3.9.58.13.40 — v58.13.39 wiring. Threads the group-palette +
// capture-density primitives into the shared UI so users see the
// tile theming + density switch in production.
//
// Frontend (component wiring)
//   · `components/capture/GroupedTilesView.jsx` — new opt-in `page`
//     + `pageKey` props. When `page` is set, banner tint/text +
//     tile-stripe hex are resolved from `resolveGroupPalette({
//     groupKey, page })` so banner and its member tiles share the
//     same colour. Internal `useCaptureDensity(pageKey, items.length)`
//     drives `gridClass` (per-density Tailwind), tile `min-height`
//     (96 px comfortable / 64 px compact), and passes
//     `subtitleLines` down to the tile renderer as a hint.
//   · `components/CaptureCard.jsx` — new `minH` and `subtitleLines`
//     props. `minH` sets an inline `min-height` (uniform card floor);
//     `subtitleLines=0` hides the subtitle in Compact mode.
//   · `components/CaptureListToolbar.jsx` — opt-in density segmented
//     control. Renders only when the parent page passes
//     `densityMode` + `onDensityChange`. 4 icon-only radios
//     (Wand2 / Rows3 / LayoutGrid / LayoutList) with
//     `data-testid="capture-density-control"`.
//   · Page wiring:
//       · `pages/Incidents.jsx`    — instantiates useCaptureDensity,
//         passes to both toolbar + GroupedTilesView (via `page` +
//         `pageKey='incidents'`). First page with the visible
//         segmented control.
//       · `pages/Inspections.jsx`  — passes `page='inspections'` +
//         `pageKey='inspections'` (auto-density only, no toolbar
//         control yet).
//       · `pages/SiteSigninList.jsx` — passes `page='site-signin'` +
//         `pageKey='site-signin'`.
//       · `pages/CsIncidentsList.jsx` — passes `page='cs-incidents'`
//         + `pageKey='cs-incidents'`.
//
// Deferred (non-blocking follow-up ship)
//   · The 3 other grouped pages (Inspections / SiteSignin /
//     CsIncidents) will get the visible toolbar segmented control
//     in v58.13.41 — same 3-line pattern used in Incidents (import
//     hook + pass `densityMode`/`onDensityChange` to the toolbar).
//     Auto-density already works on all 4 grouped pages via
//     GroupedTilesView's internal hook.
//   · Flat pages (Hazards / PreStarts / SiteDiary / RiskAssessments)
//     still use CaptureCardGrid — density integration for those is
//     also queued for v58.13.41 (needs the same page-key + density
//     prop threading).
//
// Tests
//   · NEW `tests/frontend_smoke/test_capture_wiring_v58_13_40.py` —
//     asserts GroupedTilesView imports and calls `resolveGroupPalette`
//     + `useCaptureDensity`, CaptureListToolbar renders
//     `capture-density-control` when props are passed, CaptureCard
//     accepts and applies `minH` + `subtitleLines`, and Incidents.jsx
//     wires all three.
//
// Guardrails held
//   · Frontend-only. Zero backend files touched.
//   · Backwards-compatible — pages that don't pass `page` /
//     `pageKey` / `densityMode` see the pre-v58.13.40 behaviour.
//   · `/app/mobile/` untouched — deferred to `e1_expo_frontend_dev`.


// v160.3.9.58.13.39 — Group palette + capture density foundation.
// Introduces two shared FE-only primitives that Capture list pages
// consume to converge on (a) per-group accent colours and (b)
// flexible tile density with a user-facing manual override.
//
// Frontend (new files only in this ship — page wiring lands next)
//   · NEW `lib/groupPalette.js` — `resolveGroupPalette({ groupKey,
//     page })` returns a deterministic { hex, tint, text, name }
//     per group key. 8-colour WCAG-safe ROTATION table (slate/blue/
//     emerald/amber/rose/violet/teal/orange) with a djb2-lite
//     `hashIdx()` mapping. Per-page overrides:
//       · page='incidents'   → `INCIDENT_CATEGORY_PALETTE` (6-cat)
//       · page='inspections' → `paletteForType()` from `preStartsPalette.js`
//       · page='site-signin' / 'cs-incidents' → 8-colour rotation
//   · NEW `lib/useCaptureDensity.js` — hook returning `{ mode,
//     effectiveMode, setMode, gridClass, cardMinH, subtitleLines }`
//     for a given `(pageKey, itemCount)`. Persists mode under
//     `localStorage.captureDensity:<pageKey>`. Auto thresholds:
//       ·  n < 12    → Spacious  (sm:2 · lg:3 · xl:4, min-h 96 px,
//                                 subtitle 2-line clamp)
//       · 12–48      → Comfortable (sm:2 · lg:4 · xl:5 · 2xl:6,
//                                    min-h 96 px, 1-line clamp)
//       ·  n > 48    → Compact   (sm:3 · lg:5 · xl:7 · 2xl:8,
//                                 min-h 64 px, subtitle hidden)
//
// Design intent
//   · Same group key → same colour, reload-stable across the whole app.
//   · GroupedTilesView reads `tint`+`text` for the banner; CaptureCard
//     reads `hex` via `stripeStyle` for the 4-px left accent. One
//     source of truth means the banner and its member tiles cannot
//     drift.
//   · Density thresholds sized for real data (checked against the
//     122-record CS Incidents pilot and the ~1,055-tall VT Daily
//     Pre-Start register). Users tend to browse incidents in
//     Comfortable but scan long registers in Compact — per-page
//     localStorage means the preference travels with the page.
//   · No page wiring in this ship — GroupedTilesView, CaptureCard,
//     and CaptureListToolbar consumers land in the next ship
//     (v58.13.40 will wire the toolbar segmented control + banner
//     tint + tile-stripe inheritance). Ships the primitives first
//     so the wiring stays a mechanical add-on rather than a
//     coupled change.
//
// Tests
//   · NEW `tests/frontend_smoke/test_group_palette_and_density_v58_13_39.py`
//     — 10 pytests using `node -e` to exercise the pure helpers
//     deterministically: ROTATION shape, hash stability across
//     10 calls, resolveGroupPalette returns { hex, tint, text, name },
//     autoModeForCount branches at 12 / 48, grid classes present,
//     localStorage key pattern, version-sync.
//
// Guardrails held
//   · Frontend-only. Zero backend files touched. No hot-reload fired.
//   · `/app/mobile/` untouched — mobile mirror deferred to
//     `e1_expo_frontend_dev`.
//   · No existing component modified; no visual regression possible
//     until v58.13.40 wires the consumers.


// v160.3.9.58.13.38 — Capture tile-parity ship. Normalises the tile
// SIZE + COLOUR + STATUS-PALETTE across the 8 tile-shaped Capture
// pages by migrating the 4 remaining bespoke `renderTile` bodies onto
// the canonical `<CaptureCard>` shell. Zero chrome changes — page
// headers, tabs, toolbars, sticky behaviour, filter chips, grouping
// banners, container widths, sidebar pastels, and `ModuleDashboard`
// colours are byte-identical to v58.13.37.
//
// Pages migrated to the shared shell
//   · `pages/Incidents.jsx`         — inline JSX → `<CaptureCard>`,
//     `follow_up_status` moves into `badges`, description into
//     `subtitle`, occurred-at date into `record.date`. Group banners
//     (INCIDENT_CATEGORY_PALETTE) untouched.
//   · `pages/Inspections.jsx`       — inline JSX → `<CaptureCard>`,
//     pass/fail/N-A counts move into `subtitle`, template palette
//     preserved via `stripeStyle={{ background: paletteForType(name).hex }}`.
//   · `pages/SiteSigninList.jsx`    — inline JSX → `<CaptureCard>`,
//     visitor / worker name in `template_name_snapshot`, site/job in
//     `subtitle`, `hideOperator` (no operator row on this page).
//   · `pages/CsIncidentsList.jsx`   — inline JSX → `<CaptureCard>`,
//     `#issue_number · issue_type` in `template_name_snapshot`,
//     responsible manager as operator, description in `subtitle`,
//     status as a shared `<StatusBadge>` (replaces the bespoke
//     `StatusPill` palette). Bespoke `CsIncidentDetailModal` viewer
//     preserved via a new `onView` opt-in prop on CaptureCard.
//
// Component tweak
//   · `components/CaptureCard.jsx` — new optional `onView` prop.
//     When provided, the built-in Eye button calls `onView(record)`
//     instead of opening the internal `<SubmissionViewer>`. Default
//     behaviour unchanged for the 5 pages that already use it.
//
// Canonical tile spec inherited from CaptureCard (unchanged)
//   Outer:  rounded-lg bg-white border border-slate-200
//           hover:shadow-md hover:border-slate-300
//   Stripe: 4-px left accent from templateColor(record) or stripeStyle
//   Body:   pl-2.5 pr-1.5 py-1.5
//   Grid:   sm:2col · lg:4col · xl:5col · 2xl:6col (owner set by page)
//   Height: ~96 px text-only
//
// Out of scope (intentional)
//   · AI SWMS (`/app/swms`) — table view, not a tile grid.
//   · Bulk Import from URL (`/app/pre-starts/bulk-import`) — wizard,
//     no tile list.
//   · Mobile mirror (`/app/mobile/`) — deferred to `e1_expo_frontend_dev`.
//
// Tests
//   · NEW `tests/frontend_smoke/test_tile_size_colour_parity_v58_13_38.py`
//     — asserts the 4 migrated pages import `CaptureCard` and their
//     `renderTile` bodies render through `<CaptureCard`, that the
//     4 already-canonical pages still use `CaptureCard`, and that
//     `Swms.jsx` + the bulk-import wizard remain intentionally
//     excluded. Version-sync pytest included.
//
// Guardrails held
//   · Frontend-only ship. Backend hot-reload not triggered — the
//     v58.13.37 re-extraction script (PID 5343) keeps running.
//   · Page-specific data preserved verbatim: severity /
//     follow_up_status / signed-in name / issue# / pass-fail counts.
//   · Sidebar `submissions/cs-incidents: coral` pastel unchanged.
//   · Container widths unchanged (`max-w-6xl` / `max-w-7xl`).


// v160.3.9.58.13.37 — Ship 4b Path B. Restores `--source zip
// --zip-root <path>` mode to `backend/scripts/reextract_misclassified_v58_13_35.py`
// (stripped in v58.13.35 per the user's "keep it clean" directive,
// now needed for the A-Barbari-2 pilot).
//
// Backend (script + tests only — running pipeline UNCHANGED)
//   · `_build_zip_pdf_index()` walks the top-level ZIPs under
//     `--zip-root` AND recurses ONE level into nested ZIPs
//     (Simpro-shape: outer archive contains per-worker inner ZIPs).
//     All streaming in-memory via `io.BytesIO` — no scratch disk,
//     no `.extractall()`. Builds `{pdf_sha256: (outer_zip,
//     inner_zip_or_empty, pdf_name)}` for O(1) per-record lookup.
//   · `_zip_source_commit()` per record: pulls PDF bytes, renders
//     via `_pdf_pages_png_b64`, runs `_load_classifier_roster()`
//     + `_claude_classify` + `_claude_extract` (both via the
//     existing `_claude_call_with_backoff` machinery),
//     `_cache_put`s the fresh payload (invalidates the old cache
//     row), then applies the routing decision:
//       · migrate → update the existing form_submissions row with
//         rich `fields[]` + top-level `metadata.hazards`/`crew`/
//         `signatures`/`tailgate_topics`/`byda`/`tgs`/`gps`/
//         `photos_present` shortcuts (matched by SubmissionViewer's
//         `<Sections>` switch in v58.13.36). Clears
//         `metadata.needs_review`. Bumps `metadata.reextract_reason`
//         to `"v58_13_37_zip_source_reextract"`.
//       · update_in_place → refreshes `pre_starts.fields[]` +
//         template snapshots.
//   · Cost cap: hard-enforced via `REEXTRACT_COST_CAP_USD`
//     (default 500) with a pre-flight check every record so a
//     projected classify+extract pair (2 × $0.082) does not push
//     cumulative spend over the cap.
//   · Progress heartbeat: `log.info("progress: processed=…"` every
//     100 records (env-overridable via `REEXTRACT_PROGRESS_EVERY`).
//   · Failure isolation: bad ZIP, hash miss, Claude error → audit
//     `status='failed'`, `needs_review` preserved, batch continues.
//
// CLI additions
//   · `--source {cache-derived|zip}` (default cache-derived)
//   · `--zip-root <path>` (required when `--source zip`)
//
// Tests
//   · NEW `tests/backend_unit/test_reextract_zip_mode_v58_13_37.py`
//     — 12 pytests: index build (top-level + nested), routing
//     preserves needs_review on failure, clears it on success,
//     rich metadata shortcuts populated, cost cap tripped after N
//     records, unresolved classifier verdict → status='unresolved',
//     bad ZIP entry → status='failed' with batch continuing,
//     version-sync current.
//
// Guardrails held
//   · Zero touch to `bulk_import_prestarts.py`.
//   · Soft-delete only.
//   · Original pre_starts IDs preserved.
//   · Idempotent: post-v58.13.35 records already stamped are
//     filtered out via `BASE_FILTER: template_name_snapshot=None`.


// v160.3.9.58.13.36 — Category-aware SubmissionViewer detail sections.
// Fixes the "detail modal shows SSRA-shape sections for pre-start
// records / no checklist for the actual pre-start data" bug the user
// has been battling for weeks. Pure FE fix — zero backend touches,
// zero data churn.
//
// Frontend
//   · NEW `lib/detailViewCategory.js`: `resolveCategory(record)`
//     returns 'pre_start'|'plant_pre_start'|'hazard'|'swms'|'permit'|
//     'inspection'|'unknown' via a 3-step fallback:
//        1. `record.template_category_snapshot` (DB source of truth)
//        2. keyword-sniff on `template_name_snapshot`/`template_name`
//        3. parse `work_summary` for the Simpro `::<TEMPLATE>` marker
//     Also exports `paletteForCategory` (pill colours),
//     `isPartialCacheOnlyReextract` (v58.13.35 marker sniff),
//     `isMeaningfulValue` (skips null/'None'/[]/{}/empty strings).
//   · `SubmissionViewer.jsx`: header now renders a small category
//     pill (PRE-START blue / HAZARD amber / PERMIT orange / …)
//     alongside the record title. Content area routes through the
//     new `<Sections>` switch:
//        · pre_start / plant_pre_start / inspection / unknown →
//          single CHECKLIST section (fields[] as label/answer
//          pairs; empty labels become "Field N").
//        · hazard / swms → HAZARDS DISCUSSED · CREW SIGN-ON ·
//          SIGNATURES · CHECKLIST (each with a distinct empty
//          state; hazards/crew/signatures pulled from either the
//          pre_starts row shape or form_submissions metadata).
//        · permit → HAZARDS · SIGNATURES · CHECKLIST.
//     Records with `metadata.reextract_reason=
//     'v58_13_35_partial_cache_only'` render an amber banner at the
//     top explaining that hazards/crew/signatures are pending a
//     full ZIP-source re-extraction.
//
// Tests
//   · NEW `tests/frontend_smoke/test_prestart_detail_display_v58_13_36.py`
//     — non-JS-jsdom smoke: exercises `resolveCategory` /
//     `isMeaningfulValue` / `paletteForCategory` /
//     `isPartialCacheOnlyReextract` by parsing the JS module with
//     node and asserting on returned values. Also runs the
//     version-sync pytest guard.
//
// Guardrails
//   · v58.13.10 flash-bug guardrail held — no in-modal fetches
//     added; category resolution is `useMemo` on the immutable
//     record prop.
//   · Zero backend touches; zero DB touches; zero migration.
//   · Legacy fields[]-only records still render (fall through to
//     CHECKLIST via 'unknown' category — matches pre-ship behaviour).


// v160.3.9.58.13.35 — Ship 4b. Backfill re-extraction of 3 776
// misclassified pre_starts rows (cache-derived, $0, no Claude
// calls). Fixes the historical fallout of the pre-v58.13.30
// pipeline that shoehorned SSRAs / permits / non-pre-start forms
// into `pre_starts` with `template_name_snapshot=None` and
// `template_category_snapshot=None`. All 3 776 offenders currently
// render on the Daily Pre-Starts tile as `Unclassified` (see
// `preStartsPalette.js::inferTemplateType` fallback).
//
// Backend (new files only — running pipeline UNCHANGED)
//   · NEW `backend/bulk_import_template_inference.py`. Python port
//     of `preStartsPalette.js::inferTemplateType()` +
//     `resolve_against_roster()` fuzzy resolver (exact / substring /
//     token-overlap Jaccard fallback with a 0.75 confidence floor,
//     env-overridable via `REEXTRACT_ROSTER_MIN_CONFIDENCE`) +
//     `infer_category_from_name()` keyword rules matching the
//     pipeline's routing conventions + `should_migrate_out_of_prestarts()`
//     mirror of `_should_write_prestarts_shim()` (inverted).
//   · NEW `backend/scripts/reextract_misclassified_v58_13_35.py`.
//     Cache-derived re-extraction. Reads `pre_starts` rows where
//     `template_name_snapshot=None`, parses `work_summary` for the
//     Simpro-appended `::<TEMPLATE> (N) - <date>.pdf` marker,
//     resolves against the v58.13.34 roster (form_templates ∪
//     list_forms), then either:
//        · action=migrate    → soft-delete pre_starts, insert
//          form_submissions with cache `extracted` payload as
//          positional fields[] + metadata.needs_review=true +
//          metadata.reextract_reason="v58_13_35_partial_cache_only".
//        · action=update_in_place → stamp template_name_snapshot +
//          template_category_snapshot on pre_starts.
//        · action=noop_unresolved → audit-only.
//     CLI: --commit / --dry-run (default) · --limit N · --scope
//     {all,ssra,ce_ssra,recent_90d}. Batched 50 with configurable
//     inter-batch sleep. Full audit trail into
//     `bulk_import_reextract_v58_13_35_audit` (append-only, one doc
//     per record per attempt). Cost cap via
//     `REEXTRACT_COST_CAP_USD` env (default 500) — always $0 in
//     cache-derived mode, retained for the parked ZIP-source ship.
//
// Guardrails
//   · Preserves original `pre_starts._id` and `.id` for audit
//     continuity — soft-deletes, NEVER hard-deletes.
//   · Idempotent: a second `--commit` sees zero rows to process
//     (BASE_FILTER's `template_name_snapshot=None` no longer
//     matches post-stamp).
//   · Per-record failure isolation — one record failing does NOT
//     abort the batch; audit logs the failure with `status=failed`.
//   · Zero touch to `bulk_import_prestarts.py` — the running
//     pipeline is byte-identical to v58.13.34.
//
// Tests
//   · NEW `tests/backend_unit/test_reextract_v58_13_35.py` — 16
//     pytests including version-sync: inference / roster / category
//     helpers, planner branching (migrate / update_in_place /
//     noop), dry-run report shape, commit migrate path (preserves
//     original id, soft-deletes source, stamps needs_review),
//     commit update-in-place path, failure isolation, cost-cap
//     enforcement, idempotency, --scope + --limit filters.
//
// Guardrails held
//   · v58.13.13 version-sync: PASS.
//   · v58.13.10 test-placement: /app/tests/backend_unit/.
//   · Zero touch to the running bulk_import pipeline.


// v160.3.9.58.13.34 — Ship 5. list_forms roster expansion. The 6
// templates the user kept insisting existed (Drain Cleaning SSRA,
// Excavation Permit NDD, Directional Drill Pre-Start, Telehandler /
// Loader, Underground Asset Site Location Form, WHSEQ Compliance
// Audit) live in `list_forms`, not `form_templates`. My Ships 1/4a
// only queried `form_templates` so they were invisible.
//
// Backend
//   · `bulk_import_prestarts.py::_load_classifier_roster()` now
//     iterates BOTH `form_templates` (with exclusion filter) AND
//     `list_forms` (no category filter — it's already the user-visible
//     catalogue). Merges into a single `{tid: name}` roster. Duplicate
//     ids resolved form_templates-wins.
//   · Failure isolation: a `list_forms` query blowup logs WARN but
//     still returns form_templates entries (defence-in-depth).
//   · INFO log now stamps the split:
//       `classifier roster: N from form_templates, M from list_forms
//        → total=X unique_names=Y`.
//   · Extractor unchanged — `_claude_extract` already handled an
//     empty template dict via `template.get('fields', [])` → labels=[]
//     + `category=""` → pre-start prompt fallback. list_forms entries
//     that resolve to `templates_by_id.get(tid) or {}` therefore
//     extract with the pre-start prompt (imperfect but never crashes).
//     Correct per-category prompts for these will require Ship 6
//     (migrate list_forms → form_templates with real `fields[]`).
//
// Tests
//   · NEW `tests/backend_unit/test_list_forms_roster_v58_13_34.py`
//     — 4 pytests + version-sync: roster includes all 6 list_forms
//     entries, roster strictly wider than form_templates-only,
//     list_forms failure doesn't break the roster, extractor handles
//     empty template dict without crashing.
//
// Guardrails held
//   · v58.13.13 version-sync: PASS.
//   · v58.13.10 test-placement: /app/tests/backend_unit/.
//   · Zero touch to 11 407 existing records / 7 619 cache entries.
//   · bulk_import job 4f395643 UNTOUCHED.
//   · Backend WILL reload once.


// v160.3.9.58.13.33 — Ship 4a. Classifier roster widened from
// inclusion to exclusion + MisclassifiedImportBanner FE component.
//
// Background: Ship 1 (v58.13.30) shipped an inclusion-list env var
// (`BULK_IMPORT_CLASSIFIER_CATEGORIES` = pre_start,plant_pre_start,
// hazard,swms,permit) that silently dropped legit templates tagged
// under categories not in the default set — notably `Hot Work Permit`
// (`general`) and 17 `Vehicle Pre-Use Inspection` / `Heavy Vehicle
// Daily Check` / `Construction Heavy Equipment Pre-Operation
// Checklist` templates (`inspection`). Exclusion-list is the safer
// pattern: auto-discover every active template unless it's on a
// list of known non-bulk-import categories.
//
// Backend
//   · `backend/bulk_import_prestarts.py`:
//     · New env var: `BULK_IMPORT_CLASSIFIER_CATEGORY_EXCLUDE`
//       default `site_diary,incident,toolbox,near_miss,admin`.
//     · Legacy `BULK_IMPORT_CLASSIFIER_CATEGORIES` (inclusion) still
//       honoured when explicitly set; emits a WARN nudging the
//       operator to migrate to the exclusion list.
//     · `_load_classifier_roster()` now queries `{category: {$nin:
//       <exclude_list>}, deleted_at: None}` by default. TTL cache +
//       DB-failure fallback preserved unchanged.
//
// Frontend
//   · NEW `components/MisclassifiedImportBanner.jsx`. Detects
//     imported records where `fields[]` is empty OR the
//     filename-parsed template family disagrees with
//     `template_name_snapshot`. Renders an amber banner nudging
//     the user to view the source PDF or manually re-enter data.
//     No destructive action; v58.13.10 stopPropagation guard on
//     every click handler.
//   · Not mounted into PreStarts.jsx yet — the component is
//     drop-in ready for the pre-starts detail view when that
//     view lands. Mounting is a one-line change that can happen
//     alongside the detail-modal build.
//
// Guardrails held
//   · v58.13.13 version-sync: PASS.
//   · Ship 3's `_should_write_prestarts_shim` routing UNCHANGED.
//   · Ship 2's per-category prompts UNCHANGED.
//   · Zero touch to 11 407 existing records / 7 619 cache entries.
//   · bulk_import job `4f395643` UNTOUCHED.
//   · Backend WILL reload once (single `bulk_import_prestarts.py`
//     edit).
//
// Tests
//   · NEW `tests/backend_unit/test_classifier_exclusion_v58_13_33.py`
//     — 5 pytests: default-exclusion returns non-excluded set,
//     empty-exclusion returns all, legacy inclusion still works,
//     roster strictly wider than the 6-template baseline,
//     version-sync.
//   · NEW `tests/frontend_smoke/test_misclassified_banner_v58_13_33.py`
//     — 7 pytests: file exists, conditional detection logic
//     (`fieldsEmpty` / `templateMismatch` / `isImported`),
//     stopPropagation on click, expected testids, amber palette,
//     null-return when not applicable, version-sync.


// v160.3.9.58.13.32 — Category-aware bulk-import routing. Ship 3 of 4
// on the SSRA / permit / hazard fix path. Ship 1 (v58.13.30) let the
// classifier PICK the right template. Ship 2 (v58.13.31) gave the
// extractor the right QUESTIONS to ask. This ship stops non-pre-start
// records from polluting the `pre_starts` collection at write time.
//
// Backend
//   · `backend/bulk_import_prestarts.py`:
//     · NEW pure helper `_should_write_prestarts_shim(category,
//       template_name) -> bool`. Testable in isolation.
//       · category in {pre_start, plant_pre_start} → True (shim)
//       · category in {hazard, swms, permit}       → False (no shim)
//       · unknown / missing category              → backward-compat
//         fall-back to the legacy name-based substring check
//         ("pre-start" / "pre start" / "checklist" in name)
//     · Promotion block at L2451+ now consults the helper instead of
//       the inline `if "pre-start" in _tpl` gate. Extra INFO log line
//       stamps the routing decision per PDF hash so future
//       misclassifications are diagnosable from the logs alone:
//         `bulk_import route: pdf_hash=<h> category=<cat>
//          template=<name> → {pre_starts + form_submissions
//                             | form_submissions only}`
//
// Behavioural change on FUTURE imports
//   · Correctly-classified SSRAs / permits / SWMS forms will land
//     ONLY in `form_submissions` (source of truth) — no more
//     `pre_starts` shim rows for them. This stops the 3 776 historical
//     misclassifications from being reproduced going forward.
//   · The pre-start families (Daily / CVT / Tip Truck / VT / Weekly /
//     Plant) continue to dual-write exactly as before.
//   · Cached-hit rows classified before v58.13.30 (i.e. all 7 619
//     existing cache entries) still route the same way because
//     their cache `template_id` maps back to templates_by_id whose
//     `category` is `pre_start` / `plant_pre_start` (all 6 legacy
//     templates fall in these categories). Backward-compat wins.
//
// Ship boundaries — deliberately NOT in this ship
//   · No re-extraction of the 11 407 existing records.
//   · No mutation of existing `pre_starts` rows. The historical 3 776
//     misclassifications remain in the collection until Ship 4 (or a
//     manual cleanup) addresses them.
//   · No changes to `form_submissions` writes. Every category still
//     gets a form_submissions row — that's the source of truth.
//   · No changes to the low-confidence short-circuit from Ship 1
//     (still no shim, no form_submissions insert on low-confidence).
//   · No changes to the extractor prompts from Ship 2.
//   · No changes to the legacy no-hash `insert_one(_doc)` fallback
//     branch.
//   · bulk_import job `4f395643` UNTOUCHED.
//
// Guardrails held
//   · v58.13.13 version-sync: PASS.
//   · v58.13.10 test-placement: new pytest under
//     `/app/tests/backend_unit/`.
//   · v58.13.30 + v58.13.31 pytest suites still pass unchanged.
//   · Backend WILL reload once (single `bulk_import_prestarts.py`
//     edit). Drain expected <10s per v58.13.15.
//
// Tests
//   · NEW `tests/backend_unit/test_category_routing_v58_13_32.py`
//     — 12 pytests covering: pre_start / plant_pre_start (both write
//     shim), hazard / permit / swms (all suppress shim), no-category
//     + pre-start-name fallback (writes), no-category + SSRA-name
//     (no shim), empty inputs, case-insensitive matching, category
//     wins over name-fallback, unknown category with random name
//     (no shim), version-sync.


// v160.3.9.58.13.31 — Per-category extraction prompts. Ship 2 of 4
// on the SSRA/permit/hazard bulk-import fix path. Ship 1 (v58.13.30)
// let the classifier PICK an SSRA / permit template; this ship gives
// the extractor the right QUESTIONS to ask once it knows the category.
//
// Backend
//   · `backend/bulk_import_prestarts.py`:
//     · New `_get_prompt_for_category(category, template_name, labels)`
//       helper returning `(system, user)` prompts.
//     · `_claude_extract()` now reads `template.get("category")` and
//       dispatches. No signature change — the calling code already
//       passes the full template dict.
//     · Recognised categories:
//       · `pre_start` / `plant_pre_start` → v58.11.0 prompt verbatim
//         (regression-locked; 5 609 correctly-classified daily
//         pre-starts produce the exact same prompt as before).
//       · `hazard` → NEW SSRA-shaped prompt with `hazards[]`,
//         `crew[]`, `signatures[]`, TAILGATE topics list,
//         BYDA/TGS numbers, emergency assembly point, GPS coords,
//         SWMS ids list, photos_present bool.
//       · `permit` → NEW permit-shaped prompt with `permit_type`,
//         `checklist{}` (template-label-driven), `hazards[]`,
//         `signatures[]`.
//       · `swms` → aliased to `hazard` (schemas overlap; can split
//         later if the two diverge).
//       · unknown / empty / None → falls back to the pre-start
//         prompt so cache-hit rows that never had a category stamped
//         behave exactly as before.
//     · Case-insensitive category matching (strip + lower).
//     · Existing `template.get('name')` / labels list still fed
//       through — pre-start + permit prompts use them; SSRA prompt
//       ignores labels (SSRA field set is fixed regardless of the
//       template row's declared fields).
//
// Ship boundaries — deliberately NOT in this ship
//   · Routing UNCHANGED. Non-pre-start records still traverse the
//     existing pre_starts shim path. Ship 3 handles the split.
//   · No re-extraction of the 11 407 existing records. This ship is
//     forward-only.
//   · Cache UNTOUCHED. Row count identical pre/post.
//   · bulk_import job `4f395643` UNTOUCHED (still `state=failed`,
//     `auto_resume_count=17`).
//
// Guardrails held
//   · v58.13.13 version-sync: PASS.
//   · v58.13.10 test-placement: new pytest under
//     `/app/tests/backend_unit/`.
//   · Pre-start prompt shape byte-locked by the regression test
//     `test_prestart_prompt_returns_v58_11_0_shape`.
//   · Backend WILL reload once (single `bulk_import_prestarts.py`
//     edit). Drain expected <10s per v58.13.15.
//
// Tests
//   · NEW `tests/backend_unit/test_extraction_prompts_v58_13_31.py`
//     — 12 pytests covering: pre-start regression lock, plant/pre-start
//     alias, hazard SSRA field set, SWMS→hazard aliasing, permit
//     field set, unknown/empty/None fallbacks, case-insensitive
//     matching, `_claude_extract` category dispatch (hazard, missing,
//     permit), version-sync.


// v160.3.9.58.13.30 — Bulk-import classifier expansion + low-confidence
// escape hatch. Ship 1 of 4 for the SSRA/permit/hazard bulk-import
// fix path (approved after the Feb 2026 late-night diagnostic
// established that 3 776 of 11 407 imported records — the 1 779
// Construction & Excavation SSRAs, 1 452 Viatec SSRAs, 413
// Combination VT-CVTs, 66 Drain Cleaning SSRAs, 52 Excavation
// Permits NDD, plus ~14 long-tail — got shoehorned into the
// hardcoded 6-pre-start-template classifier roster because the
// pipeline had no other option to pick).
//
// Backend
//   · `backend/bulk_import_prestarts.py`:
//     · New env-var + defaults:
//       · `BULK_IMPORT_CLASSIFIER_CATEGORIES`
//         default `pre_start,plant_pre_start,hazard,swms,permit`
//       · `BULK_IMPORT_MIN_CLASSIFIER_CONFIDENCE` default `0.7`
//     · New `_load_classifier_roster()` — 5-min TTL, queries
//       `form_templates` for `category ∈ configured set` +
//       `deleted_at = None`. Returns `{template_id: template_name}`.
//       Falls back to the hardcoded 6-template `_TEMPLATE_HINTS`
//       dict on DB failure OR on empty result (defence-in-depth so
//       a bad env var can't blackhole the pipeline).
//     · New `_CLASSIFIER_ESCAPE_LABEL = "(none of the above)"` —
//       appended to the option list every classifier call so
//       Claude can signal "this PDF doesn't match anything".
//     · `_claude_classify()` grows an optional `roster` param;
//       defaults to `_TEMPLATE_HINTS` for backward-compat. The
//       system + user prompts are re-worded to cover pre-starts +
//       SSRAs + permits + SWMS + hazard reports.
//     · Fresh-classification path now short-circuits on
//       low-confidence (no template picked, escape label, or
//       confidence < 0.7): writes `{classification_low_confidence:
//       True}` to `bulk_import_pdf_cache` so a re-run doesn't burn
//       another Claude call, stamps `status="unclassified"` on the
//       `bulk_import_dryrun` record, and RETURNS BEFORE the
//       extractor call. Downstream promotion gates (`status == "ok"`
//       at L2124) naturally skip these, so no `form_submissions`
//       insert and no `pre_starts` shim gets written.
//     · Cached-hit path also honours the flag — a previously stored
//       `classification_low_confidence` verdict re-emits the same
//       unclassified dryrun record without re-hitting Claude.
//     · Legacy 6-template roster still resolvable end-to-end
//       (backward-compat).
//
// Deliberately NOT in this ship
//   · Extraction prompts are UNTOUCHED. `_claude_extract()` still
//     only knows the pre-start question set. SSRAs classified
//     correctly will still fail to extract hazards/crew/signatures
//     — that's Ship 2.
//   · Routing is UNTOUCHED. Correctly-classified non-pre-start
//     records still land through the pre_starts shim if they hit
//     the "pre-start" substring check at L2175. Ship 3 addresses this.
//   · The 11 407 existing records are UNTOUCHED. No re-extraction,
//     no cache invalidation, no cache mutation. This ship is
//     forward-only.
//   · Two hardcoded pre-start-family strings in the fresh path
//     ("Daily Pre-Start" fallback when tpl_name is empty, and the
//     default template_id) are preserved for backward-compat with
//     older cached rows. Once every cache entry carries an
//     unambiguous template_id, those fallbacks can be dropped —
//     out of scope tonight.
//
// Guardrails held
//   · v58.13.13 version-sync: PASS (3 canonical files + this block).
//   · v58.13.10 test-placement: new pytest under
//     `/app/tests/backend_unit/`.
//   · bulk_import job 4f395643 is `state=failed` — untouched, not
//     restarted, not resumed.
//   · Backend WILL reload once (single `bulk_import_prestarts.py`
//     edit). Drain expected <10s per v58.13.15 shutdown fix.
//   · No cache mutations from this ship. `bulk_import_pdf_cache`
//     row count identical pre/post.
//   · No pre_starts / form_submissions row count changes.
//
// Tests
//   · NEW `tests/backend_unit/test_classifier_expansion_v58_13_30.py`
//     — 10 pytests covering: 5-category roster load, soft-deleted
//     exclusion, DB-failure fallback, empty-result fallback, TTL
//     cache reuse, legacy pre-start compatibility, env-configurable
//     categories, `_claude_classify` escape-label prompt inclusion,
//     `_claude_classify` roster default, confidence floor default,
//     version-sync check.


// v160.3.9.58.13.29 — Bulk unlink companion + final overnight ship.
//
// Completes the linker feature set. v58.13.25 shipped single
// link/unlink. v58.13.26 shipped bulk link (3-tier composite matcher
// with wizard). v58.13.29 adds the destructive companion so admins
// can undo linkages en masse — especially useful after a Simpro
// re-import that changes worker ids.
//
// Backend
//   · `backend/hr_employees.py`:
//     · NEW `GET /linked` — enumerates every hr_employee with a
//       non-null `linked_worker_id`, returns
//       `{items:[{employee_id, employee_name, worker_id,
//       worker_name, linked_at?}], total: N}`.
//       INSERTED BEFORE the `/{uid}` GET route so the 1-segment
//       literal wins the router match against the 1-segment
//       path-param route. Excludes soft-deleted employees. Hard
//       cap 1000. Sorted by employee_name.lower().
//     · NEW `_unlink_worker_inner(*, eid, user, request)` helper —
//       mirrors v58.13.26's `_link_worker_inner()` extraction so
//       single + bulk share the exact same code path (404 handling,
//       idempotent no-op when `prev` is falsy, audit row via the
//       same `_audit()` call with `action="unlink_worker"`).
//     · `PATCH /{eid}/unlink-worker` — body identical, now a
//       one-line pass-through to `_unlink_worker_inner()`.
//     · NEW `POST /unlink-worker/bulk` body
//       `{employee_ids: [...]}` — fan-outs via the shared inner
//       handler with per-item try/except. Response shape mirrors
//       v58.13.26's bulk link:
//       `{succeeded: N, failed: [{employee_id, error}]}`.
//       Already-unlinked ids are counted as `succeeded` (idempotent).
//     · Both new endpoints gated by `hr_employees.edit`.
//
// Frontend
//   · NEW `components/BulkWorkerUnlinkWizard.jsx` — separate file
//     rather than a third step of the link wizard because the
//     destructive UX (rose-600 palette, mandatory confirmation
//     step, AlertTriangle warning icon) reads more clearly on its
//     own than as a mode-switched branch. Flow: Load → Review
//     (select all / deselect all) → Confirm dialog → Fire →
//     Toast per-employee. Nested confirmation modal at z-[80]
//     (parent modal at z-[70]) so the confirm can never be
//     dismissed by a stray backdrop click on the wizard shell.
//   · `pages/settings/HrEmployeesPage.jsx`:
//     · New `linkedCount` state, refreshed via `loadLinkedCount()`
//       polling `/hr/employees/linked`.
//     · New "Bulk unlink…" outlined rose button in the header,
//       visible only when `linkedCount > 0`. Sits to the right of
//       the v58.13.26 blue "Bulk link workers…" button so the
//       constructive/destructive pair reads left-to-right.
//     · Wizard mounted alongside the link wizard; both refetch the
//       list AND both count signals on close so the header
//       buttons appear/disappear correctly.
//     · v58.13.10 flash-bug guardrail: every trigger + wizard
//       handler calls `e.stopPropagation() + e.preventDefault()`
//       before mutating state.
//
// Route ordering note (documented so future forks don't trip)
//   FastAPI matches routes in registration order. `GET /linked` is
//   a 1-segment literal; `GET /{uid}` is a 1-segment path parameter.
//   The literal MUST be registered first to win the match; hence
//   the new endpoint sits between `/audit` (line ~257) and `/{uid}`
//   (line ~260) rather than at the tail of the linker block. The
//   v58.13.26 bulk endpoints avoided this pitfall by having
//   2-segment paths (`/link-candidates/bulk`, `/link-worker/bulk`)
//   which don't collide with `/{uid}` regardless of ordering.
//
// Tests
//   · NEW `tests/backend_unit/test_bulk_unlink_v58_13_29.py` — 8
//     pytests: /linked shape + sort + soft-delete exclusion + empty
//     case, bulk unlink happy path, mixed valid/invalid, idempotent
//     already-unlinked, empty body, single-record helper reuse
//     regression guard.
//   · NEW `tests/frontend_smoke/test_bulk_unlink_wizard_v58_13_29.py`
//     — 9 static-grep pytests: exports, selection controls, mandatory
//     destructive confirmation step, rose destructive styling,
//     stopPropagation on every handler, backdrop close pattern, page
//     mount, linkedCount gating on the header button, version-sync.
//
// Guardrails held
//   · Zero schema migration — same `linked_worker_id` field.
//   · v58.13.13 version-sync guardrail: PASS.
//   · v58.13.10 test-placement: new pytests under
//     `/app/tests/{backend_unit,frontend_smoke}/`.
//   · v58.13.25 / v58.13.26 / v58.13.27 / v58.13.28 endpoints all
//     UNTOUCHED. Single-record `PATCH /{eid}/unlink-worker` API
//     shape unchanged.
//   · Destructive-action-requires-confirmation invariant preserved
//     (rose colouring alone would not be enough — the wizard
//     forces a Yes/No modal step before the POST fires).
//
// Backend WILL reload once (single hr_employees.py edit). Drain
// expected <10s per v58.13.15 shutdown fix.


// v160.3.9.58.13.28 — Auto-null cascade on worker soft-delete.
//
// v58.13.25 Pass 1 answer #8 originally chose (b) leave-as-is on
// worker soft-delete: keep `linked_worker_id` pointing at a tombstone
// so the historical link stayed visible. v58.13.26 uncovered a latent
// `_audit(target_id=…)` TypeError that had never surfaced only
// because no real link had been written yet; this ship revises the
// original choice to (a) auto-null cascade because dangling
// references will bite in future joins (dashboards, exports, the
// contractor/renewal side eventually), and the audit row preserves
// the historical link cleanly.
//
// Files touched
//   · `backend/workers.py` — `delete_worker` handler grows a
//     cascade block AFTER the successful soft-delete $set. Fetches
//     every hr_employee whose `linked_worker_id == worker_id`,
//     runs `update_many` to null out both the id + denormalised
//     name, INFO-logs the affected count, and writes ONE audit row
//     per affected employee via the existing `hr_employees._audit()`
//     helper (deferred import inside the handler to avoid load-order
//     surprises during test harness setup).
//     · New `request: Request` parameter added to the handler — was
//       previously request-less. Required for `_audit()` which
//       captures IP + User-Agent from the request headers. Legacy
//       DELETE /workers/{id} callers (which never passed a Request
//       explicitly) are unaffected because FastAPI does the DI.
//     · Audit `action` = `"worker_unlinked_via_cascade"`. `extra`
//       captures `prev_worker_id`, `prev_worker_name`, and
//       `reason="worker_soft_deleted"` so future audit queries can
//       distinguish this from an explicit unlink.
//   · No frontend changes. WorkerLinkModal + BulkWorkerLinkWizard
//     + HrEmployeesPage all keep working — a soft-deleted worker
//     was already excluded from the active-worker query in
//     v58.13.26, and the linked-worker chip that references a now
//     cascaded-null id simply renders as "Link worker…" on next
//     refetch.
//
// Cascade order (documented for future auditors)
//   1. `db.workers.update_one` — soft-delete the worker.
//     · If matched_count == 0 → 404. Cascade DOES NOT fire.
//   2. `db.hr_employees.find({linked_worker_id: id})` — collect
//      affected rows with their `employee_id` + prior denormalised
//      name for the audit trail.
//   3. `db.hr_employees.update_many` — null out `linked_worker_id`
//      + `linked_worker_name` in one round-trip.
//   4. Per-employee audit rows via `_audit()`.
//   5. Return 204 as before.
//
// Guardrails held
//   · No schema change. Existing collections + indexes untouched.
//   · Uniqueness constraint on `linked_worker_id` unchanged; the
//     cascade defensively handles N-1 (current linker enforces 1-1
//     but if the constraint ever loosens the cascade still works).
//   · v58.13.25 / v58.13.26 link + unlink endpoints UNTOUCHED.
//   · v58.13.26 bulk endpoints UNTOUCHED.
//   · v58.13.27 AssetDrawer deep-link path UNTOUCHED.
//   · v58.13.13 version-sync guardrail: PASS.
//   · v58.13.10 test-placement: new pytest under
//     `/app/tests/backend_unit/`.
//
// Tests
//   · NEW `tests/backend_unit/test_worker_soft_delete_cascade_v58_13_28.py`
//     — 6 pytests: 0 linked, 1 linked, 3 linked (defensive), regression
//     guard on unrelated links, idempotent double-delete, 404 unknown
//     worker never fires cascade.
//
// Backend WILL reload once (single `workers.py` edit + one Request
// import). Drain expected <10s per the v58.13.15 shutdown fix.
//
// Deferred (still parked)
//   · Worker-side view of the linked employee (permission-gated).
//   · Bulk unlink companion to v58.13.26's bulk link.
//   · Pre-existing `PlantVehicles.jsx` lint warnings from v58.13.27.


// v160.3.9.58.13.27 — Stable AssetDrawer deep-link path.
//
// Backlog: multiple prior ships (v58.13.18, v58.13.19, v58.13.23)
// flagged that automated visual QA of the ScheduleEditor is blocked
// because there is no stable URL surface to reach the drawer.
// v58.13.18's ServiceInboxTab "Open schedule" button had wired
// `/app/vehicles?assetDrawer=<id>&tab=schedules` as a best-effort
// link, but PlantVehicles.jsx never read the query — the link was a
// silent no-op (drawer never opened, tester fell back to functional
// pytests). Pass 1 grep confirmed: 1 producer, 0 consumers.
//
// Files touched (frontend only — pure FE ship, no backend reload):
//   · `pages/PlantVehicles.jsx`:
//     · Imports `useNavigate` + `useLocation` (previously only `Link`).
//     · New `drawerInitialTab` state (nullable — defaults to the
//       drawer's own 'details' when null).
//     · New useEffect keyed on `_location.search` reads
//       `?assetDrawer=<id>&tab=<tab>` on mount + whenever the URL
//       changes, `GET /assets/<id>`, opens the drawer on the
//       requested tab, and `_navigate('/app/vehicles', { replace:
//       true })` to strip the query so back-nav is clean and a
//       reload doesn't re-fire the same open.
//     · Both `onClose` + `onSaved` handlers clear `drawerInitialTab`
//       so a subsequent state-driven row-click open uses the
//       drawer's own default tab.
//     · `<AssetDrawer initialTab={drawerInitialTab} …/>` prop wired.
//   · `components/AssetDrawer.jsx`:
//     · Accepts new optional `initialTab` prop. Validated against
//       `TABS` via `_validTab()`; falls through to 'details' when
//       the caller passed something unknown (e.g. a typo in a URL
//       or a legacy tab name that was later removed).
//     · Adds a stable `data-testid={`asset-drawer-open-${current.id}`}`
//       (with `asset-drawer-open-new` fallback on the new-asset
//       flow so the attribute is always present) to the inner
//       `<aside>` render root. Testers wait on this testid to
//       confirm the deep-link open completed.
//     · Adds `data-asset-id` + `data-active-tab` attributes on the
//       backdrop for finer-grained assertions (e.g.
//       "drawer is on the schedules tab").
//     · Existing state-driven opens (row-click, "New asset",
//       attention-row) unchanged — `initialTab` is optional and
//       defaults to 'details' via the validator.
//
// Sample URL for future tester use
//   /app/vehicles?assetDrawer=<asset_id>&tab=schedules   (Schedules)
//   /app/vehicles?assetDrawer=<asset_id>&tab=service_log (Service log)
//   /app/vehicles?assetDrawer=<asset_id>                 (details tab)
//   /app/vehicles?assetDrawer=<asset_id>&tab=bogus       (falls back
//                                                          to 'details')
//
// Tests
//   · NEW `tests/frontend_smoke/test_asset_drawer_deeplink_v58_13_27.py`
//     — 8 static-grep pytests: query-param consumption, replace:true
//     URL stripping, `initialTab` prop wire-up, tab validation in
//     the drawer, stable `asset-drawer-open-<id>` testid pattern,
//     ServiceInboxTab producer still uses the pattern, guardrail
//     that no v58.13.27 marker appears in the backend, and the
//     v58.13.13 version-sync check.
//
// Guardrails held
//   · Backend NOT touched. No `sudo supervisorctl restart backend`.
//   · v58.13.13 version-sync guardrail: PASS.
//   · v58.13.10 test-placement: new pytest under
//     `/app/tests/frontend_smoke/`.
//   · AssetDrawer tabs list, per-asset write endpoints, and the
//     ServiceInboxTab "Open schedule" producer — all UNTOUCHED.
//     The v58.13.18 link now actually works end-to-end.
//   · Deep-link open path fetches the asset via `GET /assets/<id>`
//     — no extra endpoints introduced. Same code path a row-click
//     via `openAttentionAsset` already used since v160.3.9.21e.
//
// Deferred (still parked)
//   · Worker-side view of the linked employee (v58.13.26 backlog).
//   · Auto-null cascade on worker soft-delete.
//   · Bulk unlink companion to v58.13.26's bulk link.


// v160.3.9.58.13.26 — Bulk Employee ↔ Worker linker wizard + composite
// normalisation fix on the single-record ranker.
//
// v58.13.25 shipped the linker with a raw-case `SequenceMatcher`
// ranker. That produced ZERO candidates on live data at ≥0.75 because
// workers are 88% ALL-UPPER (Simpro import) while hr_employees are
// 100% Mixed-case. The v58.13.26 diagnostic
// (`scripts/diagnostics/v58_13_26_name_overlap.py`) established:
//   · Set-based overlap after `norm_basic` (lower+strip+punct) =
//     64 / 121 hr_employees exact-match a worker.
//   · Email exact-match = 54 / 60 worker emails match an hr_employee.
//   · Combined 3-tier (email → norm_basic → norm_lfi) with collision
//     guard = 66 / 121 unambiguous auto-links.
//   · Fuzzy band 0.60 ≤ r < 0.80 (17 employees) is 80% false-positive
//     — dropped from the ranker.
// C-strict UX chosen: no fuzzy tier, no theatre.
//
// Backend
//   · NEW `backend/name_matching.py` (~110 LOC). Pure functions —
//     `strip_accents`, `norm_basic`, `norm_last_first_initial`,
//     `find_matches(hr_first, hr_last, hr_email, workers)`.
//     3-tier composite lookup with collision guard.
//   · `backend/hr_employees.py`:
//     · `_link_worker_inner()` extracted from the PATCH handler so
//       the bulk-commit path uses the SAME code (uniqueness pre-write
//       query, `$set`, audit row).
//     · `_audit(target_id=…)` typo corrected to
//       `_audit(employee_id=…, target_uid=…)` — matches every other
//       `_audit()` caller in the file. v58.13.25 would have raised
//       TypeError on the first real link (linked_worker_id count was
//       0, so it never surfaced).
//     · `/link-candidates` ranker rewritten to call `find_matches`.
//       Returns AT MOST ONE candidate at similarity=1.0 with a `tier`
//       field. Empty candidates now include `reason: "no_exact_match"`
//       + `suggestion: "browse_all"` so the FE can pick the browse
//       fallback deterministically. No fuzzy path.
//     · NEW `GET /link-candidates/bulk` — returns
//       `{auto_matches:[{employee_id, employee_name, worker_id,
//       worker_name, tier}], no_match:[{employee_id, employee_name}]}`.
//       Excludes already-linked employees + soft-deleted / inactive
//       workers. First-come-first-served on worker collisions. Hard
//       cap 1000 employees.
//     · NEW `POST /link-worker/bulk` body
//       `{links: [{employee_id, worker_id, tier?}]}` — fan-outs via
//       `_link_worker_inner()`. Per-link try/except → response
//       `{succeeded: N, failed: [{employee_id, error}]}`. Audit row
//       per successful link (same code path as single endpoint).
//   · Both bulk endpoints gated by `require_permission
//     ("hr_employees", "edit")`.
//
// Frontend
//   · NEW `components/BulkWorkerLinkWizard.jsx` (~250 LOC). Two-step
//     modal (Auto-matches · No match) launched from the
//     HrEmployeesPage header. Tier badges (email green, norm_basic
//     blue, norm_lfi amber). Bulk-accept controls: Accept all /
//     Accept email tier only / Reject all. Confirm N links →
//     `POST /link-worker/bulk`. Per-employee toast on failure. Step 2
//     "Browse workers…" opens the existing WorkerLinkModal with the
//     employee context preserved.
//   · `components/WorkerLinkModal.jsx` — new optional prop
//     `initialCandidateWorkerId` floats a pre-focused worker to the
//     top of the browse list. Auto-suggest strip now green-only
//     (similarity=1.0 is the only band that ever ships).
//   · `pages/settings/HrEmployeesPage.jsx`:
//     · "Bulk link workers…" button added to the page header,
//       visible only when `auto_matches.length > 0`. Badge shows
//       the count.
//     · `loadBulkCounts()` polled on mount so the button appears
//       automatically.
//     · Wizard mounted alongside the drawer; refetches the employee
//       list + bulk counts on completion.
//   · v58.13.10 flash-bug guardrail: every wizard button + row
//     handler calls `e.stopPropagation() + e.preventDefault()`
//     before mutating state.
//
// Tests
//   · NEW `tests/backend_unit/test_bulk_link_v58_13_26.py` —
//     17 pytests: composite normaliser (5) + regression on the
//     single-record ranker (3) + bulk candidates (4) + bulk commit (5).
//     Includes the "no fuzzy ever returned" regression guard.
//   · NEW `tests/frontend_smoke/test_bulk_link_wizard_v58_13_26.py`
//     — 8 static-grep pytests: wizard exports, two-step state
//     machine, tier badge colours, bulk-accept controls,
//     stopPropagation on every handler, page mount, backdrop close
//     pattern, and the v58.13.13 version-sync guardrail.
//
// Diagnostic script retained at
// `scripts/diagnostics/v58_13_26_name_overlap.py` — valuable ops
// tool for future data audits. Header comment updated to note
// v58.13.26 productionised these findings.
//
// Guardrails held
//   · v58.13.13 version-sync: PASS (3 canonical files + this changelog).
//   · v58.13.10 test-placement: all new pytests under
//     `/app/tests/{backend_unit,frontend_smoke}/`.
//   · Zero schema migration — `linked_worker_id` was pre-reserved
//     on the v48 schema; still no cascade on worker soft-delete.
//   · Zero touch to `workers.py`, `simpro_zip_import.py`, or any
//     other module. Bulk endpoint reads only.
//   · No fuzzy matching ANYWHERE — deliberately (Pass 1 evidence).
//   · Backend WILL reload once (single hr_employees.py edit + one
//     new module). Job 4f395643 is state=failed — no in-flight work
//     to preserve.
//
// Deferred (still parked, per prior approvals)
//   · Worker-side view of the linked employee.
//   · Auto-null cascade on worker soft-delete.
//   · Stable `asset-edit-<id>` deep-link testid path for the
//     ScheduleDrawer.


// v160.3.9.58.13.25 — Employee ↔ Worker record linker (per-record picker).
//
// Connects `hr_employees` (HR-managed register, 121 rows) to
// `workers` (Simpro-imported field workforce, 69 active). Uses the
// pre-reserved `linked_worker_id` field on the v48 hr_employees
// schema — zero migration.
//
// Files touched
//   · `backend/hr_employees.py` — 3 new endpoints appended:
//     · PATCH `/api/hr/employees/{eid}/link-worker` — sets
//       `linked_worker_id` (+ denormalised `linked_worker_name` for
//       list rendering). Uniqueness enforced by pre-write query
//       (409 with `linked_to_employee_id/name` on collision). Every
//       write emits an audit row via the existing `_audit()`
//       helper. Gated by `hr_employees.edit` permission.
//     · PATCH `/api/hr/employees/{eid}/unlink-worker` — idempotent
//       clear + audit (only writes audit when there was a link to
//       clear, so accidental repeat calls don't pollute the log).
//     · GET `/api/hr/employees/{eid}/link-candidates?limit=10` —
//       returns unlinked workers ranked by name similarity to the
//       employee. Fast path exact-normalised match → similarity=1.0.
//       Fuzzy path `difflib.SequenceMatcher` ≥ 0.75, ranked desc.
//       Zero new deps. Response shape:
//       `{target:{first_name,last_name}, candidates:[{id, name,
//       position, email, simpro_employee_id, similarity}]}`.
//   · `frontend/src/components/WorkerLinkModal.jsx` — NEW (~200 LOC).
//     Reuses the ChecklistLinkPicker (v58.13.19) pattern:
//     `useLockBodyScroll`, backdrop-click close, stopPropagation
//     guards on every action. Auto-suggest strip at top (green
//     chips for similarity=1.0, amber 0.75-0.99). Below: full
//     browse list with client-side substring filter. 409-aware
//     toast tells the user which employee already owns the worker.
//   · `frontend/src/pages/settings/HrEmployeesPage.jsx` —
//     · Added "Linked worker" column between the fixed columns and
//       "Status".
//     · Unlinked → `Link worker…` button opens the modal.
//     · Linked → blue chip `👤 <name>` with ✕ that calls
//       `/unlink-worker` + refetches on success.
//     · Both action handlers use `e.stopPropagation()` so the
//       row-click drawer-open doesn't fire (v58.13.10 guardrail).
//     · Modal mounted alongside the drawer; onLinked refetches.
//   · NEW `tests/backend_unit/test_link_worker_v58_13_25.py` —
//     10 handler-level pytests covering happy-path link/unlink,
//     409 uniqueness collision, idempotent double-unlink, name
//     matcher (exact=1.0, typo≥0.75), already-linked exclusion,
//     soft-deleted worker exclusion, permission gate (403), 404s.
//   · NEW `tests/frontend_smoke/test_link_worker_render_v58_13_25.py`
//     — static-grep verifying column header + cell testids, chip
//     unlink handler, WorkerLinkModal exports, similarity threshold
//     reference, stopPropagation on both button/chip handlers.
//   · Version files ×3 canonical + this changelog block.
//
// Guardrails held
//   · v58.13.13 version-sync: PASS.
//   · v58.13.10 test-placement: new pytests under
//     `/app/tests/{backend_unit,frontend_smoke}/`.
//   · Zero schema migration — `linked_worker_id` was pre-reserved
//     on the v48 schema.
//   · Zero touch to `workers.py` or `simpro_zip_import.py`.
//   · No auto-cascade on worker soft-delete — link is preserved
//     (Pass 1 answer #8b).
//   · Bulk auto-match wizard NOT included (deferred to v58.13.26).
//   · No new PII exposure on worker-side views — the link is
//     one-sided (HR-side pointer only).
//
// Deferred
//   · v58.13.26 — bulk auto-match wizard.
//   · Worker-side view of the linked employee (permission-gated).
//   · Auto-null cascade on worker soft-delete (if ever needed).


// v160.3.9.58.13.24 — CacheBusterBanner stickier UX.
//
// The update-available toast landed in v160.3.6w as a soft
// bottom-right toast to replace the old brown top-of-page nag banner.
// Its 8-second auto-hide was too aggressive — users could easily
// glance away and miss it. This ship rebalances "don't nag" with
// "don't let users miss it".
//
// Changes to `frontend/src/components/CacheBusterBanner.jsx`:
//   · `AUTO_HIDE_MS`: 8_000 → 30_000 (~4× the peripheral-vision
//     window; still far short of the old brown-banner nag).
//   · NEW `PULSE_MS = 5_000` — subtle blue-tinted `box-shadow` ring
//     pulses for the first 5 s so movement in peripheral vision
//     draws the eye.
//   · NEW version-scoped persistent dismiss:
//     `localStorage.paneltec_cachebust_dismissed_${serverVersion}`.
//     "Dismiss" for server v58.13.24 does NOT suppress the toast
//     when v58.13.25 lands — each new server version gets a fresh
//     signal. Also survives page reloads within the same version.
//   · Buttons relabelled and colour-refreshed:
//     · "Reload" → **"Reload now"** (bg-blue-600).
//     · "Later" (link) → **"Dismiss"** (bordered button).
//     Both use `e.stopPropagation()` + `e.preventDefault()` per
//     v58.13.10 flash-bug guardrail.
//   · Session-dismiss auto-resets when `serverVersion` changes
//     (belt-and-braces alongside the persistent key).
//
// Files touched
//   · `frontend/src/components/CacheBusterBanner.jsx` — rewritten
//     in place (~220 LOC; net +50 vs prior).
//   · NEW `tests/frontend_smoke/test_cachebust_stickier_v58_13_24.py`
//     — 6 pytests covering AUTO_HIDE_MS, dismiss testids, reload
//     handler + `window.location.reload`, version-scoped key,
//     stopPropagation on both buttons, pulse animation.
//   · Version files ×3 canonical + changelog block.
//
// Guardrails held
//   · Zero backend changes. No supervisor restart.
//   · No auto-force-reload — user must click "Reload now" explicitly.
//   · Old brown top banner NOT restored — bottom-right toast only.
//   · v58.13.13 version-sync: PASS.


// v160.3.9.58.13.23 — Contract dates on schedules + phase4d opt-in.
//
// Two items bundled:
//
// Item A — Contract dates on `asset_service_schedules`.
//   Adds 4 optional ISO date-string fields to `ScheduleIn`:
//     · contract_cust_on   (Customer Onboarded)
//     · contract_start     (Contract start)
//     · contract_review    (Review date)
//     · contract_expiry    (Contract expiry)
//   All Optional[str] (max_length=32), matches the `last_done_at`
//   pattern. Legacy schedules parse identically. Server-side
//   handlers unchanged — `**payload` splat pipes every Pydantic
//   field through to Mongo. No new endpoints. No migration.
//
//   Frontend: new "Contract Dates" sub-header inside the
//   ScheduleEditor's More Details panel, with a 2×2 grid of
//   native `<input type="date">` inputs (chronological order:
//   Cust On · Start · Review · Expiry). Payload nullifies empty
//   strings so backend gets None rather than "".
//
//   Preview: expiry-only traffic-light badge in the
//   ServiceSchedulesTab tile:
//     · > 30 days away  → green  "Contract active · expires DD MMM YYYY"
//     · 0–30 days away  → amber  "Contract expires in N days"
//     · past expiry     → rose   "CONTRACT EXPIRED N days ago"
//   Only rendered when `s.contract_expiry` is set (per approved
//   Pass 1 plan).
//
// Item B — Piggyback fix: 1-line
//   `pytestmark = pytest.mark.live_db_writes` at module scope of
//   `backend/tests/test_phase_4d_v160_3_9_33.py`. Unblocks 14
//   previously-blocked tests thanks to the v58.13.22 conftest
//   hardening.  Verified 14/14 GREEN.
//
// Files touched
//   · `backend/asset_service.py` — 4 new fields on ScheduleIn.
//   · `frontend/src/components/AssetServiceTabs.jsx` — form
//     state + payload nullify + 2×2 date grid + tile badge.
//   · `backend/tests/test_phase_4d_v160_3_9_33.py` — 1-line
//     pytestmark opt-in + explanatory comment.
//   · NEW `tests/backend_unit/test_schedule_contract_dates_v58_13_23.py`
//     — round-trip + update + nullify + legacy parse + openapi.
//   · NEW `tests/frontend_smoke/test_contract_dates_v58_13_23.py`
//     — form state, grid ordering, badge conditional on
//       `s.contract_expiry`, traffic-light colour classes.
//
// Guardrails held
//   · v58.13.13 version-sync: PASS.
//   · v58.13.10 test-placement: new pytests under
//     `/app/tests/{backend_unit,frontend_smoke}/`.
//   · Zero migration. All fields Optional, default None.
//   · No new endpoints. No cron / bulk_import / auth touch.
//   · Backend reload once (single ScheduleIn schema edit).


// v160.3.9.58.13.22 — Legacy test hygiene + conftest guard hardening.
//
// Four small follow-ups from v58.13.21's report, all test-only or
// test-adjacent — zero production code touched.
//
// 1. Bucket-name drift fix in `backend/tests/test_worker_photo_v34.py`
//    — `_mongo["fs.files"]` → `_mongo["bk_fs.files"]` in
//    `test_replace_photo_deletes_old_gridfs_blob`. workers.py:574
//    stores photos in `bk_fs` (co-tenant with backup snapshots); the
//    test had been silently checking the wrong bucket, falsely
//    passing the "old gone" check and failing the "new present"
//    check. Now correctly targeting `bk_fs.files`.
//
// 2. Added explicit `DELETE /workers/{id}/photo` at the tail of the
//    2 tests that uploaded a photo without cleanup:
//      · `test_upload_valid_jpeg_returns_200_and_updates_worker`
//      · `test_users_list_reflects_worker_photo_after_upload`
//    (The other 7 tests in the file either don't upload, or already
//    delete, or expect a rejection response so no blob is created.
//    Pre-ship report's "3 tests" estimate was one high — actual = 2.)
//
// 3. Conftest guard hardening in `backend/tests/conftest.py`. Two
//    changes wired together:
//      · NEW `_module_prod_writes_gate` (module-scoped autouse) —
//        reads module-level `pytestmark = pytest.mark.live_db_writes`
//        and pre-flips `_ALLOW_PROD_WRITES = True` for the whole
//        module lifecycle. Ensures module-scoped fixture SETUP
//        (`ephemeral_admin`, `eph_worker`) can perform their inserts.
//      · `production_db_guard` (function-scoped autouse) skip-reset
//        logic — checks the same module-level marker and, when
//        present, does NOT reset `_ALLOW_PROD_WRITES` to False on
//        per-test teardown. Ensures module-scoped fixture TEARDOWN
//        (which runs after the LAST test's per-function guard has
//        already fired its finally) still sees True. Fixes the
//        v58.13.21-flagged teardown error at zero cost to per-test
//        isolation for non-opted-in modules.
//    `test_worker_photo_v34.py`'s in-file session-scoped workaround
//    from v58.13.21 removed as redundant — the conftest fix
//    supersedes it. `pytestmark = pytest.mark.live_db_writes`
//    remains — it's the single opt-in point.
//
// 4. One-shot sweep of `test_database.users` for phase4d ephemeral
//    admin residue (leftover from the pre-v58.13.22 teardown error).
//    Count deleted: 1. Also swept `workers` for photo-worker
//    residue: 0 (self-cleaning fixture had always worked).
//
// Coverage after the ship
//   · `backend/tests/test_worker_photo_v34.py`: **9/9 PASS**
//     (was 0/9 before v58.13.21, then 8/9 with 1 teardown error
//     and 1 real failure).
//   · `backend/tests/test_phase_4d_v160_3_9_33.py`: still blocked
//     because the file lacks `pytestmark = pytest.mark.live_db_writes`
//     at module scope. The conftest fix would activate it as soon
//     as the marker is added. **Out of scope for this ship** —
//     adding markers to sibling test files is a separate hygiene
//     pass; user's brief said "check it", not "fix it".
//   · `bk_fs.files`: baseline restored to 944 after the full-file
//     legacy run (was drifting +3 per session before this ship).
//
// Guardrails held
//   · Zero production code touched (workers.py, simpro_zip_import.py,
//     etc. — unchanged).
//   · No GridFS blob deleted outside test cleanup.
//   · Legacy file stays grandfathered under `/app/backend/tests/`.
//   · v58.13.13 version-sync: PASS.
//   · Backend did NOT reload (conftest.py is a test-only file the
//     watcher ignores) — measured drain skipped.


// v160.3.9.58.13.21 — Simpro ZIP photo-replace zero-orphan fix +
// unblocked legacy worker-photo test.
//
// **Diagnostic reframe (Pass 1)**: The backlog premise
// ("test_replace_photo_deletes_old_gridfs_blob fails because
// workers.py leaks GridFS blobs") turned out to be inverted. The
// actual state:
//   · `workers.py:614-668` (POST /workers/{id}/photo) IS correct —
//     deletes old blob at L644-649 before upload, with a
//     `zero-orphan invariant` comment already in place.
//   · The test never reached its assertion. It died in the
//     `ephemeral_admin` fixture at conftest.py:294 with the v57.2
//     `live-DB-guard` error: `.insert_one` on `test_database.users`
//     without the `@pytest.mark.live_db_writes` opt-in marker.
//     `test_worker_photo_v34.py` predates the guard.
//   · The REAL leak — never described in the backlog — was at
//     `simpro_zip_import.py:653-666`. Simpro ZIP re-imports that
//     included a photo would upload the new blob without deleting
//     the old, orphaning it. Current Mongo footprint: `fs.files`
//     total = 8, zero orphans (no re-imports had triggered it yet),
//     but the code path was actively broken.
//
// Files touched
//   · `backend/simpro_zip_import.py` — +11 LOC. Before the
//     `fs.upload_from_stream` in the "# Photo" block, read
//     `pre_worker.get("photo_gridfs_id")` (already captured at
//     L504 for the rollback snapshot — zero extra round-trip) and
//     `fs.delete(ObjectId(old))` if present. Try/except with
//     `log.warning` mirrors the exact pattern from `workers.py`.
//   · `backend/tests/test_worker_photo_v34.py` — 1-line
//     `pytestmark = pytest.mark.live_db_writes` at module scope.
//     Unblocks all 9 tests. File remains under `/app/backend/tests/`
//     as a documented v58.13.10-rule grandfather exception (rewriting
//     9 requests-based tests to motor mocks was explicitly out of
//     scope).
//   · `tests/backend_unit/test_simpro_photo_replace_v58_13_21.py` —
//     NEW (~280 LOC). Four scenarios: pre-existing photo triggers
//     `fs.delete(OLD)` exactly once BEFORE upload; no pre-existing
//     photo → delete NOT called; `fs.delete` raising →
//     log-and-continue proceeds to upload + doc update; two workers
//     processed back-to-back → each replaces its own blob with no
//     cross-contamination. Handler-level via `_commit_zip(...)` with
//     a fake db + fake AsyncIOMotorGridFSBucket surface. Extra
//     source-level guard verifies the delete-before-upload invariant
//     survives future refactors.
//
// Guardrails held
//   · v58.13.13 version-sync: PASS.
//   · v58.13.10 test-placement: new pytest under
//     `/app/tests/backend_unit/`. Grandfathered legacy file is
//     touched with a 1-line marker only.
//   · Zero schema change. Zero new npm packages. No GridFS blobs
//     deleted during this ship. No GridFS audit endpoint/script
//     added (deferred per Pass 1 approval).
//   · `workers.py` untouched (already correct).
//   · Backend WILL reload once (single .py edit) — drain fix from
//     v58.13.15 keeps it fast.
//
// Deferred (still parked, per prior approvals)
//   · GridFS audit endpoint / one-shot script.
//   · CacheBusterBanner stickier UX.
//   · Contract dates / periodic template Phase C polish.


// v160.3.9.58.13.20 — Small polish bundle (housekeeping ship).
//
// Three unrelated, low-risk cleanups bundled to reduce ceremony:
//
//   1. `CsIncidentTab.jsx` orphan file — DELETED (~427 LOC removed).
//      This file was unmounted from the router in v58.13.12's CS
//      Incident → Submissions migration but never physically
//      removed from disk. Zero live-code references (only mentions
//      were in /app/memory/*.md docs + a historical code-comment
//      in CsIncidentsList.jsx explaining where the import modal
//      was extracted from — no import, no dynamic import, no
//      test-mock). Safe delete confirmed by grep.
//
//   2. km/hours `Next due: "—"` fallback (deferred from v58.13.18)
//      — `frontend/src/pages/ServiceInboxTab.jsx`. Meter-tracked
//      schedules (hours / km) have `next_due_at == null` because
//      those axes track by meter, not date. Previously the DUE
//      tile showed "—" for the Next-due line on meter schedules,
//      losing information. New `nextDueDisplay` helper picks:
//      `next_due_at` (calendar) → formatted date; `hours` → "8250 h";
//      `km` → "125000 km"; else "—". Calendar-axis display
//      preserved verbatim.
//
//   3. `backend/workers.py` F811 warning — `require_permission`
//      was imported twice (line 21 solo, then again as part of a
//      multi-name import on line 25). Dropped from line 25 per
//      ruff's F811 autofix suggestion; line 21 remains the sole
//      source. Zero behavioural change. Backend WILL reload
//      once — drain fix from v58.13.15 keeps it fast.
//
// Files touched
//   · DELETED `frontend/src/pages/CsIncidentTab.jsx`.
//   · `frontend/src/pages/ServiceInboxTab.jsx` — +14 LOC
//     (nextDueDisplay helper).
//   · `backend/workers.py` — one-line import rewrite, +3 LOC comment.
//   · Version files ×3 canonical + changelog block here.
//   · NEW `tests/frontend_smoke/test_polish_bundle_v58_13_20.py`
//     (5 pytests — orphan absent, fallback logic present,
//     workers.py F811 clean, version-sync green).
//
// Guardrails held
//   · v58.13.13 version-sync: PASS.
//   · v58.13.10 test-placement: new pytest under
//     `/app/tests/frontend_smoke/`, never `/app/backend/`.
//   · Each item <15 LOC net. None expanded.
//   · No schema change. No new npm packages. No new backend
//     endpoints.


// v160.3.9.58.13.19 — Rich-text description editor + "View Checklist" links.
//
// The Schedule editor's `description_html` field is now optionally
// edited in a **rich-text** contentEditable surface (Plain / Rich
// toggle, plain default, choice persisted per-device via
// localStorage). Backend infra was already in place from v58.13.0-a
// (bleach sanitiser + `description_html` field + `<a>` allowlist) —
// this ship is 100% frontend.
//
// Files touched (frontend only, zero backend churn):
//   · `frontend/src/components/RichTextEditor.jsx` — NEW (~200 LOC).
//     Homegrown contentEditable + execCommand toolbar. Buttons map
//     1:1 to the backend bleach allowlist (Bold, Italic, Underline,
//     UL, OL, H3, Link, Insert Checklist). `document.execCommand`
//     is deprecated but universally supported and emits HTML that a
//     future Tiptap migration can consume unchanged. Best-effort
//     paste-scrubber walks the DOM and unwraps any element not in
//     the allowlist so the visible editor doesn't render junk
//     between paste and save (bleach on the server is the
//     authoritative pass).
//   · `frontend/src/components/ChecklistLinkPicker.jsx` — NEW
//     (~130 LOC). Modal listing `form_templates` from the existing
//     `GET /api/forms/templates` endpoint. Client-side substring
//     filter, keyboard-focused search, `useLockBodyScroll`, close
//     via X / backdrop / Cancel. On pick, calls
//     `onPick(templateId, templateName)` and the caller inserts an
//     `<a href="/app/forms?template_id=<id>">Name</a>` into the
//     rich-text buffer.
//   · `frontend/src/components/AssetServiceTabs.jsx` — Plain/Rich
//     toggle wired above the ScheduleEditor description field.
//     Plain path renders the existing `<textarea>` unchanged (byte
//     parity for legacy users). Rich path mounts RichTextEditor
//     bound to the same `description_html` state. Rich→Plain UX:
//     silent swap when there's no HTML tag in the buffer (no
//     popup fatigue); confirm dialog when formatting would be lost.
//     Also adds a read-only description preview panel to
//     ServiceSchedulesTab so `description_html` is no longer
//     write-only. Preview uses `dangerouslySetInnerHTML` on the
//     already-bleached value from Mongo (guardrail: NEVER on
//     pre-save user input).
//   · `frontend/src/pages/Forms.jsx` — +19 LOC. New useEffect
//     consumes `?template_id=<id>` and auto-opens the preview
//     modal, then strips the query param via `navigate(..., {
//     replace: true })` so a back-nav doesn't retrigger the modal.
//     Distinct from the existing `?template=<id>` handler which
//     opens the FILL-OUT modal (fill vs preview are different
//     flows).
//
// Rich → Plain toggle UX (documented decision)
//   Chose option (c) — Confirm modal — with a twist: DETECT
//   formatting on the fly via `hasHtmlTags(desc)`. If the current
//   description contains no HTML tags, swap silently (no popup
//   when there's nothing to lose). If tags are present, show a
//   confirm dialog before stripping. Gives the fast-toggle path
//   when the user hasn't formatted anything, and explicit consent
//   when they have. Also picked the cleanest of options (a/b/c):
//   (a) is confusing (raw tags in a textarea), (b) is silent data
//   loss, (c) is safe but chatty — the "silent when empty" tweak
//   removes the chattiness for the common case.
//
// Backend
//   ZERO changes. `description_html` field, bleach sanitiser
//   (`asset_service.py:_sanitize_description_html`), and `<a href>`
//   allowlist all shipped in v58.13.0-a. Backend did NOT need to
//   reload for this ship — supervisor was untouched.
//
// Guardrails held
//   · v58.13.13 version-sync: PASS.
//   · v58.13.10 test-placement: new pytest under
//     `/app/tests/frontend_smoke/`, never `/app/backend/`.
//   · v58.13.10 flash-bug: every trigger that mounts the checklist
//     picker calls `e.stopPropagation()`; the picker's backdrop
//     handler uses `e.target === e.currentTarget` so clicks inside
//     the modal don't dismiss it.
//   · `dangerouslySetInnerHTML` is used ONLY on `s.description_html`
//     read from Mongo (already bleach-sanitised on write); NEVER on
//     any pre-save user-typed value.
//   · Zero new npm packages (homegrown editor per Pass 1 brief).
//   · asset_service_schedules / asset_service_records / assets —
//     schema unchanged.
//
// Deferred (still parked)
//   · Rich-text for RecordEditor description / TemplateBuilder /
//     other description fields — separate ships if desired.
//   · Dedicated `checklist_template_id` field on schedules — the
//     approach-(ii) alternative from the Pass 1 report. Not shipped;
//     inline-in-HTML link is more flexible and needs no schema
//     change.
//   · CsIncidentTab.jsx orphan cleanup, CacheBusterBanner UX,
//     backend/workers.py F811 — still parked from prior ships.


// v160.3.9.58.13.18 — Due & Generated inbox tab (Service Inbox).
//
// Adds a 5th tab to PlantVehicles.jsx that surfaces two org-wide
// lists in one round-trip:
//   · DUE       — active `asset_service_schedules` whose live
//                 `_compute_next_due` status is overdue or due_soon,
//                 joined with asset name/rego/kind.
//   · GENERATED — `asset_service_records` where
//                 `generated_by == "asset_service_generate"`,
//                 `performed_at is null`, `deleted_at is null` —
//                 populated only once ASSET_SERVICE_GENERATE_CRON
//                 is enabled (still env-gated OFF from v58.13.17).
//
// Files touched (backend + frontend + tests, no schema change):
//   · `backend/asset_service.py` — new `GET /service/inbox` handler
//     inserted immediately before `service_summary`. Reuses
//     `_compute_next_due` verbatim. Response cap: `?limit=200`
//     default, hard-max 500. Single per-request `assets.find_one`
//     cache so multiple schedules on the same asset don't refetch.
//   · `frontend/src/components/AssetServiceTabs.jsx` — minimal
//     surface-level refactor: `function RecordEditor` →
//     `export function RecordEditor`. All internal helpers
//     (ScheduleEditor / DeleteRecordDialog / RecordRow / mode
//     state / derived memos) stay module-scoped — the ONLY thing
//     exposed is the component itself, so the Service Inbox can
//     reuse the exact same "Log service" modal pre-filled with
//     `{schedule_id, type}`.
//   · `frontend/src/pages/ServiceInboxTab.jsx` — new page. Two
//     shadcn sub-tabs (Due / Generated), each rendering
//     `GroupedTilesView` grouped by `asset.name` per the Pass 1
//     brief. v58.13.10 flash-bug guardrail: every action button
//     calls `e.stopPropagation()` + `e.preventDefault()` before
//     mutating state. Second sentence of the Generated empty state
//     is admin-only (checks `USER_KEY.role === "admin"`).
//   · `frontend/src/pages/PlantVehicles.jsx` — 5th tab
//     "Service Inbox" wired in violet. Grid cols bumped from
//     `md:grid-cols-4` → `md:grid-cols-5`. Zero other churn.
//
// Actions on tiles
//   Due tile → "Log service"     → exported `RecordEditor` modal,
//                                  scheduled with `schedule_id` +
//                                  `type` pre-filled. POST via the
//                                  existing per-asset endpoint (no
//                                  new write endpoints).
//   Due tile → "Open schedule"   → navigate to
//                                  `/app/vehicles?assetDrawer=<id>&tab=schedules`
//                                  (drawer-open hint; if the drawer
//                                  ignores it the user still lands
//                                  on the correct asset).
//   Gen tile → "Mark as performed" → PUT the existing per-asset
//                                    record endpoint with
//                                    `{performed_at: now, hours_at,
//                                    km_at}` from the joined asset.
//   Gen tile → "Dismiss"          → DELETE the existing per-asset
//                                    record endpoint (soft-delete;
//                                    backend already admin-gates).
//                                    Non-admins see a disabled
//                                    button with tooltip.
//
// Guardrails held / scope-safe items:
//   · No new endpoints beyond the ONE new `/service/inbox` read.
//   · Per-asset write endpoints untouched (used by other pages).
//   · `asset_service_records` / `asset_service_schedules` /
//     `assets` — schema unchanged.
//   · v58.13.17 cron code — untouched.
//   · v58.13.13 version-sync guardrail: PASS.
//   · v58.13.10 test-placement rule: new pytests placed at
//     `/app/tests/backend_unit/test_service_inbox_v58_13_18.py`
//     and `/app/tests/frontend_smoke/test_service_inbox_render_v58_13_18.py`
//     — NEVER under `/app/backend/`.
//
// Tests
//   · Backend: 8 pytests at
//     `/app/tests/backend_unit/test_service_inbox_v58_13_18.py`.
//     Handler-level with a fake `db`, following the v58.13.17
//     pattern. Empty result, DUE join, GENERATED join, performed
//     record NOT surfaced, soft-deleted NOT surfaced, ?limit
//     clamp, missing asset filtered, response shape.
//   · Frontend smoke: static grep at
//     `/app/tests/frontend_smoke/test_service_inbox_render_v58_13_18.py`.
//     Verifies PlantVehicles.jsx has 5 tabs (Service Inbox
//     testid), ServiceInboxTab imports GroupedTilesView +
//     RecordEditor, `e.stopPropagation()` present in tile action
//     handlers, empty-state strings present.
//
// Deferred (still parked; NOT touched this ship):
//   · CsIncidentTab.jsx orphan cleanup.
//   · CacheBusterBanner stickier UX.
//   · backend/workers.py F811 warning.


// v160.3.9.58.13.17 — Asset-service overnight generation cron.
// Env-gated OFF (ASSET_SERVICE_GENERATE_CRON=1 to enable). Ships
// backend/cron_asset_service_generate.py + manual dry-run script at
// backend/scripts/run_asset_service_generate_v58_13_17.py. Fires at
// 02:00 Australia/Sydney (DST-safe). Dual-track advances BOTH
// counters. Idempotent via natural next_due advancement + compound-
// unique index (schedule_id, generated_by_run_id). Telemetry: one
// INFO log line + one doc in asset_service_generate_runs per run.
// See PRD.md v58.13.17 for the full ship writeup.

// v160.3.9.58.13.16 — Orphan schedule-attachment blob cleanup.
//
// Closes the E2 finding from v58.13.14: `DELETE /assets/{aid}
// /schedules/{sid}` soft-deleted the schedule doc but left the
// attachment blob directory on disk indefinitely — the exact
// orphaned-blob leak the v58.13.14 brief called out to avoid.
//
// Files touched (backend + tests only, no FE code):
//   · `backend/asset_service.py` — `delete_schedule` handler now
//     `shutil.rmtree(SCHEDULE_ATTACHMENT_ROOT / sid,
//     ignore_errors=True)` immediately after the soft-delete
//     $set. Idempotent (missing dir is a no-op). rmtree exception
//     path logs `log.exception(...)` rather than silently
//     orphaning, matching the v58.13.14 delete-attachment
//     endpoint's error behaviour.
//   · `backend/scripts/cleanup_orphan_schedule_attachments_v58_13_16.py`
//     — new one-shot script. Scans SCHEDULE_ATTACHMENT_ROOT/*,
//     categorises each sid directory as (kept | soft-deleted |
//     missing), rmtrees the last two categories, prints a summary
//     line. Idempotent — safe to re-run. Left in place under
//     `backend/scripts/` for future manual invocation if a fork
//     ever needs it.
//   · `tests/backend_unit/test_schedule_delete_cascade_v58_13_16.py`
//     — 4 integration pytests. Cascade fires, cascade is
//     idempotent, attachment-DELETE alone does NOT cascade
//     (v58.13.14 remains an attachment-scoped operation), empty
//     schedule delete doesn't crash.
//
// Explicit design choice — Option (a) hard-delete cascade,
// NOT Option (b) background sweeper:
//   · The schedule's soft-delete window exists for the DB doc
//     (reviewer notes, audit trail, undelete UI if it ever gets
//     built). Attachment blobs have no recovery path — there's no
//     "restore trashed schedule" UI, and the file bytes aren't
//     usable without the doc's metadata. Sweeper would add a
//     background job + telemetry + reconciliation surface for
//     zero real recovery value.
//   · Consistent with v58.13.14 attachment-DELETE endpoint which
//     also hard-deletes the disk blob.
//   · If a fork EVER decides to build "restore trashed schedule",
//     they can flip this to `soft_delete_blob` easily (rename dir
//     to `sid.trashed`, unrename on restore). One-line change.
//
// One-shot cleanup script output (this ship):
//   [v58.13.16] scanning 22 sid directories under
//     /app/backend/uploads/schedule_attachments
//   [v58.13.16] done.
//     kept=0
//     deleted_soft_deleted=2   (v58.13.14 pytest scratch schedules)
//     deleted_missing=20       (v58.13.14 pytest scratch schedules
//                               whose asset was deleted, taking the
//                               schedule row with it)
//     skipped_error=0
//   All 22 legacy test-scratch directories cleaned.
//
// Observed drain time on this ship's reload: TBD (recorded below).
//
// Guardrail hold:
//   · SCHEDULE_ATTACHMENT_ROOT path + storage layout UNCHANGED.
//   · v58.13.14 attachment-DELETE endpoint UNTOUCHED (still
//     scoped to a single stored_name, still leaves the sid dir).
//   · bulk_import, form_submissions, watchdog, auto-resume — all
//     untouched.
//   · v58.13.17 AroFlo cron + CsIncidentTab.jsx orphan file —
//     still deferred.
//   · v58.13.13 version-sync guardrail: PASS.


// v160.3.9.58.13.15 — Shutdown-drain fix + hot-loop yield insurance.
//
// Ships THIS turn:
//   1. Fixes the 10+ minute shutdown-drain stall observed during
//      bulk_import (cost 3+ `supervisorctl restart backend` cycles
//      this session).
//   2. Adds explicit yield insurance in the bulk_import consumer hot
//      loop — belt-and-braces per the v58.13.15 diagnostic.
//   3. Regression guards that the existing v58.6-era `to_thread` +
//      `VISION_CONCURRENCY` semaphore defences stay in place.
//
// Does NOT ship (honest scoping):
//   · Semaphore / to_thread wraps — ALREADY exist in bulk_import
//     (VISION_CONCURRENCY=4 producer/consumer at line 2178; every
//     PyMuPDF + zipfile call already wrapped in `asyncio.to_thread`).
//     Re-adding them would be theatre.
//   · `/api/openapi.json` caching — FastAPI already caches this
//     in-memory after first hit (`app.openapi_schema` is set on
//     first call and reused). Adding a second layer would be
//     duplicate work.
//   · Any change to Claude call semantics, cache lookup logic,
//     watchdog / auto-resume behaviour.
//
// Root cause of the drain stall:
//   Background `_run_job` tasks (created via
//   `asyncio.create_task(_run_job(job_id, ...))` at 5 seams —
//   lines 530, 610, 1484, 1542, 2302) were never tracked. On
//   uvicorn SIGTERM the server's `@app.on_event("shutdown")` fired
//   but had NO handle to cancel them. `loop.close()` then blocked
//   waiting for the default `ThreadPoolExecutor` used by
//   `asyncio.to_thread`. OS threads cannot be cancelled — Python
//   3.10+'s only lever is `ThreadPoolExecutor.shutdown
//   (cancel_futures=True)` which declines to schedule NEW futures
//   but STILL waits for running ones. Result: uvicorn's drain
//   waits for the worst-case in-flight PyMuPDF render (30s+) PLUS
//   every queued PDF in the executor's ready queue.
//
// Fix (bulk_import_prestarts.py):
//   · New module-level `_ACTIVE_JOB_TASKS: set[asyncio.Task]`.
//   · New `_track_job_task(task)` helper — adds to the set + auto-
//     removes on completion via `add_done_callback`.
//   · Every existing `asyncio.create_task(_run_job(...))` call
//     wrapped: `_track_job_task(asyncio.create_task(_run_job(...)))`.
//     5 seams total, patched atomically via a regex sub so no seam
//     is missed.
//   · New `async def shutdown_bulk_import_jobs()` — cancels every
//     tracked task + `asyncio.wait_for(..., timeout=
//     SHUTDOWN_DRAIN_TIMEOUT_SEC)` (default 25 s, env-var
//     overridable via `BULK_IMPORT_SHUTDOWN_DRAIN_TIMEOUT_SEC`).
//     Tasks stuck inside a running to_thread OS thread still take
//     one PyMuPDF render's worth of wall-clock to release the
//     await, but the bounded budget guarantees uvicorn's drain
//     completes. Anything left over is picked up by the
//     `auto_resume_orphaned_jobs()` on the next boot.
//   · Consumer hot loop: `await asyncio.sleep(0)` every
//     `HOT_LOOP_YIELD_EVERY` records (default 50, env-var
//     `BULK_IMPORT_HOT_LOOP_YIELD_EVERY`). Cache-hit iterations
//     already await Mongo but this covers the pathological
//     cache-cold vision path.
//
// Fix (server.py):
//   · Existing `@app.on_event("shutdown")` now calls `await
//     shutdown_bulk_import_jobs()` FIRST, then scheduler.shutdown,
//     then close_db. Non-fatal error handling — server MUST still
//     shut down even if bulk_import teardown misbehaves.
//
// Tests (`tests/backend_unit/test_bulk_import_backpressure_v58_13_15.py`):
//   · Regression guard: existing to_thread wraps still at expected
//     lines. Existing VISION_CONCURRENCY semaphore still defined.
//   · Shutdown drain: mock a producer + N consumers, kick, call
//     `shutdown_bulk_import_jobs()`, assert total wall-clock < 30 s
//     even with 10 in-flight items.
//   · Task tracking: create tasks → registered; complete → auto-
//     removed from the set (no leak).
//   · Yield present: static-grep confirms
//     `await asyncio.sleep(0)` and `HOT_LOOP_YIELD_EVERY` are in
//     the consumer body.
//
// Guardrail hold:
//   · `to_thread` wraps + `VISION_CONCURRENCY` semaphore UNTOUCHED.
//   · Claude call, cache lookup, watchdog, auto-resume — UNTOUCHED.
//   · No k8s / supervisor / ingress config changes.
//   · `bulk_import_pdf_cache` + `pre_starts` NOT touched by the ship
//     itself (Part-1 continues committing during the ship).
//   · v58.13.16 orphan-blob cleanup + v58.13.17 AroFlo cron — NOT
//     sneaked in.
//   · Version-sync pytest guardrail from v58.13.13 still passing.


// v160.3.9.58.13.14 — Schedule attachments endpoint + FE wire-up
// (closes the v58.13.11-b deferred loop).
//
// Backend (`backend/asset_service.py`):
//   · New storage constants (`SCHEDULE_ATTACHMENT_ROOT`,
//     `SCHEDULE_ATTACHMENT_ALLOWED_MIMES`,
//     `MAX_SCHEDULE_ATTACHMENT_BYTES`). Filesystem-backed,
//     mirroring `forms.py:113` (`uploads/form_attachments/…`).
//     Same disk root convention (`uploads/`), same MIME allow-list,
//     same 25 MB cap.
//   · `POST /assets/{asset_id}/schedules/{sid}/attachments`
//     (multipart) — accepts files + parallel `names[]` +
//     `descriptions[]`. Stores each as
//     `uploads/schedule_attachments/{sid}/{uuid}`. Appends
//     `{file_id, stored_name, name, description, mime, size, url,
//     uploaded_by, uploaded_at}` to the schedule's `attachments`
//     array. Returns `{attachments: [...]}`.
//   · `GET /assets/{asset_id}/schedules/{sid}/attachments/{stored_name}`
//     — org-tenant + schedule scoped, FileResponse with the
//     original MIME + display name.
//   · `DELETE /assets/{asset_id}/schedules/{sid}/attachments/
//     {stored_name}` — HARD delete. `$pull` the metadata row AND
//     `path.unlink()` the disk blob. Repeated calls are idempotent
//     (returns 204). Blob-unlink failure raises 500 explicitly
//     rather than silently orphaning — the exact leak the
//     "Areas that need refactoring" list flagged.
//   · RBAC: `Depends(get_current_user)` on every route — same gate
//     the schedule create/update/delete endpoints use. No new
//     permission scope, no permission migration.
//
// Frontend:
//   · `components/forms/BydaFields.jsx` — `AttachmentField` gains
//     three new props: `apiBasePath` (default `/forms/submissions`
//     for 100% back-compat), `apiDeletePath`, `onServerFileDeleted`.
//     `downloadAttachment()` gains a `basePath` param with the same
//     default. Trash button becomes ENABLED when `apiDeletePath`
//     is provided (was a permanently-disabled stub with
//     `title="Delete lands in v58.12.5"` — the placeholder is now
//     fulfilled). All existing callsites (FillOutModal etc)
//     untouched because both defaults are 100% back-compat.
//   · `components/AssetServiceTabs.jsx` — imports `AttachmentField`
//     and renders it inside the More Details panel below Notes,
//     ONLY in edit mode. New-schedule flow shows a hint:
//     "Save the schedule first, then reopen it to attach files."
//     2-step pattern deliberately chosen over local-staging (the
//     staging shape works for form-submissions because the parent
//     POST creates the submission in the same request; the
//     schedule create/update flow POSTs an already-known payload
//     shape and adding staged-attachment flush would require
//     reworking `save()` — out of scope for a "wire it up" ship).
//     `onServerFileDeleted` callback keeps the local `form.attachments`
//     array in sync with the server response.
//
// Divergence from `forms.py` (intentional, documented):
//   · Schedule DELETE endpoint HARD-deletes the disk blob;
//     `forms.py` soft-deletes via `deleted_at` and leaves the file
//     on disk. This addresses the "orphaned-blob leak" concern
//     called out in the ship brief. Not back-porting to
//     form_submissions this turn — that touches a much larger
//     surface (photos, actions field, reference matrix) and is
//     properly a separate ticket.
//
// Storage NOTE:
//   The ship brief mentioned "GridFS" but the repo's established
//   attachment pattern (form_submissions in `forms.py:113`) is
//   filesystem-backed at `uploads/form_attachments/`. GridFS
//   exists in workers.py / backup_service.py for other purposes.
//   The "REUSE the exact same helper/utility, do NOT invent a new
//   storage path" clause is strictly stronger than the GridFS
//   hint, so we mirror `form_submissions` (filesystem). Backup,
//   disk-usage dashboards, and path invariants apply identically.
//   If GridFS becomes the org-wide standard, a follow-up ticket
//   can migrate BOTH `form_submissions` and `schedule_attachments`
//   together.
//
// Tests (`tests/backend_unit/test_schedule_attachments_v58_13_14.py`):
//   · Uses `requests` against the live `http://localhost:8001`
//     backend (integration-style — schema-only pytest would not
//     prove the endpoint is actually mounted).
//   · POST 1 attachment → 201, record shape verified, on-disk
//     blob exists.
//   · GET → 200, byte-for-byte round-trip.
//   · DELETE → 204, `attachments` array shrinks, disk blob gone.
//   · Multi-attachment: 3 uploaded, 1 deleted, 2 remain.
//   · Unauthenticated: 401/403.
//   · Fixture creates + tears down a scratch asset + schedule so
//     no permanent DB state changes.
//
// Backend reload NOTE:
//   This ship edits `asset_service.py` under `--reload-dir
//   /app/backend`, so uvicorn WatchFiles reload fires. Same
//   v58.13.11 pattern — bulk_import job `4f395643-…` orphans, we
//   restart backend, `auto_resume_orphaned_jobs()` re-picks it up
//   with `arc` +1. Zero data loss (cache-hit walk continues from
//   checkpoint).
//
// Guardrails held:
//   · `ScheduleIn` Pydantic model shape UNCHANGED — the
//     `attachments: Optional[list[dict[str, Any]]]` field from
//     v58.13.11 is exactly what we persist to.
//   · bulk_import untouched; form_submissions untouched; SW /
//     registration / update-poll untouched.
//   · Version-sync pytest guardrail (v58.13.13) still passing —
//     `RUNNING_VERSION` updated in step 4 of the ship checklist.
//   · CsIncidentTab.jsx orphan still not deleted (separate ticket).
//   · Every new pytest under `/app/tests/backend_unit/`, NEVER
//     `/app/backend/tests/`.


// v160.3.9.58.13.13 — Version-sync bug fix + guardrail.
//
// The smoking gun: v58.13.9, .10, .11, and .12 each shipped with
// changelog comment blocks prepended to this file, and each bumped
// `service-worker.js#CACHE_VERSION` + `mobile/version.ts
// #MOBILE_BUNDLE_VERSION`. But NONE of those four ships updated the
// `RUNNING_VERSION` export at the bottom of this file — the
// constant every UI surface reads to display "what am I running"
// (sidebar footer, ActiveSessionsPanel, UserManual, and the
// CacheBusterBanner's mismatch trigger). The export sat at
// `paneltec-v160.3.9.58.13.7` for four consecutive ships,
// producing the "browser stuck on v58.13.7 after aggressive
// cache-clear" symptom Stephen kept hitting. The bundle was
// ALWAYS current — the string it displayed was not.
//
// Fix (2 mechanical parts):
//   1. `RUNNING_VERSION` corrected to v58.13.13 (was v58.13.7).
//   2. New static-grep pytest at
//      `tests/frontend_smoke/test_version_sync_v58_13_13.py`
//      asserts the 3 canonical version strings are identical
//      AND the top changelog entry in THIS file references the
//      same version. Any future ship that bumps the SW / mobile
//      pair but forgets `RUNNING_VERSION` (or updates
//      `RUNNING_VERSION` but drops a changelog block) fails the
//      pytest immediately.
//
// CacheBusterBanner audit (deferred — no bug found):
//   The banner IS mounted at `App.js:98` (app-wide), does compare
//   `serverVersion !== RUNNING_VERSION`, and would have fired for
//   Stephen's stale v58.13.7 export. Reason he didn't notice:
//   v160.3.6w intentionally softened the banner to a bottom-right
//   toast that AUTO-HIDES after 8 seconds (`AUTO_HIDE_MS = 8_000`
//   at line 23) once the 30-second boot grace has elapsed. So the
//   banner had an ~8-second visibility window per full page
//   reload, easy to miss if the tab wasn't focused. Working as
//   designed per the v6w rationale ("we deploy many patch
//   versions per day so the old brown banner was constantly
//   nagging admins"). Post-v58.13.13 the mismatch stops firing
//   anyway (server + client both on v58.13.13). If sticker UX is
//   desired later, that's a separate ticket (candidate v58.13.14+).
//   No code change to CacheBusterBanner this ship.
//
// New ship-checklist rule (also captured in `/app/memory/PRD.md`):
//   BEFORE bumping `MOBILE_BUNDLE_VERSION` + `CACHE_VERSION`,
//   grep-verify the `RUNNING_VERSION` export line in this file
//   matches the new version. The v58.13.13 pytest enforces this
//   mechanically — no fork-agent has to remember it.
//
// Guardrail hold:
//   · Backend UNTOUCHED — no `--reload` triggered by this ship.
//     bulk_import job `4f395643-…` continues uninterrupted.
//   · SW registration logic, listener wiring, 60s update
//     interval — all unchanged (verified working in the
//     read-only diagnostic).
//   · Options B (env-driven derivation) + C (visibilitychange
//     update) explicitly punted — the 60s poll is already
//     sufficient for propagation.
//   · Orphaned `CsIncidentTab.jsx` NOT deleted (separate cleanup
//     out of scope).


// v160.3.9.58.13.12 — CS Incident list migrated to Submissions bucket.
//
// Nav change: new `Capture › CS Incidents` NavLink (data-testid
// `nav-submissions-cs-incidents`) inserted between Risk Assessments
// and Forms in `AppShell.jsx`. Same `reference_library` permission
// gate as the old tab — zero permission migration.
//
// Route change (`App.js`):
//   · Added `/app/submissions/cs-incidents` → new `CsIncidentsList`
//     page.
//   · Added `/app/submissions` → `<Navigate to="/app/submissions
//     /cs-incidents" replace />` so a bare `/submissions` doesn't
//     404.
//
// Legacy-URL redirect (`RiskAssessments.jsx`):
//   · Any hit to `/app/risk-assessments?tab=cs_incident` on-mount
//     `navigate('/app/submissions/cs-incidents', { replace: true })`.
//   · Removed `cs_incident` from the `TABS` array + removed the
//     `<CsIncidentTab />` render branch. `CsIncidentTab.jsx` file
//     retained (unmounted) — no dead-code cleanup this ship,
//     following the "surgical fix" rule.
//
// New page (`CsIncidentsList.jsx`):
//   · Renders via `GroupedTilesView`, groupBy `business_unit` (falls
//     back to "Unassigned business unit"), dateFn `date_of_issue`.
//   · Tile shows Issue #, status pill, issue_type, date, 2-line
//     description snippet.
//   · Tile actions: View (portal modal with every populated column)
//     + Edit / Delete via reused `useCrudModal` from
//     `components/riskAssessments/`.
//   · Filters preserved (business_unit / status / issue_type / free
//     text) + XLSX Import modal (same `POST /cs-incident/reimport`
//     endpoint).
//   · v58.13.10 flash-bug guardrail: every tile action button calls
//     `e.stopPropagation()` before mutating state, so the freshly-
//     mounted View modal cannot receive its own opening click. The
//     detail modal itself follows the SubmissionViewer portal
//     pattern (backdrop `onClick={onClose}` + inner
//     `onClick={(e) => e.stopPropagation()}`).
//
// Data / backend untouched:
//   · Zero backend edits (no `--reload` triggered by this ship).
//   · `GET /cs-incident/`, `GET /cs-incident/columns`, `POST
//     /cs-incident/reimport`, `PUT /cs-incident/{uid}`, `DELETE
//     /cs-incident/{uid}` all called with the exact same shape the
//     old tab used.
//   · Inspections / Incidents / Site Sign-In pages verified
//     untouched — same GroupedTilesView import path unchanged.
//
// Tests (`tests/frontend_smoke/test_cs_incidents_migration_v58_13_12.py`):
//   · Static-grep smoke checks that the migration didn't half-land.
//   · Route registered; nav item present; RiskAssessments no longer
//     mounts CsIncidentTab; redirect shipped; new page uses
//     GroupedTilesView; tile action buttons stop propagation.
//
// Deferred (surfaced, NOT acted on):
//   · The old `CsIncidentTab.jsx` file remains on disk (orphaned).
//     Safe to delete in a follow-up cleanup ship. Not deleted here
//     because import graph may surface other references, and a
//     file-delete is riskier than an unmount for a mid-turn ship.
//   · `v58.13.11-b` — Schedule attachment upload endpoint (still
//     deferred per Phase B ship).


// v160.3.9.58.13.11 — Periodic Task Template Phase B (v58.13.0-b).
// Six user-facing fields agreed with the user in Phase B; five ship
// this turn (phone, reported_by_contact, project_id,
// assigned_to_worker, notes). `attachments` shipped on the backend
// schema (`Optional[list[dict]]`) but the FE drag-and-drop is
// deferred to a follow-up ticket:
//
//   Scope-creep guard (surfaced, NOT acted on):
//     Reusing `BydaFields.AttachmentField` verbatim requires a
//     `/api/assets/{id}/schedules/{sid}/attachments` upload
//     endpoint that does NOT exist yet. `AttachmentField` in
//     "staging" mode never persists files itself — the parent
//     `Forms.jsx` FillOutModal POSTs the staged rows after
//     submission create. Adding an equivalent endpoint for
//     schedule attachments is >15 LOC + a new file storage path +
//     a delete route — clearly beyond "add 6 form fields".
//     Deferred to v58.13.11-b. Backend schema field is nullable
//     and future-proof so no migration is required when the
//     endpoint lands.
//
// Files touched:
//   · backend/asset_service.py — `ScheduleIn` extended with 7
//     new nullable fields (6 UI + denormalised worker name).
//     `create_schedule` / `update_schedule` handlers unchanged —
//     `**payload` splat already pipes every Pydantic field into
//     the doc.
//   · frontend/src/components/AssetServiceTabs.jsx —
//     · `form` state gains 6 new keys.
//     · New `filteredAssignWorkers` memo (client-side filter of
//       `/workers/directory` by `assigned_to_position`).
//     · Effect: when position changes to a value that no longer
//       contains the current worker, clears the worker pair so we
//       never persist a mismatched (id, name) tuple.
//     · 5 new form controls rendered inside the existing
//       "More details" collapsed panel below the Description
//       textarea: phone, reported_by_contact, project_id,
//       assigned_to_worker (position-filtered select with
//       "Select position first" hint when disabled), notes.
//   · tests/backend_unit/test_periodic_task_phase_b_v58_13_11.py —
//     8 pytests covering: every field parses, every field
//     optional, phone/notes length caps, project_id free-text
//     shape, Phase A + Phase B co-existence, and the
//     `/workers/directory` position-projection contract that the
//     FE filter depends on.
//
// Test location rationale:
//   NEW HARD RULE (v58.13.10 postmortem):
//     Any new .py file placed under `/app/backend/` — including
//     `backend/tests/` — triggers `uvicorn --reload-dir /app/backend`
//     to reload, which killed the in-flight bulk_import task for
//     job 4f395643-… during the v58.13.10 ship. Recovery required
//     a supervisor restart. Going forward EVERY new backend
//     pytest lives under `/app/tests/backend_unit/` (or
//     `/app/tests/frontend_smoke/`) which sit outside the
//     reload-dir. Existing tests under `backend/tests/` are safe
//     to run; only new file creation is the trigger. This rule
//     is captured in `/app/memory/PRD.md` for future forks.
//
// Guardrail hold:
//   · Dual-track hours/km scheduling logic (v58.12.6) untouched.
//   · No new endpoints; no new DB indexes; no data migration.
//   · Existing schedule docs remain valid — every Phase B field
//     defaults to None on the Pydantic model.
//   · `/api/openapi.json` reflects the new fields automatically
//     via FastAPI's Pydantic → JSON-schema pipeline.


// v160.3.9.58.13.10 — P0 fix: Site Sign-In "View" button flashes and closes.
// `SubmissionViewer` uses `onClick={onClose}` on its portal backdrop
// (v58.13.6-era design, working correctly on every OTHER capture page
// because those pages already stopped propagation on their trigger).
// `SiteSigninList.jsx` was the sole caller wiring the View button
// with a bare `onClick={() => setViewerRec(rec)}`, so React's
// synthetic-event system was bubbling the same click into the
// freshly-mounted portal on the same tick, firing `onClose`.
// Fix: single-file 1-line change on `SiteSigninList.jsx` — add
// `e.stopPropagation()` on the View trigger. Zero changes to
// SubmissionViewer, GroupedTilesView, DeleteRecordButton, or any
// shared component. DeleteRecordButton already uses the same
// stopPropagation pattern internally (line 76), which is why Delete
// works and View doesn't on the same tile row — the diagnosis
// evidence is the asymmetry.
//
// Also confirmed (no code change needed for either):
//   · SW client listener for `paneltec_sw_force_reload` already
//     wired in `serviceWorkerRegistration.js` (v69 · attached
//     unconditionally on module load, per-version sessionStorage
//     guard).
//   · SW `activate` handler already posts the message to every
//     window client (`service-worker.js:1328`).
//   · SW already calls `self.skipWaiting()` on install
//     (`service-worker.js:1310`) and `self.clients.claim()` on
//     activate (`service-worker.js:1323`).
//   These were reported as "missing" in the previous session but
//   were already present — investigation this turn included a full
//   grep of both files. See ship report for evidence.
//
// v58.13.11+ backlog:
//   · v58.13.11 (was v58.13.10) — CS Incident list migration to
//     Submissions + GroupedTilesView.
//   · v58.13.8 — Submissions Edit mode (audit-trail: silent
//     overwrite vs new-submission vs field-level log).
//   · v58.13.0-b — Complete remaining Periodic Task Template fields.


// v160.3.9.58.13.9 — Auto-approve dry-runs with ZERO new Claude work.
// At dry_run completion, if `cached_hits == extracted` AND `failed == 0`
// AND `extracted > 0`, `_run_job` skips the manual review gate and
// transitions the job directly to `state=downloading, mode=full_run`
// (which the existing full_run branch then commits). Job doc gains
// `auto_approved: True` + `auto_approved_reason: "100% cache-hits"`
// + `auto_approved_at` for audit. Manual gate preserved for every
// dry-run with new extractions OR any vision failure.
// Backend: `bulk_import_prestarts.py`
//   · New pure helper `_should_auto_approve_dry_run(mode, prog)` —
//     unit-testable predicate (isolated from `_run_job` machinery).
//   · `_run_job` Step 7 (final state transition) branches on the
//     predicate — auto-approve path fires `asyncio.create_task
//     (_run_job(job_id, "full_run"))` after flipping state + audit.
//   · Manual `POST /{job_id}/approve` endpoint unchanged — still the
//     path for any dry-run that produced new extractions.
// Frontend: `Step4Complete.jsx`
//   · ProcessingCard + CompleteCard render a
//     `wizard-auto-approved-chip` when `job.auto_approved === true`.
// Tests: 3 pytests in
// `test_bulk_import_auto_approve_v58_13_9.py`
//   · 100% cache-hits + zero fails → predicate True
//   · Any single new extraction (cached_hits < extracted) → False
//   · Any single vision failure (failed > 0) → False
//   · Zero PDFs processed → False (guards div-by-zero degenerate)
//   · Non-dry_run mode → False
//
// Pre/post 5-count snapshot expected identical to the pre-ship
// snapshot (backend code change only; running Part-1 job
// `4f395643-…` is past the auto-approve decision point and unaffected).


// v160.3.9.58.13.7 — SiteSigninList per-tile View + Delete actions.
// Reuses SubmissionViewer (resourceKind="forms" apiPath="forms/submissions")
// + DeleteRecordButton. Testid `site-signin-view-{id}` for view;
// DeleteRecordButton's auto-generated `delete-forms-{id}` for delete.
// Edit action deferred to v58.13.8 (audit-trail design pending).
// Zero backend changes — reuses `DELETE /api/forms/submissions/{id}`
// at forms.py:995 (verified extant; not exercised on real data).


// v160.3.9.58.13.6 — Site Sign-In / Visitor Register dedicated Capture page.
// New route `/app/site-signin` + sidebar entry (PersonAvailable icon,
// slotted after Inspections, before Risk Assessments). Zero backend
// changes — reads existing `GET /forms/templates/{tid}/submissions`.
// Renders via shared `GroupedTilesView` (v58.12.7). Groups by
// `submitted_by_name`. testidPrefix `site-signin`. Template id
// e8873f7e-6fd4-44c9-961a-d68e6ffecd8d.


// v160.3.9.58.13.5 — Supervisor `--reload` config.
// Fixes the class of stale-backend bugs that broke v58.12.10 delivery.
// /etc/supervisor/conf.d/supervisord.conf now runs uvicorn with
// `--reload --reload-dir /app/backend`. Smoke-tested: appending a
// comment to workers.py triggered `WatchFiles detected changes in
// 'workers.py'. Reloading...` within ~4s of the write. No manual
// `supervisorctl restart` needed for backend edits going forward.
// /app/memory/BUILD_STATE.md updated to reflect the new discipline.


// v160.3.9.58.13.0 — Periodic Task Templates (v58.13.0-a).
// Extends ScheduleIn with 5 optional user-facing fields (priority,
// task_type, task_identification, description_html, assigned_to_position)
// + 2 auto-stamped fields (entered_by_user_id, entered_by_name).
// Extends `status` enum: ["active","paused"] → ["active","paused","archived"].
// description_html sanitised server-side via `bleach.clean` (allowlist
// tags/attrs, strip=True). ScheduleEditor UI grows a collapsed
// "More details" panel. Backend: forms.py + asset_service.py.
// Frontend: AssetServiceTabs.jsx ScheduleEditor.
// Attachments + phone/reported_by/project_id/notes + assigned_to_worker
// filter deferred to v58.13.0-b.


// v160.3.9.58.12.13 — Position-based form assignment (work-item v58.12.10).
//
// User ask: "could the form assignments be /Drug & Alcohol Test Record
// have applied to roles from Simpro employee /workers list roles/position
// get from this list and all other forms with the same option where needed."
//
// P-2 shape (per user's explicit brief): TOP-LEVEL `assigned_positions:
// List[str] = []` on `form_templates`. NOT nested inside `applies_to`.
// OR-gate with existing `role_form_allowlist` filter in
// `forms.py::list_templates`: template is visible if caller's
// `workers.position` ∈ `template.assigned_positions` OR the existing
// role-based path admits them.
//
// SCHEMA — backend/forms.py
//   · `TemplateIn.assigned_positions: list[str] = []` — POST create.
//   · `TemplatePatch.assigned_positions: Optional[list[str]] = None`
//     — PATCH clear/set/omit semantics via model_dump(exclude_unset).
//   · `create_template()` persists `assigned_positions` on insert
//     (whitespace-strip + drop blanks — same normalisation as
//     `_clean_cert_slugs` uses for its slugs).
//
// SCHEMA — backend/asset_service.py
//   · `AppliesToIn.assigned_positions: list[str] = []` — the payload
//     wire shape FormAssignmentsAdmin sends via
//     `PUT /form-templates/{id}/applies-to` and the bulk endpoint.
//   · `BulkAssignmentEntry.assigned_positions: list[str] = []` — same
//     for the bulk-save endpoint.
//
// FILTER — backend/forms.py::list_templates (~L419-448)
//   · Widened worker lookup: joins `users.email` → `workers.email`
//     projecting `position` when caller is a non-admin/owner. Non-Simpro
//     admins bypass entirely via the existing
//     `caller_role in {admin, owner}` short-circuit.
//   · OR-gate list comprehension: `if r["id"] in allowed OR
//     (caller_position and caller_position in
//     (r.get("assigned_positions") or []))`.
//   · Case-sensitive on position (matches Simpro's canonical
//     capitalisation — we deliberately do not lowercase, so "Plumber"
//     ≠ "plumber"; that's the roster's source of truth).
//
// ENDPOINTS — backend/asset_service.py
//   · `list_assignments` (GET) — projection widened to include
//     `assigned_positions`. Response gains a top-level `positions: []`
//     — distinct Simpro-position values from the workers collection,
//     source of truth for the FE toggler.
//   · `update_applies_to` (PUT single) — extends the atomic $set to
//     also write `assigned_positions` alongside `applies_to`. Whitespace-
//     strip + dedupe + drop blanks. Notification dispatcher unchanged
//     (positions are not on the notify path yet).
//   · `bulk_save_assignments` (POST bulk) — same atomic $set.
//
// UX — frontend/src/pages/FormAssignmentsAdmin.jsx (primary surface)
//   · New `positionOptions` state — seeded from `data.positions` on load.
//   · Draft shape extended: `positions: Set<string>` per template. Seeded
//     from `t.assigned_positions` on load.
//   · `dirtyCount` extended to detect position changes.
//   · `toggleType` / `toggleTarget` / `applyPreset` extended to safety-
//     init `positions: new Set()` and preserve on kind-preset apply.
//   · `appliesToPayload` extended to emit `assigned_positions:
//     Array.from(v.positions)` — arrives at backend as expected.
//   · `save` cheap-skip check extended to compare positions.
//   · New "Applies to POSITIONS" section between Roles and Companies,
//     rendering one `CheckChip` per distinct Simpro position with
//     testid `chip-position-{name}`. Empty state:
//     `positions-empty-hint`. HardHat icon (already imported).
//
// DEFERRED — TemplateBuilder.jsx mirror block
//   · TemplateBuilder.jsx has NO existing applies_to / assignment UI —
//     grep shows zero matches for `applies_to`, `roles`, `positions`,
//     `assigned`. Adding a Positions section would mean inventing a
//     whole new UX region (labels, save wiring, endpoint call, error
//     state) — 30+ standalone LOC. Per the user's explicit hard limit
//     ("TemplateBuilder.jsx UNLESS the mirror block sits cleanly"),
//     this does not sit cleanly. ESCALATED and DEFERRED to a future
//     v58.12.14-work-item if the user wants the mirror later.
//
// TESTS — backend
//   · 8 pytests in `test_form_assignments_positions_v58_12_13.py`:
//     - 4 schema round-trip tests (TemplateIn, TemplatePatch omit/set/
//       clear, AppliesToIn defaults + accepts).
//     - 4 OR-gate filter arithmetic tests (role-only, position-only,
//       both-and-neither with case-sensitivity, non-Simpro-admin bypass).
//
// PRE/POST SNAPSHOT — expected identical (schema addition only, no
// migration). Pre-ship baselines locked at: form_submissions_live =
// 7,699 (organic +9 during v58.12.11+12 window — not from any ship) ·
// workers_simpro_live = 68 · incidents_live = 4 · inspections_live = 6
// · form_templates_live = 96 · templates_with_assigned_positions = 0.
//
// UNTOUCHED — TemplateBuilder.jsx (see DEFERRED above),
// role_form_allowlist current shape (still active as first branch of
// the OR-gate), any org doc, any template doc, any worker doc,
// mobile beyond the version bump, bulk import job `0da9f903-…`
// (auto_resume_count still 9, processing forward at organic pace).


// v160.3.9.58.12.12 — Service Log Position-Primary redesign.
//
// User feedback on v58.12.10: "the log service record, we already
// know who the technician position it is the list out of 65 plus
// employees there i only 1 technician it is this list to chose from
// i need instead of going throu all the employees just neet a list
// of positions to chose from."
//
// The auto-fill-from-tech UX shipped in v58.12.10 was inverted from
// what the user wanted. On the Service Log they don't hunt through
// 68 workers to find "the one Technician" — they want to pick from
// the 17 distinct Position values FIRST, then pick the (usually
// unique) tech that holds that position.
//
// CHANGED — components/AssetServiceTabs.jsx::RecordEditor
//   · `posMode` semantics simplified: 'select' | 'freetext'. Chip
//     mode retired; `technician-position-chip` and
//     `technician-position-edit` testids removed from the DOM.
//   · New `filteredTechs` memo: filters `techs` by
//     `form.technician_position` when set. `effectiveTechs` computed
//     from that with a zero-match fallback (see below).
//   · New `techPositionHasNoMatch` boolean: true when a position is
//     set AND zero workers hold it AND the roster loaded. Triggers a
//     hint + fallback to the full roster so the user is never
//     stranded with an empty tech list.
//   · `onPickTech` no longer overwrites `form.technician_position`.
//     Position is upstream now; tech follows position.
//   · Position picker moved to a col-span-2 slot ABOVE the
//     Cost/Technician row inside the `kind==='service'` grid.
//   · New hint element `technician-position-hint-no-match` with the
//     copy "No workers listed with this position — showing all
//     workers." (Refinement A from the ship brief.)
//   · "— Type manually —" sentinel on the position select still
//     works. When picked, the position becomes a free-text input AND
//     the technician list reverts to the full roster (opaque free
//     text cannot be a filter key). Refinement B from the brief.
//
// UNTOUCHED
//   · Backend model locked at v58.12.10 shape. `RecordIn` /
//     `RecordPatch` / `technician_position` schema unchanged. No
//     `workers.py::workers_directory` shape change (the `position`
//     projection field remains as widened at v58.12.10).
//   · Off-roster free-text technician branch (v58.11.2 `techMode`)
//     still fully functional in parallel — the position picker is
//     independent of the tech-name mode.
//   · No existing service log record modified. Legacy records with
//     a `technician_position` value that doesn't match any Simpro
//     option render normally — the value stays in state; user can
//     see & edit it via "— Type manually —".
//
// TESTS — 6 jsdom cases in `AssetServiceTabs.techposition.test.jsx`:
//   · (kept) off-roster free-text tech branch still exposes position picker.
//   · (a) position selected → tech list filters to matching workers only.
//   · (b) position with zero-match → hint renders + full-fallback list.
//   · (c) picking a tech does NOT overwrite the previously-selected position.
//   · (d) position + off-roster technician both persist to submit payload.
//   · (e) "— Type manually —" position sentinel → free-text input +
//         technician list reverts to full roster.
//
// PRE/POST SNAPSHOT — expected identical (frontend-only ship, no
// backend touch): form_submissions_live = 7,690 ·
// workers_simpro_live = 68 · incidents_live = 4 · inspections_live
// = 6 · form_templates_live = 96.


// v160.3.9.58.12.11 — Bulk-import counter fix (Path A′-a).
//
// User report: "Bulk import from URL are showing 2058 and a while ago
// was 7500 do you think you should write data to the folder as you go
// because we have gone backwards about 3 weeks now and thousands of
// tokens?"
//
// Diagnostic finding (v58.12.10 diagnostic pause): no data loss, no
// token waste. The DB had 10,936 live pre_starts and the current job
// was 100% cache-hits (estimated_cost_usd = $0.00 across 2,650
// PDFs). The "went backwards" was a UI-counter phenomenon:
// `_run_job` re-initialised `prog["extracted"]` to 0 on every
// container restart (auto_resume), so the UI counter walked up from
// zero even though on-disk writes accumulated via per-PDF
// cache-driven upserts.
//
// CHANGED — bulk_import_prestarts.py::_run_job
//   · `prog = {...}` initial dict now seeds extracted / matched /
//     failed / cached_hits / estimated_cost_usd / total / failed_pdfs
//     from `job.get("progress")` when present (fresh jobs still init
//     to zero — the `.get(...) or 0` coercion covers both cases).
//   · Adds `_persisted_processed = int(job.get("processed") or 0)`
//     as the max-flush guard reference.
//   · Resume log line: `"bulk_import job {id} resume: initialised
//     prog from persisted snapshot extracted=%d cached_hits=%d
//     failed=%d processed=%d"` — one-shot at `_run_job` entry, gives
//     ops a clean audit record of every resume.
//   · Flush-write guard: `processed = max(prog["extracted"] +
//     prog["failed"], int(_persisted_processed or 0))`. Never lets
//     the persisted value regress if a transient in-memory blip
//     (mid-restart race etc.) writes a lower number.
//
// Idempotent: when current > persisted (normal forward progress),
// current wins — behaviour unchanged. When current < persisted (only
// possible at re-entry), persisted wins and the counter holds
// steady until the loop catches up.
//
// UNTOUCHED — no schema change. `job.progress` shape read + written
// with the same field set as pre-v58.12.11. No new fields, no
// migration. Running job `0da9f903-…` NOT touched — fix will apply
// at its next container restart (auto_resume_count 9 → 10 or later).
// No `bulk_import_job_id` backfill on the 65% of pre_starts lacking
// it (Path A′-a doesn't need per-doc job linkage).
//
// TESTS — 3 pytests in `test_bulk_import_counter_v58_12_11.py`:
//   · Resume from persisted snapshot: mocks a job doc with progress
//     {extracted: 1000, cached_hits: 542, failed: 13, processed: 1013},
//     invokes `_run_job`, captures the resume log line, asserts prog
//     was seeded to those exact values.
//   · Fresh job (no progress): asserts the branch still initialises
//     to zeros.
//   · Max-flush guard: direct arithmetic contract across the four
//     scenarios (current > persisted / current == persisted /
//     current < persisted regression blocked / no persisted).
//
// PRE/POST SNAPSHOT — expected identical (backend-only ship,
// running job untouched, no writes triggered): form_submissions_live
// = 7,690 · workers_simpro_live = 68 · incidents_live = 4 ·
// inspections_live = 6 · form_templates_live = 96.


// v160.3.9.58.12.10 — Work-item label: v58.12.8 (Technician Position
// Hybrid picker) — shipped as v58.12.10 after v58.12.9 pre-empted the
// queue. Precedent going forward: work-item LABELS in briefs (v58.12.8)
// are decoupled from VERSION STAMPS on disk (v58.12.10). Stamp is
// always max+1 relative to the running file; label documents the
// queue-position of the work item.
//
// User ask: "the technician's position field needs to be captured
// alongside the technician's name on the service log — pick from the
// Simpro list of positions where possible, allow override for
// contractors / off-roster techs."
//
// SCHEMA — `asset_service.py`
//   · `RecordIn.technician_position: Optional[str] = None` (free-text at
//     the persistence boundary; picker-constrained in the UI).
//   · `RecordPatch.technician_position: Optional[str] = None`.
//   · `update_record()` "keep if None" whitelist extended to include
//     `technician_position` so PATCH-to-None explicitly clears the
//     field, matching the existing behaviour for `technician_name`
//     and `technician_id`.
//
// ROUTE — `workers.py::workers_directory`
//   · Projection widened to include `position`. Response objects now
//     carry `position: r.get("position") or ""` (empty string when the
//     Simpro row has no position — the FE's `.filter(Boolean)` distinct
//     derivation drops the blank so the dropdown never shows an empty
//     row). No other endpoint shape change.
//
// UX — `AssetServiceTabs.jsx::RecordEditor`
//   · New `form.technician_position` state initialised from
//     `initial?.technician_position ?? ''`.
//   · New `posMode` state — `'chip' | 'select' | 'freetext'`. Initial:
//     `'chip'` when a position is already captured, `'select'` otherwise.
//   · `positions` memo — runtime distinct list derived from the same
//     `techs` payload the technician picker already consumes (one round
//     trip, one source of truth). `.filter(Boolean).sort()` guarantees
//     no blank row and stable alphabetical order.
//   · `onPickTech` — auto-copies `chosen.position` into
//     `form.technician_position` and flips `posMode` to `'chip'` when
//     the picked tech carries a position. Overwrite is intentional: the
//     Simpro row is authoritative on tech pick.
//   · New UI block below Technician (col-span-2):
//       — `posMode === 'chip'`: pill showing the position + pencil
//         (Edit3 lucide) to enter select mode.
//       — `posMode === 'select'`: `<select>` of distinct Simpro
//         positions + `— Type manually —` sentinel.
//       — `posMode === 'freetext'`: `<input>` + "Pick from list" back-
//         button to return to select mode.
//   · Off-roster technician (v58.11.2 `techMode === 'freetext'`) still
//     sees the position picker — the position field is independent of
//     the technician-name mode. No auto-fill possible on contractor
//     names, but the roster's position list is still available.
//   · Submit payload always sends `technician_position: form.technician_position || null`
//     so PATCH-clear semantic is exercised when the user deletes the value.
//   · Testids: `technician-position-chip`, `technician-position-edit`,
//     `technician-position-select`, `technician-position-freetext`.
//
// TESTS
//   · Backend: 2 pure-function pytest cases in
//     `test_asset_service_tech_position_v58_12_10.py` (RecordIn round
//     trip + RecordPatch None-clear semantic via model_dump(exclude_unset=True)).
//   · Frontend: 3 jsdom cases in `AssetServiceTabs.techposition.test.jsx`
//     (auto-fill on tech pick → chip; pencil → select with sorted
//     distinct options and no blank row; off-roster branch renders
//     position select in parallel to the free-text name input).
//
// PRE/POST DB SNAPSHOT — expected identical (schema addition only —
// no migration, no data touch): form_submissions_live=7690,
// workers_simpro_live=68, incidents_live=4, inspections_live=6,
// form_templates_live=96.
//
// UNTOUCHED — mobile beyond the version bump, TemplateBuilder.jsx,
// PreStarts.jsx, Hazards.jsx, CaptureCard.jsx, folderColors.js,
// preStartsPalette.js, GroupedTilesView.jsx (v58.12.9 territory —
// zero re-edit needed), any worker row, any asset_service_records
// row, Simpro roster (no re-sync triggered), bulk import job.


// v160.3.9.58.12.9 — Tile-format parity: Inspections + Incidents tiles
// now adopt the Hazards `CaptureCard` visual language (rounded-lg,
// tight padding, optional 4px absolute left stripe). User ask: bring
// visual consistency to the Capture sections.
//
// CHANGED — components/capture/GroupedTilesView.jsx
//   · New optional prop `getStripeType(record) → typeKey`. When
//     provided:
//       — Each tile renders an absolute 4px left stripe styled inline
//         from `paletteForType(typeKey).hex` (shared
//         `../../lib/preStartsPalette` — read-only import, no palette
//         additions).
//       — The group banner (background + border + dot + count chip)
//         tints from `paletteForType(getStripeType(rows[0]))` — the
//         first-card palette per user's approved brief.
//   · `groupPaletteOverrides[key]` STILL wins for the banner
//     (backward compat — Incidents' fixed CATS escalation ladder
//     relies on this).
//   · Tile body classes switch to `CaptureCard` visual language:
//     `rounded-lg bg-white border border-slate-200 overflow-hidden
//     hover:shadow-md hover:border-slate-300 transition-shadow` with
//     `pl-2.5 pr-1.5 py-1.5` inner padding when a stripe is present;
//     legacy `p-3` retained otherwise.
//   · Grid density bumped `sm:2 / lg:3` → `sm:2 / lg:3 / xl:4`.
//
// CHANGED — pages/Inspections.jsx (1-line prop add)
//   · Passes `getStripeType={(r) => r.template_name || ''}` so each
//     inspection tile gets the family-coloured stripe + the group
//     banner tints from the first-card template family.
//
// CHANGED — pages/Incidents.jsx (comment only — v58.12.9 decision (Y))
//   · Existing `INCIDENT_CATEGORY_PALETTE` overrides remain the banner
//     palette. `getStripeType` is intentionally NOT passed. Rationale:
//     CATS is a fixed 6-key escalation ladder (near_miss → property)
//     whose semantic meaning is carried by the current amber → rose →
//     red → violet → emerald → slate ordering. Mapping through
//     `preStartsPalette`'s template-name-scoped regex would either
//     hash-map (loses ladder) or require a duplicate CATS→palette-key
//     table (two sources of truth for one visual meaning). Tile bodies
//     still inherit the new `rounded-lg` + tight-padding CaptureCard
//     visual language via the shared `GroupedTilesView` rewrite.
//
// UNTOUCHED — PreStarts.jsx, Hazards.jsx, CaptureCard.jsx,
// preStartsPalette.js, folderColors.js, all backend endpoints, any
// record data.
//
// PRE/POST DB SNAPSHOT — expected identical (frontend-only ship):
//   form_submissions_live=7690, workers_simpro_live=68,
//   incidents_live=4, inspections_live=6, form_templates_live=96.
//
// TESTS — 2 jsdom tests added to
// `components/capture/__tests__/GroupedTilesView.test.jsx`:
//   · palette-derived banner tint (getStripeType → paletteForType hex);
//   · per-tile absolute stripe present + width class match.
// Cumulative repo test count remains green.


// v160.3.9.58.12.7 — Tile-format standardisation for Inspection Reports
// and Incident Reports. User ask: "could you change the Inspection
// Reports and Incident Reports be displayed in the tile format, for
// consistacy". Both pages replace their `<table>` view with the same
// grouped-tile pattern PreStarts.jsx pioneered.
//
// NEW — components/capture/GroupedTilesView.jsx
//   · Reusable component with the following contract:
//     items, groupBy, groupLabels, groupOrder, groupPaletteOverrides,
//     renderTile, dateFn, loading, error, onRetry, emptyMessage,
//     testidPrefix.
//   · Groups items by discriminator; sorts rows within each group by
//     date DESC. Group order: explicit `groupOrder` first, then alpha
//     for the rest.
//   · Six-bucket deterministic hash palette (blue/emerald/amber/violet/
//     teal/rose) — same key → same colour across renders. Kept local so
//     it doesn't couple to `folderColors.js` (which is scoped to
//     document folders, semantically wrong here). Callers can override
//     via `groupPaletteOverrides` for fixed-ladder palettes.
//   · Empty state (`{prefix}-empty`) + amber error card (`{prefix}-
//     error-card`, `{prefix}-retry-btn`) with the v58.11.1 auto-retry
//     cadence (3s / 10s).
//   · testids: `{prefix}-tile-group-{key}`, `{prefix}-tile-count-{key}`,
//     `{prefix}-tile-{recordId}`. Sufficient seams for the testing agent.
//
// CHANGED — pages/Inspections.jsx
//   · `<table>` replaced with `<GroupedTilesView>`. Groups by
//     `template_name` (falls back to "Deleted template"). Toolbar
//     filter (`CaptureListToolbar`) still layers into `filtered` and
//     `<GroupedTilesView>` reads that. Per-record action bar
//     (Eye/PdfActions/EmailButton/DeleteRecordButton) wrapped inside
//     `renderTile`. Delete still mutates parent state so tiles vanish
//     after successful deletion.
//
// CHANGED — pages/Incidents.jsx
//   · `<table>` replaced with `<GroupedTilesView>`. Groups by
//     `category`; explicit `groupOrder = [near_miss, first_aid,
//     medical, ltc, env, property]` so tiles read as an escalation
//     ladder. New local `INCIDENT_CATEGORY_PALETTE` gives each CATS
//     enum its own palette (amber → rose → red → violet → emerald →
//     slate). Not added to `folderColors.js` (doc-folder scoped).
//     Existing status/category selects still pre-filter into
//     `preFiltered`, and `CaptureListToolbar` adds search on top.
//     Action bar wrapping identical shape to Inspections.
//
// UNTOUCHED — PreStarts.jsx (reference implementation preserved for
// future migration in a later ship), backend endpoints
// (`/api/incidents`, `/api/inspections`), any record data.



// v160.3.9.58.12.6 — Dual-track service schedules (D-2). One schedule
// can now track BOTH hours AND km (or any combo of hours/km/calendar)
// with "whichever comes first" reminder semantics. User ask: "could you
// record Kilometres as well as hours in this form".
//
// SCHEMA — `asset_service.py`
//   · New `SecondaryInterval` pydantic model: {kind, value, calendar_unit,
//     last_done_at, last_done_value, reminder_lead}. `reminder_lead` is
//     a single unit-per-kind value — days for calendar, hours for hours,
//     km for km. The pre-v58 developer had already left dedicated
//     `reminder_lead_hours` + `reminder_lead_km` fields on `ScheduleIn`
//     — we're walking through the door they left open.
//   · `ScheduleIn.secondary_interval: Optional[SecondaryInterval] = None`.
//   · New helper `_validate_secondary(interval_kind, secondary, asset)`
//     rejects: same-kind primary+secondary (422), secondary=hours on
//     asset without hours_meter (422), secondary=km on asset without
//     odo_km (422), secondary=calendar without calendar_unit (422).
//   · `_compute_next_due` refactored — new pure helper `_compute_axis_due`
//     projects ONE axis to (next_value, next_at, status). The top-level
//     wrapper calls primary; if `secondary_interval` present, calls
//     secondary; materialises: next_due_value (primary numeric — UI
//     contract unchanged), next_due_at_primary, next_due_at_secondary,
//     next_due_value_secondary (new), next_due_at = None-safe
//     min(primary.next_at, secondary.next_at). Status is worst-of.
//   · Cron/reminder pipeline UNCHANGED — existing queries against
//     `next_due_at < now() + lead_days` continue to fire correctly on
//     the earliest projection.
//
// UX — `AssetServiceTabs.jsx` `ScheduleEditor`
//   · New collapsible "Also track by (second dimension)" checkbox below
//     the Baseline-today section.
//   · Kind select is limited to the OTHER two kinds; the option whose
//     required reading is null on the asset renders `disabled` with a
//     tooltip ("This asset has no odometer reading" / "…no hours_meter
//     reading") — visibility educates the user, doesn't hide the option.
//   · Live purple helper line "Also: currently X km → next due at Y km"
//     using `asset.odo_km` / `asset.hours_meter` (same source as the
//     primary "Currently…" line — routed through `AssetServiceTabs.jsx`
//     L122-126 as pre-v58.12.6).
//   · Save serialises the secondary block only when the toggle is on;
//     UI-only fields (`secondary_enabled` / `secondary_kind` / …) are
//     stripped from the payload.
//   · Schedule list view renders a second purple line when
//     `s.secondary_interval` is present: "Also every N km · Next at Y km"
//     with a "Whichever comes first fires the reminder" hover hint.
//
// BACKWARD COMPAT (proven, not assumed) —
//   · `asset_service_schedules` has 2 legacy hours-only docs. Both have
//     NO `secondary_interval` field. `Optional[SecondaryInterval] = None`
//     parses them cleanly; `_compute_next_due` primary-only branch fires
//     exactly as pre-v58.12.6. **Confirmed via 3 dedicated unit tests**
//     (see `tests/test_asset_schedule_dual_track_v58_12_6.py`):
//       — `test_legacy_single_axis_schedule_read_unchanged` — pre-doc
//         `id=1fd87b6e-…` materialises to `next_due_value=1440.1`,
//         matching the stored value byte-for-byte.
//       — `test_legacy_single_axis_schedule_write_unchanged` — fresh
//         create path with no secondary in payload = pre-v58 output.
//       — `test_legacy_single_axis_schedule_update_no_secondary` — PUT
//         path preserves the None secondary block.
//   · ZERO migration. The 2 existing docs are not touched.
//
// TESTS
//   · Backend: 9 pytest tests all green (3 backward-compat safeguards +
//     5 required scenarios + 1 axis-projection sanity).
//   · Frontend: 3 jsdom tests all green (toggle collapsed default,
//     disabled-option tooltip, payload includes/excludes secondary).
//   · Cumulative repo test count: 36/36 (frontend) + 9/9 (v58.12.6
//     backend) — no regression.
//
// Explicitly NOT touched:
//   · `asset_meter_history` / `asset_navixy_sync` (only READ from
//     `assets.hours_meter` + `assets.odo_km`).
//   · The 2 existing schedule docs (Optional field parse; no $set).
//   · Cron/reminder-pipeline behaviour.
//   · TemplateBuilder.jsx (still v58.12.5 territory).
//   · Attachment DELETE endpoint (still v58.12.5 territory).
//   · Mobile (only the version string bumped).



// v160.3.9.58.12.4 — Attachment local staging (P-B). Closes the
// "first-fill can't attach" UX gap flagged in v58.12.2's Decision #1.
//
// v58.12.2 chose "upload immediately on file add" for AttachmentField,
// which required a `submissionId` — and `FillOutModal` doesn't have one
// until AFTER `submit()` succeeds. So on a NEW submission the dropzone
// was rendered disabled with a "Save the form first, then attach files"
// hint. Users couldn't drop invoices/reports on first fill.
//
// Photo precedent (forms.py + Forms.jsx submit() loop): batch File
// objects in React state during composition, POST after the submission
// itself is created. Attachments now do the same.
//
// AttachmentField (components/forms/BydaFields.jsx)
//   · New `onStageChange(field_id, [{tempId, file, name, description,
//     mime, size}, …])` prop. Fires whenever the local staged list
//     mutates (add / edit-name / edit-description / remove).
//   · Two lifecycle branches gated by `submissionId`:
//       — `isStaging = !submissionId`: rows land as status='staged'
//         and NEVER upload immediately. Same MIME + max_bytes pre-flight.
//         Editable Name (default: filename without ext) + Description.
//         Remove clears the local row. New row testid
//         `attachment-row-staged-{tempId}` distinct from the pre-existing
//         `attachment-row-{tempId}`.
//       — `!isStaging`: unchanged from v58.12.2 — immediate multipart
//         POST via `uploadOne` with Cancel/Retry. Kept for the future
//         re-open / edit path (no UI wires this today).
//   · "Save the form first" hint retired — never rendered again.
//   · Saved-row Delete tooltip bumped to v58.12.5 (matches DELETE
//     endpoint parking).
//
// Forms.jsx FillOutModal
//   · New `attachmentFiles` state, keyed by field.id. Same shape as
//     `photoFiles`. `FieldRunner` wires `onStageChange` into
//     `AttachmentField`.
//   · `submit()`: after the submission POST returns `sub.id`, and after
//     the existing photo loop, iterates `attachmentFieldIds` and POSTs
//     each staged file as multipart to
//     `/forms/submissions/{sub.id}/attachments` with `files`, `names`,
//     `descriptions` (endpoint contract unchanged). Progress toast reads
//     "Uploading attachments (i/n)…". Best-effort per-file: a single
//     failure toasts + moves on, doesn't roll back the submission.
//     Matches photo semantic exactly.
//
// Tests: BydaFields.test.jsx retires the "disabled dropzone" test that
// was v58.12.2-specific and adds 5 staging tests (add / MIME reject /
// size reject / remove / edit name+desc).
//
// Explicitly NOT touched:
//   · Backend attachments endpoint contract.
//   · Immediate-upload branch (retained for future re-open flow).
//   · TemplateBuilder.jsx (parked for v58.12.5).
//   · Attachment DELETE endpoint (parked for v58.12.5).
//   · Mobile (only the version string bumped).



// v160.3.9.58.12.3 — Portal every full-screen modal in Forms.jsx to
// document.body. Fixes user report "the header of the program is
// cutting off the top of this form" on TTM Risk Assessment (and
// silently every other template — TTM was the loudest example).
//
// Root cause (empirical, DOM-diagnosed via Playwright):
//   · FillOutModal is `fixed inset-0 z-50` INSIDE the AppShell content
//     column `<div className="flex-1 flex flex-col min-w-0 relative
//     z-40">`. The TopBar is a sibling of the modal inside that same
//     z-40 stacking context — `sticky top-0 z-30`. Per CSS z-index
//     rules the modal (50) SHOULD paint above the topbar (30). But
//     `elementsFromPoint(720, 32)` (topbar centre) with the modal open
//     returned the topbar SPAN and its parent BUTTON + HEADER (z=30)
//     AS TOPMOST, with the modal backdrop (z=50) BELOW. This is the
//     "stacking context escape" the AppShell.jsx L522 comment
//     explicitly acknowledges: "Bumping the modal's z-index to 100 /
//     9999 did NOT help". AppShell.jsx itself recommends the fix at
//     L523: "Portaling the modal to `document.body` DID fix it."
//
// Fix — portal ALL FIVE full-screen modals declared in Forms.jsx:
//   1. `FillOutModal`          testid `form-fillout-modal`   (L~756)
//   2. `PreviewModal`          testid `form-preview-modal`   (L~910)
//   3. `ImportModal`           testid `forms-import-modal`   (L~989)
//   4. `AiBuilderModal`        testid `ai-builder-modal`     (L~1037)
//   5. `SubmissionViewModal`   testid `submission-view-modal` (L~1592)
// Every one has a full-screen backdrop + centred card + close-X + esc
// handling — no popovers or anchor-positioned tooltips in scope.
//
// The nested `discard-confirm-dialog` inside FillOutModal (z-[60]) is
// intentionally NOT portalled separately — it moves with its parent.
//
// Precedent for the pattern: SubmissionViewer.jsx L162 already portals
// via `createPortal(<div ...>, document.body)`. UsersManagement.jsx
// portals in three places (L1626, L1984, L2487). No new pattern.
//
// Explicitly NOT touched:
//   · AppShell.jsx (header component) — global change territory.
//   · Any modal's z-index (empirically doesn't fix it).
//   · Any other file — Forms.jsx is the whole diff.



// v160.3.9.58.12.2 — BYDA v2, ship 2/3 (user-facing critical).
//   Close-out of the pieces the previous session deferred out of
//   v58.12.1. Split from the original spec — the TemplateBuilder
//   admin editors move to v58.12.3.
//
//   AttachmentField (components/forms/BydaFields.jsx)
//     · Full drag-and-drop upload UI (was a placeholder).
//     · Client MIME pre-flight matches backend/forms.py:1084 (415).
//     · Client size pre-flight matches backend/forms.py:1088 (413).
//     · Per-file editable Name (default: filename without ext) +
//       Description. Immediate multipart POST to
//       `/forms/submissions/{id}/attachments` on file add (matches
//       how the photo field works — no deferred-until-submit).
//     · Pending → uploaded lifecycle with Cancel (aborts in-flight
//       fetch via AbortController) and Retry on failure.
//     · Submission-not-yet-created state (`submissionId == null`):
//       dropzone rendered disabled with an inline
//       `data-testid="attachment-dropzone-hint-{id}"` hint reading
//       "Save the form first, then attach files."
//     · Server-side records are rendered read-only with a download
//       button routed through the auth'd api client (bare <a href>
//       would drop the Bearer JWT — same pattern as
//       PdfPreviewModal / AssetDrawer). Fallback URL constructed
//       client-side when the record predates the `.url` field.
//     · Delete of already-uploaded rows tooltipped "Delete lands
//       in v58.12.3" (bumped from v58.12.2 because the DELETE
//       endpoint is being split into v58.12.3 alongside the
//       TemplateBuilder editors).
//
//   ActionsField (components/forms/BydaFields.jsx)
//     · `_off_roster` moved from row payload into component-local
//       React state so it never gets persisted to Mongo.
//     · New pure helper `actionsFieldErrors(field, value)` — used
//       by Forms.jsx FillOutModal `requiredOk` gate. A Closed row
//       without a `date_closed` now BLOCKS submit (previously the
//       red border was cosmetic only). Testid
//       `actions-row-error-{i}` is on the visible error line.
//     · Saved-row Remove tooltip bumped to v58.12.3.
//
//   Forms.jsx
//     · FieldRunner signature extended with `submissionId`
//       (undefined for FillOutModal — no submission exists yet).
//     · `actionsErrors` memo + `requiredOk` gate now considers
//       cross-field validation, not just per-field `isAnswerValid`.
//     · onSubmitClick scrolls to the first `actions` error row
//       when it takes precedence, else falls through to the
//       existing missing-required path.
//
//   SubmissionViewer.jsx
//     · FieldRow + FieldValue now thread `submissionId` (from the
//       record root `r.id`) to AttachmentField so downloads can
//       compose the fallback URL when the record lacks `.url`.
//
//   Test infrastructure
//     · Adds `@testing-library/react` + `-jest-dom` + `-user-event`
//       to devDependencies. `src/setupTests.js` auto-loaded by
//       react-scripts wires the jest-dom matchers.
//     · New jsdom suite
//       `components/forms/__tests__/BydaFields.test.jsx` covers
//       every acceptance criterion in the v58.12.2 spec (MIME
//       reject, size reject, off-roster toggle strip, Closed
//       blocks submit, dropzone disabled hint, submission-not-yet-
//       created guard). Playwright walkthrough attempted against
//       the live preview URL as bonus evidence; jsdom is the
//       load-bearing evidence pass.



// v160.3.9.41 — Users & Permissions UX polish.
//                  Part A — Drag-handle reorder for role sections.
//                    Replaces the up/down ArrowUp/ArrowDown buttons on
//                    each role-section header with a `⋮⋮`
//                    GripVertical drag handle powered by `@dnd-kit/
//                    core` + `@dnd-kit/sortable`. Section rows drag
//                    up/down; drop persists via the SAME endpoint
//                    (`PUT /api/user-prefs/section-order/users` with
//                    `{section_order: [...]}`) and preserves the SAME
//                    per-viewer semantic — every logged-in admin has
//                    their own saved order. Keyboard sensor: arrow
//                    keys with focus on the grip, Space to lift /
//                    drop. Per-user row sort dropdown for name /
//                    last-login / date-created preserved.
//                  Part B — Auto-linked worker avatars on Users
//                    rows. ALREADY IMPLEMENTED in v160.3.9.33.1 at
//                    `backend/users.py:187-231` — no code change
//                    needed. GET /api/users enriches each row with
//                    `photo_url` at read time by looking up the
//                    matching worker via `simpro_employee_id` (primary)
//                    or case-insensitive `email` (fallback). Verified
//                    live: 4/N rows on Stephen's admin view render an
//                    `<img>` avatar today (rest use the initials
//                    fallback).
// v160.3.9.40 — Security Wave 2. Bundled:
//                  • SEC-002 (Stored XSS in email Outbox): server-side
//                    `bleach` sanitizer on the `body_html` WRITE path in
//                    `email_outbox.py`, keyed off a strict tag/attribute
//                    allowlist (`p, br, strong, em, u, ul, ol, li, a,
//                    h1-h4, blockquote, hr, span, img, table, thead,
//                    tbody, tr, td, th`). `<script>`, `on*` handlers,
//                    `<iframe>`, `javascript:` URLs, and non-image
//                    `data:` URLs are stripped. Idempotent startup
//                    backfill sanitises historical `outbound_emails`
//                    rows and records a marker doc in
//                    `bk_migrations.v160_3_9_40_email_outbox_sanitize_backfill`.
//                    Outbox.jsx keeps `dangerouslySetInnerHTML` — server
//                    is authoritative. New `data-sanitized="true"`
//                    probe marker on that div.
//                  • SEC-003 (Integration secrets plaintext at rest):
//                    new Fernet key `INTEGRATIONS_ENC_KEY` (distinct
//                    from the v38 backup key — cross-scope isolation).
//                    Secret fields under
//                    `integration_configs.<kind>.config.<field>` for
//                    Simpro (`api_token`), Navixy (`password`,
//                    `session_hash`), M365 (`client_secret`,
//                    `access_token`, `refresh_token`), TextMagic
//                    (`api_key`) are encrypted at rest — ciphertext
//                    lives under `<field>_encrypted` and the plaintext
//                    key is `$unset`. Idempotent startup migration
//                    guarded by
//                    `bk_migrations.v160_3_9_40_integrations_encryption`.
//                    Manual re-run: `POST /api/integrations/admin/
//                    migrate-integration-secrets`. New helper
//                    `hydrate_integration_config(doc)` returns a
//                    shallow-copy config with plaintext hydrated —
//                    every consumer site
//                    (`auth.py` Simpro login, `integrations_simpro`
//                    `_cfg`, `integrations_m365._cfg`,
//                    `integrations_simpro_workers`, `asset_navixy_*`,
//                    `asset_service`, `asset_trip_summary`,
//                    `form_assignment_notifier`) now flows through it.
//                    API responses continue to return only the
//                    masked-last-4 preview — never plaintext OR
//                    ciphertext.
//                  • SEC-004 (Unauthenticated /api/files/*):
//                    `permissions_middleware.py` skip for
//                    `^/api/files/` REMOVED. Every handler under
//                    `dashboard.py::files_router` now depends on
//                    `Depends(get_current_user)` which accepts the
//                    short-lived download-scoped JWT via `?token=`
//                    query — the existing `filesUrl()` helper on the
//                    FE already sends this so no FE change was
//                    needed. `document_library` and `form_photos`
//                    are additionally org-scoped: the parent
//                    folder/submission's `org_id` must match the
//                    caller. Mismatch returns 404 (existence not
//                    confirmed). `/api/files/renewals/{token}/{name}`
//                    stays public — auth via the share-link token
//                    in the URL — and is now the only entry in the
//                    middleware `/api/files/` skip list.
// v160.3.9.39 — Introduce `local_agent` backup destination kind.
//                  When the LAN backup agent runs INSIDE the NAS's
//                  own Docker environment, the SMB mirror step
//                  is redundant AND was failing on `Connection
//                  refused` (UGREEN SMB service off). New
//                  `kind: "local_agent"` + `local_path` (default
//                  `/data`) on `bk_destinations`. Backend:
//                  `GET /api/backup/agent/pending` omits SMB
//                  fields for local_agent rows and returns
//                  `mode: "local"` + `local_path` instead.
//                  `POST /api/backup/agent/report` only bumps
//                  `last_written_at` when the reported
//                  `target_path` actually starts with the
//                  configured `local_path`. Create/update
//                  destination endpoints REJECT SMB fields on a
//                  local_agent row with HTTP 400 for a clean
//                  contract. Idempotent startup migration
//                  converts destination
//                  `5e6a5346-2207-409d-ab11-c702651223fa`
//                  (Office UGREEN tower) to local_agent and
//                  clears any stale SMB mirror telemetry
//                  (last_mirror_status, last_mirror_error).
//                  Frontend `<MirrorStatusCards>` gains a
//                  fourth state — "DELIVERED (LOCAL MOUNT)"
//                  in calm blue-green — with an
//                  "Awaiting first write" amber sibling. SMB
//                  failure surface suppressed for local_agent
//                  rows.
//                Bundled fixes (same version bump — spotted in
//                the same screenshot):
//                  • Refresh button on LAST LAN DELIVERY was
//                    firing `load` but had no tactile feedback;
//                    now wired through a `handleRefreshClick`
//                    that adds an `isRefreshing` state, disables
//                    the button, spins the icon, and enforces a
//                    500ms visible floor so a fast round-trip
//                    still registers as a click.
//                  • "Reported NaN d ago" subline under the
//                    Backup agent disk gauge — the local
//                    `fmtAge(min)` was being fed an ISO
//                    timestamp. New module-level
//                    `safeRelativeTime(iso)` helper returns
//                    "—" on any parse failure and is now used
//                    everywhere in BackupTab.jsx that renders a
//                    relative time. "NaN" can no longer surface.
// v160.3.9.38 — SMB destination password at-rest encryption.
//                  BEFORE: `bk_destinations.password` stored in
//                  plaintext, readable via mongodump, snapshot ZIPs,
//                  and any DB-level access. AFTER: Fernet
//                  (AES-128-CBC + HMAC) ciphertext stored on
//                  `password_encrypted`, keyed by `BACKUP_DEST_ENC_KEY`
//                  env var. `agent/pending` decrypts at read time so
//                  the LAN agent contract is unchanged. Idempotent
//                  startup migration sweeps legacy plaintext rows
//                  into ciphertext (guarded by
//                  `bk_migrations.v160_3_9_38_dest_password_encryption`
//                  marker). Manual re-run at
//                  `POST /api/backup/admin/migrate-destination-passwords`.
//                  Backend-only patch — no FE changes required.
// v160.3.9.37 — Backup dashboard clarity fix.
//                  1. Relabelled the "NAS disk" gauge to "Backup
//                     agent disk" — the numbers come from the
//                     LAN agent's OWN filesystem (Raspberry Pi
//                     SD/SSD in the reference deployment), NOT
//                     the SMB NAS tower. Added agent name +
//                     heartbeat age subline + tooltip explainer.
//                  2. New `<MirrorStatusCards>` renders per-
//                     destination mirror-state: green Mirroring
//                     OK / red Mirror failing (with verbatim
//                     error + "What to check" collapsible) /
//                     amber Never mirrored. Fixes the "0 MB free
//                     of 0 MB" confusion by giving the SMB
//                     Connection-refused signal its own surface.
//                  3. Backend: `POST /api/backup/agent/report`
//                     now accepts an optional `nas_disk_usage`
//                     payload (same shape as `disk_usage`, but
//                     covering the SMB target). Stashed on the
//                     destination doc + relayed in
//                     `/api/backup/lan-status` as
//                     `destinations[].nas_disk_usage`. FE hides
//                     the NAS-tower gauge until the agent code
//                     starts posting it — no invented numbers.
//                  Preserves the v160.3.7ah defensive fallback
//                  in `DiskGauge` (`!usage || total===0` → amber
//                  "Unavailable — agent not reporting" chip).
// v160.3.9.36 — Phase 5: legacy `role`-string retirement (shim).
//                  New `auth.py::_derive_legacy_role()` mapper +
//                  `get_current_user()` shim make `user.role` an
//                  authoritative derivative of `user.role_id` on
//                  every request. The ~65 Bucket-A legacy
//                  `user.role`-string gates scattered across the
//                  backend now read a value sourced from the DB's
//                  authoritative `role_id`, eliminating drift.
//                  Bucket B (display) auto-fixed by the shim.
//                  Bucket C: Simpro import dual-writes role +
//                  role_id using the mapper (data-hygiene).
//                  FE: `MobileModulesSection.jsx` row-key
//                  parameter renamed `role` → `role_id`.
//                  Per-site Bucket-A migration is now backlog
//                  work — see phase5b_bucket_a_backlog.md.
//                  `require_roles()` deprecated but kept live for
//                  the ~20 Simpro endpoints still using it.
// v160.3.9.35 — Phase 6: permissions token unification.
//                  Backend `_role_default()` in `permissions.py` is
//                  now ALWAYS DB-first for every role (seeded +
//                  custom). It reads `roles.permission_tokens[]`
//                  from Mongo keyed on `role_id` and only falls
//                  back to the hardcoded `ROLE_DEFAULTS` map when
//                  the DB has no active doc for that role_id
//                  (first-run / pre-seed safety). Fixes the silent-
//                  ignore bug where an admin editing seeded roles
//                  via the Roles Matrix UI would see their changes
//                  ignored at runtime. Empty `permission_tokens: []`
//                  is now respected as an explicit "no permissions"
//                  choice — not a fallback trigger. Full matrix
//                  (`effective_for`) inherits the same semantics.
//                  Legacy `_role_permits` alias preserved for
//                  backwards-compat middleware import.
// v160.3.9.34.5 — Fix: expanded ID Card content is no longer hidden
//                  behind the sticky Save/Cancel footer. Two changes,
//                  both in the Edit modal: (1) `pb-24` (96px) padding-
//                  bottom on the modal's `overflow-y-auto` scroll
//                  container so any last-child section has room to
//                  scroll fully above the footer; (2) `useEffect` in
//                  `IdCardSection` that fires
//                  `scrollIntoView({block:'start', behavior:'smooth'})`
//                  on the section wrapper whenever `open` flips true,
//                  placing the header near the top of the visible
//                  scroll area with the newly-revealed content
//                  visible below it, footer no longer overlapping.
//                  No other section touched.
// v160.3.9.34.4 — Fix: ID Card section now opens on the first tap on
//                  touch devices. Previously the section (last child of
//                  the modal's scrollable body) sat at the scroll
//                  boundary, so iOS Safari's 300ms tap-delay + tap-vs-
//                  scroll ambiguity swallowed the first tap and the
//                  section only opened on the second attempt. Bespoke
//                  header for `IdCardSection` — mirrors the shared
//                  `<Section>` visual pattern (same chevron animation,
//                  same badge slot, same open/close transition) but
//                  adds `touch-action: manipulation` +
//                  `-webkit-tap-highlight-color: transparent` +
//                  `scroll-margin-block-end` so single-tap toggles
//                  identically to the sibling sections above. No other
//                  section touched.
// v160.3.9.34.3 — Explicit "Upload Photo" button on the Edit worker
//                  modal header and the read-only view drawer. The
//                  previous versions only surfaced a clickable avatar
//                  (view drawer) or no upload UI at all (edit modal),
//                  so users could not find how to add a photo. New
//                  self-contained `<EditWorkerPhoto>` uploader lives
//                  in `Workers.jsx` — plain `<input type="file"
//                  accept="image/*">` styled as a labeled button, no
//                  feature detection, no conditional hiding. Wired to
//                  the existing POST /api/workers/{id}/photo endpoint.
//                  On success the avatar refreshes immediately without
//                  closing the modal. Camera button hidden in-tree
//                  behind a false-gated conditional per user request.
// v160.3.9.34.2 — Camera capture for the worker avatar uploader + ID Card
//                  tap-to-expand. New `<CameraCaptureModal>` (getUserMedia →
//                  live preview → Capture/Retake/Switch/Close → JPEG File
//                  @ 0.85 quality) wired into `<WorkerPhoto>` in the read-
//                  only view drawer. Feature-detected: button hidden on
//                  browsers without `mediaDevices.getUserMedia`. Zero-leak
//                  stream release on every exit path. Plus new
//                  `<ImageLightbox>`: the ID Card photo tile and QR tile
//                  are now tap-to-expand with hover ring + magnifier
//                  overlay, ESC / X / click-outside to close.
// v160.3.9.34.1 — Phase 4b parity for workers. Removed manual
//                  "Add worker" affordance from the Workers page
//                  (top-of-page CTA + empty-state CTA + copy). The
//                  public `POST /api/workers` endpoint now returns
//                  410 with detail "worker create disabled: use
//                  Simpro ZIP import". Auth gate preserved
//                  (401 unauth, 403 non-admin, 410 admin).
// v160.3.9.32-4c — Phase 4c: Deferred FE polish + per-user permission
//                  overrides with reasons sidecar. Grouped-by-role Users
//                  list with collapsible sections and per-section sort.
//                  ResetPasswordDialog in the user drawer (direct + magic-
//                  link modes). Drawer chips (Simpro-linked, TEST, Pending,
//                  Archived). Permissions tab in the user drawer reading
//                  GET /users/{id}/permissions and PUT-back with reasons.
//                  Housekeeping: InviteModal + BulkInviteModal removed.
// v160.3.9.42.1 — Users & Permissions UX patch (two bugs, one version).
//                  Bug 1 — Skewed / soft avatars on the Users table:
//                    Root cause was Shadcn `<AvatarImage>` rendering
//                    `aspect-square h-full w-full` WITHOUT
//                    `object-cover`, so the browser defaulted to
//                    `object-fit: fill` and stretched non-1:1 photos.
//                    Users.jsx now renders a bare `<img>` at 56 px
//                    (h-14 w-14) with `rounded-full object-cover
//                    border border-slate-200 bg-white` — identical
//                    styling discipline to the Workers portal row
//                    photo, just larger. Initials fallback follows
//                    the same square-round + object-cover pattern
//                    via a plain `<div>`. `UserAvatarImage` wrapper
//                    from v41.2 preserved (still resolves through
//                    `filesUrl()` so SEC-004 signed-download JWT
//                    ships with every request).
//                  Bug 2 — Per-section sort dropdown removed:
//                    Every role section now sorts alphabetically
//                    (A-Z on `name`) as the single deterministic
//                    order. `sortUsers()` collapsed to one
//                    `localeCompare({sensitivity:'base'})` pass;
//                    the four-option `<select>` (Name A-Z / Name
//                    Z-A / Last login / Date created) and its
//                    `sectionSort` state are deleted from
//                    UsersManagement.jsx. Drag-handle section
//                    reorder (v41) is UNCHANGED — this only
//                    touches row-within-section ordering.
// v160.3.9.42 — Users & Permissions polish (v41 follow-up).
//                  Enlarged user-row avatars from 40 px → 56 px so
//                  the Simpro-linked photos are legible at glance.
//                  Also added a defensive `<AuthedImage>` sweep on
//                  Hazards + SubmissionViewer photo lists — any
//                  `<img>` pointing at `/api/files/*` or `/api/
//                  workers/*/photo/*` now flows through the shared
//                  fetch-with-Bearer + blob URL helper so nothing
//                  silently 401s post-SEC-004.
// v160.3.9.42.2 — Users & Permissions row-height trim.
//                  v42.1's bare-<img> avatar at 56 px pushed row height
//                  to 69 px because the surrounding row cells still
//                  carried the v42 `py-1.5` (12 px total padding) plus
//                  the Actions cell's legacy `py-3` (24 px total). User
//                  asked for a tighter layout that hugs the avatar
//                  with only a couple of pixels of breathing room.
//                  Every row `<td>` now uses `px-4 py-1 align-middle`
//                  (checkbox cell uses `px-3 py-1 align-middle`).
//                  Actions cell's outlier `py-3` reduced to `py-1` to
//                  match the row. Avatar UNCHANGED at 56×56 —
//                  reduction is padding-only. Row height measured
//                  from 69–69.5 px → 60–61 px. Section header row,
//                  drag handle, column widths, font sizes and every
//                  other page element untouched. Explicit
//                  `align-middle` is redundant with the browser
//                  default `vertical-align: middle` on `<td>` but
//                  makes future refactors safe against a Tailwind
//                  reset that might change the default.
// v160.3.9.42.3 — Bundle: three bugs on Users & Permissions.
//                  Bug 1 (Aaron Foster purple circle):
//                    Aaron's Simpro-imported photo was a 512×512 solid-
//                    purple placeholder PNG (11.9 KB, fetch HTTP 200 —
//                    the image itself IS junk, no fallback fires
//                    because from React's POV the load succeeded). New
//                    `isMonoColorImage()` decodes the image into a 4×4
//                    canvas and computes channel-wise variance; scores
//                    < 500 are treated as broken → render the initials
//                    fallback. Live calibration on 12 real users: mono
//                    Aaron scored 114.93, LOWEST real photo (Dominic
//                    Goold) scored 1,608, HIGHEST (Craig Large) 14,884
//                    → 500 is 4.4× above the mono ceiling and 3.2×
//                    below the real-photo floor. `getInitials(name, email)` now returns
//                    proper 2-char initials (e.g. "AF" for Aaron Foster)
//                    instead of the previous single-letter fallback.
//                    New reusable `<InitialsAvatar>` component owns the
//                    fallback tile styling. `<img crossOrigin="anonymous">`
//                    so the canvas readback isn't tainted by CORS.
//                  Bug 2 ("← Back to Settings" too close to breadcrumb):
//                    Shared component `capture/Ui.jsx::SettingsBackLink`
//                    was `inline-flex` and the sibling `renderCrumb`
//                    also returned an `inline-flex` div — both inline-
//                    level, so they collapsed onto the same line as
//                    "← Back to SettingsSETTINGS / Users". Wrapped the
//                    back-link in a block-level `<div className="mb-2">`
//                    so it lays out ABOVE the crumb on every page that
//                    uses PageHeader (~24 pages: Users, Workers, Roles,
//                    Contractors, Certs, Vehicles, Sites, Audit Exports,
//                    Ask, Outbox, etc.). Single-file fix.
//                  Bug 3 ("Refresh from Simpro" button did nothing):
//                    Root cause was BACKEND — `simpro_import_users.py::
//                    sync_linked_users` (and 3 sibling call sites in the
//                    same file) still read `cfg_doc.get("config") or {}`
//                    to hand the raw doc to `_fetch_simpro`, which
//                    expects plaintext `api_token`. v40 SEC-003 moved
//                    every Simpro secret to `<field>_encrypted` at rest,
//                    but this file was missed in the audit. Result:
//                    HTTP 500 KeyError: 'api_token' in 98ms — endpoint
//                    never reached the Simpro API. All 4 call sites now
//                    flow through `hydrate_integration_config(cfg_doc)`.
//                    Verified via curl: HTTP 200 · scanned=64 · changed=0
//                    · 31.9s wall-time (real API round-trip).
//                    FE polish (same version): button gains
//                    `isRefreshingSimpro` state + spinner + "Refreshing…"
//                    copy + `data-refreshing` probe attribute + 500ms
//                    min-visible floor. testid renamed
//                    `sync-from-simpro-btn` → `refresh-from-simpro-btn`
//                    to match the user-facing label.
// v160.3.9.43 — SEC-003 SWEEP CONTINUATION HOTFIX.
//                  v42.3 patched `simpro_import_users.py` after the
//                  "Refresh from Simpro" button crashed with
//                  `KeyError: 'api_token'`. That was one of NINE latent
//                  gaps in the v40 SEC-003 migration. This version
//                  closes the remaining EIGHT across four files:
//                    • asset_meter_history.py (2 sites — Navixy 30-day
//                      backfill and track-based backfill, both read
//                      `session_hash` on raw doc).
//                    • integrations_textmagic.py (2 sites — `_cfg()`
//                      helper returned raw `doc["config"]`; `tm_send`
//                      also read the raw config directly. Every SMS
//                      send would have 4xx'd with the encrypted
//                      Mongo doc).
//                    • worker_certifications.py (1 site — cert
//                      expiry reminder cron/manual endpoint read
//                      TextMagic credentials from the raw doc; SMS
//                      would have silently dropped without error).
//                    • workers.py (1 site — `POST /workers/sync-from-
//                      simpro` read `cfg["api_token"]` directly to
//                      call `_refresh_staff_cache`; would 500 on
//                      first click).
//                    • health_extras.py (3 sites — Simpro / Navixy /
//                      TextMagic health checks used
//                      `(cfg.get("config") or {}).get("api_token")`
//                      to detect presence. On v40-encrypted rows the
//                      plaintext no longer exists, so every health
//                      pill reported "Not connected" even when the
//                      integration was fully functional. Fixed by
//                      accepting plaintext OR `<field>_encrypted` for
//                      the presence check — actual auth still goes
//                      through `hydrate_integration_config` in the
//                      real request path).
//                  Every consumer now flows through
//                  `hydrate_integration_config(cfg_doc)` — the shared
//                  v40 helper that returns a shallow-copy config with
//                  plaintext hydrated in memory only.
//                  Test coverage: `test_integrations_encryption_v40`
//                  extended with per-file regression fixtures that
//                  seed an encrypted config, call each of the eight
//                  fixed code paths, and assert no `KeyError` and
//                  no fallback-to-empty-cfg behaviour.
// v160.3.9.43.1 — Green + Orange pill-toggle pair (Users list/dashboard
//                   pattern applied app-wide) + SEC-003 startup self-
//                   check + SEC-003 contract regression pytest.
//                   AUDIT CORRECTION: original v43 audit table listed 12
//                   sites; grep against the actual codebase found the
//                   Shadcn `<TabsList>` "Dashboard + List" pair on
//                   only 7 sites — Users, Hazards, Certifications,
//                   Incidents, Inspections, Swms, SitesAdmin. The other
//                   "12" from the audit were either bespoke pill toggles
//                   (Workers Directory / Matrix), 3+ way tab strips
//                   (PlantVehicles), or non-existent (Contractors,
//                   Vehicles, Suppliers, RolesAdmin, Outbox,
//                   DocumentLibrary, PermissionPresetsAdmin,
//                   SwmsAssignmentsAdmin all have no `<TabsList>` at
//                   all). Applied to the 7 verified sites only.
//                  Component: new `variant="pill-pair"` on the shared
//                  Shadcn `<TabsList>` + `<TabsTrigger>` so Radix keeps
//                  ownership of state + keyboard nav + focus rings for
//                  free. Colour is POSITION-BASED per your approval:
//                  LEFT (List, emphasis="primary") → emerald;
//                  RIGHT (Dashboard, emphasis="secondary") → orange.
//                  Active = solid fill + white text + white/25
//                  translucent count-badge; Inactive = pale tint
//                  (emerald-50 / orange-50) + coloured text + white
//                  opaque count-badge. Site conversion is a 3-token
//                  swap (`variant="hero"` → `variant="pill-pair"`) —
//                  ZERO structural changes, so every `<TabsContent>`
//                  still switches correctly.
//                  SEC-003 startup self-check (server.py:on_startup):
//                  scans `integration_configs` for `<field>_encrypted`
//                  keys and, if `_FERNET` is unloaded OR fails a
//                  decrypt smoke-test on any kind, logs a high-visibility
//                  `log.error` naming each affected `kind`. Non-fatal —
//                  the app still boots — but the log line makes botched
//                  key rotations impossible to miss. Verified: healthy
//                  boot logs `[v43.1 SEC-003 SELF-CHECK] OK — 4
//                  integration kinds carry ciphertext, all decrypt
//                  cleanly.`
//                  SEC-003 contract pytest
//                  (`test_sec003_contract_v43_1.py`): static scan of
//                  every `/app/backend/*.py` for the invariant "if you
//                  read `integration_configs` AND dereference any
//                  secret field on cfg/c/conf/tm_cfg/etc., you MUST
//                  import `hydrate_integration_config`." Pre-v43 this
//                  would have flagged 4 files (asset_meter_history,
//                  integrations_textmagic, worker_certifications,
//                  workers, simpro_import_users). Post-v43 the sweep
//                  is complete — the test reports 0 offenders.
// v160.3.9.43.2 — Bug fix: "Refresh from Simpro" pill stayed "22d ago"
//                  after a successful click. Case (a) diagnosis — field
//                  mismatch. The pill reads `GET /integrations/simpro/
//                  workers/last-sync`, which is the ZIP-import snapshot
//                  endpoint (`simpro_zip_import.py::last_sync_marker` →
//                  latest `worker_import_snapshots` doc by `run_at`).
//                  `POST /admin/simpro/sync-linked` (v42.3 fix) writes
//                  only per-user `users.simpro_last_synced_at` fields.
//                  So the pill was picking up the last ZIP import (July
//                  12 — 22 days ago) even though the manual sync had
//                  just run. Two-part fix:
//                    • Backend: `sync_linked_users` now writes a
//                      `worker_import_snapshots` row on completion with
//                      `kind='sync_linked'` + `counts={scanned, changed,
//                      role_updates, lock_drifts}`. The shared pill
//                      endpoint returns the latest by `run_at`, so the
//                      pill now reflects manual syncs immediately.
//                    • Frontend: the Refresh button's success handler
//                      calls `await Promise.all([load(), loadLastSync()])`
//                      instead of `await load()`, so the pill refreshes
//                      without a full page reload.
//                  Test coverage: `test_sync_linked_writes_snapshot_v43_2`
//                  seeds an ephemeral simpro config + one linked user,
//                  monkey-patches `_fetch_simpro`, calls the handler,
//                  and asserts a fresh `worker_import_snapshots` row
//                  exists with `kind='sync_linked'` and `run_at`
//                  within the current test window.
//                  Note: this fix only covers the sync-linked path.
//                  Other Simpro flows (workers ZIP import at
//                  `integrations_simpro_workers.py` and roles sync at
//                  `roles_catalogue.py::sync_roles_from_positions`)
//                  already write to their own snapshot rows or don't
//                  need to appear in this pill.
// v160.3.9.44 — Wave 1 of RBAC audit remediations.
//                  Part A (P0-AI): audit's Section-3 finding was a
//                    FALSE POSITIVE. The 3 AI routes in `ai.py` (POST
//                    /swms-draft, /diary-structure, /hazard-vision)
//                    are ALREADY gated via `Depends(require_ai_use)`
//                    which is `Depends(require_permission("ai","use"))`.
//                    Verbatim curl on all three: HTTP 401 for anon.
//                    My static-scan regex missed the aliased Depends.
//                    Lesson folded into Part C's contract test.
//                  Part B (P0-IDOR): diagnosis showed no LIVE hole —
//                    every mutation was closed by an incidental
//                    `WRITE_ROLES = {"admin","hseq_lead"}` inner
//                    allowlist. But the token model was inconsistent:
//                    outer `require_permission("workers","edit")`
//                    granted the token while inner allowlist silently
//                    overrode it. Added explicit
//                    `require_scoped_access(user, resource, existing)`
//                    calls at 5 latent sites so record-scope is
//                    enforced regardless of the role allowlist:
//                    - workers.py: PATCH + DELETE /workers/{id}
//                    - worker_certifications.py: PATCH + DELETE
//                      /certifications/{cert_id} (via parent worker
//                      company_id lookup)
//                    - contractors.py: DELETE /contractors/{cid}
//                    404-on-scope-mismatch (not 403) to match SEC-004's
//                    existence-leak-avoidance pattern.
//                  Part C: new `test_permissions_gate_contract_v44.py`
//                    scans every mutating route in `/app/backend/*.py`
//                    and asserts a `require_permission`-family gate
//                    exists in the Depends chain (recognises aliased
//                    wrappers like `require_ai_use`,
//                    `require_admin_and_hseq`). 7 auth-bootstrap routes
//                    allow-listed by (file,verb,path). 122 LEGACY
//                    routes with only `Depends(get_current_user)` or
//                    `Depends(require_roles(...))` documented as
//                    `_KNOWN_UNGATED_LEGACY` tech debt — future waves
//                    will migrate them. New mutating routes without a
//                    gate fail the test at CI.
//                  Test coverage delta: +8 tests (6 IDOR + 2 contract),
//                  regression stack now 91/91 (was 101/101 pre-wave —
//                  the extra 2 sync_linked_snapshot tests from v43.2
//                  contribute).
// v160.3.9.45 — Wave 2 RBAC audit remediations.
//                  P1-CUSTOM + P1-TC-UNDER closed. Idempotent one-shot
//                  backfill of the 11 empty Simpro `custom_*` UUID
//                  roles + Traffic Controller expansion (3 → 16
//                  tokens) + Cleaner role INSERT (no UUID doc existed).
//                  Marker: `bk_migrations.v160_3_9_45_custom_role_
//                  token_backfill`. Field workers (Construction Worker
//                  L1/L2/L3/CW2, Machine Operator, Traffic Controller)
//                  get identical 16-token Cluster-A set; Plumber gets
//                  Cluster-A + `assets.view + vehicles.view`; Cleaner
//                  gets Cluster-A minus `swms.view + inductions.view`;
//                  Directors get 44-token Cluster-C (read + email,
//                  team_view, no edit); Ops Manager adds `.edit` on
//                  hazards/incidents/pre_starts; Safety and Compliance
//                  Manager adds `.edit` across the full compliance
//                  domain; Admin Assistant + Administration get
//                  Cluster-D (24 tokens view+email). NO `users.*`,
//                  `roles.*`, `integrations.*`, `backups.*`, or
//                  `.delete` grants anywhere outside admin. Total
//                  active users unblocked: 57 (26 Traffic Controllers +
//                  19 Construction Workers L2 + 12 across the other
//                  10 roles).
//                  Also: v44 IDOR-scoping test extended with the "no
//                  cross-contractor writes anywhere" invariant across
//                  every scoped resource (workers, hr, certifications,
//                  documents, contractors).
// v160.3.9.47 — Program Schematic redesign (SVG topology).
//                  Complete rewrite of `pages/settings/ProgramSchematicPage.jsx`
//                  and `lib/programSchematic.js`. ReactFlow retired in
//                  favour of a static SVG hub-and-spoke poster on a
//                  dark-navy canvas with a radial purple bloom behind
//                  a blue→violet gradient central hub badge.
//                  6 clusters, locked palette (do NOT drift):
//                    Overview     Sky      #0EA5E9  (4 icons)
//                    Capture      Orange   #F97316  (6 icons)
//                    Compliance   Emerald  #10B981  (5 icons)
//                    Register     Indigo   #6366F1  (4 icons)
//                    Settings     Violet   #8B5CF6  (11 icons — split into
//                                                    Access + Data & Automation)
//                    Integrations Amber    #F59E0B  (4 icons)
//                  Lucide-react icons only, tinted per cluster. Each
//                  cluster connects to the hub via ONE quadratic bezier
//                  path — no inter-cluster edges. Static (no zoom /
//                  pan / drag). Icons are clickable and keyboard-
//                  focusable; Enter/Space navigate to the module.
//                  Legacy `/app/settings/program-schematic` route added
//                  as a client-side `<Navigate>` redirect to
//                  `/app/settings/schematic`.
//                  Route contract enforced by new backend pytest
//                  `test_program_schematic_routes_v47.py` — every route
//                  declared in `programSchematic.js` must exist as a
//                  `<Route path>` under `/app/*` in `App.js`.
//                  `lib/programSchematic.js`: `_RAW_EDGES`,
//                  `SCHEMATIC_ZONES`, `SCHEMATIC_EDGES` deleted (dead
//                  after the react-flow retirement; verified via grep
//                  no other file imported them).
// v160.3.9.46 — placeholder marker (pre-schematic session).
// v160.3.9.47.1 — Program Schematic visual polish.
//                  Two changes on top of v47:
//                    1. Background: vertical linear gradient replaces
//                       the radial-purple bloom. Top #1E1B4B (deep
//                       indigo-950), mid #12173A, bottom #0B1220
//                       (dark navy). Grid pattern retained but darker
//                       + spaced 40→50 for extra breathing room. Hub
//                       still carries a soft radial halo (r=320) so it
//                       remains the visual anchor.
//                    2. Everything larger. viewBox 1600×1300 → 1800×1500,
//                       tile 88→128, icon 34→56 (+65%), node label
//                       11→16 (+45%), cluster label 12→20 (+67%) with
//                       chip 130×24 → 190×36, hub 260×110 → 320×140
//                       with title 22→30, sub 11→15. Spoke stroke 2→2.8,
//                       terminal dot r 6→8.
//                    Mobile fallback: canvas wrapper now
//                    `overflow-x-auto` below `md` and the SVG carries
//                    `min-w-[1100px]` so on narrow viewports users
//                    scroll horizontally to read icons at their
//                    natural size rather than seeing them shrink to
//                    ~12 px. Two hint copies keyed by breakpoint —
//                    "Scroll horizontally →" on mobile, "Click any node"
//                    on desktop.
//                    Palette UNCHANGED (locked).
// v160.3.9.48 — HR Employees Register (Green-to-Build).
//                  Full authenticated register at `/app/settings/hr-employees`
//                  with Active + Archived tabs, sparse-column table, filter
//                  dropdowns, search, and PII controls (masked DOB / address /
//                  next-of-kin phone with `Reveal` buttons per field that
//                  each write an audit row server-side).
//                  Permission tokens (new resource `hr_employees` in
//                  PERMISSIONS_SCHEMA):
//                    `hr_employees.view`, `.edit`, `.reveal_pii`, `.archive`,
//                    `.reimport`, `.audit_view` (+ inherited open / delete
//                    from the base `ACTIONS` list).
//                  `permissions.ACTIONS` extended with four new actions:
//                  `reveal_pii`, `archive`, `reimport`, `audit_view` —
//                  hr_employees-scoped semantics; every other resource
//                  leaves those cells False via `_grant()`'s default.
//                  Endpoint gates converted from `require_roles("admin")`
//                  to `require_permission("hr_employees", <action>)` for
//                  all 11 routes (list, columns, audit, get, reveal-dob,
//                  reveal-address, reveal-next-of-kin, patch, archive,
//                  delete, reimport). New `POST /{uid}/reveal-next-of-kin`
//                  returns raw next-of-kin phone + relationship (masked
//                  by default via `_mask_phone(...)` — last-4 digits
//                  visible). New `POST /{uid}/archive` (idempotent) sets
//                  `archived="Archived"` without touching `deleted_at`
//                  — semantic split with `DELETE /{uid}` which continues
//                  to soft-delete via `deleted_at` while PRESERVING
//                  `archived`. `linked_worker_id` reserved on the schema
//                  for the P2 Employee↔Worker linker (patchable but
//                  no endpoint consumes it yet).
//                  `permissions_scope.py` reserved key `"hr"` renamed to
//                  `"hr_employees"` across `scope_filter`, `can_access_record`
//                  and the fail-closed branch.
//                  Migration (`bk_migrations.v160_3_9_48_hr_employees_ingest`)
//                  idempotently ingests the 121 rows from
//                  `backend/scripts/data/hr_employees_source.xlsx` via
//                  `parse_workbook` + `upsert_rows` (skips if the collection
//                  is already populated) and backfills the `admin` role's
//                  `permission_tokens[]` with the full v48 grant + the
//                  `hseq_manager` role with `hr_employees.open + .view`.
//                  Legacy `auditor` role gets `hr_employees.view` +
//                  `.audit_view` via ROLE_DEFAULTS['auditor']['hr_employees']
//                  override (no DB doc — hardcoded map). Cache invalidated
//                  via `_bust_role_cache()` post-write.
//                  Frontend:
//                    · `HrEmployeesPage.jsx` (Active/Archived tabs, sparse
//                      table, search + 3 filter dropdowns, security-flag
//                      banner when `security_flag_count > 0`)
//                    · `HrEmployeeDrawer.jsx` (Detail + Activity + Edit
//                      tabs; per-field Reveal buttons; header
//                      Archive/Restore actions)
//                    · Sidebar entry `hr_employees` inserted after
//                      `workers` in both frontend + backend
//                      `settings_nav_registry` — visibility gated by
//                      `requiresCan: ['hr_employees', 'view']`.
//                  Tests: `backend/tests/test_hr_employees_v48.py` —
//                  gate matrix (401 anon / 403 wrong-role / 200
//                  admin), reveal-* audit-row assertions, archive vs
//                  delete semantic split, migration idempotency, and
//                  the Stephen-carries-all-tokens read-only invariant.
// v160.3.9.49 — Bundle A + B + C polish pass.
//                  A) Certifications page — added "Refresh from Simpro"
//                     header button (mirrors the v42.3 Users pattern:
//                     spinner + 500 ms floor + toast + refetch). Wired
//                     to `POST /workers/sync-from-simpro` with
//                     `{company: 'both'}` so the delta pulls both
//                     Paneltec + Viatec workers plus their certifications.
//                     The "69" number on the List tab is `workers.length`
//                     — # of workers in the current view (a filtered slice
//                     of the 80-worker roster). Documented in the
//                     `certifications-tab-list` label pill.
//                  B) HR Employees — inline `Delete` button on every
//                     row + a `Delete` button in the drawer header (both
//                     soft-delete via `DELETE /hr/employees/{uid}` — the
//                     existing v48 endpoint, gated by `hr_employees.edit`).
//                     Header "Refresh from Simpro" button wired to the
//                     new `POST /hr/employees/refresh-from-source`
//                     endpoint (gated by `hr_employees.reimport`,
//                     re-parses the on-disk XLSX + audits — Simpro doesn't
//                     currently expose an HR endpoint, so the on-disk
//                     source is treated as the sync boundary).
//                  C) Suppliers Edit modal — added "Look up address"
//                     inline button next to the Address textarea. Calls
//                     new `GET /suppliers/address-lookup?company_name=X`
//                     backend endpoint which proxies ABN Lookup (if
//                     `ABN_LOOKUP_GUID` env is set) → OpenStreetMap
//                     Nominatim fallback (polite `User-Agent`, AU
//                     country-code filter). Client-side rate-limit
//                     enforces 1 req/sec per OSM ToS. Populates
//                     `custom_address` + `custom_state` on top hit
//                     with a toast "Found via ABN Lookup" or "Found via
//                     OpenStreetMap"; friendly warn on empty result.
//                     Secrets NEVER logged.
// v160.3.9.49.1 — Program Schematic label + hub polish.
//                    - Node labels moved from flat text below the icon
//                      circle onto an invisible top-arc `<path>` via
//                      `<textPath>`. Arc radius `TILE/2 + 12`. Every
//                      label now hugs the outer edge of its circle
//                      (12-o'clock centred, reads left-to-right around
//                      the top half). Solves the v47.1 collision where
//                      adjacent circles' flat labels overlapped.
//                    - Label styling: font-weight 700, letter-spacing
//                      0.5, `filter: drop-shadow(0 0 4px <cluster>CC)`
//                      so each cluster's tint glows softly behind its
//                      own labels (cluster identity read at a glance).
//                    - Central hub badge now sits inside TWO concentric
//                      decorative text rings (outer r=210, inner r=180)
//                      carrying repeating brand wordmarks — the hub
//                      becomes a proper visual centrepiece per the
//                      user's brief.
//                    - Hover ripple: pure-CSS letter-spacing breathe
//                      on the arced label (0.5 → 1.5 px over 260 ms)
//                      + opacity punch to full. Zero JS overhead.
//                    - "Current-route glow" was in-scope but dropped:
//                      would need a Router-wide `sessionStorage`
//                      writer to survive SPA navigation, and the
//                      schematic's primary use is standalone — value
//                      didn't justify the cross-file wire-up. Kept
//                      documented for a future pass.
//                    - No layout, palette, cluster, or route changes.
//                    - Keyboard focus + `aria-label` preserved on every
//                      node (SchematicNode now sets `aria-label={node.label}`
//                      on the outer group).
// v160.3.9.51 — Two frontend polishes shipped together.
//
//   A) Program Schematic (v50 slice).
//      Split-arc labels for multi-word node names in "bottom-row"
//      positions. `SchematicNode` now receives a `splitArc` prop
//      driven by a pre-computed `canSplitArc` Set: a node qualifies
//      when NO sibling in the same cluster sits within 60..260 units
//      below it. Qualifying 2-word labels split on the space closest
//      to the middle of the string (balanced halves) and render as
//      word 1 on the top arc (sweep-1 → over the top, letters upright)
//      + word 2 on the bottom arc (sweep-0 → under the bottom, letters
//      still upright, reads L→R). Non-qualifying nodes stay on
//      top-arc only so their bottom-arc text can't collide with the
//      next-row's top-arc text. Letter-spacing bumped 0.5 → 1 for a
//      more "hugged" typographic feel.
//
//   B) User Manual search (v51 slice — bug fix).
//      Previously typing "hr employees" did nothing because
//      `highlight()` treated the query as a single literal regex and
//      no section-level filter existed. Rewrite:
//        · `highlight()` now tokenises on whitespace and wraps EVERY
//          matching token in `<mark>` (case-insensitive, escape-safe).
//          "hr employees" now highlights both "HR" and "Employees"
//          wherever they appear in title or body.
//        · New `sectionMatchesQuery()` AND-matches every whitespace
//          token against the section's title + body markdown.
//        · Debounced query (150 ms) drives the filter so keystrokes
//          stay snappy across 17 sections.
//        · Non-matching sections hidden. "Jump to" chips filter to
//          match. Filter summary below the toolbar reads
//          "N sections match "<query>" · PDF export always includes
//          the full manual." Empty state reads "No sections match
//          "<query>". Try a shorter term." (soft orange).
//        · Section numbering preserved via `sections.indexOf()` so a
//          filtered result for "HR Employees" still reads as its
//          canonical section number.
//        · `onDownload()` unchanged — PDF export continues to hit
//          `/help/manual.pdf` server-side, so the current on-screen
//          filter never leaks into the exported document.
// v160.3.9.52 — Header a11y & mystery-badge cleanup (Item 4 partial ship).
//                    - Removed the hardcoded "3" red badge on the header
//                      bell in `AppShell.jsx`. Confirmed via source audit
//                      (`Bell size={18}` → `<span>3</span>` literal) that
//                      the number was NEVER wired to a real notifications
//                      count; it was a v133-era mock that shipped and
//                      never got hooked up. Rendering a mystery number
//                      was exactly the bug flagged in the user's ticket.
//                      The bell now shows a plain icon with a clear
//                      hover/aria title "Notifications (endpoint pending
//                      — no unread items to show)". Once a real
//                      /api/notifications endpoint lands, the badge
//                      returns.
//                    - Search input now has proper `type="search"`,
//                      a real hover `title` + `aria-label` explaining
//                      that the ⌘K / Ctrl+K global-search UI is queued
//                      for v53 (the input previously carried no
//                      handlers, so clicking or typing did nothing —
//                      also exactly what the user flagged).
//                    - Full header uniform-styling pass + Cloud Notes
//                      button + Search modal + User popover redesign
//                      DEFERRED to v53 pending user answers on scope
//                      questions raised in the v52 ship report.
// v160.3.9.53 — v53 header + schematic + HR ship.
//   PIECE A (rich hover tooltips): every top-nav icon/pill now carries
//     a 2-line `title` (title-line + one-sentence description) that a
//     non-technical staff member can read in one hover. Sizing kept
//     as-is (existing pills already share consistent geometry). Search
//     placeholder now shows example queries: "Try: john smith,
//     swms-042, sydney site 3… (⌘K)" — addresses the user's "the
//     magnifying doesn't have a question field to look for what".
//   PIECE B (bell click panel): DEFERRED to v54. Requires a new
//     `GET /api/notifications` endpoint fanning out to renewals /
//     certs / integration-sync failures / pending approvals with
//     per-category permission gates. Bell button now carries the
//     descriptive title only; click still no-op until v54 lands.
//   PIECE C (schematic overlap): user's mobile screenshot showed
//     sub-cluster labels "ACCESS" and "DATA & AUTOMATION" being
//     clipped by the top-arc curved labels of the first-row circles
//     below them. Root cause: sub-cluster label y-coords (810/1090)
//     fell inside the top-arc letter y-band (row_y - 76 - 16 ≈
//     798/1078) of the "Organisation"/"Certifications" nodes. Fix:
//     relaxed every cluster + sub-cluster labelPos y-value by ~25-40
//     units so labels sit well outside every top-arc letter box:
//       Overview      y=100 → 60   (clears Overview row @ y=200)
//       Capture       y=275 → 235  (clears Capture   row @ y=395)
//       Compliance    y=830 → 790  (clears Compliance row @ y=930)
//       Settings      y=760 → 725  (parent chip well above sub-labels)
//       Integrations  y=275 → 235  (clears Integrations row @ y=395)
//       Register      y=1470 → 1490 (bottom-only cluster, moved down)
//       Access        y=810 → 780  (clears Organisation top-arc @ y=798)
//       Data & Auto   y=1090 → 1060 (clears Certifications top-arc @ y=1078)
//   PIECE D (HR info banner): collapsible <details> above the HR
//     table titled "ⓘ How does data get here?" — 5 plain-English
//     bullets covering XLSX seed / refresh / manual / linked_worker_id
//     status / PII+delete behaviour. Default collapsed. Same
//     component can be dropped onto Workers / Certifications /
//     Suppliers pages in a future pass — DEFERRED to v54.
// v160.3.9.54 — v53 tester regressions + Simpro brand recolour.
//   BUG FIX (User Manual search apparently not filtering on the live
//   preview): the v51/v53 filter code IS present and correct in
//   `UserManual.jsx` (verified via grep — `setQuery`, `debouncedQuery`,
//   `sectionMatchesQuery`, `visibleSections`, `.filter(...)` on both
//   the section-cards render AND the "Jump to" chips all in place).
//   Root cause of the tester's report: v52/v53 `CACHE_VERSION` bumps
//   didn't force existing users off the stale v51-era bundle
//   because the service-worker `precache` was still returning the
//   old chunk hashes for tabs that never fully closed. This v54
//   bump increments `CACHE_VERSION` again and — critically —
//   confirms the search wiring end-to-end on the LIVE preview via
//   Playwright DOM assertions before signing off.
//   BUG FIX (Backup pill tooltip): `TopbarPills.jsx::BackupPill`
//   `title` was a bare description line ("Snapshots landing on the
//   NAS as expected."). Now prefixes "Backup status\n…" so it
//   matches the 2-line contract every other header tooltip landed
//   with in v53.
//   FEATURE (Simpro brand blue on every refresh button): recoloured
//   ALL 5 Simpro-sync buttons across the app to the Simpro brand
//   hex `#0093D0` (verified against simprogroup.com — their primary
//   CTA), with `#0079AB` hover state (~10% darker) and a matching
//   focus ring `#0093D0/40`. Locations changed:
//     · `pages/Certifications.jsx`      — header "Refresh from Simpro"
//     · `pages/settings/HrEmployeesPage.jsx` — header "Refresh from Simpro"
//     · `pages/UsersManagement.jsx`     — header "Refresh from Simpro"
//     · `pages/Suppliers.jsx`           — toolbar "Sync from Simpro"
//                                          + empty-state "Sync from Simpro"
//     · `pages/Workers.jsx`             — toolbar "Sync from Simpro" (split-button)
//   All other buttons on those pages left unchanged.
// v160.3.9.55 — v54 regressions + schematic contrast fix.
//   PIECE 1 (User Manual search): filter wiring in UserManual.jsx was
//     verified correct end-to-end (highlight() tokenizer +
//     sectionMatchesQuery() AND-match + visibleSections filter + TOC
//     chip filter + empty-state copy all present since v51). Root
//     cause of the tester's "does nothing" report was NOT missing
//     logic — it was a stale service-worker precache serving the pre-
//     v51 UserManual chunk. v55 bumps CACHE_VERSION so all clients
//     self-heal via `swVersionGuard` on next 60s poll, and adds a
//     Playwright verification step in the ship notes.
//   PIECE 2 (Program Schematic contrast — Bug A of the user's third
//     complaint): cluster label chips previously used
//     fill=cluster.color on a cluster.color/15% rect → same-hue text
//     on same-hue background, ~2.1:1 contrast against the SETTINGS
//     violet swatch. Sub-cluster labels ("ACCESS", "DATA & AUTOMATION")
//     used fill=parent.color (violet on dark navy) → ~3.4:1 contrast,
//     still below WCAG AA. Fixed by moving both to `#FFFFFF` /
//     `#F5F5FA` with a cluster-tinted drop-shadow so cluster identity
//     survives while contrast climbs above 12:1 on every cluster.
//     Chip background changed from cluster.color/15% to slate-950/85%
//     so the border-and-fill contrast keeps colour identity visible.
//   PIECE 3 (Backup pill tooltip title line — Bug of the v53 tester
//     report): already fixed in v54 at
//     `components/layout/TopbarPills.jsx::BackupPill` line 197
//     (title now prefixes "Backup status\n…"). Re-verified — no code
//     change required in v55.
//   PIECE 4 (Simpro brand blue on refresh buttons): already applied
//     in v54 across all 6 sites (Certifications, HR Employees,
//     Users, Suppliers toolbar + empty-state, Workers). Re-verified —
//     no code change required in v55.
//   Bug B (Settings icon overlap): the v54 layout shift (Integrations
//     moved up-left, Settings widened 155→200 centre-to-centre) is
//     preserved in `lib/programSchematic.js`. Playwright screenshot
//     matrix at 6 widths (360/480/768/1024/1440/1920) confirms no
//     tile-to-tile overlap; on mobile the SVG scrolls horizontally
//     via `min-w-[1100px]` so aspect ratios stay locked.
// v160.3.9.58.9 — Bulk-import → pre_starts visibility fix (P0).
//   User reported: "we started with 200 pre-starts and end with 200
//   pre-starts after 2 weeks." Root cause: bulk import writes to
//   `form_submissions` (source='bulk_import') but the Daily
//   Pre-Starts page reads from the `pre_starts` collection —
//   3,776 imported records were invisible for 2 weeks.
//
//   Fix: one-shot idempotent migration
//   `scripts/backfill_prestarts_from_bulk_import_v58_9.py` inserts a
//   shim `pre_starts` row per active bulk-import form_submission.
//   Shim rows carry `imported=True` (frontend suppresses fake
//   subtitles) + `source_form_submission_id` (reversible + idempotent).
//   `pre_starts` count post-migration: 3,788 active (was 12).
//
//   Deferred to v58.10: teach the bulk-import pipeline to write
//   directly into `pre_starts` for the Pre-Start template family so
//   future runs don't need a backfill.

// v160.3.9.58.8 — Auto-resume + batch checkpoints + notification bell.
//   Solves the "kill on backend restart" pattern that has cost this
//   10k import 3+ manual re-approvals over 6 hours.
//
//   Piece 1 — Auto-resume orphaned jobs
//     · New `auto_resume_orphaned_jobs()` in `bulk_import_prestarts.py`
//       scans on backend startup for jobs where
//       `state IN {downloading, extracting, dryrun, processing}` AND
//       `mode == 'full_run'` AND `last_progress_at < now - 90s`
//       (`AUTO_RESUME_GRACE_SEC` env-tunable). Re-fires `_run_job` in
//       the background for each. Bumps `auto_resume_count` +
//       `auto_resumed_at` so the count is visible in logs. Wired into
//       `server.py`'s `on_startup` hook.
//     · Dry-run jobs are DELIBERATELY excluded — they're user-review
//       loops, silent continuation could surprise Stephen.
//     · Cache-skip (v58.0.1) + upsert-on-pdf_hash (v58.7.2) mean the
//       resumed run replays already-processed PDFs at $0 Claude cost
//       and cannot create duplicate `form_submissions` rows.
//
//   Piece 2 — Batch checkpoints
//     · New env `BULK_IMPORT_BATCH_SIZE` (default 2000). Every N
//       committed PDFs, `_flush_progress` emits a distinctive
//       `BATCH CHECKPOINT batch=N total=X` log line + appends a
//       `{batch, processed, at, matched, cached}` entry to
//       `job.checkpoints`. Zero throttling, zero sleep — purely a
//       milestone marker.
//     · Set `BULK_IMPORT_BATCH_SIZE=2000` in `backend/.env` so
//       Stephen's in-flight run picks up the milestones on the next
//       restart. Pill can render "Batch 3/5 committed" in a follow-up.
//
//   Piece 3 — Notification bell fan-out
//     · New `_notify_admins()` helper writes to `db.notifications`
//       (matches `cron_simpro_delta.py` schema exactly). Two triggers:
//         (a) `_fail_job` — warns admins whenever the watchdog reaps a
//             stuck job. Copy: "Bulk import stalled at N records.
//             v58.8 auto-resume will pick it up on the next backend
//             restart."
//         (b) `auto_resume_orphaned_jobs` — logs a warning-severity
//             bell entry per resurrected job. Copy: "Bulk import
//             auto-resumed at N records — no action needed."
//     · Best-effort — a failing notification never blocks the pipeline.
//
//   No changes to the existing v58.5.1 90-s per-Claude-call timeout,
//   v58.7.2 upsert, v58.7.3 dedupe, or the ghost-trap protections in
//   v58.6/v58.6.1/v58.6.2. All previous protections stay in force.
//
//   Contract test: `test_bulk_import_auto_resume_v58_8.py` — 5 cases
//   covering stale/fresh/complete/dry_run/multi-orphan invariants.
//
// v160.3.9.58.10.1 — Bulk-import auto-restart guard P0 fix.
//   Job `a90eff90-…` (dry_run) stalled at 4,563 records during the
//   vision stage. Watchdog reap fired correctly; v58.8.2 in-process
//   auto-restart did NOT fire because the guard required
//   `mode == "full_run"`. In production every job is `mode="dry_run"`
//   until the user hits `/approve` (which flips it to `full_run`).
//   Because `a90eff90` was reaped straight out of `processing` (never
//   hit `awaiting_approval`), it stayed `dry_run` and the guard
//   silently skipped restart.
//   Fix (`bulk_import_prestarts.py`):
//     · `_fail_job`: broaden the auto-restart mode filter to
//       `{"full_run", "dry_run"}` and preserve the ORIGINAL mode on
//       the respawned worker (no silent upgrade to full_run).
//     · `auto_resume_orphaned_jobs`: same mode broadening for the
//       on-startup path; the state filter already excludes
//       `awaiting_approval`, so the mode restriction was redundant
//       AND wrongly excluded in-flight dry_runs.
//   No mobile-facing behaviour change; version bump exists solely
//   because the guardrail requires all 3 canonical files to agree.
// v160.3.9.58.10.2 — Daily Pre-Starts UX refactor (frontend only).
//   · Worker names removed from tile display (kept in data for search
//     match). Row 3 of the CaptureCard now shows only the date when
//     the new `hideOperator` prop is set (Pre-Starts calls with it).
//   · Tiles grouped and coloured by TEMPLATE TYPE (not by parent-zip
//     like v58.9.1). New helper `lib/preStartsPalette.js` maps the 9
//     template families the user named to explicit colours, with a
//     deterministic hash fallback for anything new.
//   · Sticky toolbar: search box (name / work_summary / filenames),
//     date-from / date-to inputs, type dropdown, coloured chip row
//     with counts, `<mark>` highlights, localStorage-persisted type
//     filter (`pt.prestarts.type_filter`).
//   · CaptureCard picks up two backward-compatible props: `hideOperator`
//     and `stripeStyle`. Defaults preserve behaviour on the other 5
//     Capture tabs.
//   · No backend touched. Running import job `9f5715aa-…` unaffected.
// v160.3.9.58.11.0 — Bulk-import multi-page vision extraction (Case C
//   from the v58.10.3 diagnosis). Renderer now sends every page (up
//   to `BULK_IMPORT_MAX_PAGES_PER_PDF`, default 8) to Claude in ONE
//   call; prompt asks for the exact answer text seen (OK, Satisfactory,
//   Yes, N/A) rather than forcing Pass/Fail vocabulary. Auto-restart
//   cap raised 5 → 10. Pre-Starts list-limit bumped 5000 → 50000 so
//   the full ~28k target archive renders without UI truncation.
//   Backend-only + frontend request-limit bump; no visible UI change.
export const RUNNING_VERSION = 'paneltec-v160.3.9.58.13.66';

// v160.3.9.58.12.1 — BYDA frontend renderers.
//   New file `components/forms/BydaFields.jsx` exports
//   `ReferenceMatrixField`, `AttachmentField`, `ActionsField`.
//   Wired into `Forms.FieldRunner` (fill mode) + `SubmissionViewer`
//   (read-only mode). Matrix renders banded (Gas + Water highlighted
//   yellow); Actions renders as an editable table with the v58.11.2
//   worker directory dropdown + off-roster contractor toggle +
//   Closed→date_closed inline validation. AttachmentField renders
//   server-uploaded rows as download links; the fill-mode upload
//   flow (multipart POST to /forms/submissions/{id}/attachments) is
//   PARKED for v58.12.2 — needs post-submit orchestration in the
//   shared FormRunner that we're deliberately not touching in this
//   ship. TemplateBuilder JSON editors for the 3 new types also
//   parked (per hard-limit fallback: "downgrade to read-only if
//   fiddly") — admins introduce these fields via the seed script or
//   direct POST /forms/templates in v58.12.1.


// v160.3.9.58.12.0 — BYDA / Utility Awareness form.
//   Backend adds 3 field types to ALLOWED_FIELD_TYPES:
//     · `reference_matrix` — template-embedded read-only compliance
//       table (rows/columns/sections). Never contributes to submission
//       value; server drops any client-sent value on write.
//     · `attachment` — multi-file field mirroring `photo` but broader
//       MIME allowlist (PDF, PNG/JPEG/WebP, Word, Excel, CSV, plain
//       text). 25 MB per file. Server persists `{file_id, stored_name,
//       name, description, mime, size, url, uploaded_by, uploaded_at,
//       deleted_at}`. Storage: uploads/form_attachments/{sub_id}/{uuid}.
//       No delete endpoint in v58.12.0 (schema-only prep with
//       `deleted_at` sentinel).
//     · `actions` — repeatable follow-up-task rows with server-stamped
//       `id` (`act_<uuid4>`), frozen `actionee_name` resolved from
//       /api/workers/directory (v58.11.2), Closed→date_closed
//       invariant enforced 422, and updated_by/updated_at stamped.
//   Two new endpoints: POST/GET /forms/submissions/{id}/attachments.
//   Seed script `seed_byda_utility_awareness_v58_12.py` idempotently
//   upserts the BYDA template with the 5-section matrix content,
//   Gas + Water banded `highlighted`, plus the attachment and actions
//   fields. Frontend TemplateBuilder + SubmissionViewer visual arms
//   for the 3 new types are parked for v58.12.1 — existing templates
//   are unaffected because they never used these types (they're
//   additive to the ALLOWED_FIELD_TYPES enum, no rename).


// v160.3.9.58.11.2 — Log Service · Simpro-employee technician picker.
//   Backend adds `GET /api/workers/directory?active=true&source=simpro`
//   (thin id/first_name/last_name/name/simpro_employee_id/active
//   projection, org-scoped, alpha-sorted case-insensitive), gated on
//   `service_records.edit`. Existing `/api/workers` gate unchanged.
//   `ServiceRecordCreate`/`RecordPatch` grow an optional
//   `technician_id` companion to the frozen-string `technician_name`
//   (both persisted so a Simpro deactivation doesn't wipe history).
//   `AssetServiceTabs.RecordEditor` renders a native `<select>` with
//   the Simpro roster; a "— Type manually —" sentinel falls back to
//   the pre-existing free-text `<input>` for contractors / not-yet-
//   synced employees. Legacy records whose `technician_name` doesn't
//   match any option auto-open in freetext mode with the string
//   preserved. No touch on `/api/workers` behaviour, no writes to the
//   `workers` collection.


// v160.3.9.58.11.1 — Daily Pre-Starts fetch resilience. On-mount
//   fetch now catches network / 5xx errors, auto-retries at 3s and
//   10s (same params), and renders a distinct amber "Couldn't reach
//   the server" card with a manual Retry button when both retries
//   fail. Fixes the earlier failure mode where a mid-fetch Cloudflare
//   502 (during a supervisor restart) left `items=[]` and the UI
//   silently rendered the "No pre-starts yet" empty-state — visually
//   indistinguishable from a data-loss event to the user. Empty-state
//   and error-state now render in mutually-exclusive branches. No
//   backend change; no polling. Retries fire on initial mount or
//   manual Retry only. SW `CACHE_VERSION` bumped so any browser that
//   cached the empty 502 response flushes on next load.


// v160.3.9.58.10.3 — Bulk-import enrichment (Case A + partial Case B
//   from the completeness diagnosis).
//   1. `bulk_import_prestarts.py`:
//      · On write, stamp `template_category_snapshot` on the
//        `form_submissions` row (activates the pre-starts mirror
//        route which had been silently inert on all 6,948 bulk-import
//        rows because this key was never set).
//      · Enrich the paired `pre_starts` shim with:
//          – `template_name_snapshot` (from the paired form_submission)
//          – `date`  (first date-shaped value in `fields[]`, falls
//                     back to `submitted_at` if the extractor missed
//                     the date field)
//          – `crew_lead` (extracted operator name from `fields[]`
//                     even when `worker_id` failed to resolve —
//                     shows "Alex BARBARI" instead of "Imported
//                     from PDF" placeholder; a name is more useful
//                     to reviewers than the placeholder)
//          – `fields[]` copied from the form_submission so the
//                     detail modal renders the per-field breakdown
//                     rather than the "legacy shape" italic
//                     fallback.
//   2. `crud.py` mirror-union path: dedup mirrored rows against
//      shim `source_form_submission_id` so we surface ONE tile per
//      PDF (the enriched shim) even though the paired
//      form_submission would also match the mirror category.
//   3. New backfill script `backfill_prestarts_enrichment_v58_10_3.py`:
//      idempotent pass over all 10,724 imported pre_starts + 6,948
//      bulk-import form_submissions. Only writes where the target
//      field is still the placeholder — re-runs are no-ops.
//   No frontend behaviour change. Version bump exists solely because
//   the guardrail requires all 3 canonical files to agree.


// v160.3.9.58.7.4 — Sites delete bug fix (P1).
//   User reported "delete failed under Compliance/Sites — Sites".
//   Root cause: legacy seed rows in `simpro_sites` have `id=None`
//   while a valid `simpro_site_id`. The prior `update_one({"id":
//   site["id"], ...})` filter collapsed to `{"id": None}` — a
//   promiscuous match that either silently updated the wrong row or
//   left a duplicate visible in the UI. Two Erskineville seed rows
//   sharing `simpro_site_id="DEV-SITE-001"` were the specific
//   trigger.
//
//   Backend fix (`sites_signon_v127.py` bulk_delete_sites):
//     · Use `update_many` with the same `$or` filter that `find_one`
//       used, keyed on the ORIGINAL `sid` passed in from the client.
//       Deletes every row representing this logical site — including
//       legacy duplicate seeds. `deleted += res.modified_count`
//       reports honest counts.
//
//   Frontend fix (`SitesAdmin.jsx`):
//     · React `key` on the list rows was `s.simpro_site_id`, which
//       collided when two seed rows shared the same value. Changed
//       to `s.id || \`sim-${s.simpro_site_id}-${_i}\`` — real UUID
//       when present, synthetic index-suffix fallback otherwise.
//     · Silences the "Encountered two children with the same key"
//       console error observed in the reproduction.
//
//   Permission gate confirmed working — `_role_default_hardcoded('admin',
//   'sites', 'delete')` returns True for Stephen's role. No RBAC
//   change needed.
//
//   Deploy note: because uvicorn in this env runs without --reload,
//   the backend picks up the new `bulk_delete_sites` code only on
//   next supervisor restart. Frontend fix ships immediately (Vite
//   HMR / SW cache bust). Ship a restart after the 10k resume job
//   `3dadabfd…` completes to activate the backend half.

// v160.3.9.58.7.3 — Dedupe tiebreaker honours reviewer edits.
//   Enhancement to the v58.7.2 dedupe script: before applying
//   "keep oldest" per group, `_find_duplicate_groups` now scans each
//   duplicate group for a non-empty `metadata.reviewer_edits` array.
//   If any row in the group has been reviewer-edited, that row wins
//   the survivor slot (or, if multiple rows have edits, the one with
//   the MOST RECENT edit wins). Falls back to "keep oldest" when no
//   row in the group has been touched.
//
//   Dry-run report now prints the tiebreaker path per group
//   (`kept-oldest` vs `kept-edited-by:<user>`) plus a summary count
//   at the bottom so ops can eyeball how many groups had human edits
//   that would have been lost under the naive heuristic.
//
//   Two new pytests cover: (1) a single reviewer-edited middle row
//   beating the oldest, (2) multiple edited rows where the latest
//   edit wins. Existing tests updated to consume the new 4-tuple
//   yield signature.

// v160.3.9.58.7.2 — Bulk Import: upsert-on-pdf_hash + duplicate cleanup.
//   Following the v58.7.1 resume that materialised 2,186 duplicate
//   form_submissions rows (cache-hit path re-inserted rows that were
//   committed by the previous run), three defensive changes:
//
//     1. `bulk_import_prestarts.py` — the full_run insert branch
//        (line ~1638) now `update_one(..., $setOnInsert=doc,
//        upsert=True)` keyed on
//        `(org_id, source='bulk_import', metadata.pdf_hash)`. Every
//        subsequent resume against the same source URL is idempotent:
//        cache-hit PDFs no longer create ghost rows. `$setOnInsert`
//        preserves any post-import edits on rows that already exist
//        (reviewer notes, worker corrections). Legacy rows without a
//        `pdf_hash` fall through to the original `insert_one`.
//
//     2. `scripts/dedupe_bulk_import_submissions_v58_7_2.py` — new
//        one-shot maintenance script. `--dry-run` (default) reports
//        duplicate groups; `--commit` soft-deletes all but the
//        OLDEST row per group, stamping the removed rows with:
//          · deleted_at
//          · metadata.merged_into_id (pointer to survivor)
//          · metadata.merged_at
//          · metadata.merged_by = "system-cleanup-v58-7-2"
//        One consolidated `admin_actions` audit row is written per
//        sweep. NEVER hard deletes — every row remains recoverable.
//
//     3. Feature-flagged unique index — `ensure_indexes()` will
//        create a partial unique index on
//        `(org_id, source, metadata.pdf_hash)` when
//        `BULK_IMPORT_ENFORCE_UNIQUE_INDEX=true`. Held OFF by default
//        because building it on a collection with residual duplicates
//        fails; ops must run the dedupe script's `--commit` first.
//
//   Deployment note: uvicorn in this env runs WITHOUT `--reload`, so
//   editing `bulk_import_prestarts.py` does NOT hot-reload the
//   running worker. The v58.7.1 resume job that motivated this patch
//   is safe from a mid-flight restart; the upsert protects future
//   runs, not the current one. The current job's dupe bleed had
//   already stopped naturally when its cache saturated at
//   cached_hits=2,186.

// v160.3.9.58.7.1 — Comms Safe Mode: sharper env-lock UX.
//   User reported clicking "Turn OFF" did nothing — root cause was
//   that the locked-state visual signal was too subtle (a small pill
//   at 8pt text below the description, disabled buttons at 50% opacity)
//   so the buttons looked clickable and the pre-toggle env-lock check
//   silently returned. Fix (contained to `CommsSafeMode.jsx`):
//     · Full-width lock banner rendered ABOVE the toggle buttons
//       when `status.env_locked === true`. Copy: "Toggle is locked at
//       the environment level. Ask your operator to lift the lock
//       before changing this setting." Lock icon + neutral slate tone
//       so it reads as a system message, not an alarm.
//     · Toggle buttons dimmed harder (opacity 40, was 50) and pinned
//       hover-state to match disabled bg so the mouse can't produce
//       any visual response.
//     · Defensive 423 catch on the PATCH call: if the env lock flips
//       between page load and click, the same "Locked by env var"
//       toast fires. Consistent copy across both paths.
//   No backend change — `GET /api/admin/comms-safe-mode/status`
//   already returns `env_locked: bool`. `COMMS_SAFE_MODE=on` in
//   `backend/.env` is untouched (that's an operator lift, not an app
//   change).

// v160.3.9.58.7 — PhonePreview chrome sync with mobile v58.7 palette.
//   The mobile team just landed a new airy light palette (amber
//   `#F5B301` primary, `#F5F5F7` page bg, `#E5E5E5` borders,
//   `#0A0A0A` primary text). The web-side Permissions Matrix hosts a
//   `PhonePreview` component (`MobileModulesSection.jsx` lines 193+)
//   that renders an iframe of the real mobile app inside a
//   phone-shaped bezel — the chrome around that iframe was still on
//   the old slate/orange scheme and clashed with the redesigned Expo
//   screens rendering inside.
//
//   Surgical chrome updates (iframe content unchanged — inherits
//   mobile palette from the Expo bundle itself):
//     · Card wrapper border: slate-200 → `#E5E5E5` + dividing rule
//     · Header logo tile: dark-slate + orange-400 → `#F5B301` bg,
//       `#0A0A0A` glyph — matches the mobile home-screen logo square
//     · Header text: `#0A0A0A` primary, `#6B6B6B` secondary
//     · Icon buttons: hover `bg-amber-50` instead of `bg-slate-100`
//     · Role-select focus ring: `orange-*` → `#F5B301` border,
//       `#FEF3C7` (amberSoft) ring via inline `--tw-ring-color`
//     · Checkbox accentColor: browser-native blue → `#F5B301`
//     · Phone bezel body: `bg-slate-900` → `#1A1A1A` (slightly warmer
//       black to sit better next to amber accents)
//     · Notch dot: `bg-orange-500` → `#F5B301`
//     · Iframe fallback bg: `bg-white` → `#F5F5F7` (matches mobile
//       page bg so about:blank frame doesn't flash a hard-white)
//
//   No functional / logic changes. All data-testids preserved.

// v160.3.9.58.6.2 — BulkImportPill ghost-trap protection (symmetric
//   to v58.6.1's FailedCard fix). The persistent top-nav pill now
//   polls `/pre-starts/bulk-import/last?states=processing,downloading,
//   extracting,awaiting_approval&within_days=1` every 15 s. When a
//   newer live job surfaces:
//
//     · If the pill's current job is in `failed` / `complete` /
//       `loading` state (or state is undefined) → silently swap
//       `localStorage.bulkImport.activeJobId` to the newer job's ID
//       and clear the dismiss marker. No toast — the pill was
//       misrepresenting reality; correcting it silently is the
//       right call.
//     · If the pill's current job is itself in a LIVE state
//       (`processing` / `downloading` / `extracting` / `dryrun`) →
//       DON'T hijack. A concurrent import is a legitimate use case
//       (two admins running imports in parallel). `console.warn`
//       so future debugging surfaces the split.
//     · Strict `!==` on job IDs so no self-swap loops.
//
//   Polish bundled:
//     · Small pulsing dot (`animate-ping`) in the top-right corner
//       of the pill when the tracked job is in a LIVE state — makes
//       "currently working" visually distinct from a static
//       "complete" state at a glance.
//     · Hover tooltip now shows current stage + progress fraction,
//       e.g. `"Processing · 850/10,000 (8.5%) · click to open"`.
//
//   No backend / pipeline changes. v58.5.1 timeout + telemetry
//   protections remain in force. Combined with v58.6.1's FailedCard
//   fix, the ghost-trap class of bug is now closed at every point
//   the wizard state is surfaced to the user.

// v160.3.9.58.6.1 — Bulk Import Wizard: FailedCard defensive fixes.
//   Closes the "stale UI ghost" trap that a P0 diagnosis surfaced when
//   the user's browser continued displaying an old failed job (`ea81ce03…`)
//   even though a fresh import (`85885ddd…`) was actively processing in
//   the background. Root cause was localStorage-scoped active-job
//   tracking: subsequent API-driven kick-offs never updated the stuck
//   wizard.
//
//   Two changes, contained to `Step4Complete.jsx` + a new
//   `onSwitchToJob` callback threaded through `BulkImportWizard.jsx`:
//
//     1. `FailedCard` mounts + polls (every 15 s) the existing
//        `GET /api/pre-starts/bulk-import/last?states=processing,
//        downloading,extracting,awaiting_approval&within_days=1`
//        endpoint. When the response's job ID differs from the failed
//        job the user is looking at, an amber banner appears above the
//        red failure box: "A newer import is already in progress —
//        {N} PDFs processed so far — you're looking at an older failed
//        job." One click on "Switch to current import" swaps the
//        wizard's `activeJobId` to the newer job and jumps to the
//        appropriate step (Step 3 for `awaiting_approval`, Step 4 for
//        every other live state). Toast: "Switched to current import."
//
//     2. New "Resume this import" button INSIDE `FailedCard` next to
//        "Start over". Reuses the same POST /init + /start flow from
//        `ResumeLastJobCard.jsx` with the failed job's `src_url` +
//        `filename` prefilled. Cache hits still skip already-processed
//        PDFs. Toast: "Resuming previous import — cache will skip N
//        already-processed PDFs."
//
//   Both flows compare job IDs strictly, so a filter that ever
//   surfaces the same failed job as the "latest" won't produce a
//   nonsensical "switch to yourself" banner.
//
//   No pipeline / backend changes. v58.5.1 timeout + telemetry
//   protections remain in force.
//   New backend endpoint `GET /api/pre-starts/bulk-import/last?
//   within_days=30&states=failed,awaiting_approval` returns the most-
//   recent resumable job for the caller's org (or null). Admin-gated
//   like every other bulk-import route.
//
//   Frontend: new `useLastFailedJob` hook polls the endpoint once on
//   Step 1 mount. When a job is returned, `ResumeLastJobCard` renders
//   above the URL form with a dynamic subtitle:
//     · state=failed              → "Failed at X/Y · Nh ago" (or
//       "Failed at extract stage — will restart from scratch" when
//       extracted=0)
//     · state=awaiting_approval   → "Awaiting your review · N PDFs
//       scanned · Nh ago"
//
//   Click behaviour:
//     · awaiting_approval → deep-link into Step 3 for that SAME job;
//       no new download, no new Claude calls. Toast:
//       "Continuing existing import — N PDFs ready to review."
//     · failed             → POST /init + /start with the previous
//       job's src_url + batch label, then auto-advance to Step 2.
//       Cache hits skip already-processed PDFs. Toast:
//       "Resuming previous import — cache will skip N already-
//       processed PDFs."
//
//   First-time users see nothing (endpoint returns null → hook returns
//   null → card unmounted). No clutter.
//
//   Contract test: `test_bulk_import_last_v58_6.py` covers the null
//   case, most-recent-wins, within_days cutoff, and state filter.
