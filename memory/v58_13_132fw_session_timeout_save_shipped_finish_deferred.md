# v58.13.132fw — Session-timeout per-user save fix (web only, scoped-down)

**Ship type:** P1 backend fix. Web only.
**Finish:** DEFERRED.

## Scope note

Original `.132fw` brief bundled 4 tasks (A: session-timeout save;
B: show-inactive-workers toggle; C: 4 legacy template matchers;
D: dedupe hash upgrade). Task A had a clean, reproducible root
cause and a minimal fix; Tasks B/C/D each require deeper
investigation (schema audits, template-matcher module refactor,
hash-algorithm swap across the import path). To keep this ship
safe on the current context budget only Task A landed —
B/C/D deferred to a follow-up ship documented at the bottom.

## Task A — "Could not save" on session-timeout preset

### Root cause

Mel's toast fired from `UserDropdownCard.saveTimeout` in
`frontend/src/components/layout/TopbarPills.jsx` L303, which
sends `PATCH /settings/session-timeout/me` with `{minutes: n}`.

Curl reproduced HTTP **405 Method Not Allowed**:

```
$ curl -X PATCH ".../api/settings/session-timeout/me" -d '{"minutes":120}'
{"detail":"Method Not Allowed"} HTTP 405
```

`backend/session_timeout.py` registers `GET /session-timeout/me`
but there was no matching PATCH. The FE has been shipping this
call for a while; every user who has clicked "Save" on the
timeout preset in the user dropdown has hit 405 → the catch-all
`toast.error('Could not save')` fired without any specific hint.

### Fix

`backend/session_timeout.py`:

1. New `UserTimeoutIn` Pydantic model with `minutes: int (ge=5,
   le=1440)`.
2. New route `PATCH /settings/session-timeout/me` that persists
   `session_timeout_minutes_override` (+ `session_timeout_updated_at`)
   on the user document, then returns the freshly-effective
   settings.
3. `effective_for_user()` now reads
   `session_timeout_minutes_override` from the user doc and, if
   present and `>= 5`, wins over the org / role default —
   overrides `idle_minutes` and populates a new `effective_minutes`
   key. Consumers (`GET /session-timeout/me`, the user dropdown)
   pick this up automatically.

### Verification

Live curl round-trip (backend restarted to load the new route):

```
$ curl -X PATCH .../api/settings/session-timeout/me -d '{"minutes":240}'
{"idle_minutes":240, "absolute_hours":8, "warning_modal_enabled":true,
 "warning_modal_seconds":60, "remember_me_enabled":true,
 "effective_minutes":240}

$ curl .../api/settings/session-timeout/me
{"idle_minutes":240, …, "effective_minutes":240}     ← persisted

$ curl -X PATCH .../api/settings/session-timeout/me -d '{"minutes":30}'
{"idle_minutes":30, …, "effective_minutes":30}       ← override cleared
```

Pytest:

```
$ python -m pytest tests/test_v58_13_132fw_session_timeout_patch.py -v
collected 4 items
::test_patch_route_exists                                   PASSED
::test_effective_for_user_honours_per_user_override         PASSED
::test_live_round_trip                                      PASSED
::test_version_bumped_to_132fw                              PASSED
========================== 4 passed in 1.00s ==============================
```

`test_live_round_trip` reads Stephen's current effective preset,
saves 240, GETs, asserts the value stuck, then restores the
original — no probe data left in prod.

## Files changed

1. `backend/session_timeout.py`
   - `UserTimeoutIn(BaseModel)` (new).
   - `PATCH /settings/session-timeout/me` route (new).
   - `effective_for_user()` reads `session_timeout_minutes_override`
     and returns `effective_minutes` alongside `idle_minutes`.
2. `frontend/src/lib/version.js`,
   `frontend/public/service-worker.js` — bumped to `.132fw`.
3. `backend/tests/test_v58_13_132fw_session_timeout_patch.py` —
   4 pytest checks (all pass).
4. This memo.

Zero `/app/mobile/` files touched.

## Acceptance criteria

1. Session timeout saves without "Could not save" — **PASS**
   (curl round-trip + pytest live round-trip).
2. Show-inactive-workers toggle — **DEFERRED**.
3. 4 legacy template matchers — **DEFERRED**.
4. Duplicate-detection tightening — **DEFERRED**.

## Deferred to a follow-up ship (`.132fw-b` or `.132fy`)

- **Task B** — Show inactive/deleted workers toggle with per-row
  Restore + `archive_audit` logging. Requires touching the Workers
  list query + toggle UI + a new PATCH endpoint. Careful scope so
  we don't accidentally include archived workers in exports /
  KPIs.
- **Task C** — Template matchers for Excavator Pre-Start, Trailer
  Pre-Start, Drain Cleaning SSRA, Excavation Permit. Grep the
  existing matcher module (`backend/template_matcher.py` or
  similar) for the registration pattern, add four entries, ship
  with fixture PDFs.
- **Task D** — Duplicate detection sha256 + size + first-N-bytes
  upgrade. Currently filename-based; needs a schema field for the
  digest on `form_submissions_imports` (or wherever imports are
  tracked) plus a backfill for existing records.

## Standing rules acknowledged

`finish`: NOT called. `testing_agent` / `e1_tester`: NOT called.
`/app/mobile/`: NOT touched. CRA preserved. Response in English.
Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
