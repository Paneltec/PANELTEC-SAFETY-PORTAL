# v58.13.132ht — Settings sidebar folder-delete + Doc Library tree + Workers toolbar rollback (shipped)

## The bug Stephen actually reported

> "There IS a trash icon beside each folder in the tree. Clicking it
> crashes the page. Folder is not deleted. The 3 orphan NEW FOLDER
> entries exist because delete keeps failing."

Screenshot showed 3 "New folder" rows in the **left sidebar**
(under Settings → Certifications), each with a "Drop items here"
placeholder. Not in the Document Library — the earlier `.132hm`
work fixed a different tree entirely.

## Root cause (proved by live browser reproduction, 2026-09-17)

1. Signed in as `stephen@paneltec.com.au`.
2. Navigated to `/app/settings/users` (any settings route surfaces
   the SettingsNav sidebar).
3. Clicked the trash beside a "New folder" — modal appeared.
4. Clicked "Delete folder" (Confirm) — **nothing happened**. Modal
   stayed open. Folder still present.
5. Injected a capture-phase click listener on Confirm — the listener
   **never fired**. Click had missed the button entirely.
6. Called `document.elementFromPoint(cx, cy)` at the exact center of
   the Confirm button — response:

       {'tag': 'TH', 'testid': null, 'text': 'Role'}

   The Users page table header `<th>Role</th>` was rendering **ON
   TOP OF** the Confirm button. The tap was landing on the table
   header, not on Confirm. Delete never fired. Modal never closed.

### Why `z-50` (or even `z-[100]`) didn't help

`<DeleteFolderModal>` was rendered in-place inside `SettingsNav.jsx`.
The AppShell sidebar (and dnd-kit's `<DragOverlay>` ancestor)
applies a `transform` which creates a **local stacking context**.
Once you're trapped inside a lower stacking context, no `z-index`
on a descendant can escape it — the entire subtree gets layered
under whatever the parent sits behind.

### Fix

`SettingsNav.DeleteFolderModal` now renders via `createPortal(body,
document.body)`. The modal escapes to `<body>` where its `z-[100]`
is authoritative. Verified by re-running the reproduction:

    elementFromPoint(confirm-center):
      {'tag': 'BUTTON', 'testid':
       'settings-nav-folder-folder_e05e6f4c-...-delete-confirm',
       'text': 'Delete folder'}

Confirm button is now the topmost element. Tap lands cleanly.
Modal closes. Folder removed. PUT `/api/settings/nav-layout` fires.
Server persists. Fresh reload confirms zero orphans.

### Honest note about `.132hm`

`.132hm` fixed the recursive cascade on `DELETE /document-library/folders/{id}`.
That was a real fix for a real bug — but for a **different tree**.
`.132hm` did not touch `SettingsNav.jsx` at all, so the sidebar's
in-place-modal stacking-context trap was never on the table. This
memo makes that separation explicit so nobody re-conflates the two
paths on the next report.

## Second sub-fix — trash icon visibility on iPad

`SettingsNav.SortableFolder` trash button was styled with
`opacity-0 group-hover/folder:opacity-100`. On desktop hover reveals
it; on iPad there is no hover, so admins had no discoverable delete
affordance in the sidebar. `.132ht` promotes it to:

    opacity-60 group-hover/folder:opacity-100 focus-within:opacity-100
    transition-opacity

Same treatment applied to `DocumentLibraryTree.jsx` per Stephen's
earlier iPad feedback.

## Third sub-fix — Workers toolbar rollback (`.132hq`)

Removed the worker-company multi-select chip filter from the
`Workers.jsx` toolbar. The chip row displaced the search input on
narrow viewports. Backend `worker_companies` collection, CRUD
endpoints and `worker.company` field are intentionally kept in place
— data is dormant, not purged. **Open question with Stephen: full
purge or leave the dormant data?**

## Files touched

* `frontend/src/components/settings/SettingsNav.jsx`
  - Import `createPortal` from `react-dom`.
  - `DeleteFolderModal` renders via portal to `document.body`.
  - Modal className: `z-[100]` (was `z-50`).
  - Trash button className: `opacity-60 …/opacity-100 focus-within:opacity-100`.
* `frontend/src/pages/DocumentLibraryTree.jsx`
  - Tree action pill className: `inline-flex … opacity-40
    group-hover:opacity-100 focus-within:opacity-100`.
* `frontend/src/pages/Workers.jsx`
  - `.132hq` chip filter block, `workerCompanies`/`companyFilter`
    state, loader, filter-in-useMemo, and dep-array entry all
    deleted. Search input keeps its original toolbar position.
* `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped `.132hs` → `.132ht`.
* `frontend/public/service-worker.js` — `CACHE_VERSION` bumped in
  lockstep.

## Verifications

**Live Playwright reproduction (2026-09-17 10:09):**

    #1 folder_e05e6f4c-db31...  del btn opacity: 0.6
        elementFromPoint(confirm-center): {'tag': 'BUTTON',
         'testid': 'settings-nav-folder-...-delete-confirm',
         'text': 'Delete folder'}
        after confirm → modal=0, wrapper=0
    #2 folder_e005c0ba-07fb...  ✓ modal=0, wrapper=0
    #3 folder_fd47a060-bbac...  ✓ modal=0, wrapper=0

    Network for /nav-layout:
      REQ PUT https://.../api/settings/nav-layout → RES 200 ×3
      (one PUT per deletion, debounced from doDeleteFolder)

Server-side verification post-fix:

    total folders: 1 · orphan New folder: 0
      'Admin' kids=5

**Pytest (`tests/test_v58_13_132ht_folder_tree_delete_and_workers_rollback.py`) · 7/7 green:**

  1. `test_delete_empty_doc_library_folder_returns_204` — the
     `.132hm` cascade endpoint still returns 204 on empty folders.
  2. `test_nav_layout_put_persists_folder_removal` — PUT
     `/settings/nav-layout` accepts a payload with a folder removed
     and returns it clean on subsequent GET.
  3. `test_settings_nav_modal_uses_portal_and_z100` — source-level
     guard: modal uses `createPortal(body, document.body)` at
     `z-[100]`. Regression guard for the actual fix.
  4. `test_settings_nav_trash_button_not_opacity_zero` — trash
     button className has a visible idle opacity.
  5. `test_doc_tree_action_pill_is_not_hover_only` — Doc Library
     tree pill not `hidden group-hover:inline-flex`.
  6. `test_workers_toolbar_has_search_and_no_company_chip_filter` —
     Workers toolbar rollback verified at source level.
  7. `test_version_pin_v132ht` — three-way version lockstep.

## Ops rules honoured

* No `testing_agent` / `e1_tester` / `finish` — pytest + Playwright
  reproduction only.
* No `/app/mobile/` edits — mobile bundle version unchanged.
* No hard-coded env values.
* `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` + `CACHE_VERSION` all
  bumped in lockstep.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## NOT in this ship

* Full purge of the `worker_companies` collection + `worker.company`
  field. Stephen owed a yes/no on that; parked.
* Certifications-page-specific redesign (Stephen's screenshot had a
  "Certifications" badge nearby but the actual bug was the shared
  sidebar folder tree, not the Certifications page content).

## Screenshots

* `/app/memory/v58_13_132ht_settings_nav_delete_repro.jpeg` — modal
  visible but Confirm button unreachable (elementFromPoint = `<TH>`).
* `/app/memory/v58_13_132ht_settings_nav_FIXED.jpeg` — modal closed,
  all 3 orphans gone, sidebar clean.
