# v58.13.132iz — EAS API hotfix confirmation + version lockstep bump · SHIPPED (finish deferred)

**Ship phase:** `.132iz`
**Scope:** Housekeeping. Confirm the four EAS API hotfixes made inline during the `.132ix` live sync are committed, bump the version lockstep so browsers pick up the current backend/FE state.

## Parent context

`.132ix` (commit `cda0f65`) shipped `POST /api/mobile/downloads/android/ingest-from-eas` but the GraphQL query and httpx client had four schema/behaviour mismatches against EAS's current API. Live-fixed during the ingest verification run — see `memory/v58_13_132ix_eas_apk_synced.md` for the full byte-diff proof.

## The four fixes (already in `backend/mobile_downloads.py`)

Verified present with `grep`, then confirmed already committed by an intervening `.132iy` mobile ship (commit `8ef19bc4`) that picked them up in its `git add -A` sweep.

| # | Fix | Root cause |
|---|---|---|
| 1 | `accountByName(...)` → `me { accounts { … } }` | `accountByName` is not a field on `RootQuery` in EAS's current schema. `me.accounts` returns the same info accessible to the authenticated token. |
| 2 | `apps(limit: 100)` → `apps(limit: 50, offset: 0)` | `offset: Int!` is a required arg; `limit` has a hard cap of 50 (server returns `VALIDATION_ERROR: Limit must be less than or equal to 50`). |
| 3 | `builds(limit: 5, filter: …)` → adds `offset: 0` | Same `offset: Int!` requirement as `apps` — EAS returns `GRAPHQL_VALIDATION_FAILED: argument "offset" of type "Int!" is required`. |
| 4 | `httpx.AsyncClient(timeout=30)` → adds `follow_redirects=True` | The signed artifact URL returned by `artifacts.buildUrl` is HTTP 307 to the actual CDN. `httpx.AsyncClient.stream("GET")` does NOT follow redirects by default; the endpoint was returning `EAS artifact HTTP 307` for every ingest attempt. |

Result: `POST /ingest-from-eas` returns `200 OK` in ~1.4 s with a full manifest for a 61.1 MB APK download. Verified end-to-end in `.132ix` run.

## Version lockstep

- `RUNNING_VERSION` (`frontend/src/lib/version.js`)         → `paneltec-v160.3.9.58.13.132iz`
- `EXPECTED_CACHE_VERSION` (`frontend/src/lib/version.js`)  → `paneltec-v160.3.9.58.13.132iz`
- `CACHE_VERSION` (`frontend/public/service-worker.js`)     → `paneltec-v160.3.9.58.13.132iz`

Mobile stays at `1.0.17` (backend/web-only housekeeping ship).

## Ban compliance

- No `/app/mobile/` edits.
- No pytest / Playwright per standing rule. Post-commit sanity: `sudo supervisorctl restart backend` + `curl /api/health` → 200.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Follow-up

Awaiting EAS build `ca208091` (mobile `.132iy` — apiClient `AbortController` + Intelligence Briefing fallback). Stephen will click **Sync latest from EAS** in the top-bar 📱 popover once that build reaches FINISHED. The freshly-hardened EAS integration will handle it.
