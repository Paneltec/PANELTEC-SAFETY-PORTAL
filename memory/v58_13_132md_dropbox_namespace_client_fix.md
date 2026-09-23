# v58.13.132md — Dropbox migration: team-namespace client fix

**Ship date:** 2026-09-23 · **Author:** e1 (main agent) · **Commit:** `<sha filled at finish>`

One-line backend hotfix. Unblocks the real Dropbox → NAS migration that has been failing silently since the `.132lm` engine landed. No frontend UI changes; version bump is lockstep only.

---

## RCA (one paragraph)

`dropbox_bytes_copy._run_copy()` used the DEFAULT Dropbox client factory `integrations_dropbox._get_dbx_client()` (personal namespace) but the `dropbox_files_enum` collection was populated by `.132lj` via the TEAM-scoped `dropbox_folder_mirror._get_dbx_root_client()` — which applies `with_path_root(namespace_id=$DROPBOX_ROOT_NAMESPACE_ID)`. Every enum path is a team-space path; the personal namespace can't resolve them and `files_get_temporary_link` returns `not_found` for 100% of them. The engine's inner `try/except Exception … continue` accumulated errors in-memory only (the `.132mb` `_maybe_flush()` polish now surfaces them, but the client is still wrong), so from the outside the migration looked like it was slowly hammering Dropbox while enqueuing zero NAS ops.

## What "(Team folder conflict)" actually was

A **personal-namespace-only artifact**, not a folder rename. Evidence:

```
DEFAULT client files_list_folder(""):
  80 personal-namespace entries
  HIT: /Paneltec-General Administration (Team folder conflict)   ← with suffix

TEAM-NS client (with_path_root=ns:2673752851) files_list_folder(""):
  6 team-space entries
  HIT: /Paneltec-General Administration                          ← no suffix, matches Stephen's UI
```

Stephen never saw a "(Team folder conflict)" in his Dropbox UI because his UI is scoped to the team space. Only the API's default (personal) view carries the suffix.

## Fix

**`backend/dropbox_bytes_copy.py:270-283`** (single import + factory swap; ~10 lines including the audit comment):

```python
# v58.13.132md — Use the TEAM-NAMESPACE-scoped Dropbox client
# (via `dropbox_folder_mirror._get_dbx_root_client`, which applies
# `with_path_root(namespace_id=$DROPBOX_ROOT_NAMESPACE_ID)`). The
# `dropbox_files_enum` collection was populated by `.132lj` using
# this same team-namespace client, so every stored path is a
# team-space path. …
from dropbox_folder_mirror import _get_dbx_root_client
import nas_client
client = _get_dbx_root_client()
```

Was:
```python
from integrations_dropbox import _get_dbx_client
client = _get_dbx_client()
```

## Proof

### Sample of 40 random enum paths through team-namespace client
```
sample=40  ok=40  not_found=0  other_err=0
```
Zero failures. Two independent runs, same result.

### The exact `plugins.qmltypes` path that failed 30/30 in `.132mb`
```
DEFAULT: ApiError('path', 'not_found')
TEAM-NS: OK  link_len=267
```

### `files_list_folder("")` root listing
Team-namespace view shows `/Paneltec-General Administration` cleanly, no suffix. Personal namespace view is the only place the `(Team folder conflict)` label lives.

## Dry-run expectations (fired before ship, run_id `copy-189cbad17d0a`)

| Metric | Value |
|---|---|
| raw_files | 145,035 |
| raw_bytes | 285.2 GB |
| would_copy_files | 98,520 |
| would_copy_bytes | 255.1 GB (~237.6 GB decimal) |
| Bevs PC Backup excluded | 30,391 files / 18.0 GB |
| Jago Crt CCTV excluded | 16,122 files / 12.1 GB |
| Scoyttsdale CCTV excluded | 2 files / 2 MB |
| kept_pitt_sherry_swms_seen | ✅ true |
| kept_arthurs_lake_swms_seen | ✅ true |
| taswater_line_viewer_files_kept | ✅ 463 (≥400) |
| callibration_certificates_zip_migrated | ✅ true, 14.7 GB |

Delta vs previous dry-run: zero. Enum has not drifted since `.132lj` — no re-enum required.

## Belt-and-braces already in place from `.132mb` (kept)

- `_BACKGROUND_TASKS: set` in `integrations_dropbox.py` holds strong refs to background tasks (fixes Python 3.11 `WeakSet _all_tasks` GC footgun).
- Outer `try/except BaseException` in `run_copy_job` persists `state=failed` + traceback to `dropbox_migration_run` on any exception.
- `_maybe_flush()` heartbeat helper fires before every `continue` (excluded prefix, temp-link failure) so failure bursts don't look identical to a healthy silent run.

## Not shipped

- **`.132me`** — auth-lockout time-window decay + login-attempts forensic trail. Diagnosis complete, ~15 lines of code drafted, awaiting user green-light. Kept out of `.132md` so the migration hotfix stays surgical.
- **Re-enum** — not performed. 40/40 team-namespace verification proves it's unnecessary.

## Real migration kickoff plan

After ship:
1. Restart backend (`supervisorctl restart backend`) so the new import lands.
2. `POST /api/dropbox/migration/start {agent_id: "958bf283-9238-4a11-9673-d59dd686fb9d", dry_run: false}` — explicit `agent_id` to target `ugreen-nas` and bypass the "Office Pi freshest-wins" bug in `nas/health`.
3. 5-min health check: `state=running`, `updated_at` advancing, `files_copied > 0`, `bytes_transferred > 0`, `errors[]` minimal, `current_file` populated, `nas_ops` queue draining.
4. If any of the above is alarming — cancel run + surface traceback.

## Files touched

- `backend/dropbox_bytes_copy.py` (~10 lines)
- `frontend/src/lib/version.js` (RUNNING_VERSION + EXPECTED_CACHE_VERSION + changelog block)
- `frontend/public/service-worker.js` (CACHE_VERSION lockstep)
- `memory/v58_13_132md_dropbox_namespace_client_fix.md` (this file)

No API contract changes. No schema changes. No frontend UI changes. No mobile changes.

## Standing constraints observed

- Only `git add -- <exact-file>` for own files. Parallel-actor files (`craco.config.js`, `.bak_ticket261441`, `.132la` / `.132lg` / `.132mc` memos, `test_reports/`, `backend/tests/test_v58_13_132mb_doclib_phase2.py`) left unstaged.
- `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify -m "…"`.
- No push.
- Migration engine untouched beyond this one client-factory swap.
- `.132me` not bundled.
