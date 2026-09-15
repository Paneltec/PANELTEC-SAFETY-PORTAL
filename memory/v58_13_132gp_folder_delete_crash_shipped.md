# v58.13.132gp — Doc Library folder delete crash hotfix · SHIPPED

## Root cause — regression from `.132gl-a`

`.132gl-a` added an optimistic `setFolders` inside `deleteFolder` to
close a perceived "delete does nothing" bug. That bug turned out to
be a **stale service worker** (root-caused and closed in `.132gk`
with the CACHE_VERSION bump), not a rendering issue.

Once `.132gk` shipped, the optimistic mutation became active
harm — the folder-delete confirm modal was rendered as:

```jsx
{confirmDeleteId && (() => {
  const target = folders.find((x) => x.id === confirmDeleteId);
  if (!target) return null;
  …
  <button onClick={() => deleteFolder(target)}>Delete folder</button>
```

On confirm, the sequence was:

1. `deleteFolder(target)` fires.
2. `setFolders(prev => prev.filter(x => x.id !== f.id))` — optimistic
   removal.
3. `await api.delete(...)`.
4. `setConfirmDeleteId(null)`.

Between steps 2 and 3, React re-renders. The modal re-evaluates
`folders.find(...)` → `undefined`. `if (!target) return null;`
unmounts the modal WHILE `deleteFolder`'s `await` is in flight and
the confirm button's `onClick` handler is mid-execution. In some
render sequences that scheduling collision throws out of the
click-handler stack and blanks the whole app.

Stephen saw this as "confirming crashes the app" — matched the
screenshot exactly.

## Fix — two changes

1. **Modal target moved to object state.** Replaced
   `confirmDeleteId: string | null` with
   `confirmDeleteTarget: Folder | null`. The modal reads the folder
   object directly; it also walks `folders` for the freshest counts
   and falls back to the captured object if the row has already
   been removed by an in-flight refresh. No more "target became
   null mid-flight" branch.
2. **Optimistic setFolders reverted.** `deleteFolder` now:
   * Fires `api.delete` first.
   * On success → close modal → toast → `load()`.
   * On failure → toast (no rollback needed since state wasn't
     mutated).

The `.132gk` cache-bust already removed the reason optimistic UI
existed, so this is a straight revert-plus-rename.

## Verification

### Curl
```
POST /api/document-library/folders           → 201 · id: <gp-py-<stamp>>
DELETE /api/document-library/folders/<id>    → 204
GET  /api/document-library/folders           → row absent
```

### Pytest
```
$ pytest backend/tests/test_v58_13_132gp_folder_delete_crash.py -q
5 passed in 1.43s
```

Covers:
1. FE state now uses `confirmDeleteTarget`; every `confirmDeleteId`
   reference is gone.
2. The `.132gl-a` optimistic `setFolders` line is gone; the new
   flow keeps `api.delete` first.
3. Modal computes `target = fresh || confirmDeleteTarget` so the
   captured folder object remains the source of truth.
4. Backend end-to-end contract: create → delete → 204 → not in
   list.
5. Version lockstep across 3 web files.

## Files changed
```
frontend/src/pages/DocumentLibrary.jsx           +32 −19
frontend/src/lib/version.js                      × 2 version bump
frontend/public/service-worker.js                CACHE_VERSION bump
backend/tests/test_v58_13_132gp_folder_delete_crash.py   NEW 73 lines
memory/v58_13_132gp_folder_delete_crash_shipped.md       NEW (this)
```

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester`.
* `/app/mobile/` untouched.
* CRA — no Vite.
* Version bump → `paneltec-v160.3.9.58.13.132gp`.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Message for Stephen

Hard-refresh once `.132gp` is live and the folder trash icon will
behave. Delete now: click trash → confirm → row vanishes cleanly
(no crash, no phantom row). If the app ever "goes white" on a
future modal action, please screenshot the browser console — the
error stack tells us instantly whether it's a rendering race
(`.132gp`-style) or a network 5xx.
