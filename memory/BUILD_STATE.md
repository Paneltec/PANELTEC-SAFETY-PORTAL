# BUILD_STATE.md — v58.13.132p2c

Snapshot generated at close of `.132p2b` session, before the docs-only
`.132p2c` ship. This file is regenerated at every major ship — treat
it as a point-in-time view of the running build, not a historical log
(that lives in `PROJECT_STATE.md`).

---

## Current versions

| Surface                        | Version                                | Notes                                                    |
|--------------------------------|----------------------------------------|----------------------------------------------------------|
| Web `RUNNING_VERSION`          | `paneltec-v160.3.9.58.13.132p2a`       | Bumps to `.132p2c` in this docs ship.                    |
| Web `EXPECTED_CACHE_VERSION`   | `paneltec-v160.3.9.58.13.132p2a`       | Same.                                                    |
| Service worker `CACHE_VERSION` | `paneltec-v160.3.9.58.13.132p2a`       | Bumps to `.132p2c` in this ship.                         |
| Mobile `app.json`              | `1.0.50` (`versionCode: 172`)          | Reflects `.132p2` mobile ship (Job screen redesign).     |
| **Published APK on disk**      | **`1.0.50` build `172`**               | Fresh — auto-ingested by watchdog at 11:17:01Z.          |
| Backend HEAD SHA               | `29d268c6`                             | `.132p2b`: colour palette lock in mobile theme.          |

APK manifest details (from `backend/static/downloads/android_manifest.json`):

```
filename:     paneltec-field-app-eas-9f9abe41-6b29-4082-b190-0b2a9088a6bb.apk
version:      1.0.50
version_code: 172
size_bytes:   148,566,712  (~141.7 MB)
sha256:       ec3ed3d89ae89d6944d9ec84eddddd003f84d8e46b36ba1210e432850645cb01
built_at:     2026-09-26T11:14:12.371Z
eas_build_id: 9f9abe41-6b29-4082-b190-0b2a9088a6bb
synced_at:    2026-09-26T11:17:01Z
synced_by:    scheduler tick (source=watchdog)
```

---

## Unpushed commits

**No upstream remote configured** — every commit is local. Backlog of
significant recent ships in this working set (newest first):

```
29d268c6  132p2b: lock full color palette in colors.ts + normalize hex literals across mobile
08ce98ed  132p2a: persistent EAS APK auto-ingest scheduler + immediate v1.0.50 ingest
79b1ffc1  132p2:  Job screen redesign (before/after accept) with truck-prestart button, navigate, sign-on stub
b740dc62  132p1b: Android SMS BroadcastReceiver via Expo config plugin + local notification + retry queue
1959d5b1  132p1a: mobile parser + iPhone paste modal + paneltec:// deep-link
7f4244bd  132p1:  Phase 2 SMS intake (Android BroadcastReceiver + iOS paste flow + deep-link import)
f496ed01  132p0:  lock daily_job_assignments to 7 SMS fields, add shared SMS parser, purge task/supervisor/truck-split
9cd87ee5  132n7d: EAS build watcher + auto-ingest of fresh APK (v1.0.48 build 170 live)
8bbeaebb  132n7c: phone-preview worker auto-select + EAS APK rebuild triggered
227addbe  132n7b: wide-net trial-seed for phone-preview tile + EAS rebuild status memo
2bf61da2  132n8:  hard NAS-write lockdown — refuse all Dropbox → NAS writes at the code layer
7f655efc  132n7a: issue today's job form (supervisor removed) + trial-to-my-phone + real SMS-shape trial seed + /today fallback
1956e2f4  132n5m5: mobile — remove supervisor UI, filter self from work mates, new-job pulse + banner
```

Total commits ever on branch: `1010` (project inception cumulative).
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
CACHE_VERSION  →  paneltec-v160.3.9.58.13.132p2a   (→ .132p2c on this ship)
```
Managed by supervisor on `:3000`. Hot-reload live.

### Published APK
```
/api/mobile/downloads/android/latest.apk  →  200
Content-Type: application/vnd.android.package-archive
Content-Length: 148566712
```
Serving v1.0.50 build 172, sha256 `ec3ed3d8…`. Refresh dropdown to
pick up the freshly-published binary.

### EAS build status
```
Latest FINISHED build: 9f9abe41-6b29-4082-b190-0b2a9088a6bb
  Platform:     ANDROID
  Profile:      preview-apk
  Version:      1.0.50  (build 172)
  Started:      2026-09-26T10:48:55.755Z
  Finished:     2026-09-26T11:14:12.371Z    (~25 min end-to-end)
  Distribution: internal
```
No active builds in flight. Next build will be triggered by Phase 4+
mobile ships.

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
| `eas_apk_ingest_watchdog`       | **5 min**         | ✓        | NEW in `.132p2a`. Successfully auto-ingested v1.0.50 at 11:17:01Z. Last tick: 11:26:55Z, action=same-build, build_id=9f9abe41-…. |
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
- **Team folder namespace**: `DROPBOX_TEAM_FOLDER_ID` not in `.env`
  in this pod. Runtime resolves via
  `dbx.with_path_root(PathRoot.namespace_id(team_folder_id))` when
  the team-folder id is discovered at OAuth completion — not required
  at boot.

### NAS lockdown state
```
MIGRATION_DISABLED = True    (both dropbox_bytes_copy.py + integrations_dropbox.py)
```
Guard-count audit:

| File                              | `MIGRATION_DISABLED` occurrences |
|-----------------------------------|----------------------------------|
| `backend/dropbox_bytes_copy.py`   | 6                                |
| `backend/integrations_dropbox.py` | 16                               |
| **Total**                         | **22**                           |

Endpoints intentionally return HTTP 503 while the lockdown is active:
- `POST /api/dropbox/migration/start`
- `POST /api/dropbox/migration/{run_id}/resume`

Runtime write refusal: any call into the byte-copy path logs
`[copy] run_id=... REFUSED — MIGRATION_DISABLED` and returns
without touching the NAS.

---

## Environment notes (`backend/.env`)

| Key                      | Present? | Length | Notes                                                     |
|--------------------------|----------|--------|-----------------------------------------------------------|
| `MONGO_URL`              | ✓        | 27     | Local Mongo.                                              |
| `DB_NAME`                | ✓        | 15     | Unchanged since env init.                                 |
| `EMERGENT_LLM_KEY`       | ✓        | 32     | Used for GPT / Claude / Nano-Banana / Whisper / OpenAI embeddings. |
| `EXPO_TOKEN`             | ✓        | 40     | Authenticates as `stephenguy`. Prefix `nopw…`, suffix `…hQY3`. Confirmed working via `.132p2a` scheduler ingest. |
| `DROPBOX_APP_KEY`        | ✓        | 15     |                                                           |
| `DROPBOX_APP_SECRET`     | ✓        | 15     |                                                           |
| `DROPBOX_TEAM_FOLDER_ID` | ✗        | —      | Resolved at OAuth completion; not required in `.env`.     |
| `NAVIXY_API_TOKEN`       | ✗        | —      | `navixy_sync_counters` scheduler skipped when missing.    |
| `REACT_APP_BACKEND_URL`  | ✓ (frontend/.env) | — | `https://whs-compliance.preview.emergentagent.com`. |

---

## Tooling on the pod

- `eas-cli@24.8.0` installed globally via `yarn global add` — binary
  at `/usr/local/bin/eas`. **BUT**: this binary is wiped on every
  container restart. Rebuild recipe: `yarn global add eas-cli`
  (see `/app/memory/v58_13_132p2a_eas_auto_ingest.md`). The
  `eas_apk_ingest_watchdog` scheduler does NOT depend on the CLI
  binary — it uses `httpx` + EAS GraphQL directly.

- No `expo-cli` locally.

- Supervisor commands (no user restarts of processes):
  - `sudo supervisorctl status`
  - `sudo supervisorctl restart backend`
  - `sudo supervisorctl restart frontend`
