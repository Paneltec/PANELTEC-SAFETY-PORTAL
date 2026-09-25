# v58.13.132n2 — Dropbox in-app file browser (phases A + B)

## Scope shipped

Phases A **and** B bundled: browse + download + upload + mkdir + delete, all
inside the app at `/app/dropbox`. Replaces the external-tab launcher from
`.132n0`. Phase C (rename, move, previews, server-side search) is deliberately
deferred — noted at the end of this memo.

## Files touched

### Backend
| File | Change |
|---|---|
| `backend/dropbox_browse.py` **(new)** | 5 endpoints under `/api/dropbox/browse` (list / download / mkdir / delete / upload). Namespace-aware path normalisation, per-user upload semaphore (5 concurrent), chunked upload for >150 MB, audit log to `db.dropbox_browse_audit`. |
| `backend/tests/test_v58_13_132n2_dropbox_browse.py` **(new)** | 22 unit tests — path guard, serialise, mkdir conflict → 409, upload path validation, download link shape, worker refusal. Mocks the Dropbox SDK end-to-end. |
| `backend/server.py` | Import + register `dropbox_browse_router`. |
| `backend/integrations_dropbox.py` | Added `files.content.write` to `_DROPBOX_SCOPES` so future OAuth handshakes mint a write-capable token. |
| `backend/settings_nav_registry.py` | `dropbox_launcher` `route` flipped from `/app/settings/integrations` back to `/app/dropbox` (internal). |

### Frontend
| File | Change |
|---|---|
| `frontend/src/pages/DropboxBrowser.jsx` **(new)** | Full file-browser UI. Breadcrumb, sortable columns (name/modified/size), filter box, folder drill-in via URL query, download button (temporary link → new tab), upload button + drag-drop, new-folder modal, delete confirm modal, progress panel per upload. Namespace-relative path state (`""` = team root). Route-level gate on `integrations.view`; deep-link without permission renders "Dropbox browser locked". |
| `frontend/src/App.js` | New route `/app/dropbox` → `<DropboxBrowser />`. |
| `frontend/src/lib/settingsNavRegistry.js` | `dropbox_launcher` now `route: '/app/dropbox'` (internal NavLink) instead of `externalUrl`. Cloud icon + `requiresCan: ['integrations', 'view']` unchanged. The `externalUrl` branch in `SortableItem` stays as dormant infrastructure — future ships can register external-only entries without re-plumbing. |
| `frontend/src/lib/version.js` | `.132n1b` → `.132n2` on both `RUNNING_VERSION` and `EXPECTED_CACHE_VERSION`. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` bumped to `.132n2`. |

### Docs
- `memory/v58_13_132n2_dropbox_in_app_browser.md` **(this file)**

## Endpoint contracts

All endpoints live under `/api/dropbox/browse` and require `integrations.view`.

```
GET  /api/dropbox/browse?path=<optional>
     → 200 { path: "/…", entries: [{ name, path, type, size, modified, mime_type }, …] }

GET  /api/dropbox/browse/download?path=<full_path>
     → 200 { path, url, expires_in }         (4h Dropbox temporary link — client fetches directly)

POST /api/dropbox/browse/mkdir  { path }
     → 200 { path }
     → 409 if a folder/file already exists at that path
     → 403 if OAuth token is missing files.content.write scope

POST /api/dropbox/browse/upload (multipart: path, file)
     → 200 { path, size, modified }
     · one-shot files_upload   for ≤ 150 MB
     · chunked upload_session  for > 150 MB (8 MiB per chunk)
     · per-user asyncio.Semaphore(5) caps concurrent uploads

DELETE /api/dropbox/browse?path=<full_path>
     → 200 { path, deleted: true }
     · refuses to delete the team folder root itself (400)
```

## Namespace-relative path model (important design note)

The Dropbox SDK client is scoped to the team's path-root namespace via
`with_path_root(PathRoot.namespace_id(...))`. This means Dropbox interprets
every path relative to the team's namespace root — the team folder itself
IS the namespace root. Concretely:

- The team folder shows up as `""` (empty string) at the SDK layer.
- A subfolder called "Docs" is `path_display = "/Docs"` — NOT
  `"/Paneltec-General Administration/Docs"`.

`_normalise_path` on the backend accepts **either** shape and always
converts to the namespace-relative form the SDK expects. The frontend
`DropboxBrowser` state is likewise namespace-relative (`""` root,
`/Docs`, `/Docs/Sub`) so browser navigation, breadcrumb reconstruction,
and mkdir/upload paths all round-trip consistently.

## Guardrails

- **Path syntax**: `..`, `//` segments rejected with 400 (defence-in-depth).
- **Namespace scoping**: the SDK client can't reach outside the team
  namespace regardless of what a caller passes — Dropbox will simply
  return `not_found` for names it doesn't recognise inside the namespace.
  The earlier "prefix must start with `/Paneltec-General Administration`"
  guard was a red herring based on a misunderstanding of how Dropbox's
  namespace-scoped API returns paths; it was replaced with the
  syntactic guard above.
- **Rate limit**: `asyncio.Semaphore(5)` per user on uploads.
- **Audit**: every mutating call (`upload`, `mkdir`, `delete`) logs to
  `db.dropbox_browse_audit` with `{ at, user_id, user_email, action, path, meta }`.
- **Team-root protection**: `mkdir` / `delete` / `download` on the team
  root itself return 400 (can't recreate/delete the root).
- **Auth**: every endpoint gated on `integrations.view`. Non-admin users
  hit 403 before any Dropbox call happens (verified against the worker
  account — `HTTP 403 { "detail": "Permission denied: integrations.view" }`).

## Known operational blocker — Dropbox app scope re-consent needed

The Dropbox app registered for this project currently has a refresh token
minted with read-only scopes:

```
account_info.read  files.metadata.read  files.content.read  sharing.read
```

Every write endpoint (mkdir / upload / delete) will now surface a helpful
**403** instead of an opaque 502:

```json
{"detail":"Dropbox token is missing the 'files.content.write' scope. An admin
must re-authorise Dropbox from Settings → Integrations so the app can mint
a new refresh token with write access."}
```

**Unblock procedure** (admin, one-time):
1. `_DROPBOX_SCOPES` in `backend/integrations_dropbox.py` already includes
   `files.content.write` (added in this ship).
2. Visit `POST /api/dropbox/oauth/start` (from Settings → Integrations →
   Dropbox → Reconnect) and consent to the expanded scopes on the
   Dropbox authorize screen.
3. On callback, the new refresh token replaces the read-only one, and
   write endpoints start returning 200.

Read paths (`GET /api/dropbox/browse`, `GET /api/dropbox/browse/download`)
work today with the existing token — no reconnect needed for browsing.

## Verification

- `curl /api/health/version` → `paneltec-v160.3.9.58.13.132n2` ✓
- Unit tests: **22/22 passed** (`tests/test_v58_13_132n2_dropbox_browse.py`)
- Live `/api/dropbox/browse` returns 6 team-folder entries as admin ✓
- Path escape via `..` → **400** ✓
- Worker (no `integrations.view`) → **403** ✓
- Frontend `/app/dropbox` renders full file list, drill-in updates URL and
  breadcrumb, `data-testid` attributes present on every interactive
  element (`dropbox-browser-page`, `dropbox-row-*`, `dropbox-open-*`,
  `dropbox-delete-*`, `dropbox-upload-btn`, `dropbox-mkdir-btn`,
  `dropbox-crumb-N`) ✓
- Worker deep-link `/app/dropbox` renders "Dropbox browser locked" card
  with `data-testid="dropbox-browser-denied"` ✓
- Mkdir/upload/delete: all correctly return the scope-missing 403 with the
  reconnect instructions until the OAuth token is re-consented.

## Screenshots (rendered inline; screenshot tool sandbox does not persist
to `/app/test_reports/`)

- Root list — 6 team-folder subfolders visible with breadcrumb + toolbar.
- Drill-in — `/Stephen Guy` folder loaded with 80 entries, breadcrumb
  updates to `Paneltec-General Administration › Stephen Guy`.
- Mkdir modal — dialog opens with input focused.
- Access-denied card for worker preset.

## Deferred (phase C, future ship)

- Rename
- Move / drag-drop between folders
- File previews (PDF viewer, image lightbox, video player)
- Server-side search across the team folder
- Multi-select + bulk delete / bulk download
- Right-click context menu
- Comments / tags
- Version history browsing

## Ship discipline

- Version lockstep `.132n2` (`version.js` + `service-worker.js`). ✓
- `git reset HEAD -- .` before `git add`, only my files staged.
- Commit created, **no push**.
- No mobile touched — `.132mx` slug intact.
