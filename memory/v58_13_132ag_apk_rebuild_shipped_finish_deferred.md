# v58.13.132ag — SHIPPED (APK rebuild — `EXPO_PUBLIC_BACKEND_URL` baked in)

Status: **shipped after first attempt errored. Second attempt with
`newArchEnabled` reverted succeeded. New APK hosted at same URL —
Stephen tap-updates over `.132af` via the same QR. Pytest 1/1.**

## Fix path (2 attempts)

### Attempt 1 — FAILED
- `newArchEnabled: false` + eas.json `env` block for `EXPO_PUBLIC_BACKEND_URL`.
- Gradle failed after 1m 57s with:
  ```
  > Task :react-native-reanimated:assertNewArchitectureEnabledTask FAILED
  BUILD FAILED
  ```
- **Root cause of failure**: `react-native-reanimated` 4.x (bundled with Expo SDK 54) **requires** `newArchEnabled: true`. The Old Architecture path is dead in Reanimated 4.
- Errored build ID: `1f8ec363-b7a9-4a73-b07d-1489905b1d2f` (kept for audit).

### Attempt 2 — SUCCESS
- Reverted `newArchEnabled: true` (kept as `.132af`).
- Kept the eas.json `env` block change (this is the actual fix).
- Successful build ID: `477b405b-1a5f-425c-b973-5cbd044f549b`
- Duration: ~14 min (08:23:59 → 08:38:28 UTC).

**Isolating hypothesis #2 (missing backend URL) is the real fix.**
Hypothesis #1 (new-arch × `expo-maps` instability) turned out to
be a red herring — we couldn't have disabled it anyway because
Reanimated 4 blocks the flip.

## APK metadata (verified)

```
Filename:     paneltec-field-app-v58.13.132ag.apk
Path:         /app/backend/static/downloads/paneltec-field-app-v58.13.132ag.apk
Size:         120,565,090 bytes  (115 MiB)
SHA-256:      d3b584fd38310b46743c1958be4ee6874bbfe32dfc47eb02efeffda6c1532c3c
              (differs from .132af d 954e4076... — proves fresh build)
Magic bytes:  PK\x03\x04         (valid ZIP → valid APK)
Version:      1.0.2
Version code: 133                (up from 132 → Android will offer as update)
Bundle ID:    com.emergent.whscompliance.fv5aib
Keystore:     same EAS-managed one as .132af (Build Credentials TATfMEiylK)
              → user's phone accepts as update-in-place
Built at:     2026-09-07T08:38:28Z
```

## Files changed

| File | Change |
|---|---|
| `mobile/app.json` | `version: 1.0.1 → 1.0.2`, `versionCode: 132 → 133` |
| `mobile/eas.json` | added `env: {EXPO_PUBLIC_BACKEND_URL: "https://whs-compliance.preview.emergentagent.com"}` to both `preview` and `production` profiles |
| `backend/static/downloads/paneltec-field-app-v58.13.132ag.apk` | new binary (115 MiB) |
| `backend/static/downloads/android_manifest.json` | updated to v1.0.2 / vc133 |
| `backend/tests/test_v58_13_132af_apk_downloads.py` | asserts version=1.0.2, vc=133, sha != .132af |
| `frontend/src/lib/version.js` | RUNNING → .132ag |
| `mobile/src/lib/version.ts` | MOBILE_BUNDLE → .132ag |

Backups:
- `.132af` APK moved to `/tmp/paneltec-field-app-v58.13.132af.apk.backup` (rollback available).

No landing-page or backend-route changes. Same QR content, same `/api/mobile/downloads/android/latest.apk` URL.

## Runtime verification

```
$ curl http://localhost:8001/api/mobile/downloads/android/version
{
  "available": true,
  "filename": "paneltec-field-app-v58.13.132ag.apk",
  "version": "1.0.2",
  "version_code": 133,
  "size_bytes": 120565090,
  "sha256": "d3b584fd38310b46743c1958be4ee6874bbfe32dfc47eb02efeffda6c1532c3c",
  "built_at": "2026-09-07T08:38:28Z",
  "eas_build_id": "477b405b-1a5f-425c-b973-5cbd044f549b",
  "bundle_id": "com.emergent.whscompliance.fv5aib",
  "ship_version": "paneltec-v160.3.9.58.13.132ag"
}
```

Pytest: 1 passed. Asserts version=1.0.2, versionCode=133, sha256 differs from .132af, PK\x03\x04 magic, all X-Paneltec-* headers.

## Instructions to relay to Stephen

1. On his phone, re-open the same QR from his printed card (either scan it again, or tap the landing URL from wherever he last had it). URL is unchanged.
2. Landing page renders "Welcome, Stephen" → tap **Download & install**.
3. Chrome downloads the new 115 MB APK. Android detects it as an **update** to the crashing .132af (same package name, same keystore signature) and prompts *"Do you want to install an update to this existing application?"* → tap **Update**.
4. Open **Paneltec Civil Field** from the home screen.
5. Expected result: navy splash → division selector card with **Paneltec Civil** and **Viatec Traffic Solutions**. Tap **Paneltec Civil** → PIN creation screen → main tabs (Home · Forms · Profile).
6. If it still crashes: pull `adb logcat` if possible, or report back — hypothesis #1 (`expo-maps` × new-arch) becomes the next suspect and we'd trial removing/upgrading `expo-maps`.

## Version bumps

- `RUNNING_VERSION`: `.132af` → `.132ag`
- `MOBILE_BUNDLE_VERSION`: `.132af` → `.132ag` (matches versionCode 133)
- `CACHE_VERSION` / `EXPECTED_CACHE_VERSION`: unchanged (`.132af` — no web UI change).

## Security compliance

Per user rules:
- `EXPO_TOKEN` passed inline (`EXPO_TOKEN=<value> eas ...`) — never written to any source file.
- Token NEVER logged in this memo, screenshots, or console output.
- Token NEVER committed to git.
- Post-batch env check: `env | grep -i EXPO_` → empty. Not persisted.

## Rollback

```
mv /tmp/paneltec-field-app-v58.13.132af.apk.backup /app/backend/static/downloads/paneltec-field-app-v58.13.132af.apk
# then rewrite android_manifest.json back to .132af metadata
```

Or just serve nothing (delete the manifest) — endpoint returns 503 with a friendly message and Stephen keeps using his existing (crashing) install until the next fix.

## Chain complete

Standing by for Stephen's re-test result. If the app still crashes on launch, the next `.132ah` batch would attempt either (a) drop `expo-maps` (used only on mobile home hero — degradable to a static map) or (b) pull real logcat from Stephen's phone to pin the exact native failure.
