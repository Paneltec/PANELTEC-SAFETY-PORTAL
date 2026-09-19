# Ship Memo — v58.13.132ja: In-App Update Banner + EAS Build Fix

## Date: 2026-09-19

## Changes

### 1. EAS Build `ca208091` Root Cause Analysis

**Error**: `EAS_BUILD_UNKNOWN_GRADLE_ERROR`

**Root Cause**: Sentry source map upload failed during Gradle build. The `sentry-cli` requires an `--org` flag, but no Sentry organization was configured for the EAS environment. The critical failure was:

```
> Task :app:createBundleReleaseJsAndAssets_SentryUpload_com.emergent.whscompliance.fv5aib@1.0.16+138_138 FAILED
error: An organization ID or slug is required (provide with --org)
Execution failed for task ':app:createBundleReleaseJsAndAssets_SentryUpload...'
> Process 'command '.../sentry-cli'' finished with non-zero exit value 1
BUILD FAILED in 5m 59s
```

**Contributing factor**: Build `ca208091` was kicked with profile `preview` (not `preview-apk`). The `preview` profile lacked `SENTRY_DISABLE_AUTO_UPLOAD=true` env var, causing Sentry's Gradle plugin to attempt source map upload without credentials.

**Fix applied**:
1. Added `SENTRY_DISABLE_AUTO_UPLOAD=true` and `SENTRY_DISABLE_NATIVE_DEBUG_UPLOAD=true` to BOTH `preview` and `preview-apk` profiles in `eas.json`
2. `app.json` already had `autoUpload: false` in the Sentry plugin config (controls Expo config plugin, not Gradle directly)
3. Created `.easignore` to exclude `android/`, `ios/`, `.expo/`, `node_modules/.cache/`, `*.map` from future uploads
4. Deleted local `android/` directory (stale from previous local build attempt)
5. Updated `runtimeVersion` from `1.0.16` to `1.0.18` to match app version

### 2. In-App Update Banner (Already Implemented)

- `src/features/updates/useUpdateCheck.ts` — Hook that calls `GET /api/mobile/downloads/android/version`, compares `server.version_code` vs `Application.nativeBuildVersion`
- `src/features/updates/UpdateBanner.tsx` — Dismissible blue banner: "Update available: v{version} · Tap to install"
- Tap → `Linking.openURL(apiBase + '/api/mobile/downloads/android/latest.apk')` (browser handles APK install)
- Dismissal stored in AsyncStorage keyed by `server.version_code`
- Background check: 5s timeout, silent on error
- Manual check: 15s timeout, surfaces errors as toast

### 3. AbortController in apiClient.ts (Already Implemented)

- `authGet`: 20s default timeout, `authPost`: 45s default
- Overridable via `{ timeoutMs }` option
- External `AbortSignal` chaining supported
- Intelligence Briefing card: 45s timeout, "Briefing unavailable — tap to retry" fallback

## New EAS Build

- Build ID: `6604e1b3-8ad6-4be6-8a82-1adb1fdf8e54`
- Profile: `preview-apk`
- Version: 1.0.18 / versionCode 140
- Status: IN PROGRESS (as of ship time)
- Dashboard: https://expo.dev/accounts/stephenguy/projects/paneltec-civil-field/builds/6604e1b3-8ad6-4be6-8a82-1adb1fdf8e54

## Version

- app.json: version 1.0.18, versionCode 140, runtimeVersion 1.0.18
- MOBILE_BUNDLE_VERSION: `paneltec-v160.3.9.58.13.132ja`

## Files Modified

- `/app/mobile/eas.json` — Added SENTRY_DISABLE vars to `preview` profile
- `/app/mobile/app.json` — Updated runtimeVersion 1.0.16 → 1.0.18
- `/app/mobile/.easignore` — New file to exclude android/, ios/, etc.
- `/app/mobile/src/lib/version.ts` — Synced to v160.3.9.58.13.132ja

## Known Issues (Not Patched — Report Only)

- **Missing footer nav icons**: Reported by user. Tab layout uses `@expo/vector-icons` Ionicons — icons render correctly on web preview. May be a native-only issue after SDK 57 upgrade (Ionicons font not bundled correctly in APK). To investigate: check if `@expo/vector-icons` is properly linked in the native build.
- **Only Cat 320 pre-start visible**: Reported by user. Forms screen fetches from `/api/forms/templates` and groups by category. Need to verify backend returns all templates for the user's role, not just one.
