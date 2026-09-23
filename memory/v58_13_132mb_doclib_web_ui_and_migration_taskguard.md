# v58.13.132mb — Document Library Phase 2 web UI + Dropbox migration task-guard hotfix

**Ship date:** 2026-09-23 · **Author:** e1 (main agent) · **Commit:** `<sha filled at finish>`

---

## 🚨 UNRESOLVED — USER DECISION NEEDED (Dropbox migration)

**The Dropbox → NAS migration is CANCELLED and will remain cancelled until you decide.** This is a data / OAuth / business decision, not a code bug.

### Evidence
- Dry-run at 09:23 UTC on 2026-09-23 returned `98,520 files / 237.6 GB to copy` ✅
- Real run `copy-8a4cdedd49a3` fired at 09:33:59 UTC — **task GC'd** by Python 3.11's `WeakSet` `_all_tasks` (fixed in Part A below)
- After Part A fix, real run `copy-37441652818b` fired at 10:28:13 UTC — task now stays alive but the loop hammered Dropbox at ~5 req/sec with **0 fetch_and_put ops enqueued** for the whole 15-minute window
- Root cause: **30/30 sampled `dropbox_files_enum` paths return `ApiError('path', 'not_found')`** from live Dropbox
- Live `dbx.files_list_folder("")` shows the source folder has been **renamed**: enum expects `/Paneltec-General Administration`, Dropbox now shows **`/Paneltec-General Administration (Team folder conflict)`**
- Cancelled run `copy-37441652818b` at 10:43:37 UTC with note *"cancelled by RCA: enum paths return 100% not_found from Dropbox — enum snapshot is stale / wrong namespace. Escalating to user before restarting."*

### Options — pick one

| # | Action | Pros | Cons |
|---|---|---|---|
| A | Rename the Dropbox folder **back** to `/Paneltec-General Administration` in the Dropbox web UI. Then `POST /api/dropbox/migration/start {agent_id, dry_run:false}` again. | Zero code change. Immediate. | Requires resolving the underlying team-folder-conflict cause — Dropbox may re-append the suffix later. |
| B | Rewrite paths in-place in `dropbox_files_enum` via `updateMany` to prepend the `(Team folder conflict)` suffix, then restart. | No re-enum cost. Preserves dry-run counts. | Risky: if the folder gets renamed back later, we corrupt paths. Also masks the real Dropbox team-folder problem. |
| C | Re-run the enumeration (`.132lj` engine) against the current live path. Costs ~1 hour of Dropbox API activity but guarantees correctness. Then restart migration. | Correct + resilient. Also captures any files added since the last enum. | Slow (~1 hour of `files_list_folder` requests). Uses API quota. |
| D | Investigate the Dropbox team-folder mount conflict first (why is Dropbox showing the `(Team folder conflict)` suffix?). Fix upstream. Then choose A or C. | Fixes root cause, not symptom. | Requires Dropbox admin work outside this pod. |

### Recommendation (agent)
- **Short-term:** (A) — cheapest, get bytes moving today.
- **Long-term:** (D) — figure out why Dropbox rewrote the folder name before it happens again.

### State to preserve
- `dropbox_files_enum` collection: **NOT TOUCHED** by this ship. 145,035 rows still present. Do not `updateMany` without picking option (B) explicitly.
- `dropbox_migration_run` collection: two `cancelled` runs from this session (`copy-be6692492c53`, `copy-8a4cdedd49a3`, `copy-37441652818b`) preserved for audit.

---

## Part A — Migration task-guard hotfix (backend, applied)

### The bug

Layer-1 (silent death):
```python
# integrations_dropbox.py:677 (before)
asyncio.create_task(bcopy.run_copy_job(run_id, agent_id, dry_run=dry_run))
```
Return value discarded. Python 3.11's `asyncio._all_tasks` is a `WeakSet` — [documented footgun](https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task). Task ran until its first `await` yield, got GC'd, `dropbox_migration_run` doc frozen at `state: running` with no traceback anywhere.

Layer-2 (silent errors — polish):
The 2-second heartbeat lived at the bottom of the loop body. Every `continue` (excluded path OR temp-link failure) skipped it, so a burst of stale-enum failures wrote nothing to `dropbox_migration_run.errors[]` for the endpoint to surface. Made a 100% failure look identical to a healthy silent run.

### Fix

**`backend/integrations_dropbox.py`:**
```python
# Module-level (new)
_BACKGROUND_TASKS: set = set()

# In dropbox_migration_start (line 677 area)
task = asyncio.create_task(
    bcopy.run_copy_job(run_id, agent_id, dry_run=dry_run)
)
_BACKGROUND_TASKS.add(task)
task.add_done_callback(_BACKGROUND_TASKS.discard)
```

**`backend/dropbox_bytes_copy.py`:**
1. Wrapped `run_copy_job` in a top-level `try/except BaseException` that writes `state=failed` + traceback to `dropbox_migration_run` before re-raising. Any future silent death is now visible via `GET /api/dropbox/migration/status`.
2. Hoisted the 2-second heartbeat into an inner `_maybe_flush(current)` helper. Called before `continue` on excluded paths + temp-link failure + at end of a successful iteration.

### Proof it works
- Layer-1 fix: after the change, the second real run (`copy-37441652818b`) executed for 15 min continuously with 3000+ Dropbox SDK calls in the log — pre-fix behaviour was task death within ~1 second.
- Layer-2 fix: with the flush polish, if run again today the endpoint would show `files_failed` climbing per iteration and `errors[]` populated with `ApiError not_found` — no more silent frozen `state: running`.

---

## Part B — Phase 2 web UI (frontend, applied)

### New files

| File | Purpose |
|---|---|
| `src/components/document-library/ShareModal.jsx` | File-level share sheet. Users + All Workers preset. view / download permissions. Current shares list with per-row revoke. |
| `src/components/document-library/HardDeleteModal.jsx` | Rose-themed confirmation modal. Requires typing target name. Hits DELETE `/files/{id}/hard` or `/folders/{id}/hard`. |
| `src/components/document-library/FolderAdminToolbar.jsx` | Upload folder (native `webkitdirectory` + folder-drop tree walker), Download folder as ZIP, Bulk actions dropdown. |
| `src/pages/SharedWithMe.jsx` | Non-admin visible page at `/app/shared-with-me`. Table view of active shares. |

### Edited files

| File | Change |
|---|---|
| `src/pages/DocumentLibrary.jsx` | Import new components. State: `shareFile`, `hardDeleteTarget`, `selectedFileIds`, `droppedItems`. Mounts `<FolderAdminToolbar/>` above the file table (canEdit only). Adds checkbox column. Adds Share + Hard-delete row buttons. Folder-aware drop handler dispatches to tree-upload when `webkitGetAsEntry()` reports a directory. Mounts the two new modals. |
| `src/components/layout/AppShell.jsx` | New nav entry "Shared with me" under Document Library (Compliance section). Hidden by default; a one-shot poll of `/document-library/shared-with-me` on mount flips the flag when non-empty. |
| `src/App.js` | Import + route `/app/shared-with-me → <SharedWithMe/>`. |

### Endpoints consumed (all shipped in `.132ma`, contracts unchanged)
- `GET /document-library/shared-with-me`
- `GET /document-library/shared-with-me/files/{id}/download`
- `POST /document-library/files/{id}/shares`
- `GET /document-library/files/{id}/shares`
- `DELETE /document-library/shares/{share_id}`
- `POST /document-library/download/bulk`
- `GET /document-library/folders/{id}/download-zip`
- `DELETE /document-library/files/{id}/hard`
- `DELETE /document-library/folders/{id}/hard`
- `POST /document-library/folders/{id}/upload-tree`
- `GET /api/users?hide_test=true` (existing — powers user picker)

### Scope cuts (deliberate)
- **Group shares** — still deferred; no `user_groups` collection exists yet. Share modal exposes Users + All Workers only.
- **Per-file cap 200 MB** — unchanged. Pre-signed NAS URL flow for >200 MB uploads still deferred.
- **Mobile hide (`.132mc`)** — Phase 3, delegated to `e1_expo_frontend_dev`. This ship does NOT touch `/app/mobile/*`.
- **Legacy soft-delete button retained** — the new rose-tinted hard-delete lives alongside it. Admins can pick either.

---

## Ship discipline

- Version bump `.132ma → .132mb` in `frontend/src/lib/version.js` (RUNNING_VERSION + EXPECTED_CACHE_VERSION) + `frontend/public/service-worker.js` (CACHE_VERSION). Full changelog block added at top of version.js.
- Only `git add -- <exact-file>` for own files. Parallel-actor files (`craco.config.js`, `.bak_ticket261441`, `.132la`/`.132lg` memos) left untouched.
- `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify -m "..."`.
- No push.

## Testing

See `e1_tester` invocation in commit message. Four scenarios: admin folder upload, admin Share to All Workers, worker Shared-with-me + download, admin Bulk download ZIP.
