# v58.13.132im — Exit-preview chip + mobile endpoint timeouts · SHIPPED (finish deferred)

**Ship phase:** `.132im`
**Scope:** Two-part fix for the user's "none of the buttons work" report on the mobile preview iframe.

## What shipped

### 1. Backend — `asyncio.wait_for(..., timeout=6.0)` on the sibling mobile endpoints

- **`backend/mobile_data.py::records_mine`**
  - Both Mongo cursor drains (template category map + submissions list, up to 500 rows) now live inside an inner `_load()` coroutine wrapped in `asyncio.wait_for(_load(), timeout=6.0)`.
  - On timeout: warning log (`"records/mine hit 6s wait_for — returning empty groups"`) + returns `{"groups": [], "degraded": True}` — same shape the mobile Home renders an empty-state card for.

- **`backend/mobile_daily_jobs.py::get_today_daily_job`**
  - Import: `asyncio` + `logging`; new module logger `paneltec.mobile.daily_jobs`.
  - Entire 2-3-query lookup (user-ID probe → optional worker fallback → assignment fetch) wrapped in the same 6 s `wait_for`.
  - On timeout: warning log + returns `{"assignment": None, "status": "no_job", "degraded": True}` — same shape as the no-job branch the mobile Home already handles.

These two are the only sibling mobile-scoped endpoints the mobile tab bar actually hits (see `mobile/app/(tabs)/*` `authGet` / `useQuery` audit). `/api/mobile/ai/briefing` was already wrapped in `.132il`; `/api/forms/templates` is a shared web+mobile endpoint and left alone.

### 2. Frontend — Exit-preview chip on `MobileModulesSection.jsx`

- **New `onExitPreview` handler** on the aside component. Clears both preview sessionStorage keys:
  - `paneltec_preview_user` — the key `PreviewBanner` polls to decide whether to render.
  - `paneltec_preview_jwt` — the key `isPreviewSession()` in `mobile/src/services/auth.ts` reads to gate destructive UI (Confirm/Submit buttons on forms, etc.).
  - Then re-points the iframe at a token-less URL (`computeExpoResetUrl()`) so any lingering preview credentials inside the RN Web bundle are wiped on reload.
- **Red-outlined chip** rendered above the phone bezel: `"Exit preview mode"` — data-testid `mobile-preview-exit`. Distinct from the neutral "Reset preview" onboarding chip so admins never confuse "test onboarding" with "exit preview".
- **Muted explanatory copy** immediately above the bezel (data-testid `mobile-preview-help`):
  > **Read-only preview.** Tab navigation works; Confirm/Submit actions on forms are disabled server-side to keep audit trails clean. Click **Exit preview mode** above to interact with the real device flow.

### 3. Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132im`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132im`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132im`

## Pytest coverage — `tests/test_v58_13_132im_exit_preview_and_timeouts.py` — 6 checks
- Source pins — `records/mine` + `daily-jobs/today` both have `_load()` + `asyncio.wait_for(..., 6.0)` + warning log + `degraded: True` fallback shape.
- Source pins — MobileModulesSection.jsx `onExitPreview` handler clears both sessionStorage keys; chip has the `mobile-preview-exit` testid; muted copy carries the `mobile-preview-help` testid + expected string.
- Version lockstep (forward-safe regex).
- **Behavioural × 2** — monkey-patch `db.form_templates.find` / `db.form_submissions.find` / `db.daily_job_assignments.find_one` / `db.workers.find_one` to hang for 30 s; call the endpoint directly; race against a 9 s ceiling. Both endpoints return the degraded shape in ~6 s (wait_for fires; endpoints total ~6 s each, combined test-suite wall time 12.3 s).

### Combined suite (.132ie → .132im): **67/67 green.**

## Verification against live server (post-restart)
```
GET /api/health/version
  → {"cache_version":"paneltec-v160.3.9.58.13.132im"}

GET /api/mobile/records/mine (fresh)      → 200 in 112 ms
GET /api/mobile/daily-jobs/today (fresh)  → 200 in 133 ms
```

## Ban compliance
- No `/app/mobile/` edits. All fixes on the backend + web-host side. The iframe sandbox already had `allow-scripts allow-same-origin allow-forms allow-popups` — no change needed.
- No `testing_agent` / `e1_tester` / `finish`.
- `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Next action items
- **Ask Intelligence full-page path** — `/api/ask` POST route still lacks the wait_for wrap. Same LLM-hang risk as `.132il` briefing. Next ship candidate.
- **Retroactive extractor for `.132ik`** — still queued (needs the source-PDF stash).
- **Mobile specialist** — `apiClient.ts::authGet` + `authPost` still use bare `fetch()` with no `AbortController`. Belt-and-braces client-side timeout would harden the mobile app against any backend that doesn't yet have wait_for. Flagged, not shipped (ban).
