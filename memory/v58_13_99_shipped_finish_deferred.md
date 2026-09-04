# v58.13.99 — Shipped (finish tool deferred)

**Status**: SHIPPED from user's side per explicit acknowledgement (Option A).
**Date**: 2026-09-04.
**Reason `finish` tool not called**: Platform pre-completion checker
treats 20 pre-existing `ephemeral-upload-storage` warnings as blocking.
Under user's standing directive, those are DEFERRED to a future
v58.14.x object-storage migration ship — they predate v58.13.99 and
are unrelated to any change in .99.

## Ship scope delivered

Single deliverable: **Sign-in error classifier — 5xx / 520 / network-down
stops masquerading as "Invalid password".**

### Root cause (from the v58.13.94 investigation)
`Cover.jsx::doLogin` (and the deprecated `Login.jsx::submit`) collapsed
every axios rejection into `'Invalid email or password'` unless the
error message contained the substring "disabled". No HTTP status
introspection. So a 502 / 503 / 504 / 520 Cloudflare origin error, or
a network-offline / DNS failure, ALL rendered as "bad credentials".
During the CF 520 / prod-OOM incidents that culminated in the .98
deferred-startup ship, users hammered the sign-in form and reported
"my password stopped working". This ship kills that failure mode.

### Fix — `/app/frontend/src/lib/api.js`
NEW `classifyAuthError(err)` returns `{ kind, message }`:
- **`server_down`** — no `err.response` (offline, DNS, timeout, CORS
  preflight failure, LB drop) OR status in 500..599 (covers 502, 503,
  504, 520). Message: "Sign-in is temporarily unavailable. The server
  may be down or restarting — please try again in a moment."
- **`rate_limit`** — status 429; delegates to `apiError` so the
  v58.13.88 retry_after_seconds copy is preserved verbatim.
- **`disabled`** — `x-auth-reason: account-disabled` header OR backend
  detail matches `/disabled/i`. Kept ABOVE the 401/403 branch so a
  legitimately disabled account never gets the misleading
  "Invalid password" copy.
- **`credentials`** — 401 / 403. Message: "Invalid email or password.
  Please try again."
- **`validation`** — 422 or other structured 4xx.
- **`unknown`** — falls back to `apiError(err)` or a generic
  "Could not sign in. Please try again." Never hardcodes "Invalid
  password" — the whole point of the ship.

`apiError` is **untouched**. 40+ callers across the app rely on its
existing shape; changing it would be a surprise-regression vector.
Regression guard: `test_apierror_still_handles_429_verbatim` pins
that the 429 short-circuit + retry_after_seconds copy from .88
survives verbatim.

### Wire-in
- `frontend/src/pages/Cover.jsx::doLogin` — one-line switch to
  `classifyAuthError(err).message`. The old
  `msg.toLowerCase().includes('disabled')` string check is deleted
  (now handled inside the classifier via `x-auth-reason` first,
  backend detail second).
- `frontend/src/pages/Login.jsx::submit` — same switch. Legacy
  surface (deprecated but on disk per its own header) kept in
  lock-step to prevent a future re-route silently reintroducing
  the misclassification.
- `frontend/src/pages/Login.jsx::submitSimpro` — same classifier;
  falls back to the Simpro-specific default only on `kind='unknown'`.

### Wire proof (live curl through preview backend)
```
POST /api/auth/login  {"email":"stephen@…","password":"WRONG"}
  → HTTP 401
  → {"detail":"Invalid email or password"}
  → classifier maps to kind='credentials'
  → Cover renders "Invalid email or password. Please try again."
```
5xx / 520 / offline paths are covered by the classifier's static
branch ordering (source-pinned by the pytest — 5xx branch
appears BEFORE credentials branch), so a downed backend now renders
"Sign-in is temporarily unavailable. The server may be down or
restarting — please try again in a moment." instead of accusing the
user of a bad password.

### Tests
NEW `tests/backend_unit/test_login_error_classifier_v58_13_99.py`
(18 source-pin tests, matches the .98 / .97 / .84 pattern):
- `classifyAuthError` is a named export.
- No-response path returns `server_down`.
- 5xx branch appears BEFORE the credentials branch in the source
  (regression guard: swapping the order would silently reintroduce
  the bug).
- 429 delegates to `apiError` (retry_after_seconds preserved).
- `disabled` branch appears BEFORE the credentials branch (regression
  guard: same class of bug).
- 401 / 403 map to `credentials` with the exact "Invalid email or
  password. Please try again." copy.
- 422 maps to `validation`.
- `unknown` fallback never hardcodes an "Invalid password"-like
  string (the whole point of the ship).
- `apiError` unchanged — its 429 short-circuit + fallback logic
  from .88 still intact.
- `Cover.jsx` imports `classifyAuthError` and NO LONGER contains
  the raw `.toLowerCase().includes('disabled')` string check.
- `Login.jsx::submit` catch uses `classifyAuthError(err)`.
- `Login.jsx::submitSimpro` catch uses `classifyAuthError(err)`.
- Version-sync forward-safe pin >= 99 for RUNNING_VERSION,
  CACHE_VERSION, MOBILE_BUNDLE_VERSION.

**Full pytest suite: 605 passed, 1 skipped, 0 regressions**
(was 587 pre-ship; +18 new tests, zero regressions in the 587-test
baseline). Webpack compiled with 110 pre-existing warnings, none
from touched files.

### Version bumps (all 3 canonical strings → paneltec-v160.3.9.58.13.99)
- `frontend/src/lib/version.js#RUNNING_VERSION` (+ full changelog
  block prepended above the export line).
- `frontend/public/service-worker.js#CACHE_VERSION` (bump also
  forces the SW cache to roll so the new bundle is served fresh on
  the next page load).
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION`.

### NOT changed (deferred per user directive)
- Backend `/auth/login` handler — same shape, same status codes.
  The classifier only changes what the FRONTEND does with the same
  responses.
- `apiError` behaviour for its 40+ existing non-auth callers.
- `/app/mobile/` code (only `MOBILE_BUNDLE_VERSION` bumped; no
  `.tsx` / `.ts` code changes per the strict mobile rule).
- The 20 pre-existing `ephemeral-upload-storage` lint warnings
  (still parked for v58.14.x object-storage migration).
- Rate-limit UX (429 already surfaces `retry_after_seconds` via
  the .88 rate-limit ship; classifier delegates to that path).
- `CommsSafeMode` UI pill (from .92-.97), deferred startup (from
  .98), `@safe_admin_endpoint` wrapper (from .91), or any other
  prior ship.

## Item disposition — original two-item brief

The v58.13 handoff brief specified two items:
1. **Deferred startup work** — **ALREADY SHIPPED IN v58.13.98**
   (previous session). Verified live in `backend/server.py` lines
   671-1266: `async def _deferred_startup_work()` scheduled via
   `_dsw_asyncio.create_task(_deferred_startup_work())`. All heavy
   migrations (v26, v45, v46), Simpro/Navixy syncs, meter_history
   backfill, and backup catch-up are inside the deferred coroutine.
   Fast bootstrap (indexes, session_history, role seeds) stays
   synchronous. Existing `test_deferred_startup_v58_13_98.py` pins
   the structure.
2. **Login.jsx 5xx-vs-401 distinction** — **SHIPPED IN v58.13.99**
   (this session). Details above.

Both items complete. No .100 queue item needed for the two-item brief.

## Rollout plan
- **PREVIEW**: Auto-picks up via frontend hot-reload; no backend
  restart needed. New SW cache version rolls on next full page load.
- **PROD**: User completes Launch-tier upgrade (2 GB) and Re-publishes
  when ready. .98 (deferred startup) + .99 (classifier) ship together
  on the same bundle. On first prod load with .99 live, verify:
  - Footer version reads `.99`.
  - Deliberately kill the backend (or wait for a real 5xx) and
    hit the sign-in form → expect "Sign-in is temporarily
    unavailable…", NOT "Invalid email or password".
  - Actual bad password → still "Invalid email or password. Please
    try again."
  - Pre-starts loads, Safe Mode pill correct (from .98).

## Next roadmap items (in the user's stated priority order)
- **P1**: Wire `comms_safe_mode.edit` grant/revoke into the Users &
  Permissions matrix UI checkbox so admins don't have to use API
  directly.
- **P1**: Address the "Vehicle Unmatched" taxonomy discrepancies
  from `vehicle_unmatched_audit_v58_13_97.md`.
- **P2**: Rate-limit exhaustion during full pytest suites — implement
  `TEST_MODE_BYPASS_RATE_LIMIT` env toggle in `backend/rate_limit.py`.
- **P2**: Compile-time guard `frontend/scripts/check-routes.js` to
  ensure every `<Link to="X">` path exists in `App.js`.
- **Future**: Object-storage migration ship as **v58.14.x** — clears
  the 20 currently-blocking `ephemeral-upload-storage` warnings and
  unblocks the `finish` tool.
- **Paused hygiene chain**: `useCallback` + module constants; array
  index keys → stable IDs; TTL indexes + `expires_at` BSON Date fields
  on monotonic DB collections; Track 2 ZIP-mode PDF re-extraction.
