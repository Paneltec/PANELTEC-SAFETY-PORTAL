# v58.13.132at — Sentry mobile crash reporting shipped

**Status:** Ship in progress — mobile-only, no backend deployment side-effects. Awaiting user acknowledgement before I close the loop.

## What shipped

- Expo EAS Android build `24783f93-3817-4f32-a85c-e41fea8d5734` finished (2026-09-08T04:27:19Z, ~17 min build, ~1.3 hr queue).
- `@sentry/react-native ~6.14.0` wired into `mobile/app/_layout.tsx` with the EU-region DSN (source of DSN is env-scoped for the build only; not persisted).
- APK downloaded from EAS artefacts and hosted at `/app/backend/static/downloads/paneltec-field-app-v58.13.132at.apk`.
- `/app/backend/static/downloads/android_manifest.json` refreshed to point at the new file.

## Manifest values

| Key                | Value |
|--------------------|-------|
| filename           | paneltec-field-app-v58.13.132at.apk |
| version            | 1.0.6 |
| version_code       | 137 |
| size_bytes         | 121,906,775 (~121.9 MB) |
| sha256             | `0a6112f0cc90de4d1b4907064c34dfe7044a81220143d88c18c74a0e68ab44a0` |
| built_at           | 2026-09-08T04:27:19Z |
| eas_build_id       | 24783f93-3817-4f32-a85c-e41fea8d5734 |
| bundle_id          | com.emergent.whscompliance.fv5aib |
| ship_version       | paneltec-v160.3.9.58.13.132at |
| git commit         | e298ffbf3fa5b08866832544e64ceaedf5760572 |

## Why this build matters

`.132ai` blinked-and-vanished at launch on Android with no useful log. `.132al` added JS-side ErrorBoundary, boot-trace, splash retention and an on-next-boot recovery screen. `.132at` layers the native side on top: Sentry captures the JVM/native stack **and** the JS stack **and** breadcrumbs pre-crash. First build capable of shipping a real crash report off-device.

Instrumentation from `.132al` is preserved verbatim (recovery screen still works if Sentry misses).

## What to do next

1. Install `paneltec-field-app-v58.13.132at.apk` on the affected device(s).
2. Reproduce the crash (or let it happen naturally).
3. In Sentry EU dashboard, watch the Paneltec Civil project for a new event tagged `release=paneltec-v160.3.9.58.13.132at` and `dist=137`.
4. Expected fingerprint prefixes for the launch-crash bucket will land under either:
   - `AndroidRuntime` (JVM) — points at whatever native module is throwing.
   - `RCTJavaScript` (JS) — points at the RN JS shim.
5. Share the event permalink so we can chase the root cause in `.132av+`.

## Security note

`EXPO_TOKEN` was passed inline for this poll (`build:view`), never persisted to disk, never echoed in logs, never committed. Fresh token required for the next EAS invocation.

## Rollback

Uninstall the APK on-device or roll `android_manifest.json` back to `.132al` (git blame keeps the previous manifest). No backend / DB side-effects to reverse.

## Version state

- RUNNING_VERSION: `paneltec-v160.3.9.58.13.132at` (already at this value from earlier prep — no bump this batch)
- CACHE_VERSION: `paneltec-v160.3.9.58.13.132as` (unchanged — mobile-only ship, no SW invalidation needed)
- EXPECTED_CACHE_VERSION: `paneltec-v160.3.9.58.13.132as` (matches CACHE_VERSION)
- MOBILE_BUNDLE_VERSION: `paneltec-v160.3.9.58.13.132at` (bump-of-record for the APK)

## Not in this ship

- iOS Sentry — waiting on Apple Developer account signup.
- `.132au` (dedupe fix + Transaction ID columns) — separate ship memo `v58_13_132au_dedupe_fix_shipped_finish_deferred.md`.
- `.132av` deferred UI (MyProfile Admin PIN section + Users Management Clear PIN) — carried forward.
