# BUILD_STATE.md — v58.13.132p2j

Last updated: 2026-09-27

Snapshot generated at close of `.132p2j` session (asset detail polish
+ tile merge + Forms tab PIN loop fix). This file is regenerated at
every major ship — treat it as a point-in-time view of the running
build, not a historical log (that lives in `PROJECT_STATE.md`).

---

## Current versions

| Surface                        | Version                                | Notes                                                    |
|--------------------------------|----------------------------------------|----------------------------------------------------------|
| Web `RUNNING_VERSION`          | `paneltec-v160.3.9.58.13.132p2j`       | Bumped in `.132p2j`.                                     |
| Web `EXPECTED_CACHE_VERSION`   | `paneltec-v160.3.9.58.13.132p2j`       | Same.                                                    |
| Service worker `CACHE_VERSION` | `paneltec-v160.3.9.58.13.132p2j`       | Same.                                                    |
| Mobile `app.json`              | `1.0.54` (`versionCode: 176`)          | Reflects `.132p2j` asset detail polish.                  |
| **Published APK on disk**      | **`1.0.54` build `176`**               | Auto-ingested by watchdog at 2026-09-27T05:07:11Z.      |
| Backend HEAD SHA               | `2f60a5f8`                             | `.132p2j`: asset detail + tile merge.                    |

APK manifest details (from `backend/static/downloads/android_manifest.json`):

```
filename:     paneltec-field-app-eas-daa9caf5-65e6-4f40-acee-3de17bf8d67b.apk
version:      1.0.54
version_code: 176
size_bytes:   148,254,106  (~141.4 MB)
sha256:       200a2a6a3c882a2453fd25b584af977ed0c5d4d041e68f641aad02ab0f832b50
built_at:     2026-09-27T05:04:42.566Z
eas_build_id: daa9caf5-65e6-4f40-acee-3de17bf8d67b
git_commit:   2f60a5f8046fdd584301e5aa5a9f3a1b4cae6c48
synced_at:    2026-09-27T05:07:11.345737Z
synced_by:    watchdog
```

---

## Unpushed commits

**No upstream remote configured** — every commit is local. Backlog of
significant recent ships in this working set (newest first):

```
2f60a5f8  132p2j:  asset detail white header/title, expanded vehicle info, assigned forms category filter with persisted last-selected
e72da6c4  132p2i:  merge Today's Assignment tiles into single solid-green "You have a new job" tile
b36492c4  132p2g:  remove aggressive focus-refetch on Forms tab to prevent repeat PIN prompts + expired session subtitle
c490bf46  132p2f1: forms library correction — title #1A1A1A + stripe 4px per spec
4dc73784  132p2f:  Forms Library Option B — colour-coded tiles with SVG category icons
cfbbd929  132p2e:  bump mobile v1.0.51/173 + web lockstep for EAS APK rebuild
(earlier)  132p2d:  MY WORK tab polish (shrink tiles, single-line, solid green buttons)
(earlier)  132p2b:  lock full color palette in colors.ts + normalize hex literals across mobile
(earlier)  132p2a:  persistent EAS APK auto-ingest scheduler + immediate v1.0.50 ingest
(earlier)  132p2:   Job screen redesign (before/after accept) with truck-prestart, navigate, sign-on stub
(earlier)  132p1b:  Android SMS BroadcastReceiver via Expo config plugin + notification + retry queue
(earlier)  132p1a:  mobile parser + iPhone paste modal + paneltec:// deep-link
(earlier)  132p0:   lock daily_job_assignments to 7 SMS fields, shared SMS parser, purge task/supervisor/truck-split
```

Total commits ever on branch: ~1020+ (project inception cumulative).
No `git push` protocol until user explicitly requests it — see
`backlog.md` P2 "Push 20+ unpushed commits when user is ready".

---

## Live services state

### Backend
```
GET /api/health  →  200
{
  "ok": true,
  "checks": {
    "mongo":  { "ok": true, "ms": 0 },
    "gridfs": { "ok": true },
    ...
  }
}
```
Managed by supervisor. Uvicorn bound to `0.0.0.0:8001`. Hot-reload
enabled. Restarts required only for `.env` and requirements changes.

### Frontend / service worker
```
CACHE_VERSION  →  paneltec-v160.3.9.58.13.132p2j
```
Managed by supervisor on `:3000`. Hot-reload live.

### Published APK
```
/api/mobile/downloads/android/latest.apk  →  200
Content-Type: application/vnd.android.package-archive
Content-Length: 148254106
```
Serving v1.0.54 build 176, sha256 `200a2a6a…`.

### EAS build status
```
Latest FINISHED build: daa9caf5-65e6-4f40-acee-3de17bf8d67b
  Platform:     ANDROID
  Profile:      preview-apk
  Version:      1.0.54  (build 176)
  Started:      2026-09-27T04:42:46Z
  Finished:     2026-09-27T05:04:42Z    (~22 min end-to-end)
  Distribution: internal
  Status:       FINISHED — auto-ingested by watchdog
```
No active builds in flight. The `production` profile (AAB) is
currently broken with `EAS_BUILD_UNKNOWN_GRADLE_ERROR`. All recent
successful builds use `preview-apk` (APK).

### APScheduler jobs registered (from `server.py`)

| Job id                          | Interval          | Enabled? | Notes                                                       |
|---------------------------------|-------------------|----------|-------------------------------------------------------------|
| `navixy_sync_counters`          | 15 min            | ✓        | Registered only if `NAVIXY_API_TOKEN` present (MISSING → skipped). |
| `simpro_sync_suppliers`         | 12 h              | ✓        | Guarded on Simpro creds.                                    |
| `swms_purge_expired`            | Cron 03:15 daily  | ✓        |                                                             |
| `org_archive_apply_rules`       | Cron 03:30 daily  | ✓        |                                                             |
| `dropbox_migration_watchdog`    | 5 min             | **⚠ DISABLED** | `migration_watchdog_settings.enabled=False` — set by user_v132n0 at 2026-09-25T22:22Z. Paired with `MIGRATION_DISABLED=True` code lockdown. |
| `meter_history_daily_snapshot`  | Cron 03:45 daily  | ✓        |                                                             |
| `bulk_import_watchdog`          | 10 min            | ✓        |                                                             |
| `eas_apk_ingest_watchdog`       | **5 min**         | ✓        | Auto-ingested v1.0.54 at 05:07:11Z. |
| `backup_snapshot_watchdog`      | 1 h               | ✓        |                                                             |
| `pod_retention_sweep`           | Interval          | ✓        |                                                             |

### Dropbox integration
- **Connected**: Yes. Refresh token stored in `db.dropbox_tokens`.
- **App key / secret**: present in `backend/.env`.
- **Scopes granted** (`_DROPBOX_SCOPES` in `integrations_dropbox.py:79`):
  ```
  account_info.read
  files.metadata.read files.content.read sharing.read
  files.content.write            (post-.132n2 in-app browser writes)
  sharing.write                  (post-.132n4b Share/Permissions)
  team_data.member
  ```
  - **`files.permanent_delete`**: ticked in Dropbox App Console but
    **not yet in the refresh token** — user still needs to hit
    `/api/dropbox/oauth/start` and re-authorise before the trash
    purge can run (blocks the housekeeping script).

### NAS lockdown state
```
MIGRATION_DISABLED = True    (both dropbox_bytes_copy.py + integrations_dropbox.py)
```
22 code guards across 2 files. Endpoints return HTTP 503.

---

## Environment notes (`backend/.env`)

| Key                      | Present? | Length | Notes                                                     |
|--------------------------|----------|--------|-----------------------------------------------------------|
| `MONGO_URL`              | ✓        | 27     | Local Mongo.                                              |
| `DB_NAME`                | ✓        | 15     | Unchanged since env init.                                 |
| `EMERGENT_LLM_KEY`       | ✓        | 32     | Used for GPT / Claude / Nano-Banana / Whisper / OpenAI embeddings. |
| `EXPO_TOKEN`             | ✓        | 40     | Authenticates as `stephenguy`. Confirmed working for v1.0.54 build. |
| `DROPBOX_APP_KEY`        | ✓        | 15     |                                                           |
| `DROPBOX_APP_SECRET`     | ✓        | 15     |                                                           |
| `DROPBOX_TEAM_FOLDER_ID` | ✗        | —      | Resolved at OAuth completion; not required in `.env`.     |
| `NAVIXY_API_TOKEN`       | ✗        | —      | `navixy_sync_counters` scheduler skipped when missing.    |
| `REACT_APP_BACKEND_URL`  | ✓ (frontend/.env) | — | `https://whs-compliance.preview.emergentagent.com`. |

---

## Tooling on the pod

- `eas-cli` — needs `npm install -g eas-cli@latest` after each
  container restart (not persisted). The `eas_apk_ingest_watchdog`
  scheduler does NOT depend on the CLI binary — it uses `httpx` +
  EAS GraphQL directly.
- Supervisor commands:
  - `sudo supervisorctl status`
  - `sudo supervisorctl restart backend`
  - `sudo supervisorctl restart frontend`
  - `sudo supervisorctl restart mobile`
