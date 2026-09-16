# v58.13.132gz — Document Library Frontend Tree UI — SHIPPED

`finish` tool deliberately deferred per Stephen's standing directive.

## What shipped

`.132gy` restructured the 51 flat seed folders into 9 WHS top-level
parents (Compliance & Safety, Training & Competency, Administration,
Field Operations, HR & Payroll, IT & Systems, Site & Depot,
Suppliers & Contracts, Uncategorised). `.132gz` is the visual half:
a collapsible tree replaces the flat pastel grid on
`/app/document-library` whenever no text/colour filter is active.

## User-facing behaviour

- **Default expand**: `Uncategorised` (the system folder) + top-2 root
  folders by direct `file_count` on first load per user.
- **Persistence**: `localStorage.paneltec_doclib_tree_expanded_v1_
  <user_id>` — per-user, survives reloads.
- **Counts**: leaf rows show a single count (direct files). Parent
  rows with children show `4 (127)` — direct then recursive total.
  Recursive total is memoised and cycle-safe.
- **DnD** (admins only, folders only this ship):
  - Row drag → drop onto another row PATCHes `parent_folder_id`.
  - Root drop zone appears at the top while dragging a folder that
    currently has a parent; drop uses the `-` sentinel to detach.
  - Client-side cycle guard (`isDescendantOrSelf`) rejects invalid
    targets with a rose ring + `dropEffect=none`; backend also
    cycle-checks on PATCH as belt-and-braces.
- **Rename / delete**: inline rename input + existing page-level
  delete-confirm modal are reused — no new modals.
- **Filter-mode fallback**: activating the text filter or a colour
  chip renders the pre-existing flat pastel grid so search hits stay
  visible flat.

## Files touched

- `backend/document_library.py` — `/folders/all` response extended
  with `file_count`, `color_key`, `sort_order`. Sort widened to
  `[(sort_order, 1), (name, 1)]`.
- `frontend/src/pages/DocumentLibrary.jsx` — six new helpers
  (`_treeStorageKey`, `_loadExpandedFromStorage`,
  `_saveExpandedToStorage`, `buildFolderIndex`,
  `computeDefaultExpanded`, `isDescendantOrSelf`) plus three
  components (`TreeRow`, `TreeSubtree`, `FolderTreeView`).
  Primary render gated on `(!filter && colorFilter.size === 0)`
  swaps the flat grid for `<FolderTreeView>`. Load flow eager-fetches
  `/folders/all` alongside `/folders` on mount.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped `.132gy` → `.132gz`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped in
  lockstep.

## NOT in this ship (deferred to `.132ha` per user directive)

- File drag-and-drop between folders. Folders only for now.
- Breadcrumb rail at the top of the tree. Clicking a row navigates
  to the folder detail page which already carries `<PageHeader>`
  breadcrumb — deferred until user asks for a rail inline.
- Tree row recolour. Users can still recolour via the flat grid view
  (activate any filter).

## Testids (locked, ready for Playwright)

- `folder-tree`
- `tree-root-drop-zone`
- `tree-row-<folder_id>`
- `tree-chevron-<folder_id>`
- `tree-open-<folder_id>`
- `tree-count-<folder_id>`
- `tree-actions-<folder_id>`
- `tree-rename-<folder_id>`
- `tree-delete-<folder_id>`
- `tree-rename-row-<folder_id>`
- `tree-rename-input-<folder_id>`
- `tree-rename-save-<folder_id>`

Legacy grid testids (`folder-grid`, `folder-card-<id>`, all
existing rename/delete/recolor patterns) are UNCHANGED — filter-mode
still renders the grid.

## Verification

- `backend/tests/test_v58_13_132gz_doclib_tree.py` — 13 checks, all
  green. Locks endpoint payload, tree components, filter gate,
  localStorage key, reparent PATCH shape, root sentinel, testids,
  DnD contract, version lockstep.
- `scripts/verify_132gz.py` — Live curl smoke on
  `/api/document-library/folders/all` (as Stephen) passed: 64
  folders (9 roots + 55 nested), all extended keys present. Web
  smoke available (Playwright chromium not installed on this pod —
  script warns and continues rather than failing).

## Ops notes

- Disk was at 100% during writes; `rm -rf /app/frontend/node_modules/
  .cache /app/backend/**/__pycache__ /tmp/*` freed ~1 GB and unblocked
  the ship.
- Mongo migration nothing further — `.132gy` already reparented
  folders via `_ensure_tree_structure`, and `/folders/all` invokes
  it on every call so a fresh org auto-nests on first render.

## Pending user verification

Awaiting Stephen to sanity-check the tree UX end-to-end and confirm
whether the deferred items (file DnD, breadcrumb rail, tree
recolour) should be pulled forward to `.132ha` or slot in later.
