# v58.13.132ja — EAS build fix + In-app update banner

## Ship date: 2026-09-19

## EAS Build ca208091 failure — Root Cause

**Error:** `EAS_BUILD_UNKNOWN_GRADLE_ERROR`
**Specific failure:** Sentry CLI upload task crashed during release build:
```
Execution failed for task ':app:createBundleReleaseJsAndAssets_SentryUpload_...'
> Process 'command '.../sentry-cli'' finished with non-zero exit value 1
```
**Root cause:** `@sentry/react-native` Expo plugin was configured without `autoUpload: false`.
During the EAS cloud build, the Sentry Gradle plugin tried to upload source maps but had no valid
auth token / DSN in the build environment → `sentry-cli` exited with error → Gradle build failed.

**Fix:** Changed `app.json` plugin entry from `"@sentry/react-native"` to
`["@sentry/react-native", {"autoUpload": false}]`.

## In-app update banner

### Files created
- `src/features/updates/useUpdateCheck.ts` — Hook: background version check on mount, manual check, dismiss logic, install via Linking
- `src/features/updates/UpdateBanner.tsx` — Persistent blue banner: "Update available: vX.X.X · Tap to install" + dismiss X

### Files modified
- `app/(tabs)/home.tsx` — Mount UpdateBanner at top of scroll content
- `app/(tabs)/profile.tsx` — "Check for Updates" row with current version display + blue dot when update available
- `app.json` — Sentry autoUpload fix, version 1.0.18, versionCode 140
- `src/lib/version.ts` — v160.3.9.57.13.132ja
- `src/services/apiClient.ts` — (from .132iy) AbortController with timeouts

### Behavior
- On launch: background `GET /api/mobile/downloads/android/version` (5s timeout)
- server.version_code > installed → show banner on home + blue dot on profile
- Tap banner or "Install" in alert → `Linking.openURL(apk_url)` → system browser downloads APK
- Dismiss → stores version_code in AsyncStorage → won't nag for same version
- Newer server version resets and re-shows banner
- Network errors on background check → silently ignored
- Manual check (Profile) → shows alert with result or error

### Edge cases handled
- server ≤ installed → no banner
- endpoint 5xx → silent skip (background) / alert (manual)
- web platform → nativeBuildVersion returns null → installedBuildCode=0 → always shows banner (expected, web isn't the target)

## Version
- version: 1.0.18
- versionCode: 140
- MOBILE_BUNDLE_VERSION: paneltec-v160.3.9.57.13.132ja
