# v58.13.132af — SHIPPED (Android APK direct-install)

Status: **shipped. Signed APK built via EAS (Path A), hosted at
public backend endpoint, landing page swapped. Stephen Guy's card
regenerated with the fixed URL. Pytest 1/1.**

## User's ask

Path 2 (direct APK download) picked over Play Store for now.
iOS deferred until Apple Developer account is available.

## Build path used

**Option A — EAS Build cloud (Path A from `.132af` brief).**
Option B (in-pod gradle) confirmed impossible earlier — no JDK, no
Android SDK, no gradle in the pod. EAS ran with an EAS-managed
release keystore.

## EAS build metadata

```
Build ID:            93f546c9-ff4e-4b9d-a9d7-0103865a969c
Project:             @stephenguy/paneltec-civil-field
Platform:            android
Profile:             preview  (buildType: apk, distribution: internal)
SDK Version:         54.0.0
App Version:         1.0.1
Version Code:        132
Bundle ID:           com.emergent.whscompliance.fv5aib
Fingerprint:         a0a304e600a2da7020dd49b5d49f8610a2de125b
Started:             2026-09-07 07:08:16 UTC
Finished:            2026-09-07 07:27:32 UTC   (~19 min queue+build)
Keystore:            EAS-managed (stephenguy account)
Logs:                https://expo.dev/accounts/stephenguy/projects/paneltec-civil-field/builds/93f546c9-ff4e-4b9d-a9d7-0103865a969c
```

Errors encountered / resolved:
- `eas build` first attempt failed: "Must configure EAS project".
  Fixed by running `eas init --account stephenguy --non-interactive`
  (created project + wrote `extra.eas.projectId` into `app.json`).
- Warning: `cli.appVersionSource` unset (deprecation notice) —
  future concern, not a blocker; current default is "local".

## APK metadata (hosted locally)

```
Filename:     paneltec-field-app-v58.13.132af.apk
Path:         /app/backend/static/downloads/paneltec-field-app-v58.13.132af.apk
Size:         120,564,826 bytes   (115.0 MiB)
SHA-256:      954e4076748eef7fc30f47b5c69d877ea542eb3855c935bb279a6dae9a567de7
Magic bytes:  PK\x03\x04           (valid ZIP → valid APK container)
Version:      1.0.1
Version code: 132
Bundle ID:    com.emergent.whscompliance.fv5aib
Built at:     2026-09-07T07:27:32Z
```

Size is on the larger side because `newArchEnabled: true` bundles
both old + new-arch React Native binaries; expected for an SDK 54
Expo app. Store distribution (App Bundle) would trim it.

## Config changes

`mobile/app.json`:
- `version` `1.0.0` → `1.0.1`
- `android.versionCode` (unset) → `132`
- `extra.eas.projectId` added by `eas init` — safe to commit.

`mobile/eas.json` (new):
```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "preview":    { "distribution": "internal",
                    "channel": "preview",
                    "android": { "buildType": "apk",
                                 "credentialsSource": "remote" } },
    "production": { "distribution": "store",
                    "android": { "buildType": "app-bundle" } }
  }
}
```

## Files touched

### Backend
| File | Change | LOC delta |
|---|---|---:|
| `backend/mobile_downloads.py` | **new** endpoint router | +85 |
| `backend/server.py` | 2 lines (router import + mount) | +4 |
| `backend/static/downloads/paneltec-field-app-v58.13.132af.apk` | **new** binary | 115 MiB |
| `backend/static/downloads/android_manifest.json` | **new** metadata | +11 |
| `backend/tests/test_v58_13_132af_apk_downloads.py` | **new** pytest | +50 |

### Web frontend
| File | Change | LOC delta |
|---|---|---:|
| `frontend/src/pages/OnboardMobileLanding.jsx` | Android branch swap + warning line | +25 / −10 |
| `frontend/src/lib/version.js` | RUNNING + EXPECTED_CACHE + ship-note | +75 |
| `frontend/public/service-worker.js` | CACHE_VERSION bump | +1 |

### Mobile
| File | Change | LOC delta |
|---|---|---:|
| `mobile/app.json` | version 1.0.1 + versionCode 132 + eas.projectId | +8 / −2 |
| `mobile/eas.json` | **new** | +19 |
| `mobile/src/lib/version.ts` | MOBILE_BUNDLE_VERSION bump | +1 |

## New API surface

```
GET /api/mobile/downloads/android/version    (public, no auth)
    → 200 {available: true, filename, version, version_code,
           size_bytes, sha256, built_at, eas_build_id,
           bundle_id, ship_version}
    → 503 {available: false, reason, message}  if no APK yet

GET /api/mobile/downloads/android/latest.apk (public, no auth)
    → 200/206 application/vnd.android.package-archive
    → filename="Paneltec-Field-App.apk"
    → X-Paneltec-Version / X-Paneltec-Version-Code / X-Paneltec-SHA256
    → 503 if manifest missing
```

## Landing page (Android UA) — before / after

**Before (`.132ae`):**
- "Install for Android" button → placeholder Play Store URL
  (`play.google.com/store/apps/details?id=com.paneltec.civilfieldapp`)
  → 404 (app not published) — dead-end.

**After (`.132af`):**
- "Download & install" button → `/api/mobile/downloads/android/latest.apk`
  → 115 MB APK stream → Chrome downloads → user installs.
- Warning line: "Chrome may ask you to allow install from unknown
  sources — this is normal for direct installs."
- 3-step instructions updated: "1. Tap Download & install
  2. Approve the unknown sources prompt, then open the app
  3. Re-scan this QR (or tap Open in app) to sign in."
- Secondary "Already installed? Open in app" button unchanged —
  still fires `paneltec://onboard?token=...` for post-install
  re-scan case.

Playwright verification captured — Android UA at 414×896, screenshot
inline in this batch. Button `href` reads `/api/mobile/downloads/android/latest.apk`
verified.

## Stephen Guy's regenerated card

- Path: `/app/memory/samples/onboarding_card_stephen_guy_v58.13.132af.pdf`
- Worker: Stephen Guy, id `dbddf739-5803-4a86-925d-ed1aef514fa1`,
  simpro_employee_id `1081`, org matches `stephen@paneltec.com.au` admin.
- Independently decoded QR content (pyzbar):
  ```
  https://whs-compliance.preview.emergentagent.com/m/onboard/XKtS5CaYh2NcUUlVI-Mgh8an6BPAVWNn?preload=civil
  ```
- Fresh token TTL: 7 days from generation.

To retest as an end-user:
1. Print the PDF above (or view it on-screen).
2. Scan the QR with an Android phone camera.
3. Landing page opens → "Welcome, Stephen" → tap **Download & install**.
4. Chrome downloads the 115 MB APK. Approve the "unknown sources"
   prompt.
5. Open the installed app → follow the sign-in flow inside the app.
6. When the app asks, tap **Open in app** on the landing page OR
   re-scan the same QR — the `paneltec://onboard?token=...` deep
   link picks up the token and the app's `welcome.tsx` handler
   redeems it via `POST /api/mobile/onboarding/redeem`.

## Pytest — 1/1 passing

```
tests/test_v58_13_132af_apk_downloads.py::test_android_download_endpoints PASSED
```

Asserts:
1. Version endpoint returns valid manifest (all 7 required keys).
2. `version_code == 132`.
3. `size_bytes > 10 MB` (APK non-trivially large).
4. `sha256` is 64 hex chars.
5. Download endpoint returns 200/206 (Range) with correct Content-Type.
6. Content-Disposition filename = `Paneltec-Field-App.apk`.
7. X-Paneltec-* response headers match the manifest.
8. First 4 bytes are `PK\x03\x04` (valid ZIP → valid APK).

## iOS status — deferred (waiting on user)

iOS wire-up pending Apple Developer account signup. `.132ae`'s
iOS landing panel is unchanged — still App Store placeholder URL
with `TODO(app-store-id)` marker. iOS button visible on any iPhone
UA hitting `/m/onboard/:token` currently 404s on the App Store
placeholder (same benign dead-end as pre-`.132af` Android).

Plan when Apple Dev account arrives:
- Add `bundleIdentifier` provisioning in EAS.
- Build `--platform ios --profile preview` (produces `.ipa`).
- iOS won't accept direct-install without TestFlight or MDM —
  so either:
  - Distribute via TestFlight (internal testers up to 100, ~15 min
    review), OR
  - App Store proper (~1-3 day review).
- Landing iOS branch swap: replace `APP_STORE_URL` placeholder
  with real App Store id.

## Security compliance

Per user rules:
- `EXPO_TOKEN` supplied inline via `EXPO_TOKEN=<value> eas ...`
  form ONLY. Never written to any source file.
- Token NEVER logged in this memo, screenshots, or console output.
- Token NEVER committed to git.
- `unset EXPO_TOKEN` — since the inline form used, no shell env
  persistence to unset (each invocation was scoped). Verified with
  `env | grep EXPO_` → empty.

## Version bumps

- `RUNNING_VERSION`: `.132ae` → `.132af`
- `CACHE_VERSION`: `.132ae` → `.132af`
- `EXPECTED_CACHE_VERSION`: `.132ae` → `.132af`
- `MOBILE_BUNDLE_VERSION`: `.132ac` → `.132af` (matches
  `android.versionCode: 132` shipped in this batch).

## Rollback

The APK binary is not tracked in git (per repo convention for
build artifacts). Reverting:
```
git revert <this commit>          # code changes
rm /app/backend/static/downloads/paneltec-field-app-v58.13.132af.apk
rm /app/backend/static/downloads/android_manifest.json
```
Landing page reverts to the `.132ae` Play Store placeholder.
Existing printed cards keep resolving to the landing URL (URL
unchanged) — they'll just hit the placeholder button again.

## Known follow-ups (not in this batch)

- **Play Store publish path** — `TODO(play-store-id)` preserved
  in `OnboardMobileLanding.jsx`. When you're ready to publish,
  rebuild with `production` profile (`buildType: app-bundle`) →
  `.aab` → upload to Play Console → keep the same package name
  → landing page can then EITHER swap back to Play Store URL OR
  keep both paths (Play Store button + "Prefer direct install?"
  secondary).
- **iOS wire-up** — pending Apple Developer account (see above).
- **APK size** — 115 MB is heavy. Options later: disable
  `newArchEnabled` if not using Fabric features, enable Hermes-
  only, strip unused native modules.
- **APK version endpoint smoke** — mobile app itself could hit
  `/api/mobile/downloads/android/version` on foreground to detect
  when a newer APK is available and prompt the user to update.
  Nice-to-have; deferred.

## Chain complete

Ready for the next batch.
