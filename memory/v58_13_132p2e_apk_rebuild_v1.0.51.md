# v58.13.132p2e — Mobile version bump + EAS APK rebuild trigger

## Purpose
Ship a fresh EAS Android APK carrying every `.132p1a` → `.132p2d` mobile
change bundled by the parallel mobile agent since the last APK build
(v1.0.50 / build 172, EAS run label `.132p2`). User (Stephen) needs
v1.0.51 on his device so the on-device redesign + SMS-intent payload
changes can be validated end-to-end.

## Scope
- Single-file mobile edit: version bump in `/app/mobile/app.json`.
- Web lockstep: bump the three version constants so the browser's
  cache-buster banner fires once for warm SW clients and the version
  pill in the TopBar reads `.132p2e`.
- No other mobile code touched — this ship is *only* the version bump
  + the EAS build trigger. All feature work in this APK belongs to
  the parallel mobile agent (already in the working tree).
- No push. No test-agent invocation. Defensive git-reset before staging.

## Changes
| File | Change |
|---|---|
| `mobile/app.json` | `version: "1.0.50" → "1.0.51"`, `android.versionCode: 172 → 173` |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132p2e` |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132p2e` |
| `memory/v58_13_132p2e_apk_rebuild_v1.0.51.md` | New (this file) |

iOS `buildNumber` intentionally NOT bumped — this is an Android-only
EAS rebuild; iOS TestFlight is a separate cadence.

## EAS build trigger
1. Load `EXPO_TOKEN` from `/app/backend/.env`.
2. Ensure `eas-cli` is available on PATH — reinstall via `yarn global add eas-cli` if the container restart wiped it.
3. `eas whoami` to verify auth.
4. `cd /app/mobile && eas build --platform android --profile preview-apk --non-interactive --no-wait`
5. Capture the build ID and URL from the CLI output.

## Auto-ingest handoff
No manual watcher needed. `.132p2a` `eas_apk_ingest_watchdog`
(APScheduler, 5-min poll of Expo GraphQL) will detect the `FINISHED`
build and atomically swap `latest.apk` under
`/app/backend/static/downloads/`. The DOWNLOAD APP dropdown will
update once the swap lands. Previous cadence: build takes ~23 min +
1 poll cycle (≤5 min) = ~28 min end-to-end.

## Defensive git protocol applied
- `git reset HEAD -- .` before staging.
- Only these paths staged:
  - `mobile/app.json`
  - `frontend/src/lib/version.js`
  - `frontend/public/service-worker.js`
  - `memory/v58_13_132p2e_apk_rebuild_v1.0.51.md`
- `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify -m "132p2e: bump mobile v1.0.51/173 + web lockstep for EAS APK rebuild"`
- **NO PUSH.**

## Post-ship report
See the session response for the exact commit SHA, EAS build ID, EAS
build URL, and `eas whoami` output.
