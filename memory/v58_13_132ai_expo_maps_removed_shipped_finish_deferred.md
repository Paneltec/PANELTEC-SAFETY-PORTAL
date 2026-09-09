# v58.13.132ai — Drop expo-maps, rebuild APK

**Ship status:** SHIPPED (finish deferred).
**Comms Safe Mode:** ON (unchanged).
**Batch scope:** mobile-only. Web + backend untouched apart from `android_manifest.json` and the `.132af` test assertions.

---

## Root cause hypothesis (from Stephen)

Since `.132af` (first EAS build to actually include `expo-maps` at native level) the standalone APK crashes on launch with a generic Android error. `expo-maps ~0.11.0` is a pre-1.0 preview; `react-native-reanimated 4.x` forces `newArchEnabled: true`; the combination has documented instability. Fastest way to test: remove `expo-maps` entirely — the app never used it at the JS layer.

Confirmed pre-build: `grep -rn "expo-maps" /app/mobile/src /app/mobile/app` returned **zero JS imports**. Home hero (`app/(tabs)/home.tsx:378-386`) uses `<Image source={{ uri: openstreetmap-tile }}>` — no native map component. Removing the dep is a pure no-op at the JS layer.

---

## Changes shipped

### 1. `mobile/package.json` — dependency removed
- `"expo-maps": "~0.11.0"` deleted.
- `yarn install` regenerated `yarn.lock` (auto-ran on package.json edit). `node_modules/expo-maps` verified absent.

### 2. `mobile/app.json` — version bumps
- `expo.version`: `"1.0.2"` → `"1.0.3"`.
- `expo.android.versionCode`: `133` → `134`.

### 3. `frontend/src/lib/version.js` + `mobile/src/lib/version.ts`
- `RUNNING_VERSION`: `paneltec-v160.3.9.58.13.132ah` → `paneltec-v160.3.9.58.13.132ai`.
- `MOBILE_BUNDLE_VERSION`: `paneltec-v160.3.9.58.13.132ag` → `paneltec-v160.3.9.58.13.132ai`.
- `CACHE_VERSION` / `EXPECTED_CACHE_VERSION`: **unchanged** (no web UI change in this batch).

### 4. `backend/static/downloads/android_manifest.json` — rebuilt

```json
{
  "filename": "paneltec-field-app-v58.13.132ai.apk",
  "version": "1.0.3",
  "version_code": 134,
  "size_bytes": 115672735,
  "sha256": "68022d29b266bf5ecb49b457839eee669cf53530b68ddb6ad46bea8f594a52e7",
  "built_at": "2026-09-08T00:42:49Z",
  "eas_build_id": "9434e49a-945d-4b03-8254-fe63cfd71673",
  "bundle_id": "com.emergent.whscompliance.fv5aib",
  "ship_version": "paneltec-v160.3.9.58.13.132ai"
}
```

### 5. `backend/tests/test_v58_13_132af_apk_downloads.py` — assertions bumped
- `version_code == 134`, `version == "1.0.3"`.
- `sha256 NOT IN {old .132af, old .132ag}` — hardened to catch both prior broken builds.

---

## EAS Build

| Field | Value |
|---|---|
| **Build ID** | `9434e49a-945d-4b03-8254-fe63cfd71673` |
| Platform | Android |
| Profile | preview |
| Distribution | internal |
| SDK Version | 54.0.0 |
| Version | 1.0.3 |
| Version code | 134 |
| Fingerprint | `d2198adbc49664077c28b7982cfd9771d42e42dc` |
| Started | 2026-09-08 00:25:40 UTC |
| Finished | 2026-09-08 00:42:49 UTC (17 min 09 s) |
| Artifact URL | `https://expo.dev/artifacts/eas/ABLtcJ4_r4h6wq1S15HI1S4NoPBooyYtwSFKiYyQD5Q.apk` |
| Logs | `https://expo.dev/accounts/stephenguy/projects/paneltec-civil-field/builds/9434e49a-945d-4b03-8254-fe63cfd71673` |

**Fingerprint changed vs `.132ag`** (was `bce29c80…`, now `d2198adb…`) — confirms the native module graph is genuinely different, i.e. expo-maps is really gone from the APK, not just from package.json.

---

## APK metadata (post-download)

| Field | Value |
|---|---|
| On-disk path | `/app/backend/static/downloads/paneltec-field-app-v58.13.132ai.apk` |
| Size | **115,672,735 bytes** (≈110 MB) |
| SHA-256 | `68022d29b266bf5ecb49b457839eee669cf53530b68ddb6ad46bea8f594a52e7` |
| Prior `.132ag` size | 120,565,090 bytes (≈115 MB) |
| **Delta** | **−4.7 MB** — consistent with removing the `expo-maps` native module + its Play-services-maps transitive libs. |

---

## Curl verification (served via the `.132ah` Range-aware handler)

Internal `localhost:8001`:

```
$ curl -sI http://localhost:8001/api/mobile/downloads/android/version
HTTP/1.1 405   ← HEAD not allowed (endpoint is GET-only, expected)

$ curl -s http://localhost:8001/api/mobile/downloads/android/version | python -m json.tool
{
  "available": true,
  "filename": "paneltec-field-app-v58.13.132ai.apk",
  "version": "1.0.3",
  "version_code": 134,
  "size_bytes": 115672735,
  "sha256": "68022d29b266bf5ecb49b457839eee669cf53530b68ddb6ad46bea8f594a52e7",
  ...
}

$ curl -s -o /dev/null -D - http://localhost:8001/api/mobile/downloads/android/latest.apk | grep -E 'HTTP|accept-ranges|content-length|x-paneltec'
HTTP/1.1 200 OK
accept-ranges: bytes
content-length: 115672735
x-paneltec-version: 1.0.3
x-paneltec-version-code: 134
x-paneltec-sha256: 68022d29b266bf5ecb49b457839eee669cf53530b68ddb6ad46bea8f594a52e7
```

Range support carried over from `.132ah` — no regression.

---

## Pytest

```
$ python -m pytest tests/test_v58_13_132ah_range_delivery.py tests/test_v58_13_132af_apk_downloads.py -v
tests/test_v58_13_132ah_range_delivery.py::test_full_download_advertises_range_and_streams_entire_file PASSED
tests/test_v58_13_132ah_range_delivery.py::test_range_first_1024_bytes_returns_206_with_content_range   PASSED
tests/test_v58_13_132ah_range_delivery.py::test_range_last_10_bytes_returns_206_tail_slice              PASSED
tests/test_v58_13_132ah_range_delivery.py::test_range_beyond_eof_returns_416_not_satisfiable            PASSED
tests/test_v58_13_132ah_range_delivery.py::test_malformed_range_header_returns_416                      PASSED
tests/test_v58_13_132ah_range_delivery.py::test_version_endpoint_still_returns_manifest                 PASSED
tests/test_v58_13_132af_apk_downloads.py::test_android_download_endpoints                               PASSED

============================== 7 passed in 5.36s ===============================
```

---

## Instructions for Stephen (retest)

> 1. Get on Wi-Fi.
> 2. Re-scan the same onboarding QR — URL unchanged.
> 3. Landing page will now show **File size: ~110 MB** (down from 115 MB — expected, expo-maps removed) and **Verify: 68022d29…**.
> 4. Tap **Download & install**. Approve "Install from unknown sources".
> 5. Launch app. **If it still crashes on launch**, capture the exact Android error (long-press notification → "App info" → "Force close" trace, or install `adb logcat` output if you can wire your phone up) and I'll prep `.132aj` (Sentry crash reporting).
> 6. If it opens: set PIN → done. We now know `expo-maps` was the culprit.
> 7. Old `.132ag` file (`paneltec-field-app-v58.13.132ag.apk`) is kept on disk as a rollback anchor — same URL always serves the latest per the manifest.

---

## Security & token compliance

- `EXPO_TOKEN` was supplied inline on the `eas build` CLI (`EXPO_TOKEN=<redacted> npx eas-cli@latest build …`).
- Token never written to `/app/mobile/.env`, `/app/backend/.env`, `~/.expo/*`, or any repo file.
- Token never appears in any log or memo — this doc redacts it as `<redacted>`.
- Polling script wrote to `/tmp/eas_poll_132ai.log` (pod-local, no persistence). Contents scanned — no token leak; only build ID + status lines.
- No future batches can reuse this token without a new inline supply from you.

---

## If the crash persists → `.132aj` prep note (NOT shipped)

If `.132ai` still crashes on Stephen's phone, ship `.132aj` = wire up `@sentry/react-native` (or `sentry-expo`) so we can pull real stack traces rather than guess. We'd need:
- A Sentry DSN (either yours or a fresh Paneltec-owned org).
- Environment var `EXPO_PUBLIC_SENTRY_DSN` in `mobile/.env` (never committed).
- ~40 lines wiring `Sentry.init()` at `app/_layout.tsx` boot + `ErrorBoundary` around the router.
- Ship as `.132aj` with a new APK.

Not scoped this batch — awaiting your call after retest.

---

## Files touched

- `mobile/package.json` (removed `expo-maps`)
- `mobile/yarn.lock` (auto-regenerated by yarn install)
- `mobile/app.json` (version `1.0.3`, versionCode `134`)
- `mobile/src/lib/version.ts` (`MOBILE_BUNDLE_VERSION`)
- `frontend/src/lib/version.js` (`RUNNING_VERSION`)
- `backend/static/downloads/android_manifest.json` (rewritten)
- `backend/static/downloads/paneltec-field-app-v58.13.132ai.apk` (downloaded, new file)
- `backend/tests/test_v58_13_132af_apk_downloads.py` (bumped assertions to `.132ai`)
- `memory/v58_13_132ai_expo_maps_removed_shipped_finish_deferred.md` (this memo)

Zero DB migrations. Zero new backend deps. `expo-maps` fully purged from node_modules, yarn.lock, and package.json.
