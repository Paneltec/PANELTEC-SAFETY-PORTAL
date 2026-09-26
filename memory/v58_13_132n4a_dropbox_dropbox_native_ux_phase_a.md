# v58.13.132n4a — Dropbox browser Dropbox-native UX (phase A)

## TL;DR

Big polish pass on `/app/dropbox` to bring it in line with the
Dropbox web UI. Ships everything the current OAuth scopes support;
sharing/permissions (`.132n4b`) is deferred to a follow-up after
the admin ticks `sharing.write` in the Dropbox App Console and
re-authorises.

Feature list (all four in this ship):

1. **File-count badges on folder rows** — lazy fetch via a new
   `GET /api/dropbox/browse/count` endpoint. Client-side
   concurrency capped at 5 to match the server semaphore. 5-min
   in-process cache.
2. **Per-row ⋯ action menu** — Preview / Download / Rename /
   Copy path / Move to… / Share (**DISABLED**, `.n4b` badge) /
   Version history / Delete.
3. **Rename + Move to… + Version history + Restore** — four new
   backend endpoints (`/rename`, `/move`, `/revisions`,
   `/restore`) plus a Move-picker modal and Version-history
   drawer.
4. **Right details panel** — single-click a FILE row opens a
   slide-in right panel with file metadata + quick actions.
   Double-click still opens the preview modal. Folder rows
   preserve their existing single-click-navigates behaviour.

## Backend additions

5 new endpoints on `dropbox_browse.py`:

| Method | Path                            | Purpose                                       |
| ------ | ------------------------------- | --------------------------------------------- |
| GET    | `/api/dropbox/browse/count`     | Folder file-count (first page, cached 5 min)  |
| POST   | `/api/dropbox/browse/rename`    | Rename in-place (`{from_path, new_name}`)     |
| POST   | `/api/dropbox/browse/move`      | Move into a different folder                  |
| GET    | `/api/dropbox/browse/revisions` | Up to N prior revisions of a file             |
| POST   | `/api/dropbox/browse/restore`   | Restore a file to a prior revision            |

All 5 go through the `.132n2a` team-namespace `_get_dbx()`
client, share the existing per-user semaphore (`_PREVIEW_SEMS`,
capped at 5 concurrent), wrap Dropbox errors via
`_wrap_dropbox_error`, and audit-log mutations to
`dropbox_browse_audit`.

Rename / move care about a subtle detail: `os.path.dirname("/foo")`
returns `"/"` for top-level entries, but our namespace-relative
convention uses `""` for the team-folder root. The rename +
move handlers both normalise that (`if parent == "/": parent = ""`)
so the destination path doesn't get an accidental double slash.

## Frontend additions

New components under `components/dropbox/`:

- **`RowActionMenu.jsx`** — popover on the ⋯ button. Positioned
  via a `fixed` overlay + `getBoundingClientRect` so it clears
  the row scroll container.
- **`MovePickerModal.jsx`** — mini folder browser rooted at the
  team folder. Shows only folder rows, disables self + descendants
  as invalid destinations, matches Dropbox web's "navigate INTO
  the destination, then click Move here" convention.
- **`VersionHistoryDrawer.jsx`** — right slide-in drawer showing
  up to 10 revisions. Each row: date + size + opaque rev id +
  Restore button (except for current version). Restore hits
  `/api/dropbox/browse/restore` and closes the drawer on success.
- **`DetailsPanel.jsx`** — right slide-in panel opened on
  single-click of a FILE row. Shows Kind / Size / Modified /
  Versions (lazy) / Sharing (placeholder for `.132n4b`) + a
  full-height action list. Version count comes from
  `/api/dropbox/browse/revisions?limit=10` — shows `N versions`
  with a `+` appended when the file has ≥ 10 revisions.

`DropboxBrowser.jsx` wiring changes:

- **Single-click / double-click split** — file row single click
  opens the details panel; double click on the name button opens
  the preview modal. Folder rows still navigate on single click
  (regression-safe).
- **Lazy folder-count effect** — after the parent list renders,
  iterates folders that don't already have a count in the
  `folderCounts` state map and fires up to 5 parallel
  `/count` requests. Cleared on folder navigation.
- **Rename dialog** — compact modal opened from either the ⋯
  menu or the details panel; posts to `/rename` and refreshes.

## Deferred: sharing (`.132n4b`)

The Share slot is rendered but **disabled** in both the row
action menu and the details panel, with a tooltip pointing the
user at Settings → Integrations. Every disabled slot carries a
small `.n4b` badge so admins can see at a glance that these
actions will light up once the scope grant lands.

To prepare for the flip, `_DROPBOX_SCOPES` in
`integrations_dropbox.py` now includes **`sharing.write`** — so
the next OAuth mint automatically requests it. `sharing.read`
was already there.

### What the admin needs to do before `.132n4b` ships

1. Open the Dropbox App Console at
   `https://www.dropbox.com/developers/apps/info/<app_key>` for
   this Paneltec app.
2. Under **Permissions**, tick both `sharing.read` and
   `sharing.write` (only the write scope is truly new, but
   double-check `sharing.read` because the App Console layer
   overrides the OAuth request every time).
3. Click **Submit** on the Permissions page (Dropbox invalidates
   pending consents if you forget).
4. Go to the Paneltec app → Settings → Integrations → Dropbox
   → **Reconnect**. This mints a new refresh token with
   `sharing.write` in the granted scopes.
5. `.132n4b` verifies by making a real
   `sharing_create_shared_link_with_settings` round-trip against
   any team folder path.

## Verification

### Backend (live pod)

```
GET /api/dropbox/browse/count?path=/Paneltec-General Administration/General Administration/References
→ 200  {"path":"/General Administration/References","item_count":3,"is_partial":false,"ttl_seconds":300}

POST /api/dropbox/browse/rename
   {"from_path":".../.132n4a_test_rename_src","new_name":".132n4a_test_rename_new"}
→ 200  renamed:true, previous_path:".../.132n4a_test_rename_src"

POST /api/dropbox/browse/move
   {"from_path":".../.132n4a_test_rename_new","to_folder":".../Software"}
→ 200  moved:true, entry.path:"/Software/.132n4a_test_rename_new"

GET /api/dropbox/browse/revisions?path=.../Paneltec Trade References.docx&limit=5
→ 200  3 revisions returned (Nov 2023, Nov 2023, Mar 2019)

DELETE /api/dropbox/browse?path=.../Software/.132n4a_test_rename_new
→ 200  deleted:true
```

### Frontend (Playwright)

Screenshots at `/app/test_reports/`:

- `132n4a_full_ui.png` — team folder root with **19 folder-count
  badges** (Amandas Folder 44 items, CCTV 15 items, Customers
  93 items, Employee's 5 items, Enviro Solutions Tasmania 2 items,
  General Administration 39 items, Historical JSEAS 7 items,
  Incoming Attachments 6 items, logo 16 items, Patricks Folder
  2 items, Plant & Equipment 40 items, Risk & Compliance 147
  items, Software 6 items, Stormy's folder 13 items, …). Version
  pill `v160.3.9.58.13.132n4a` visible bottom-left.
- `132n4a_action_menu.png` — ⋯ menu open on
  `Paneltec Trade References.docx`. All 8 items visible in order:
  Preview / Download / Rename / Copy path / Move to… / **Share
  (disabled, `.n4b` badge)** / Version history / Delete.
- `132n4a_details_panel.png` — right details panel showing
  Kind=DOCX, Size=12.9 KB, Modified=Nov 17 2023 · 12:35 AM,
  **Versions=3 versions**, Sharing="Enabled in .132n4b". Full
  action list rendered including disabled Share row.
- `132n4a_move_picker.png` — Move picker modal opened via the
  Details Panel "Move to…" button. Breadcrumb + destination
  path (`/General Administration/References`) visible. "Move
  here" button disabled because current parent is the same as
  the source's parent (correct guard).
- `132n4a_version_history.png` — right drawer showing 3
  revisions of `Paneltec Trade References.docx`. Current version
  (Nov 17 2023 · 12:35 AM) + Version 2 (Nov 17 2023 · 12:06 AM,
  restorable) + Version 1 (Mar 8 2019 · 3:17 AM, restorable).
  Each row shows the opaque Dropbox rev id.

Console clean.

## Files touched

- `backend/dropbox_browse.py` — 5 new endpoints (~250 lines),
  `_COUNT_CACHE` dict + helpers, `import time`, pydantic
  `RenameIn` / `MoveIn` / `RestoreIn`, `_validate_basename`.
- `backend/integrations_dropbox.py` — `sharing.write` added to
  `_DROPBOX_SCOPES` for the `.132n4b` scope grant.
- `frontend/src/components/dropbox/RowActionMenu.jsx` — new.
- `frontend/src/components/dropbox/MovePickerModal.jsx` — new.
- `frontend/src/components/dropbox/VersionHistoryDrawer.jsx` — new.
- `frontend/src/components/dropbox/DetailsPanel.jsx` — new.
- `frontend/src/pages/DropboxBrowser.jsx` — imports + state +
  handlers + Row prop threading + panel/modal/drawer mounts +
  lazy folder-count effect + rename dialog. (~135 lines added)
- `frontend/src/lib/version.js` — `.132n4a`.
- `frontend/public/service-worker.js` — `.132n4a`.
- `memory/v58_13_132n4a_dropbox_dropbox_native_ux_phase_a.md` —
  this memo.

## Not touched

- `/app/mobile/*` — banned.
- FilePreviewModal — unchanged.
- Migration engine.
- All pre-`.132n4a` browse endpoints (list / download / mkdir /
  delete / upload / preview) — untouched.

## Known limitations

- **Bulk actions on selected rows** (`.132n2c` selection
  toolbar) don't yet include Rename/Move — deliberate:
  bulk-rename doesn't have an obvious UX and bulk-move is
  covered by drag-drop (not built yet either). The
  selection toolbar still ships Download + Delete only.
- **Folder-count first page cap** — folders with >2000 items
  render `2000+ items`. Live Paneltec data doesn't have any
  folder that large today.
- **Move destination = current parent** is silently a no-op
  (Move here button disabled with a tooltip). Same for moving a
  folder into itself or a descendant.
