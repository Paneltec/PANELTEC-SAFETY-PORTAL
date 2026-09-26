# v58.13.132n7c — Phone-preview worker auto-select + EAS APK rebuild triggered

Follow-up to `.132n7b`. Two things ship in this iteration:

1. **UX polish**: the admin phone-preview worker picker now
   auto-selects the current admin's own workers row on first mount,
   so the "Today's Assignment" tile hydrates without the operator
   having to hunt for the dropdown.
2. **EAS APK build triggered** via `eas-cli` (installed globally via
   `yarn global add`). Preview-APK profile, Android, non-interactive,
   `--no-wait` so the build queues + returns.

## 1) Phone-preview worker auto-select

### Behaviour before

`components/settings/MobileModulesSection.jsx :: PhonePreview` mounts
with `previewWorkerId = ''` → the preview session mints with no
worker binding → `/api/mobile/daily-jobs/today` cannot resolve any
seed → tile shows the empty state. Admin has to open the "Preview as
specific worker" dropdown and manually select themselves (Stephen
Guy) every visit.

### Behaviour after

- `previewWorkerId` initial state now hydrates from
  `localStorage[perms.previewDropdown.workerId]`. Once the admin
  picks (or explicitly clears) the picker, we persist that choice
  and honour it forever.
- If the localStorage key was never written (first visit ever) AND
  the current admin's email matches a `workers.email` returned by
  `GET /api/mobile/preview-user/workers`, we auto-set
  `previewWorkerId = <that worker.id>` and rebuild the iframe URL
  once the workers list resolves. For Stephen this lands on
  `dbddf739-5803-4a86-925d-ed1aef514fa1` → the .132n7b trial seed
  now surfaces on the tile without any picker interaction.
- Hint text under the picker adapts to state:
  - No worker picked → "Pick a worker to see their real Today's
    Assignment on the phone tile. Preview stays read-only."
  - Worker picked → "Preview session stays read-only. Writes are
    blocked server-side."

### What we did NOT change

- Preview minting endpoint stays untouched — the auto-select happens
  purely FE-side by consuming the existing
  `/mobile/preview-user/workers` payload + the already-persisted
  `paneltec_user` blob from `getUser()`.
- Admins whose email doesn't map to any workers row (e.g. a fresh
  onboarding admin) still see the generic no-worker preview. They
  fall back to the pre-`.132n7c` behaviour: pick a worker
  explicitly. Hint text reminds them.
- Reset preview / Exit preview buttons still clear the in-session
  worker binding (they don't touch localStorage), so a subsequent
  page mount will re-auto-select the admin. That matches the
  operator's intent — "reset" is a temporary onboarding-flow test,
  not a permanent picker preference.

### Files

  frontend/src/components/settings/MobileModulesSection.jsx
      +getUser import
      +LS_PREVIEW_WORKER_ID + previewWorkerPickerTouched ref
      +auto-select-on-workers-fetch guard
      +onWorkerChange persistence
      +hint text state-aware

### Testing

  · yarn build (implicit via hot reload) — Compiled successfully.
  · No new console errors.
  · Manual smoke deferred (Playwright login on this preview host
    doesn't stick — see .132n7b memo). The change is FE-only and
    consumes existing endpoints; curl proof from `.132n7b` still
    holds for the underlying data path.

## 2) EAS APK rebuild — TRIGGERED

`eas-cli@24.8.0` installed globally via `yarn global add`
(binary at `/usr/local/bin/eas`). Authenticated using `EXPO_TOKEN`
from `backend/.env` as `stephenguy` (`stephen@paneltec.com.au`).

Triggered from `/app/mobile/` (READ-ONLY — no file edits):

    EXPO_TOKEN=<redacted> eas build \\
        --platform android \\
        --profile preview-apk \\
        --non-interactive \\
        --no-wait

Profile choice justification: `eas.json` defines three profiles.
`production` builds an `app-bundle` (AAB, Play-Store-only). The
existing published binary is an APK for sideloading. `preview-apk`
matches the historical distribution shape, so we use that.

### Build metadata

  · **Build URL**: https://expo.dev/accounts/stephenguy/projects/paneltec-civil-field/builds/cf70a770-e7fa-4c6b-87d4-38a533946d98
  · **Build ID**: `cf70a770-e7fa-4c6b-87d4-38a533946d98`
  · Platform: Android
  · Profile: `preview-apk`  (distribution=internal, buildType=apk)
  · Version: **1.0.48 build 170**  (previous published: 1.0.40 build 162)
  · Runtime: 1.0.18
  · SDK: 57.0.0
  · Commit: `227addbe`  (the .132n7b commit)
  · Started: 2026-09-26 07:53:34 UTC
  · Status at commit time: **in progress** (EAS typical ~15 min turnaround)

### Post-build ingest

Once the build finishes on Expo's cloud, pull the artifact onto the
pod so the in-app "Download Android APK" link serves the fresh
binary. Existing endpoint already handles this:

    POST /api/mobile/downloads/android/ingest-from-eas
    (admin-only; reads `EXPO_TOKEN`; picks the newest FINISHED
    internal Android build with an artifact URL; drops it in
    `APK_DIR` + refreshes `android_manifest.json`.)

Call this from the admin UI's Settings → Mobile App Modules →
"Download Android APK" area, OR curl it manually with an admin JWT.

### What we did NOT change

- `/app/mobile/` untouched (no file edits, only reads via `eas-cli`).
- No `production` profile switch — sticking with `preview-apk` for
  APK distribution.
- No auto-ingest hook after build finish. Stephen (or the next
  agent) needs to hit `ingest-from-eas` once EAS reports FINISHED
  to publish the new APK on `/api/mobile/downloads/android/latest.apk`.
- `eas-cli` installed globally via `yarn` (not `npm`) to honour the
  environment's yarn-only rule. Binary lives at `/usr/local/bin/eas`.

## Ship pointers

- `.132n7c` = one FE file change + one memo.
- `.132n7b` seed still valid and required; nothing here supersedes
  the wide-net trial-seed script.
- Not pushed. Residual parallel-actor files remain untouched.
