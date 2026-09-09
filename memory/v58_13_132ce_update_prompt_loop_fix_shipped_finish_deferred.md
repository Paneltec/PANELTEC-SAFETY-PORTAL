# v58.13.132ce — Update-prompt loop fix · SHIPPED (finish-deferred)

## Ship rules honoured
- `testing_agent` — NOT invoked.
- `e1_tester` — NOT invoked.
- `finish` tool — NOT invoked. Finish-deferred per standing directive.
- `/app/mobile/` + `metro.config.js` — untouched.
- 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.
- No mocks.

## User pain (verbatim, Stephen)
> "'Update available' popup keeps reappearing… normal SW cache-version cutover should trigger it once per version bump, but it's persistent."

## Root cause — THREE-way version-pin drift

`CacheBusterBanner.jsx` compares `serverVersion` (== SW `CACHE_VERSION`, fetched from `GET /api/health/version`) vs `EXPECTED_CACHE_VERSION` (a constant in `version.js`). When they don't match, the banner fires. That comparison is CORRECT — it's the single mechanism that tells the frontend "the SW you're expecting isn't the one the server has installed".

But there are **three** version constants that must stay in lockstep:

| Constant | File | Purpose |
| --- | --- | --- |
| `RUNNING_VERSION` | `frontend/src/lib/version.js` | The bundle's identity string. Shown in the sidebar pill + emitted in support links. |
| `CACHE_VERSION` | `frontend/public/service-worker.js` | The SW's own advertised identity, returned by `/api/health/version`. |
| `EXPECTED_CACHE_VERSION` | `frontend/src/lib/version.js` | What THIS bundle expects the SW to be. **Only this constant is used by CacheBusterBanner's mismatch check.** |

Every ship since `.132bc` bumped `RUNNING_VERSION` + `CACHE_VERSION` in lockstep, but **`EXPECTED_CACHE_VERSION` was silently forgotten in `.132cb`, `.132cc`, and `.132cd`** — it stayed pinned at `.132ca`. Result:

| Constant | Pre-`.132ce` value |
| --- | --- |
| `RUNNING_VERSION` | `paneltec-v160.3.9.58.13.132cd` |
| `CACHE_VERSION` (SW) | `paneltec-v160.3.9.58.13.132cd` |
| `EXPECTED_CACHE_VERSION` | `paneltec-v160.3.9.58.13.132ca` ← **stale by 3 ships** |

CacheBusterBanner compared `serverVersion=.132cd` vs `EXPECTED=.132ca` → **permanent mismatch** → banner appeared on every load after the 30s BOOT_GRACE_MS. Dismissing wrote `paneltec_cachebust_dismissed_paneltec-v160.3.9.58.13.132cd` to localStorage, which suppressed for that specific server version — but the moment the SW cache_version changed (next ship), the version-scoped dismiss key rotated and the banner returned. From Stephen's POV: relentless.

## Fix

Two-part:

### 1. Actually bump `EXPECTED_CACHE_VERSION` (and the other two) to `.132ce`
```
export const RUNNING_VERSION         = 'paneltec-v160.3.9.58.13.132ce';  // was .132cd
export const EXPECTED_CACHE_VERSION  = 'paneltec-v160.3.9.58.13.132ce';  // was .132ca (drift!)
const CACHE_VERSION                  = 'paneltec-v160.3.9.58.13.132ce';  // was .132cd (SW file)
```
Live confirmation:
```
$ curl /api/health/version
{'cache_version': 'paneltec-v160.3.9.58.13.132ce'}
```

### 2. Add a guardrail pytest that PINS the three-way equality
`backend/tests/test_v58_13_132ce_update_prompt_loop_fix.py::test_all_three_version_pins_agree` reads all three constants from source and asserts they're identical. Any future ship that bumps only two of them will fail this test at pytest time, before it can loop the banner on production. This is the check that would have caught the `.132cb / .132cc / .132cd` drift at ship time.

## Investigate findings
1. **Grep for "Update available"** → `frontend/src/components/CacheBusterBanner.jsx:201`.
2. **Trigger tracing** — `CacheBusterBanner.jsx:133-139`. The mismatch check is: `serverVersion && EXPECTED_CACHE_VERSION && serverVersion !== EXPECTED_CACHE_VERSION && !dismissed && !persistentlyDismissed && (Date.now() - bootTsRef.current) >= BOOT_GRACE_MS`. Polls `/api/health/version` every 5 minutes + on visibility change.
3. **Controllerchange** — `serviceWorkerRegistration.js:117` fires ONCE per SW upgrade to reload the tab. Not the source of the loop.
4. **Dismissal logic** — sound. `paneltec_cachebust_dismissed_${serverVersion}` in localStorage. Reset intentionally when `serverVersion` changes (line 117). Not the source of the loop.
5. **Version pin equality** — **DRIFT CONFIRMED**. `EXPECTED_CACHE_VERSION=.132ca`, server=`.132cd` → mismatch fires every load.
6. **`registration.update()`** — called once per registration in `serviceWorkerRegistration.js:106`; no timer, no focus loop.

## Common causes ruled out
- ✓ Multiple SW registrations racing — single `register()` call.
- ✓ Preview host serving stale SW — `/api/health/version` correctly returns the SW's `CACHE_VERSION`.
- ✓ "Dismiss forever" state missing — already implemented (`paneltec_cachebust_dismissed_<version>`). Just wasn't enough for a pin-drift bug.
- ✓ Localhost quirk — no, same URL pattern as production.

## Files touched
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` both bumped to `.132ce`, plus a diagnosis+fix header block.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped to `.132ce`.
- `backend/tests/test_v58_13_132ce_update_prompt_loop_fix.py` (NEW) — three-way equality guardrail + `≥.132ce` version-sync pin.

## Pytests
- `test_all_three_version_pins_agree` — ✅ green. Locks the fix.
- `test_version_pins_at_least_132ce` — ✅ green.
- Adjacent regressions (`.132cb` + `.132cc` + `.132cd`) — 30/30 still green. **32/32 batch total.**

## Live verification
- **Backend** — `GET /api/health/version` returns `{cache_version: 'paneltec-v160.3.9.58.13.132ce'}`.
- **Frontend** — Playwright signed in as Stephen, waited 35s past `BOOT_GRACE_MS`, then queried `[data-testid='cache-buster-banner']`. Count = **0** (banner does not appear). Sidebar pill reads `v160.3.9.58.13.132ce`. Screenshot: `/tmp/132ce_no_banner.jpeg`.

## Decisions
- **Alphanumeric-only guard vs semver diff** — the three constants are compared as literal strings (`==`), not parsed. That's fine because they're always identical when in lockstep. The version-sync check reads the `.132ce` tail and asserts `>= '132ce'` alphanumerically (matches how other ships in this session were guarded).
- **Kept the existing dismiss + auto-hide behaviour** — user asked "if it fires once per version bump that's correct behaviour". After this ship it will do exactly that: appear once when the server actually ships a new SW that this bundle wasn't compiled against. Every intermediate hop is silent.
- **Didn't touch `serviceWorkerRegistration.js`** — the `controllerchange` reload is correct; drift was the sole cause.

## NOT changed
- `CacheBusterBanner.jsx` — logic already correct.
- `serviceWorkerRegistration.js` — no changes.
- `AUTO_HIDE_MS` / `PULSE_MS` / `BOOT_GRACE_MS` — the existing 30s / 5s / 30s window is fine.
- `paneltec_cachebust_dismissed_<version>` localStorage keys — kept as-is (belt-and-braces for real future mismatches).
- 20 pre-existing `ephemeral-upload-storage` lint warnings — parked for v58.14.x.
- `/app/mobile/` code — untouched. `MOBILE_BUNDLE_VERSION` unchanged.

## Prevention (for the next fork)
Ship checklist gains a hard three-way lockstep: on every version bump, `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` + `CACHE_VERSION` must all move together. `test_v58_13_132ce_update_prompt_loop_fix.py::test_all_three_version_pins_agree` will fail loudly if any one of them lags, so the mistake becomes a pytest failure at ship time instead of a persistent "Update available" popup in production.

## finish tool
Deferred by design. Handed off to the next fork with this memo.
