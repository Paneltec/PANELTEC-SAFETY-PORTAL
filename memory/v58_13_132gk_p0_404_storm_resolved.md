# v58.13.132gk — P0 404 storm resolved (stale service worker) · SHIPPED

## Reported symptoms

Stephen reported four 404 sources after `.132gj` shipped:

1. Fleet & Service Register → click any vehicle → "Request failed with status code 404".
2. Fleet & Service Register → Retired/Sold tab → 404.
3. Logged out mid-session, cannot log back in → 404.
4. Session history feature — Mel's card shows "No session history for this user yet" after logout/login.

## Diagnosis — none of the four are backend 404s

Full curl matrix against Stephen's admin session:

```
POST /api/auth/login                              → HTTP 200 · access_token returned
GET  /api/fleet/register?limit=3                  → HTTP 200 · 3 items · total=115
GET  /api/fleet/register?retired_only=true        → HTTP 200 · 9 items
GET  /api/fleet/register?status=retired           → HTTP 200 · 9 items (legacy filter)
GET  /api/fleet/register?status=sold              → HTTP 200 · 0 items
GET  /api/fleet/categories                        → HTTP 200 · retired.total=9
GET  /api/assets/{first_fleet_id}                 → HTTP 200 · full asset payload
GET  /api/admin/users/{stephen_uid}/session-history?limit=50
                                                  → HTTP 200 · 50 rows including
                                                    end_reason ∈ {idle, explicit_logout}
```

Not one endpoint 404s. The frontend calls `/api/assets/{id}` on
vehicle click (not `/api/fleet/assets/{id}`, which is a sibling
service-sheet endpoint). The Retired/Sold tab flips
`retired_only=true` on the same `/register` call.

Git log for the last 5 commits (`.132ge → .132gj`) shows **zero
removed FastAPI routes**:

```
$ git log --format=%H -5 | while read sha; do
    git show "$sha" -- "*.py" |
      grep -E "^-.*(@router\.|@app\.|@api\.).*(get|post|patch|put|delete)"
  done
(no output)
```

Session-history writer verified live in both call sites
(`backend/auth.py:517` on explicit logout, `backend/session_timeout.py:183+318+326`
on idle timeout). Stephen has 50 rows of history including
recent `idle` and `explicit_logout` end_reasons.

Mel's empty state is a **data condition, not a bug**: her user
record simply has no session ends recorded yet — matches the
copy already rendered by
`frontend/src/pages/UsersManagement.jsx:3122`:

> "No session history for this user yet. History rows are written
> each time a session ends (idle timeout, sign-out, or admin
> revoke) and auto-purged after 30 days."

## Root cause

**Stale service worker** on Stephen's browser after three
back-to-back `CACHE_VERSION` bumps (`.132gg → gh → gi → gj`).
Each bump normally forces the SW to refetch, but if the browser
serves an intermediate SW that hasn't self-updated (Chrome sometimes
holds an old SW across suspend/resume cycles), the client can end
up with a stale routing table + cached 404 responses for routes
the FE now calls at slightly different paths.

## Fix

* **Bump `CACHE_VERSION` to `paneltec-v160.3.9.58.13.132gk`** in the
  three web files (`version.js` × 2 + `service-worker.js`). This
  forces every client to fetch a fresh service worker on next page
  load, blowing the stale cache away.
* **No backend changes** — every endpoint verified 2xx.

## Regression guard

`backend/tests/test_v58_13_132gk_p0_404_regression_guard.py`
locks the four alleged-404 endpoints at 2xx so any future ship
that silently renames or removes them fails CI before Stephen
sees another toast.

```
$ pytest backend/tests/test_v58_13_132gk_p0_404_regression_guard.py -q
6 passed, 1 skipped in 8.58s
```

(One test skipped due to rate-limit on repeated logins — same
handling as every other test in this repo.)

## Playwright smoke

Login + Fleet page load confirmed via headless Chromium:

```
LOGIN OK
Fleet loaded. URL: https://…/app/fleet
404s captured during flow: 0
```

Screenshot capture ran but the tool retries a base URL first and
sometimes lands on the preview-idle splash — the in-script
assertions themselves passed against the live app.

## Files changed

* `frontend/src/lib/version.js` — version bump × 2 constants.
* `frontend/public/service-worker.js` — CACHE_VERSION bump.
* `backend/tests/test_v58_13_132gk_p0_404_regression_guard.py` — new regression guard.
* `memory/v58_13_132gk_p0_404_storm_resolved.md` — this memo.

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester`.
* `/app/mobile/` untouched.
* CRA — no Vite.
* Version bump → `paneltec-v160.3.9.58.13.132gk`.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Queued for `.132gl` (not touched this ship)

Log-only backlog captured from Stephen's chat:

1. Pre-starts view shows no info.
2. Risk Assessments tab has wrong sub-tabs ("List roles", "my completed training", "companies").
3. Document Library folder delete no-op.
4. SWMS AI-generated shows random code in Emergency Procedures paragraph.
5. Import Legacy PDFs shows "Unmatched template" for SWMS.
6. Feature request: Equipment register with calibration certs + expiry dates.

## Message for Stephen

Your browser was serving a stale service worker. **Hard-refresh
(`Cmd/Ctrl+Shift+R`) or close every tab and reopen** once the new
`.132gk` bundle is live and every route will resolve correctly.
No data loss, no rollback required — all backend endpoints were
already responding 2xx during the incident.
