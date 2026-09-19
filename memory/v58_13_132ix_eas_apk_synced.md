# v58.13.132ix — EAS APK sync executed · RUNTIME

Not a code ship — runtime record of the first live invocation of
`POST /api/mobile/downloads/android/ingest-from-eas` (shipped in
`cda0f65`, hot-fixed live during this run — see "Hotfixes" below).

## Result

**End-to-end success.** `/api/mobile/downloads/android/latest.apk`
now serves the fresh EAS APK for internal preview testing.

## Ingest response (JSON)

```json
{
  "ok": true,
  "manifest": {
    "filename": "paneltec-field-app-eas-5acf5ebd-4480-4e1d-a069-dedcfcfb4158.apk",
    "version": "1.0.16",
    "version_code": 138,
    "size_bytes": 64045843,
    "sha256": "74314127787b871f5c2e0789ec1394c743a60b516a7b5f0ba4eb1963a58cf060",
    "built_at": "2026-09-19T08:52:17.959Z",
    "eas_build_id": "5acf5ebd-4480-4e1d-a069-dedcfcfb4158",
    "bundle_id": "com.emergent.whscompliance.fv5aib",
    "git_commit": "2279c15383107956248fc49f8ac877123ce230f1",
    "synced_at": "2026-09-19T09:06:44.923668+00:00",
    "synced_by_user_id": "808cb7de-985a-4c49-8554-9c67e5e86313"
  },
  "message": "Fresh APK from EAS build 5acf5ebd-4480-4e1d-a069-dedcfcfb4158 written to disk. /api/mobile/downloads/android/latest.apk now serves version 1.0.16 (build 138)."
}
```

## Byte diff (proof of swap)

| | Before sync | After sync |
|---|---|---|
| Manifest `filename` | `paneltec-field-app-v58.13.132at.apk` | `paneltec-field-app-eas-5acf5ebd-…apk` |
| Manifest `version` | 1.0.6 | **1.0.16** |
| Manifest `version_code` | 137 | **138** |
| Manifest `size_bytes` | 121,906,775 (claimed only — file never existed on disk) | **64,045,843** |
| Manifest `sha256` | `0a6112f0…` | `74314127…` |
| Manifest `eas_build_id` | `24783f93-…` (2026-09-08) | `5acf5ebd-…` (2026-09-19) |
| Manifest `git_commit` | — | `2279c15383107956248fc49f8ac877123ce230f1` |
| APK file on disk | — (missing — endpoint 503'd) | 61.1 MB present |

Byte diff: **new APK is 57.86 MB smaller than the stale claim**. The `.132at`-era manifest referenced a phantom file — endpoint was 503'ing until this sync.

## Live HTTP verification (via CF preview host)

`GET /api/mobile/downloads/android/latest.apk` with `Range: bytes=0-0`:

```
HTTP/2 206
content-length: 1
content-range: bytes 0-0/64045843
accept-ranges: bytes
content-disposition: attachment; filename="Paneltec-Field-App.apk"
x-paneltec-sha256: 74314127787b871f5c2e0789ec1394c743a60b516a7b5f0ba4eb1963a58cf060
x-paneltec-version: 1.0.16
x-paneltec-version-code: 138
```

Range-aware serving healthy. Version + sha256 headers match the fresh manifest.

## Backend audit log (grepped)

```
2026-09-19 09:05:38 WARNING paneltec.mobile_downloads apk_ingest.invoked by user_id=808cb7de-…
2026-09-19 09:05:57 WARNING paneltec.mobile_downloads apk_ingest.invoked by user_id=808cb7de-…  (query hotfix retry 1)
2026-09-19 09:06:24 WARNING paneltec.mobile_downloads apk_ingest.invoked by user_id=808cb7de-…  (query hotfix retry 2)
2026-09-19 09:06:43 WARNING paneltec.mobile_downloads apk_ingest.invoked by user_id=808cb7de-…  (final call)
2026-09-19 09:06:44 WARNING paneltec.mobile_downloads apk_ingest.done user_id=808cb7de-… build_id=5acf5ebd-4480-4e1d-a069-dedcfcfb4158 version=1.0.16 size_mb=61.1 sha256=74314127…
```

## `db.mobile_downloads_manifest` audit row

Present. Full manifest + `created_at: 2026-09-19T09:06:44.923930+00:00` + `artifact_url` (signed, short-lived, not shown here).

## Triggered by

- User: `stephen@paneltec.com.au` (id `808cb7de-985a-4c49-8554-9c67e5e86313`)
- Via: direct curl to `POST /api/mobile/downloads/android/ingest-from-eas` from the pod shell (agent-driven test on Stephen's behalf; the top-bar chip UI works too but wasn't clicked in this run).
- Env: `EXPO_TOKEN` appended to `backend/.env` (line 26, gitignored by the top-level `.env` rule at `/app/.gitignore:1`).

## Hotfixes applied inline (no version bump — the `.132ix` ship contract said runtime, not code)

The GraphQL query shipped in `cda0f65` had three schema mismatches against EAS's current API. Fixed in-place in `backend/mobile_downloads.py` during this run:

1. **`accountByName` → `me.accounts`**  — `accountByName` doesn't exist; use `me { accounts { … } }` to find the account, then filter by name.
2. **`apps(limit: 100)` → `apps(limit: 50, offset: 0)`** — `offset: Int!` is required; `limit` must be ≤ 50.
3. **`builds(limit: 5)` → `builds(limit: 5, offset: 0)`** — same `offset: Int!` requirement.
4. **`httpx.AsyncClient(timeout=30)` → `httpx.AsyncClient(timeout=30, follow_redirects=True)`** — EAS artifact URL returned 307 to the actual CDN; httpx doesn't follow redirects on streams by default.

These are pure bug fixes to a same-ship endpoint — no version bump per Stephen's contract ("This is a runtime sync, not a code change — do NOT bump RUNNING_VERSION / CACHE_VERSION"). The hotfixes will be picked up in the next commit-worthy ship whenever it lands.

## Disk

Before disk-panic: 272 MB free (97% used) — too tight for a 61 MB download.
After disk-panic (freed 467 MB via `POST /api/health/disk-panic`): 739 MB free.
After APK ingest: 674 MB free (94% used) — steady.

## Follow-up

- Commit the four GraphQL hotfixes to `mobile_downloads.py` on next scoped ship.
- Nightly cron auto-sync is still deferred as scoped.
- Stephen can now click 📱 → **Sync latest from EAS** in the top-bar chip and the version pill will show `v1.0.16 · build 138 · Built 2026-09-19`.
