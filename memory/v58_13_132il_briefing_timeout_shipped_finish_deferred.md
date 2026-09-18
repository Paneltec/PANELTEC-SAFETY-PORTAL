# v58.13.132il — Deployment cache-bust + Intelligence Briefing timeout · SHIPPED (finish deferred)

**Ship phase:** `.132il`

## Diagnosis (before the fix)

### Issue 1 — Web changes not visible
Verified server-side deployment IS on the latest ship:
- Live `GET /api/health/version` → `{"cache_version": "paneltec-v160.3.9.58.13.132ik"}`.
- Live `GET /service-worker.js` head → `CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ik'`.
- Frontend supervisor log shows `Compiled successfully! webpack compiled successfully` after each ship.
- Backend log clean, mongo/gridfs/tools all healthy.

→ **The server has the changes. The user's browser was serving a stale service-worker cache.** The `CacheBusterBanner` component fires when `serverVersion !== EXPECTED_CACHE_VERSION`, but each ship since the user last reloaded uses a version-scoped `paneltec_cachebust_dismissed_<version>` localStorage key — the banner was possibly dismissed on `.132ig` or `.132ih` AND their browser hadn't re-fetched. Bumping to `.132il` naturally re-fires the banner because it's a fresh version that's never been dismissed.

**Instruction for the user** (also embedded in the reply below):
1. Open the app.
2. When the "Update available — Reload now" toast appears (top-right), click **Reload now**. That runs the built-in unregister-SW + clear-caches + reload flow.
3. If the toast doesn't appear within ~30s, use browser DevTools:
   - **Application → Service Workers → Unregister** (all entries).
   - **Application → Storage → Clear site data**.
   - Hard refresh (Ctrl+Shift+R / Cmd+Shift+R).

### Issue 2 — Mobile "Intelligence Briefing" infinite spinner
Traced to `backend/mobile_data.py::ai_briefing`. The endpoint pre-computes a hand-crafted fallback string then optionally upgrades it via `_claude_json`. The problem: **`_claude_json` had no timeout**. When Claude was slow or hung, the endpoint hung with it. Combined with the mobile app's `fetch()` also having no timeout in `apiClient.ts::authGet`, an unresponsive LLM turned into an infinite spinner on the mobile home screen.

Confirmed live-endpoint response time was 2.5 s on a warm hit — but the user's screenshot shows a cold-start path where the LLM took >30 s and never completed.

The same pattern exists on `backend/ask.py::briefing` (the web dashboard Intelligence Briefing card). Fixed both.

## What shipped

### 1. `backend/mobile_data.py` — 8-second timeout wrap
- `import asyncio` + `import logging`; new module logger.
- `_claude_json(...)` call inside `ai_briefing` now wrapped in `asyncio.wait_for(..., timeout=8.0)`.
- New `except asyncio.TimeoutError` branch that logs a warning and falls through to the pre-computed hand-crafted string.
- Existing general `except Exception` branch renamed → still catches every other failure path.

### 2. `backend/ask.py` — 10-second timeout wrap
- `import asyncio` added.
- `_claude_json(ASK_SYSTEM, user_text)` call wrapped in `asyncio.wait_for(..., timeout=10.0)`.
- Existing HTTPException fallback broadened to `except (HTTPException, asyncio.TimeoutError):` so the "Briefing temporarily unavailable · try again in a minute" copy also serves the timeout path.

### 3. Version bump `.132ik → .132il`
- `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` in `frontend/src/lib/version.js`.
- `CACHE_VERSION` in `frontend/public/service-worker.js`.
- Bumping is the deliberate cache-bust lever — the `CacheBusterBanner` re-fires for every user still on a previous version because the dismiss key is version-scoped.

## Ban compliance
- No `/app/mobile/` edits. The `apiClient.ts::authGet` `fetch()` in the Expo app still has no timeout — that's a fair-game item for the mobile specialist. This ship narrows the failure envelope from the backend side so the browser-side timeout matters less.
- No `testing_agent` / `e1_tester` / `finish`.
- `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Pytest coverage — `tests/test_v58_13_132il_briefing_timeout.py` — 4 checks
- **Source pins** — mobile briefing has `asyncio.wait_for(..., timeout=8.0)` + timeout-except branch + warning log; web briefing has `asyncio.wait_for(..., timeout=10.0)` + combined `(HTTPException, asyncio.TimeoutError)` except; fallback copy present.
- **Version lockstep** — forward-safe regex on all three constants.
- **Behavioural (asyncio)** — monkey-patches `ai._claude_json` to `asyncio.sleep(30)` and calls `ai_briefing` directly, then races the whole call against a 12 s ceiling. Confirmed:
  - Wall-clock finishes in ~9 s (8 s wait_for + ~1 s overhead).
  - Response has a non-empty `briefing` string.
  - Response is the fallback, not the LLM's would-be reply.

### Combined suite (.132ie … .132il): **61/61 green.**

## Verification against live server (post-restart)
```
GET /api/health/version
  → {"cache_version":"paneltec-v160.3.9.58.13.132il"}

GET /api/mobile/ai/briefing  (fresh, no cache)
  → 200 in 2.24 s
  → {"briefing":"Good morning…","severity":"info","generated_at":"…"}
```

## Next action items
- **User: force cache refresh** — see the "Instruction for the user" block above. `.132il` triggers a fresh banner.
- **Mobile specialist** — add `AbortController` + `setTimeout` (or `Promise.race`) to `mobile/src/services/apiClient.ts::authGet` + `authPost` so a truly hung request client-side also degrades to a `{ ok: false, error: 'Timeout' }` result. Flagged, not shipped (ban).
- **Retroactive extractor for `.132ik`** — still queued (needs the source-PDF stash).
- **Ask Intelligence full page** — same LLM-timeout risk lives in the `/api/ask` POST path. Deferrable but should get the same wait_for wrap in a future ship.
