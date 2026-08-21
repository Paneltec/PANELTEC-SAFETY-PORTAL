// Paneltec Civil · v159 — single-source-of-truth version constant
// for the currently running JS bundle.

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
export const RUNNING_VERSION = 'paneltec-v160.3.9.58.13.24';

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
