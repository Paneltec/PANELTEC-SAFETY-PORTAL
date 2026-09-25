# v58.13.132n2a — Dropbox browse: team-folder `path_root` fix

## TL;DR

All 5 `/api/dropbox/browse/*` endpoints were talking to the WRONG
Dropbox namespace. LIST silently returned the admin's private
Dropbox home instead of the team folder, and every WRITE was
rejected by Dropbox with `no_write_permission` because the Dropbox
Team app can't mutate the user's private namespace via a shared
folder mount.

One-file fix (`backend/dropbox_browse.py`): rewrite `path_root` on
the browse client to point at the team folder's namespace ID
instead of the user's root namespace ID. Migration engine is
untouched — it still needs the user-namespace shape for its enum.

## Symptom

Post `.132n2` OAuth re-consent (user grants `files.content.write`
via the Dropbox App Console → Permissions tab + reconnect flow),
write endpoints still fail. Round-trip proof:

```
POST /api/dropbox/browse/mkdir { path: "/Paneltec-General Administration/.132n2_write_test_delete_me" }
→ HTTP 502  {"detail":"Dropbox create_folder failed: ApiError"}
```

Backend log:
```
WARNING | paneltec.dropbox.browse | [browse.mkdir] /.132n2_write_test_delete_me:
  ApiError('cf4f7d5140b947278ab73a4a6ab705f8',
           CreateFolderError('path', WriteError('no_write_permission', None)))
```

Distinct from the pre-`.132n2` failure shape (`BadInputError` with
"required scope 'files.content.write'"), so the OAuth scope IS
present — the token has write scope, Dropbox is refusing at the
filesystem ACL layer. User confirmed they CAN create folders as
`stephen@paneltec.com.au` at the same team folder root via the
Dropbox web UI, so it's not an account permission issue either —
it's the app targeting the wrong namespace.

## Root cause

`dropbox_browse._get_dbx()` was returning the mirror engine's
client factory `dropbox_folder_mirror._get_dbx_root_client()`:

```python
# backend/dropbox_folder_mirror.py L44, L80-101
_ROOT_NS = os.environ.get("DROPBOX_ROOT_NAMESPACE_ID", "2673752851")

def _get_dbx_root_client():
    ...
    return dbx.with_path_root(PathRoot.namespace_id(_ROOT_NS))
```

`_ROOT_NS = 2673752851` is the USER'S root namespace (stephen's
Dropbox home). Under that path_root, `/2/files/list_folder("")`
lists stephen's private root — NOT the team folder. Verified
with an actual GET:

```
$ curl /api/dropbox/browse?path=
{ "path": "/Paneltec-General Administration",
  "entries": [
    {"type":"folder","path":"/Stephen Guy","name":"Stephen Guy"},
    {"type":"folder","path":"/Marketing","name":"Marketing"},
    {"type":"folder","path":"/COL CCTV Newstead Program","name":"COL CCTV Newstead Program"},
    ... 3 more, total 6 entries ...
  ]}
```

Six entries — that's stephen's PRIVATE Dropbox home. The team
folder has 18 folders and 1447 files (per `/api/dropbox/health`).

Writes fail on the same client because Dropbox Team apps can't
mutate a user's private namespace via the shared team folder
mount point (`WriteError('no_write_permission')` is the
resulting ACL rejection).

The mirror engine got away with this shape because it does its
own enum from an absolute team-folder path — the user-namespace
mount was incidentally traversable for READ traffic in that flow.

## Fix

`backend/dropbox_browse.py::_get_dbx()` now rewrites path_root
to the TEAM FOLDER's namespace ID:

```python
def _get_dbx():
    from dropbox_folder_mirror import _get_dbx_root_client
    from dropbox.common import PathRoot
    team_ns = _get_team_namespace_id()  # env → artifact → fallback
    return _get_dbx_root_client().with_path_root(
        PathRoot.namespace_id(team_ns)
    )
```

`_get_team_namespace_id()` lookup order:
1. `DROPBOX_TEAM_FOLDER_ID` env var (explicit override).
2. `.132lb` audit artifact `/app/memory/dropbox_phase0_audit_v58_13_132lb.json`
   (same source of truth `/api/dropbox/health` uses).
3. Hardcoded fallback `"5079287136"` (matches `_live_probe`).

`with_path_root` chained twice cleanly overrides — the SDK
returns a new client with a fresh `Dropbox-API-Path-Root`
header each call.

`_normalise_path` already produces team-folder-relative paths
(`""` for root, `/Foo/Bar` for subfolders), so no other code
change is needed. Frontend already sends namespace-relative
paths (see `pages/DropboxBrowser.jsx` line 32-37 comment) —
zero frontend churn.

## Files touched

- `backend/dropbox_browse.py` — `_get_dbx()` + new
  `_get_team_namespace_id()` helper (+56 lines including comment
  block explaining the bug).
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped to `.132n2a`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped
  to `.132n2a`.

## Verification (post-fix)

Full round-trip on the live pod:

- `GET /api/dropbox/browse?path=` → 200, 18 entries at the team
  folder root (matches health's `top_level_folder_count`).
- `POST /api/dropbox/browse/mkdir` with `path=/Paneltec-General Administration/.132n2a_write_test`
  → 200, `{"path":"/.132n2a_write_test"}`.
- `DELETE /api/dropbox/browse?path=/Paneltec-General Administration/.132n2a_write_test`
  → 200, `{"path":"/.132n2a_write_test","deleted":true}`.
- Upload / delete of a 1 KB test file — 200 on both.
- Regression check: sub-folder listing still works and returns
  namespace-relative paths (`/Foo/Bar` rather than
  `/Paneltec-General Administration/Foo/Bar`).

## Migration engine impact

Zero. `dropbox_folder_mirror._get_dbx_root_client()` still
scopes to the user's root namespace — its enum + copy paths are
unchanged. The only new caller of the team-scoped client is
`dropbox_browse`'s five endpoints.

## Not touched

- `/app/mobile/*` — banned.
- Migration engine.
- Any Dropbox OAuth code (`integrations_dropbox.py`).
- Tests (`backend/tests/test_v58_13_132n2_dropbox_browse.py`) —
  they mock `_get_dbx()` so this internal change is transparent.
