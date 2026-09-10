# v58.13.132db — Pre-commit lint hardening + mobile data endpoints — SHIPPED (finish deferred)

## Part 1 — Pre-commit lint hardening

### Diff of `backend/scripts/check_version_files_v58_8_1.py`

Extended the existing 3-slot guard to a **4-slot strict-equality guard** and added the `MOBILE_VERSION_SYNC_OPTIONAL` escape hatch:

| Slot | File | Pattern | Kind |
|---|---|---|---|
| `RUNNING_VERSION` | `frontend/src/lib/version.js` | `^export const RUNNING_VERSION` | strict |
| `EXPECTED_CACHE_VERSION` | `frontend/src/lib/version.js` | `^export const EXPECTED_CACHE_VERSION` | strict |
| `CACHE_VERSION` | `frontend/public/service-worker.js` | `^const CACHE_VERSION` | strict |
| `MOBILE_BUNDLE_VERSION` | `mobile/src/lib/version.ts` | `^export const MOBILE_BUNDLE_VERSION` | mobile (soft) |

**Escape hatch:** `MOBILE_VERSION_SYNC_OPTIONAL=true` demotes mobile-lag from **error** to **warning**. This lets the web-side agent ship while the Expo specialist bumps the mobile version on their own cycle (typically one letter behind).

**Fail-loudly message added:** when the strict slot mismatches, the hook prints the full mapping + the specific ship note:
```
MISMATCH (MOBILE): mobile lags — web='paneltec-v160.3.9.58.13.132db', mobile='paneltec-v160.3.9.58.13.132cz'.
  To ship the web side alone, re-run with MOBILE_VERSION_SYNC_OPTIONAL=true
  or `git commit --no-verify` (leave a note in the commit message).
```

**`--no-verify` note:** the hook comment now explicitly states that `git commit --no-verify` bypasses this guard, and that GitHub Actions is the last line of defence. When you bypass, add a note in the commit message so post-merge review is legible (the `.132cx` commit is the reference example).

### Smoke — both paths verified

```
$ MOBILE_VERSION_SYNC_OPTIONAL=true python backend/scripts/check_version_files_v58_8_1.py
Version-file sanity guard — WARNINGS
  ⚠ MISMATCH (MOBILE): mobile lags — web='paneltec-v160.3.9.58.13.132db', mobile='paneltec-v160.3.9.58.13.132cz'. ...
Version-file sanity guard OK — 4 slots agree on 'paneltec-v160.3.9.58.13.132db'
$ echo $?  # 0

$ python backend/scripts/check_version_files_v58_8_1.py
Version-file sanity guard FAILED
  · MISMATCH (MOBILE): mobile lags — ...
$ echo $?  # 1
```

## Part 2 — Backend endpoints for mobile mocks

New module: `backend/mobile_data.py` (~230 lines). Registered at `/api/` root via `server.py`. All 5 endpoints depend on `auth.get_current_user` (same JWT dep as web routes) — the mobile PIN-login JWT (minted by `auth.create_access_token()` at `auth_mobile_pin.py:293`) is accepted verbatim.

### (a) `GET /api/mobile/records/mine` — user's submissions grouped by template category

**Auth:** `Bearer <session_token>` (mobile or web).
**Response shape:**
```json
{
  "groups": [
    {
      "category": "pre_start",
      "label":    "Pre-Starts",
      "count":    3,
      "items":    [{"id","date","status","title"}, ...]
    },
    ...
  ]
}
```
- Joins `form_submissions.submitted_by == user.id` × `form_templates.category`.
- Empty categories omitted; groups sorted by descending count; items capped at 50 per group.
- Extended `CATEGORY_LABELS` map covers all 8 CATEGORY_ORDER values from mobile's `forms.ts`.

**Curl trace:** `GET /api/mobile/records/mine` (anon) → **401 `Not authenticated`** ✓

### (b) `GET /api/mobile/ai/briefing` — daily 2-3 sentence briefing (cached 6 h/user)

**Auth:** bearer.
**Response shape:**
```json
{"briefing": "…", "severity": "info"|"warn", "generated_at": "…"}
```
- **Cache:** in-process dict `{user_id: {briefing, severity, generated_at, ts}}` with 6-hour TTL. Not distributed — sufficient for pod-local response caching, will need Redis if this ever needs to survive restarts.
- **LLM path:** `ai._claude_json` (Anthropic via Emergent LLM key) when `EMERGENT_LLM_KEY` env is set.
- **Fallback:** hand-crafted string using role label + today's hazard-report count.
- **Severity heuristic:** `warn` if `hazards_today > 3`, else `info`.

**Curl trace:** `GET /api/mobile/ai/briefing` (anon) → **401** ✓

### (c) `POST /api/mobile/prestart/submit` — mobile pre-start submission

**Auth:** bearer.
**Body:**
```json
{
  "vehicle_rego": "…", "date": "YYYY-MM-DD",
  "crew_lead": "…", "crew_members": [...],
  "work_summary": "…", "hazards": "…",
  "sign_ons": [{"name","role","signed_at"}, ...]
}
```
**Behaviour:** inserts a `form_submissions` doc with `source: "mobile"`, `category: "pre_start"`, `status: "submitted"`. Uses the org's live `pre_start` template if present; otherwise a synthetic `mobile-prestart` template id (so the record still groups correctly in `/records/mine`).
**Response:** `{"submission_id": "<uuid>", "status": "submitted"}`.

**Curl trace:** `POST /api/mobile/prestart/submit` (anon, empty body) → **401** ✓

### (d) `POST /api/mobile/sites/{site_id}/sign-on` + `/sign-off` — GPS attendance

**Auth:** bearer.
**Body:** `{"lat": 0.0, "lng": 0.0, "timestamp": "…"}`
**Behaviour:**
- **sign-on:** resolves `sites.id == site_id AND org_id == user.org_id` (404 if missing). Computes Haversine distance from the site's `(latitude, longitude)`; if > 250 m, records `warn: "gps_offsite_<meters>m"`. Inserts a `site_attendance` doc with `signed_on_at`, `signed_off_at: None`, and both GPS points. Returns `{attendance_id, signed_on_at, warn}`.
- **sign-off:** `find_one_and_update` on the most recent open attendance (`signed_off_at: None`) for that (user, site). 404 if no open sign-on. Records `signoff_lat/lng`. Returns `{attendance_id, signed_off_at}`.

**Curl trace:** `POST /api/mobile/sites/site-xyz/sign-on` and `/sign-off` (anon) → **401** each ✓

### (e) `POST /api/mobile/ai/ask` — role-scoped LLM chat

**Auth:** bearer.
**Body:** `{"prompt": "…"}`
**Behaviour:** wraps `ai._claude_json` with a role-aware system prompt ("You are the WHS assistant for Paneltec Civil. The user's role is: `<role_label>`. Answer plainly, cite policy/SWMS names when applicable."). Rejects empty prompts (400). Falls back to a helpful stub if the LLM path fails or `EMERGENT_LLM_KEY` is missing.
**Response:** `{"answer": "…", "sources": []}`.

**Curl trace:** `POST /api/mobile/ai/ask` (anon) → **401** ✓

## Part 3 — `/api/users/me` diagnosis (for the Expo specialist)

**No backend change needed.** The mobile PIN-login endpoint mints its JWT via `auth.create_access_token(user["id"], user["email"], user.get("token_version", 0))` — the **exact same function** the web login uses. Same `JWT_SECRET`, same `JWT_ALGORITHM`, same 30-day expiry. Therefore `/api/auth/me` accepts the mobile `session_token` verbatim when sent as `Authorization: Bearer <session_token>`.

**Verified via pytest** (`test_auth_me_accepts_mobile_session_token`):
1. `POST /api/auth/mobile/pin-login {pin: "3310", device_id: "pytest-132db"}` → **200** with `session_token`.
2. `GET /api/auth/me` with `Authorization: Bearer <that token>` → **200** with `email = stephen@paneltec.com.au`. ✓

**Root cause of the `.132cz` 401 is client-side.** For the Expo specialist to fix in `.132dc`:
- Confirm `apiClient.ts` (or wherever mobile fetches run) reads `AsyncStorage.getItem("session_token")` after `pin-login` succeeded.
- Confirm the header is set as literal `Authorization: Bearer ${token}` (case-sensitive; some Expo fetch wrappers auto-strip `Authorization`).
- Confirm the token isn't stale (mobile `.132cq` stored it under key `session_token`; some earlier `.132co` code used `access_token` — check for a mismatch).

**Endpoint (`/api/auth/me`) is behaving correctly. No backend change.**

## Version bump — Part 3

- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132db`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132db`
- `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132db`
- `MOBILE_BUNDLE_VERSION` remains at `.132cz` (Expo specialist bumps in `.132dc`). Hook flags this with a warning under `MOBILE_VERSION_SYNC_OPTIONAL=true`, or fails hard without.

## Testing

```
$ python -m pytest tests/test_v58_13_132db_precommit_and_mobile_endpoints.py -v
tests/test_v58_13_132db_precommit_and_mobile_endpoints.py::test_hook_exists_and_reads_all_four_slots PASSED
tests/test_v58_13_132db_precommit_and_mobile_endpoints.py::test_hook_passes_on_current_tree_with_mobile_escape PASSED
tests/test_v58_13_132db_precommit_and_mobile_endpoints.py::test_hook_fails_when_mobile_escape_disabled_and_mobile_lags PASSED
tests/test_v58_13_132db_precommit_and_mobile_endpoints.py::test_mobile_data_endpoints_mounted_and_gated PASSED
tests/test_v58_13_132db_precommit_and_mobile_endpoints.py::test_auth_me_diagnosis_anon_returns_401 PASSED
tests/test_v58_13_132db_precommit_and_mobile_endpoints.py::test_auth_me_accepts_mobile_session_token PASSED
tests/test_v58_13_132db_precommit_and_mobile_endpoints.py::test_three_way_sync_at_132db_or_later PASSED
============================== 7 passed in 0.34s ==============================
```

## Files touched

| File | Change |
|---|---|
| `backend/scripts/check_version_files_v58_8_1.py` | Extended to 4-slot strict-equality guard + escape hatch |
| `backend/mobile_data.py` | NEW — 5 mobile endpoints, ~230 lines |
| `backend/server.py` | Register `mobile_data_router` |
| `frontend/src/lib/version.js` | RUNNING + EXPECTED → `.132db` |
| `frontend/public/service-worker.js` | CACHE_VERSION → `.132db` |
| `backend/tests/test_v58_13_132db_precommit_and_mobile_endpoints.py` | NEW — 7 tests |
| `memory/v58_13_132db_precommit_lint_and_mobile_endpoints_shipped_finish_deferred.md` | THIS FILE |

## Ship rules honoured

- No `finish` tool. Memo + chat only.
- No `testing_agent` / `e1_tester`. Pytest + curl only.
- No `git filter-repo`.
- `git stash push --include-untracked` **before** touching tracked files (captured the `.132da` WIP + routine `.emergent/emergent.yml` bump). `git stash pop` clean after ship (no conflicts).
- No writes to `/app/mobile/` — verified by `git status`; mobile version drift acknowledged and handled via the escape hatch.

## For the Expo specialist (`.132dc` scope)

1. **Bump `mobile/src/lib/version.ts` to `.132db` or later** — closes the mobile-lag warning.
2. **Wire the 5 new endpoints** — all are auth-gated, use the standard `Authorization: Bearer <session_token>` header. Contracts documented above.
3. **Fix the `/api/auth/me` 401** — check that:
   - `session_token` (not `access_token`) is the AsyncStorage key.
   - The header is set literally as `Authorization: Bearer ${token}`.
   - The token hasn't expired (30 days from PIN-login).
4. **`.132cv`** — the `role_id`-vs-`role` bug in `mobile/app/(tabs)/forms.tsx` (hides admin form category on PIN-login sessions) is still pending from `.132cu`.

## Follow-ups deferred

- **Distributed AI briefing cache** — currently in-process dict. If we run > 1 backend pod or use gunicorn workers, briefings will regenerate per pod. Migrate to Redis or Mongo TTL collection if this becomes an issue.
- **Site-radius tuning** — the `250 m` sign-on radius is hardcoded. Should probably become a per-org or per-site setting.
- **AI ask endpoint sources array** — currently always `[]`. Wire real doc/policy citations when the vector-search layer lands.
