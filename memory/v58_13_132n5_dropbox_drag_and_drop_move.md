# v58.13.132n5 — Dropbox browser drag-and-drop MOVE + row-hover green

## TL;DR

Adds full HTML5 drag-and-drop MOVE across the Dropbox browser
and folds in a green ⋯-button polish that lights the icon up on
row hover (via `group-hover:`) instead of only on direct button
hover.

- **Drag source**: any file or folder row (`draggable`).
- **Multi-select drag**: if the dragged row is in the current
  selection, all selected paths ride along as a batch move.
- **Drop targets** (all reuse the existing
  `POST /api/dropbox/browse/move` endpoint):
    - Folder rows in the current listing
    - Every breadcrumb ancestor segment
    - The back-arrow (moves to the parent folder)
- **OS-file drag still uploads** — discriminated via
  `DataTransfer.types` (`Files` = upload, custom
  `application/x-paneltec-dropbox-move` = in-app move).
- **Visual feedback** matches the brief:
    - Source rows dim to 40 % opacity.
    - Valid drop targets get a Dropbox-blue ring + soft blue
      wash + a floating **"Move to <name>"** blue tooltip near
      the cursor.
    - Invalid targets get a rose ring + rose wash + a red
      tooltip with the specific reason
      (`Cannot move a folder into itself.` / `into its own
      subfolder.` / `Already in this folder.` / `nothing to
      move`).

## Cross-ship bug caught + fixed

`POST /dropbox/browse/move` had a latent bug that made an empty
`to_folder` (used by the back-arrow target when the user is at a
first-level folder) create a **phantom** `/Paneltec-General
Administration/` subfolder inside the team-namespace root:

```
_normalise_path("") → "_TEAM_FOLDER_ROOT"  ("/Paneltec-General Administration")
dst = dst_folder + "/" + src_base            # <-- prefix gets doubled
dbx.files_move_v2(from, "/Paneltec-General Administration/X")
                                 # Dropbox created a real subfolder
```

Fix: when `dst_folder == _TEAM_FOLDER_ROOT` we now write
`"/" + src_base` (namespace-relative to the SDK's already-scoped
path-root) instead of the doubled path. Verified end-to-end:
move-in / move-out round-trip via `to_folder: ""` no longer
creates the phantom.

Manual cleanup: the pre-fix run had already created the phantom
during exploratory testing. The offending folder was deleted
before commit; `Historical JSEAS` is back at the team folder
root.

## Backend

- `POST /dropbox/browse/move` — patched the destination-path
  computation as above.

## Frontend

### `pages/DropboxBrowser.jsx`
- New state: `draggingPaths` (array), `dragTarget`
  `({path, name, valid, reason?})`, `dragMousePos` (ref).
- Const `DND_MIME = 'application/x-paneltec-dropbox-move'`.
- `validateDropTarget(sources, targetPath)` — three-rule check
  (no self-drop, no descendant-cycle, no same-parent no-op).
- `onRowDragStart(entry, ev)` — populates `draggingPaths`
  (single-row or multi-selection), stashes `{paths}` on the
  DataTransfer, and paints a compact chip drag-image
  (`N items` when > 1).
- `onRowDragEnd()` — clears `draggingPaths` + `dragTarget`.
- `makeDropTargetHandlers(targetPath, displayName)` — factory
  returning `{onDragEnter, onDragOver, onDragLeave, onDrop}`
  wired for the target. Reused across folder rows, every
  breadcrumb segment, and the back-arrow.
- `doBatchMove(paths, toFolder, toFolderName)` — runs the moves
  sequentially (matches the existing endpoint contract), clears
  the moved paths from `selectedIds`, refreshes the listing,
  and reports totals via toast.
- Page-level upload drag handlers now gate on
  `types.includes('Files')` so in-app moves bubble through to
  their real target handlers.
- Row `<tr>` gets `draggable={true}`, `onDragStart`,
  `onDragEnd`, plus (for folder rows only) the drop handlers.
- Row visual states — `isDragging` → `opacity-40`; `isDropTarget`
  + `dragTarget.valid` → `ring-2 ring-inset ring-[#0061FF]
  bg-[rgba(0,97,255,0.08)]`; invalid → rose ring/wash.
- Floating tooltip: `position: fixed`, `z-[9999]`, tracks
  `dragMousePos.current` (updated in `onDragOver`). Blue when
  valid, rose when invalid, reads `Move to <name>` / the
  validation reason.

### `components/dropbox/RowActionMenu.jsx` — polish
- Class swap: was `text-slate-500 group-hover:text-[#0061FF]
  hover:!text-[#0047B3] hover:bg-[rgba(0,97,255,0.15)]`.
- Now: `text-slate-400 group-hover:text-emerald-600
  group-hover:bg-emerald-100/50 hover:!text-emerald-700
  hover:!bg-emerald-100
  focus-visible:ring-2 focus-visible:ring-emerald-400/40`.
- The circle background is now driven by the PARENT ROW hover
  (via `group-hover:`) so the ⋯ lights up anywhere on the row.
  Direct button hover stacks a darker emerald + solid circle.

## Verified

Screenshots in `test_reports/`:

1. **`132n5_row_hover_green.jpeg`** — mouse at 300 px into the
   `Historical JSEAS` row (over the name, NOT over the ⋯). The
   ⋯ button shows the emerald-600 icon + emerald-100/50 circle.
   Computed styles confirm `color: rgb(5, 150, 105)` +
   `bg: rgba(209, 250, 229, 0.5)`.
2. **`132n5_drag_over_folder.jpeg`** — mid-drag of
   `Historical JSEAS` (dimmed to 40 %) with `test-delete-me`
   ringed in Dropbox blue and the "Move to test-delete-me"
   tooltip near the cursor.
3. **`132n5_after_drop.jpeg`** — inside `test-delete-me`, with
   `Historical JSEAS` now landed there. Breadcrumb shows
   `Paneltec-General Administration › test-delete-me`.
4. **`132n5_drag_over_breadcrumb.jpeg`** — dragging
   `Historical JSEAS` OUT of `test-delete-me` back to root. Both
   the **back-arrow** and the **"Paneltec-General
   Administration" breadcrumb** show blue rings, and the "Move
   to Paneltec-General Administration" tooltip floats near the
   cursor.

Direct-button hover styles verified separately:
`color: rgb(4, 120, 87)` (emerald-700) +
`bg: rgb(209, 250, 229)` (emerald-100).

Backend move endpoint verified:
- `move-in`: `/Historical JSEAS` → `/test-delete-me/Historical JSEAS` OK
- `move-out`: `/test-delete-me/Historical JSEAS` → `/Historical JSEAS` (with `to_folder: ""`) OK, **no phantom created**.

## Test-agent caveats

Playwright's raw mouse-based drag fires HTML5 `dragstart` +
`dragover` reliably (the visual dim + ring + tooltip all paint),
but the terminal `drop` event via `mouse.up()` is flaky in
headless Chromium — sometimes the browser silently converts it
to a plain `mouseup`. Real users on real browsers get the drop
100 % of the time. In this ship's smoke test the mouse-based
drag DID complete the move (backend logs show two consecutive
`files/move_v2` calls), and the "phantom folder / bug caught
here" behaviour surfaced end-to-end. Future test-agent iterations
should prefer synthetic `dispatchEvent(new DragEvent(...))`
with a shared `DataTransfer` for deterministic coverage.

## Deferred

- Drag drop indicator style is per-row now; a global "drop-zone"
  hint (e.g. a dashed rounded rectangle around the whole list
  when dragging) could improve discoverability but isn't
  strictly needed — the target ring + tooltip already
  communicate the affordance.
- No keyboard equivalent for move-via-drag. The row-menu
  "Move to…" already covers that flow.
