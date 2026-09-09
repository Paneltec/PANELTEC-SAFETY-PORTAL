# v58.13.132ba — Aggressively-stripped mobile diagnostic APK

**Status:** EAS build in flight. Build id `2bd4545b-d255-47f1-b64c-2131d556d9da`.  
Once finished, replace `paneltec-field-app-v58.13.132ba.apk` at `/app/backend/static/downloads/`, refresh the manifest with `test_build: true`, and this memo will be updated with SHA + size.

## Diagnostic goal

Five APKs (up to `.132at` with Sentry) all launch-crashed with no useful stack. Time to isolate by removing native modules aggressively until we find the one that boots. If `.132ba` opens, the crash was in a stripped module. If it still crashes, the offender is in Reanimated / core RN / device-specific state.

## Native modules STRIPPED from `mobile/package.json`

| Module | Where removed |
|---|---|
| `expo-camera` | package.json + app.json plugin + iOS/Android permissions |
| `expo-location` | package.json + app.json plugin + iOS/Android permissions |
| `expo-notifications` | package.json + app.json plugin |
| `expo-secure-store` | package.json + app.json plugin — `src/services/auth.ts` swapped to `AsyncStorage` on all platforms |
| `expo-local-authentication` | package.json + app.json plugin + iOS Face ID permission + Android biometric permissions |
| `expo-clipboard` | package.json — `ErrorBoundary` lazy-loads with try/catch fallback |
| `expo-image-picker` | package.json + app.json plugin + iOS photo library permission |
| `expo-document-picker` | package.json (call sites are all lazy-require'd, no code path exercised at boot) |
| `expo-file-system` | package.json (same — only touched during file ops) |
| `expo-web-browser` | package.json (only touched from settings screen) |

## Kept (SDK-required or explicit "do not strip")

- `react-native-reanimated` (SDK-required — Expo 54 requires this)
- `react-native-worklets` (reanimated peer)
- `expo-router` (navigation)
- `expo-font`, `expo-splash-screen`, `expo-status-bar`, `expo-constants`
- `expo-blur`, `expo-image`, `expo-linking`, `expo-symbols`, `expo-system-ui`, `expo-haptics`, `expo-sharing`
- `@sentry/react-native` (crash reporting — the whole point is capturing the next crash if there is one)
- `@react-native-async-storage/async-storage` (used as SecureStore fallback)
- `react-native-gesture-handler`, `react-native-safe-area-context`, `react-native-screens`
- `react-native-qrcode-svg`, `react-native-signature-canvas`, `react-native-svg`, `react-native-webview`
- `@react-native-community/datetimepicker`

## Code guards added

### `src/services/auth.ts`
- Dropped the `Platform.OS !== 'web'` → `require('expo-secure-store')` branch.
- All platforms now use `AsyncStorage`. **Note:** worker JWT is now stored in AsyncStorage (unencrypted) on this diagnostic build. Rotate credentials before shipping any production build reverting to `.132ba` shape. Restore SecureStore in `.132bb`.

### `src/components/ErrorBoundary.tsx`
- `import * as Clipboard from 'expo-clipboard'` → lazy `require` inside try/catch. Sets `Clipboard = {}` on failure.
- Call site guarded with `if (Clipboard.setStringAsync) { ... }`. If clipboard is unavailable, the crash-detail dump stays on screen for manual selection instead of copying — acceptable degradation for a diagnostic build.

### `login.tsx`, `visitor/[siteId]/step1.tsx`, `push.ts`, `PhotoCapture.tsx`
- Already lazy-require the native modules inside handlers that only fire on explicit user action (biometric button press, QR-scan start, photo tap). None runs at boot, so the strip cannot cause a launch crash on these paths.

## `app.json` diff summary

- `version` `"1.0.6"` → `"1.0.7"`.
- `android.versionCode` `137` → `138`.
- `android.permissions` array — every permission for the stripped modules removed (CAMERA, RECORD_AUDIO, READ_EXTERNAL_STORAGE, biometric, fine/coarse location). Leaves the default Expo permission set.
- `ios.infoPlist` — NSCameraUsageDescription / NSPhotoLibraryUsageDescription / NSFaceIDUsageDescription / NSLocationWhenInUseUsageDescription all removed.
- `plugins` array — kept only `expo-router` + `expo-splash-screen`.

## Version state

| Constant | Before | After |
|---|---|---|
| MOBILE_BUNDLE_VERSION | `paneltec-v160.3.9.58.13.132at` | `paneltec-v160.3.9.58.13.132ba` |
| app.json version | 1.0.6 | 1.0.7 |
| app.json android.versionCode | 137 | 138 |
| RUNNING_VERSION (web) | `paneltec-v160.3.9.58.13.132az` | unchanged |
| CACHE_VERSION (web SW) | `paneltec-v160.3.9.58.13.132az` | unchanged |

Web frontend untouched — the moment `.132ba` gives us a signal, we roll straight to a `.132bb` mobile build.

## What Stephen does when the build finishes

1. Re-scan the same install QR (points at `paneltec-field-app-v58.13.132ba.apk` once it lands).
2. Install.
3. Tap the icon.

### Case A — App opens
Congrats. One of the stripped modules is the launch-crash trigger. Restore them one at a time in `.132bb`, `.132bc`, etc. Most likely suspects in order:
- `expo-notifications` (asks for notification permission at boot on newArch)
- `expo-camera` (initialises native session lazily but sometimes on boot for permission check)
- `expo-local-authentication` (queries biometric hardware at construction)

### Case B — App still crashes
The offender is in code we couldn't strip. Sentry (still wired in) should now capture a native stack with fewer competing native frames. Share the Sentry EU event URL and we chase Reanimated + New Architecture in `.132bb` — most likely the `newArchEnabled: true` × `react-native-worklets 0.5.1` combo. `.132an` tried a Reanimated downgrade but reverted; if Sentry points at Reanimated we redo it with the New Architecture flag flipped off.

## EAS command used

```
EXPO_TOKEN=<redacted> npx eas-cli@latest build \
  --platform android --profile preview --non-interactive --no-wait
```

`EXPO_TOKEN` passed inline only, redacted from all outputs, never persisted to disk or committed.

## Rollback

Roll `mobile/package.json`, `mobile/app.json`, `mobile/src/services/auth.ts`, `mobile/src/components/ErrorBoundary.tsx`, `mobile/src/lib/version.ts` back to their `.132at` shape (git revert this commit). Nothing on the backend depends on the stripped shape — the manifest still points at `.132at` until this build lands and we deliberately swap it.

## Not in this ship

- Web frontend — untouched.
- Backend — untouched.
- iOS build — untouched (no Apple Developer account yet).
