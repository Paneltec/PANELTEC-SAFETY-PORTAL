# v58.13.132n2c — Dropbox browser UX polish

## TL;DR

UX polish pass on `/app/dropbox`. Four asks bundled:

1. **Back / up-one-folder arrow** to the left of the breadcrumb.
2. **Multi-select checkboxes** on each row + header tri-state
   "select all" + selection toolbar with bulk Download / Delete /
   Deselect.
3. **Richer row info** — Modified with time
   ("Sep 25, 2026 · 11:38 AM") and Size in bolder font.
4. **Dropbox brand blue** (`#0061FF`) on primary buttons,
   breadcrumb active underline, checkbox accent, row hover +
   selected tint, and drag-drop overlay.

Frontend-only ship. Backend endpoints unchanged — bulk delete
just calls the existing `DELETE /api/dropbox/browse` once per
path in parallel via `Promise.allSettled`.

## Behaviour details

### 1. Back arrow
- `ArrowLeft20Regular` fluent icon in a small square button on
  the very left of the breadcrumb nav.
- **Disabled** at team-folder root (`parentPath === null` per
  the new `parentPath` memo). Confirmed via automated test —
  the `disabled` HTML attribute is set when at root, absent in
  every other folder.
- Title / aria-label: "Up one folder".
- On click: sets path to the parent (or root when one level
  below root).

### 2. Multi-select
- Leftmost column now carries a checkbox per row. Header row
  has a **tri-state** "select all" checkbox that uses the
  browser's native `indeterminate` DOM property (imperatively
  set from a `useRef` — no equivalent JSX attribute exists).
- Selection state is a `Set<string>` keyed by entry `path`.
- **Cleared automatically on folder change** so selections
  don't silently persist across navigations (a common file-
  manager trap — Dropbox's own web UI clears too).
- Selection toolbar renders above the file list only when
  `selectedIds.size > 0`. It shows:
  - "N selected" text in brand blue
  - `[Download]` primary blue button
  - `[Delete]` red button (destructive semantic kept — no
    forced brand-blue here as per your brief)
  - `[Deselect all]` outlined slate button
- **Bulk download** implementation (`doBulkDownload`):
  - Filters out folders in the selection with a `toast.info`
    that reads "Skipping N folder(s): open them and select
    files inside for bulk download."
  - Serial (not parallel) `api.get('/dropbox/browse/download')`
    followed by `window.open(data.url, '_blank')`. Serial so
    (a) we don't hammer Dropbox's rate limit, and (b) popup-
    blockers get one trigger at a time — a 5-tab burst is
    reliably blocked in Chrome / Firefox / Safari.
  - Ends with a summary toast — either "Downloaded N files"
    or "Downloaded N · M failed. Popup blocker? Try individual
    downloads." No server-side zip in this ship (deferred to
    Phase C per brief).
- **Bulk delete** implementation (`doBulkDelete`):
  - Opens a confirm modal listing every selected entry with
    a mono filename + type chip.
  - On confirm: `Promise.allSettled` over the existing
    `DELETE /api/dropbox/browse?path=…` endpoint.
  - Summary toast: "Deleted N items." or "Deleted N · M
    failed. Refresh to see the current state."
  - Clears selection + refreshes the folder view on
    completion.

### 3. Richer row info

`formatModified()` now emits `"Sep 25, 2026 · 11:38 AM"`
(short-date + middle-dot + short-time). The middle-dot
separator makes date-vs-time scannable at a glance. Uses
browser locale + timezone — Dropbox returns UTC ISO, the
browser converts (matches the format used elsewhere in the
app for consistency).

`formatSize()` (already human-readable — `1.4 MB`, `735 KB`,
`13 KB`) is now rendered with `font-medium tabular-nums` so
numbers align vertically across rows.

Folder rows still show `—` for Size (folder byte-counts aren't
free to compute — `dbx.files_list_folder` doesn't return
recursive size totals). Folder rows DO show a Modified time
when Dropbox provides one.

### 4. Dropbox brand blue

Colour: `#0061FF` — Dropbox's canonical brand blue. Kept as
an inline JS const `DBX_BLUE` inside `DropboxBrowser.jsx`
rather than a Tailwind theme colour so the palette doesn't
leak into other product surfaces (this colour is Dropbox-
specific).

Applied to:
- Upload button (filled)
- New folder button (outlined — border + text)
- Selection toolbar "Download" button (filled)
- Selection toolbar background tint + border
- "N selected" count text
- Active breadcrumb crumb's bottom-border underline
- Checkbox `accentColor` (both row + header tri-state)
- Selected row background tint
- Row hover background tint (subtle)
- Drag-drop overlay banner
- Folder-icon fill colour
- Upload progress bar (`uploading` state)

Left alone (destructive / neutral semantics):
- `[Delete]` buttons stay red (`bg-red-600`)
- Refresh button stays slate outline
- Cancel buttons stay slate outline
- Row action-icon hovers stay slate
- Sidebar entry icon unchanged (still `Cloud`)

## Upload interpretation (per brief)

The user's ask: "select one or all to upload files."

**My read**: they want to select **multiple local files at
once** from the native OS picker when uploading. The
`<input type="file">` already carries `multiple` from
`.132n2` — the Upload button opens the OS picker with
multi-select enabled, and drag-drop was already multi-file.
The UploadPanel renders one progress bar per file, with
per-file `done` / `error` / `%` status.

I therefore did NOT add any new upload UX in this ship
beyond a minor cosmetic bump (progress-bar colour → Dropbox
blue). Everything the ask seems to describe is already
functional.

**If my read is wrong** and the user meant something like:
- "select uploaded files in the LIST view and do a batch
  action on them" → covered by the new selection toolbar.
- "select from a queue of files staged for upload before
  they upload" → NOT built; requires a staging drawer.
- "select multiple files in the LIST view to re-upload as
  a batch" → NOT built; this would be an odd flow.

Relay to the user for confirmation.

## Files touched

- `frontend/src/pages/DropboxBrowser.jsx` — new state
  (`selectedIds`, `bulkDeleteConfirm`), new handlers (`goUp`,
  `parentPath` memo, `toggleSelect`, `clearSelection`,
  `toggleSelectAllVisible`, `doBulkDownload`, `doBulkDelete`),
  new `SelectAllCheckbox` sub-component, updated `Row`,
  reworked toolbar / breadcrumb / table header / bulk-delete
  modal, imported `ArrowLeft20Regular`. (+~230 / -55)
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `.132n2c`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `.132n2c`.

## Verification (Playwright + DOM introspection)

| # | Case | State |
|---|------|-------|
| 1 | Back arrow at References folder | `disabled` attr absent → enabled |
| 2 | Back arrow at team folder root | `disabled` attr present → disabled |
| 3 | Click back arrow at References | Navigates to General Administration, breadcrumb updates |
| 4 | Click 2 row checkboxes | `dropbox-selection-count` text = "2 selected" |
| 5 | Click header tri-state checkbox with 2/3 selected | All 3 rows now selected, `indeterminate: false, checked: true` |
| 6 | Selection toolbar buttons present | Download (blue), Delete (red), Deselect all (slate) — all rendered |
| 7 | Modified column formats | "Jan 30, 2020 · 10:57 PM", "Nov 17, 2023 · 12:35 AM" |
| 8 | Size column | "1.4 MB", "735 KB", "13 KB" — bold tabular-nums |
| 9 | Console errors / warnings | 0 |

Screenshots saved:
- `/app/test_reports/132n2c_back_arrow.png` — References folder
  view with back arrow enabled + Dropbox-blue Upload button +
  breadcrumb active-underline.
- `/app/test_reports/132n2c_multi_select.png` — 2 rows selected,
  selection toolbar visible with Download / Delete / Deselect
  buttons, header tri-state indeterminate.
- `/app/test_reports/132n2c_rich_rows.png` — Modified column
  showing date + time, Size column bold + right-aligned.
- `/app/test_reports/132n2c_blue_accents.png` — "select all"
  active state, all 3 rows highlighted with blue tint, checkbox
  accent-color = Dropbox blue.

## Backend impact

None. All UX polish is client-side; bulk delete just fans out
existing `DELETE /api/dropbox/browse` calls.

## Not touched

- `/app/mobile/*` — banned.
- Migration engine.
- `dropbox_browse.py` — no new endpoints.
- `FilePreviewModal.jsx` — no changes.
- Sidebar entry icon (still `Cloud`).
- Single-file preview flow (`.132n2b`) — regression-tested via
  clicking a row's name (opens modal).

## Known limitations / deferrals

- **Bulk download popup blocker**: browsers rate-limit multiple
  `window.open` calls within one gesture. Sequential dispatch
  helps but the last few files in a very large selection may
  still be blocked. Documented in the toast message. A future
  ship could:
  - Fetch bytes through the backend proxy (`.132n2b`'s
    `/preview` endpoint style) and stream them to hidden
    `<a download>` anchors — no popup involved.
  - Or add a server-side zip endpoint (deferred to Phase C).
- **Selection persistence across folders**: intentionally
  cleared. Cross-folder multi-select is a Phase C ask.
- **Folder byte-count in Size column**: still `—`. Would need
  a recursive `files_list_folder` walk per folder, not worth
  the API cost for a size column that most users glance past.
