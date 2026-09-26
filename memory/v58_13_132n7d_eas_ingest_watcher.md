# v58.13.132n7d — EAS build watcher + auto-ingest (post-`.132n7c` build cycle)

Follow-up to `.132n7c` which triggered the EAS APK rebuild. This
memo captures the successful build-finish + ingest cycle and adds
a reusable watcher script for future rebuilds.

## Build cycle result — ✅ ALL GREEN

```
EAS build id     cf70a770-e7fa-4c6b-87d4-38a533946d98
Status           FINISHED at 2026-09-26T08:16:39Z (~23 min after trigger)
Artifact URL     https://expo.dev/artifacts/eas/VPPGAvFCbHeiBbY4i4_ibmpYDXzdo_wIh2bSAQ2rV3Y.apk
Version          1.0.48 build 170                    (was 1.0.40 build 162)
Size             148,499,238 bytes  (~141 MB)
SHA-256          4aef9561c04ef8a84a4dcc9272f61e84396a78cf029b5d33ccdcf85a4398787a
Git commit       227addbe  (the .132n7b commit)
```

### Ingest — `POST /api/mobile/downloads/android/ingest-from-eas`

Response: HTTP 200
```json
{
  "ok": true,
  "message": "Fresh APK from EAS build cf70a770-e7fa-4c6b-87d4-38a533946d98 written to disk. /api/mobile/downloads/android/latest.apk now serves version 1.0.48 (build 170).",
  "manifest": {
    "filename":       "paneltec-field-app-eas-cf70a770-e7fa-4c6b-87d4-38a533946d98.apk",
    "version":        "1.0.48",
    "version_code":   170,
    "size_bytes":     148499238,
    "sha256":         "4aef9561…8787a",
    "built_at":       "2026-09-26T08:16:39.782Z",
    "eas_build_id":   "cf70a770-…",
    "bundle_id":      "com.emergent.whscompliance.fv5aib",
    "git_commit":     "227addbe…",
    "synced_at":      "2026-09-26T08:17:01.891386+00:00",
    "synced_by_user_id": "808cb7de-…"
  }
}
```

### Verification

- `GET /api/mobile/downloads/android/version` returns the fresh
  manifest (same shape as `manifest` above, `available: true`).
- `GET /api/mobile/downloads/android/latest.apk` with `Range:
  bytes=0-127` returns HTTP **206** partial, content-type
  `application/vnd.android.package-archive`.
- On-disk file at `/app/backend/static/downloads/paneltec-field-app-eas-cf70a770-…apk`
  is 148,499,238 bytes — matches `manifest.size_bytes` byte-for-byte.
- `HEAD /latest.apk` returns 405 (endpoint is GET-only) — cosmetic
  quirk of the watcher script, not a real defect. Real clients use
  GET (the Android package installer does GET, not HEAD).

**Stephen's phone should now see version 1.0.48 (build 170) in the
in-app update dropdown and can install it via the "Download APK"
link.** Older APKs (v1.0.40, v1.0.36) remain on disk but are not
referenced by the manifest.

## Reusable watcher — `scripts/eas_ingest_watcher_132n7d.sh`

Standalone bash script that:
  · Polls `eas build:view <id>` every 30 s (max 40 min).
  · When `status == FINISHED` and `artifacts.applicationArchiveUrl`
    is set, logs in as admin (uses `stephen@paneltec.com.au`
    credential from `test_credentials.md`) and POSTs to
    `/api/mobile/downloads/android/ingest-from-eas`.
  · Verifies `/version` metadata and issues a HEAD probe against
    `/latest.apk`.
  · Writes structured progress to `/tmp/eas_ingest_132n7d.log`.

Invocation for future rebuilds:
```
nohup /app/scripts/eas_ingest_watcher_132n7d.sh <BUILD_ID> \
      > /tmp/eas_watcher_stdout.log 2>&1 &
```

Environment prereqs (already satisfied here):
  · `eas-cli` installed globally (yarn global add).
  · `EXPO_TOKEN` set in `/app/backend/.env`.
  · Admin credentials in `/app/memory/test_credentials.md` still valid.

## Optional follow-ups

- Fold the watcher logic into `POST /api/mobile/downloads/android/build-and-ingest`
  (option 2 from the `.132n7b` memo) if the manual bash script gets
  used more than twice.
- HEAD on `/latest.apk` returning 405 is fine but slightly rude;
  could add a HEAD-alias next time the endpoint gets touched. Not
  worth a dedicated ship.

## Ship pointers

- `.132n7d` = one bash script + this memo. No FE, no BE code
  changes. No `/app/mobile` edits.
- Watcher already ran once successfully; the ingest is done and the
  APK is live.
