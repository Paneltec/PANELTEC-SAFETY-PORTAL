# v58.13.132p2h — Mobile version bump + EAS APK rebuild trigger (v1.0.52 / 174)

## Purpose
Roll all post-v1.0.51 mobile work into a fresh APK for Stephen's phone.
Three parallel-actor commits have landed on top of `.132p2e` but none
bumped `mobile/app.json` — they only touched Forms code:

- `4dc73774` — `.132p2f`  Forms Library Option B (colour-coded tiles + SVG icons)
- `c490bf46` — `.132p2f1` Corrections (title `#1A1A1A`, 4px stripe)
- `b36492c4` — `.132p2g`  Forms tab focus-refetch fix + session-expired PIN banner

These will ONLY reach the device once packaged into a new APK. That's
what `.132p2h` does.

## Scope
- Single-file mobile edit: version bump in `/app/mobile/app.json`.
- Web lockstep: bump the three version constants in
  `frontend/src/lib/version.js` (RUNNING_VERSION + EXPECTED_CACHE_VERSION)
  and `frontend/public/service-worker.js` (CACHE_VERSION) so the TopBar
  version pill reads `.132p2h` and warm-SW browsers reload once.
- No other mobile code touched — the three feature commits above already
  did the actual Forms work; this ship is only the package bump.
- No push. No test-agent. Defensive git-reset before staging.

## Changes
| File | Change |
|---|---|
| `mobile/app.json` | `version: "1.0.51" → "1.0.52"`, `android.versionCode: 173 → 174` |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132p2h` |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132p2h` |
| `memory/v58_13_132p2h_apk_rebuild_v1.0.52.md` | New (this file) |

iOS `buildNumber` NOT bumped — Android-only ship, iOS TestFlight is a
separate cadence.

## EAS build trigger
1. Load `EXPO_TOKEN` from `/app/backend/.env`.
2. Reinstall `eas-cli` via `yarn global add eas-cli` (container-restart
   wipe is expected; verified again here).
3. `eas whoami` verifies `stephenguy` auth.
4. `cd /app/mobile && eas build --platform android --profile preview-apk --non-interactive --no-wait`
5. Capture build ID + URL.

## Prior build state
The previous ship (`.132p2e` = v1.0.51 / 173 = build ID
`fe46a74f-41e5-43b1-babe-ce9974a9b75a`) is checked at the top of this
ship's report and included there. Watchdog auto-ingest will always
pick the highest completed `versionCode`, so a slower v1.0.51 finishing
AFTER v1.0.52 is a non-issue — the guard in
`eas_ingest_watchdog.py::maybe_swap_apk` rejects any candidate whose
`versionCode` is less than the currently installed `latest.apk`.

## Auto-ingest handoff
No manual watcher needed. `.132p2a` `eas_apk_ingest_watchdog`
(APScheduler, 5-min GraphQL poll) will detect the `FINISHED` build for
`174` and atomically swap `latest.apk`. Previous cadence: build takes
~23 min + ≤5 min poll = ~28 min end-to-end.

## Defensive git protocol
- `git reset HEAD -- .` before staging.
- Only these paths staged:
  - `mobile/app.json`
  - `frontend/src/lib/version.js`
  - `frontend/public/service-worker.js`
  - `memory/v58_13_132p2h_apk_rebuild_v1.0.52.md`
- `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify -m "132p2h: bump mobile v1.0.52/174 for EAS APK build with forms redesign + refetch fix"`
- **NO PUSH.**

## Post-ship report
See the session response for the exact commit SHA, EAS build ID +
URL, `eas whoami` output, and the live status of both the v1.0.51 and
v1.0.52 EAS builds.
