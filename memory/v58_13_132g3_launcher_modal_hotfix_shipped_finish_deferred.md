# v58.13.132g3 — HOTFIX: Apps Directory launcher modal picks up 3-dots + drag + PIN gate · SHIPPED (finish deferred)

## Root cause
`.132g1` shipped the tile 3-dots menu + drag-to-reorder + per-tile
PIN gate on **the wrong two surfaces**:
- ✅ `pages/AppsDirectory.jsx` — the standalone `/apps-directory` page.
- ✅ `components/QuickLinksSection.jsx` — the Org Settings Manage-Tiles editor.

Stephen's actual users open the **launcher modal**
(`components/AppsDirectoryModal.jsx`) from the sidebar entry — a
DIFFERENT component that was untouched by `.132g1`. His screenshot
of 10 "LAUNCH X" tiles with no 3-dots, no drag, no PIN state was
the launcher modal, not the standalone page. Playwright asserted
the wrong surface and reported PASS.

## Fix — extract shared tile primitives
New file **`frontend/src/components/apps-directory/TileCard.jsx`**
holds all tile interaction code as reusable exports:

- `TileCard`           — visual card (3-dots, PIN state, credential launch).
- `SortableTileCard`   — `TileCard` wrapped in `useSortable`.
- `TilePinModal`       — portalled 4-dot keypad + shake feedback.
- `useHiddenTiles(userId)` — session-scoped per-user hide hook.
- `openCheatSheet(...)` — credential auto-launch cheat-sheet popup.
- `DEFAULT_TILE_COLOR` — brand accent fallback.

Testid slots take a `testIdPrefix` prop so both surfaces stay
uniquely addressable:
- `apps-directory-hub-tile-*` — standalone page.
- `apps-directory-modal-tile-*` — launcher modal.

## Files touched

### New
- `frontend/src/components/apps-directory/TileCard.jsx` — the shared module (~450 lines).
- `backend/tests/test_v58_13_132g3_launcher_modal_3dots_and_reorder.py` — 9 source pins.
- `scripts/verify_132g3.py` — Playwright coverage of the launcher modal specifically.
- `memory/v58_13_132g3_01_modal_menu.png` + `v58_13_132g3_02_pin_modal.png` — screenshots.

### Refactored (no inline duplication)
- `components/AppsDirectoryModal.jsx` — now imports from the shared module,
  renders `<DndContext>` + `<SortableContext>` + `SortableTileCard` with
  `testIdPrefix="apps-directory-modal-tile"` and `credentialLaunch` prop
  (the old inline `HubTile` + `openCheatSheet` are gone).
- `pages/AppsDirectory.jsx` — same treatment with
  `testIdPrefix="apps-directory-hub-tile"` and `showAdminSettingsIcon`.

### `.132g1` test retargeting
- `backend/tests/test_v58_13_132g1_tiles_3dots_and_reorder.py` — frontend
  source pins now read `components/apps-directory/TileCard.jsx` for the
  tile primitives that migrated (menu testids, PIN modal function,
  session-hide, PIN modal wiring). The intent of each pin is unchanged
  — only the file path moved. Version pin relaxed to `.132g\d` regex
  so subsequent bumps (e.g. this `.132g3` hotfix) don't retroactively
  fail the `.132g1` ship's version check.

### Version bumps
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132g3`.
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132g3`.

## Pytest — 23 passed / 2 environment-conditional skips (`.132g1` + `.132g3` together)
```
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py            14 passed · 2 skipped
tests/test_v58_13_132g3_launcher_modal_3dots_and_reorder.py    9 passed
======================== 23 passed, 2 skipped in 2.66s =========================
```
`.132g3` pins cover:
- Shared TileCard exports (`TileCard`, `SortableTileCard`, `TilePinModal`,
  `useHiddenTiles`, `openCheatSheet`, `DEFAULT_TILE_COLOR`).
- PIN modal is portalled (`createPortal` + `document.body`).
- Launcher modal imports from the shared module (no inline `HubTile`,
  no inline `openCheatSheet`).
- Launcher modal renders `<DndContext>` + `<SortableContext>` + wires
  `PATCH /org/url-tiles/reorder`.
- Launcher passes `credentialLaunch` (auto-copy password path);
  standalone page does NOT.
- Testid prefixes are distinct per surface.
- All 9 parameterised testid slots emitted by the shared TileCard.
- `.132g3` version bump.

## Playwright (`scripts/verify_132g3.py`)
```
seeded launcher tiles: ['0b425b11-…', 'b1f4a392-…', '21752702-…']

=== v58.13.132g3 launcher modal verification ===
tiles seeded: 3 · failures: 0
STATUS: PASS
```
The script:
- Seeds 3 real tiles via API (2 plain, 1 PIN-protected).
- Opens the launcher modal by firing the SAME
  `paneltec:open-apps-directory` CustomEvent the sidebar entry
  uses (so we don't depend on sidebar collapse state).
- Asserts every seeded tile has an `apps-directory-modal-tile-menu-<id>`
  button visible.
- Opens the menu on tile A → asserts Open / Copy URL / Hide items.
- Clicks Hide on tile B → asserts it disappears from the grid + the
  per-user `hidden_tiles_<uid>` sessionStorage key carries the id.
- Confirms the PIN tile carries `data-pin-protected="true"`, has the
  lock overlay, and the 3-dots stays visible on the greyed card.
- Clicks Unlock → asserts the portalled `tile-pin-modal-<id>` opens.
- Enters a deliberately wrong PIN → asserts inline error + shake +
  modal stays open (no navigation).
- Fires `PATCH /reorder` with a new order, reloads the page (so
  `useHiddenTiles` re-initialises from empty sessionStorage), reopens
  the launcher, and asserts the modal grid renders in the new order.

Screenshots dropped:
- `memory/v58_13_132g3_01_modal_menu.png` — 3-dots menu open on a
  launcher-modal tile.
- `memory/v58_13_132g3_02_pin_modal.png` — PIN modal popped from a
  PIN-protected launcher-modal tile.

## NOT changed
- `admin_console_pin.py` — no schema change. The tile verify-pin
  endpoint added in `.132g1` still handles authentication.
- `components/layout/AdminPillsLock.jsx` header PIN modal — untouched.
- `components/QuickLinksSection.jsx` — untouched by this hotfix (its
  `.132g1` PIN checkbox + editor payload are unaffected).
- `/app/mobile/` — untouched. `MOBILE_BUNDLE_VERSION` unchanged.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still
  parked for `v58.14.x`.
- `finish` / `testing_agent` / `e1_tester` — none used, per standing
  directive.

## Lesson for future ships
When a feature has two rendering surfaces (standalone page + in-app
modal), extract shared primitives BEFORE shipping the feature —
Stephen catches the miss immediately via the primary user surface.
The `TileCard` shared module now guarantees both surfaces stay in
lock-step for any future tile UX change.
