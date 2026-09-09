# v58.13.132al — Crash instrumentation for mobile launch-crash

**Ship status:** SHIPPED (finish deferred).
**Comms Safe Mode:** ON (unchanged).
**Batch scope:** mobile-only, plus `android_manifest.json` refresh + `.132af` test bump.

---

## Context

Stephen fresh-installed the `.132ai` APK (expo-maps removed) and the app **blinks then disappears with no error dialog**. That points to a crash too early for Android to surface even the standard crash toast. `.132al` adds 5 layers of local instrumentation so the next launch produces actionable data — without adding Sentry (no DSN yet).

---

## Changes shipped

### 1. `mobile/src/components/ErrorBoundary.tsx` (new · 260 lines)

Two exported components + 3 AsyncStorage keys:

- **`ErrorBoundary`** — class component with `componentDidCatch`. Persists to `LAST_CRASH` **before** setState so a subsequent render throw still leaves a breadcrumb for the next boot. Renders `<CrashScreen>` with error name, message, stack, componentStack, versionCode, versionName, timestamp, platform.
- **`CrashRecoveryGate`** — on mount, checks `LAST_CRASH` / `LAST_UNHANDLED_REJECTION` / `BOOT_TRACE`. If any exist, renders `<CrashScreen>` for the first record + full JSON of the rest, with a **Copy to clipboard** button (via `expo-clipboard`, already installed) and a **Dismiss & continue** button that clears the keys and falls through to normal render.
- **`<CrashScreen>`** UI: dark-red full-screen `<ScrollView>`, monospace stack blocks, prominent capture note (*"Screenshot this screen and send it to your admin"*), version + platform header.
- **Keys:** `LAST_CRASH_KEY`, `LAST_REJECTION_KEY`, `BOOT_TRACE_KEY`.

### 2. `mobile/app/_layout.tsx` (full rewrite · 175 lines)

Five instrumentation layers stacked on top of the existing layout tree:

- **Layer 5 (module-import scope)** — `SplashScreen.preventAutoHideAsync().catch(()=>{})`. If we crash *before* the React tree mounts, the splash stays visible instead of blinking off (fixes the visual symptom Stephen reported).
- **Layer 2 (module-import scope)** — `ErrorUtils.setGlobalHandler(async (error, isFatal) => …)` persists to `LAST_CRASH` then delegates to the original handler so the OS crash dialog still surfaces. Also installs `globalThis.onunhandledrejection` for the Promise engine.
- **Layer 4 (helper `traceStep`)** — wraps risky boot-time work in try/catch and appends `{step, status, error?, ts}` to `BOOT_TRACE` on every call. Currently traces one step (`root-layout-mounted`) — subsequent batches can wrap more steps as we narrow down.
- **Layer 1 (JSX)** — `<ErrorBoundary>` wraps everything.
- **Layer 3 (JSX)** — `<CrashRecoveryGate>` sits right below the boundary.

On successful mount, boot-trace is cleared and `SplashScreen.hideAsync()` fires. If any prior crash was recorded, the recovery gate short-circuits to `<CrashScreen>` before children render.

### 3. Version bumps
- `mobile/app.json` → `expo.version: "1.0.4"`, `expo.android.versionCode: 135`.
- `mobile/src/lib/version.ts` → `MOBILE_BUNDLE_VERSION: paneltec-v160.3.9.58.13.132al`.
- `frontend/src/lib/version.js` → `RUNNING_VERSION: paneltec-v160.3.9.58.13.132al`.
- `CACHE_VERSION` unchanged (no web-only rebuild required for `.132al`; bumped in the parallel `.132am` batch).

### 4. `backend/static/downloads/android_manifest.json` — rebuilt
```json
{
  "filename": "paneltec-field-app-v58.13.132al.apk",
  "version": "1.0.4",
  "version_code": 135,
  "size_bytes": 115687611,
  "sha256": "046ee4193245e4c29b96a1d94d023b0561786575db8eb555da9859a058ffd057",
  "built_at": "2026-09-08T01:43:26Z",
  "eas_build_id": "09cb2b94-528a-40bc-ade5-17a026c4dcd1",
  "ship_version": "paneltec-v160.3.9.58.13.132al"
}
```

### 5. `backend/tests/test_v58_13_132af_apk_downloads.py` — assertion bump
- `version_code == 135`, `version == "1.0.4"`.
- SHA-256 excluded from `.132af`/`.132ag`/`.132ai` (3 prior broken builds).

---

## EAS Build

| Field | Value |
|---|---|
| **Build ID** | `09cb2b94-528a-40bc-ade5-17a026c4dcd1` |
| Version / vc | 1.0.4 / 135 |
| Fingerprint | `887804644e79e23aadcd4b8151aec474d8f96fd9` |
| Started | 2026-09-08 01:28:39 UTC |
| Finished | 2026-09-08 01:43:26 UTC (14 min 47 s) |
| Artifact | `https://expo.dev/artifacts/eas/ErrI0labFo8TTNljyISqLTdIxmIcD9afexkQyp9WVco.apk` |
| Logs | `https://expo.dev/accounts/stephenguy/projects/paneltec-civil-field/builds/09cb2b94-528a-40bc-ade5-17a026c4dcd1` |

Fingerprint changed vs `.132ai` (`d2198adb…` → `887804644…`) — instrumentation is really in the native module graph.

---

## APK metadata (post-download)

| Field | Value |
|---|---|
| On-disk | `/app/backend/static/downloads/paneltec-field-app-v58.13.132al.apk` |
| Size | **115,687,611 bytes (~110 MB)** — +14 KB vs `.132ai` (JS-only additions) |
| SHA-256 | `046ee4193245e4c29b96a1d94d023b0561786575db8eb555da9859a058ffd057` |

Served through the `.132ah` Range-aware handler — no changes to the download path.

---

## Instructions for Stephen (retest)

1. Wi-Fi on, re-scan the same QR (URL unchanged).
2. Landing page will now show **`~110 MB`** + **`Verify: 046ee419…`**.
3. Tap Download & install → approve "Install from unknown sources" → Android prompts to update over `.132ai`.
4. Open the app — **whatever happens, take a screenshot**:
   - **Splash screen stays visible and never advances** → early native init crash; splash-retention layer worked. Need Sentry (`.132am`+ mobile batch) to get a native stack.
   - **Red "Previous crash detected" screen with a stack trace** → 🎯 the very reason we shipped `.132al`. Screenshot it, hit **Copy to clipboard**, and paste it back to me. Whatever the stack says, we have a real target.
   - **Red "App crashed — React tree threw during render" screen** → same story, we caught it on THIS launch. Screenshot + Copy.
   - **App opens to normal PIN entry / division picker** → the ErrorBoundary or try/catches worked around the bug. Send that too — we then remove the instrumentation once we know what broke.
   - **App blinks and closes again with no red screen** → OPEN IT A SECOND TIME. `LAST_CRASH` from the first blink will surface on the second launch as the recovery gate screen.

---

## Security & token compliance

- `EXPO_TOKEN` supplied inline on the `eas build` CLI, redacted in this memo.
- Never written to `.env` / `~/.expo/*` / repo files. Poll script log at `/tmp/eas_poll_132al.log` scanned — build ID + status only, no token.

---

## Files touched

- `mobile/src/components/ErrorBoundary.tsx` (new)
- `mobile/app/_layout.tsx` (full rewrite)
- `mobile/app.json` (version + versionCode bumps)
- `mobile/src/lib/version.ts` (MOBILE_BUNDLE_VERSION)
- `frontend/src/lib/version.js` (RUNNING_VERSION — later bumped again by `.132am`)
- `backend/static/downloads/android_manifest.json`
- `backend/static/downloads/paneltec-field-app-v58.13.132al.apk` (new APK, ~110 MB)
- `backend/tests/test_v58_13_132af_apk_downloads.py` (assertion bump)
- `memory/v58_13_132al_crash_instrumentation_shipped_finish_deferred.md` (this memo)
