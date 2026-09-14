# v58.13.132g4 — HOTFIX: prominent drag handle + lower sensor threshold + Hide/PIN copy clarification · SHIPPED (finish deferred)

## Root cause
`.132g3` shipped drag-to-reorder on the launcher modal via the
shared `TileCard`, but Stephen reported: **"i cant drag the tils
around"**. Two compounding problems:

1. **Drag handle was near-invisible.** `.132g3` rendered
   `<GripVertical size={14} className="text-slate-300 hover:text-slate-600">`
   at the top-left of each tile. 14px slate-300 on a white card is
   barely visible; users don't know WHERE to grab.
2. **Sensor threshold too high.** `@dnd-kit`'s `PointerSensor`
   with `activationConstraint: { distance: 6 }` requires 6px of
   pointer travel before the drag activates. On a MacBook trackpad
   micro-drag, Stephen was releasing the click before crossing that
   threshold — click event fired instead of a drag.

Also in this ship: Stephen conflated "Hide until next login" with
PIN protection, so the menu copy needed rewriting to make the
semantic difference obvious.

## Fixes

### Prominent drag handle (`TileCard.jsx`)
- 14px → **18px** icon.
- `text-slate-500 hover:text-slate-900` (was slate-300 / slate-600).
- White-90% background + slate-200 border + soft shadow so it stands
  out against the tile.
- `title="Drag to reorder"` + matching `aria-label` — hover shows
  the intent even before drag starts.
- `cursor-grab` / `active:cursor-grabbing` retained.
- `touch-none` retained (per @dnd-kit docs — prevents mobile Safari
  from stealing the gesture).

### DnD sensor tuning (`AppsDirectoryModal.jsx` + `pages/AppsDirectory.jsx`)
- `PointerSensor { distance: 6 }` → **`{ distance: 3 }`**.
- **Added `TouchSensor`** with `{ delay: 150, tolerance: 5 }` — an
  iPad admin holding a tile for 150ms triggers a drag; a single tap
  or scroll gesture is unaffected. `.132g3` didn't wire touch, so
  reorder on tablet was impossible.
- `KeyboardSensor` retained (accessibility).

### Menu copy (`TileCard.jsx`)
- 3-dots trigger `title` + `aria-label` → **"Actions for this tile"**
  (was "Tile options").
- Hide item **primary label** → **"Hide from my view (until logout)"**
  (was "Hide until next login").
- Hide item **sub-label** (italic, ml-5, text-slate-400):
  **"Only affects your view. Not secure."** — explicitly tells the
  user this is unrelated to PIN protection.
- PIN-protected tiles: menu's top action stays **"Unlock with PIN"**
  (unchanged label, but the plain "Open" is not rendered for PIN
  tiles — one clear primary action).
- Menu panel width bumped `w-56` → `w-64` to accommodate the
  longer Hide label without wrapping.

## Version bumps
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132g4`.
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132g4`.

## Pytest — 31 passed / 2 environment-conditional skips
```
tests/test_v58_13_132g4_drag_handle_and_copy.py             8 passed
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py          14 passed · 2 skipped
tests/test_v58_13_132g3_launcher_modal_3dots_and_reorder.py  9 passed
======================== 31 passed, 2 skipped in 2.23s =========================
```
`.132g4` pins (8 new):
- Drag handle is 18px, slate-500 default → slate-800 hover, white
  bg + border + shadow, `cursor-grab` / `cursor-grabbing`.
- `title="Drag to reorder"` + `aria-label` present.
- `PointerSensor { distance: 3 }` in both parent components
  (`{ distance: 6 }` no longer in any active `useSensor` call).
- `TouchSensor { delay: 150, tolerance: 5 }` in both parents.
- 3-dots trigger tooltip rewrite (Actions for this tile).
- Hide primary label + sub-label copy locked.
- PIN-tile menu top action is exclusively `Unlock with PIN`.
- `.132g4` version bump.

Older pins retargeted:
- `.132g1` Hide label pin loosened to accept either "Hide until
  next login" OR "Hide from my view" (semantic slot).
- `.132g3` version pin relaxed to `.132g\d` regex.

## Playwright (`scripts/verify_132g4.py`) — human-like drag
```
seeded: ['1603bf0c-…', '984bbafb-…', 'e81fd551-…']
grid before drag: ['1603bf0c', '984bbafb', 'e81fd551']
grid after drag:  ['984bbafb', 'e81fd551', '1603bf0c']
grid after reload: ['984bbafb', 'e81fd551', '1603bf0c']

=== v58.13.132g4 launcher drag verification ===
seeded 3 tiles · failures 0
STATUS: PASS
```
The script:
- Seeds 3 real tiles, opens the launcher, asserts every tile has a
  visible drag handle testid.
- Opens the 3-dots menu on tile 0 → reads the panel text and pins:
  - `"Hide from my view"` present.
  - `"Only affects your view"` sub-label present.
  - Trigger's `title` and `aria-label` are `"Actions for this tile"`.
- Executes a **human-cadenced mouse drag**: `mouse.move(handle_A) →
  mouse.down() → 6 slow interpolated moves with time.sleep(0.05)
  between each → mouse.up(tile_C)`. First micro-move (4,2) breaks
  the 3px activation threshold; subsequent moves interpolate
  linearly to the drop target.
- Asserts the DOM grid order changed (A moved from position 0 to
  position 2, wrapping the seeded set).
- Reloads the page, clears session-hide, reopens the launcher,
  confirms the drag actually persisted via `PATCH /reorder` (not
  just a local re-render).

Screenshot: `memory/v58_13_132g4_launcher.png`.

## Files changed
```
frontend/src/components/apps-directory/TileCard.jsx                          — drag handle + menu copy rewrite
frontend/src/components/AppsDirectoryModal.jsx                               — sensors: distance 3 + TouchSensor
frontend/src/pages/AppsDirectory.jsx                                         — sensors: distance 3 + TouchSensor
frontend/src/lib/version.js                                                  — .132g4 bump
frontend/public/service-worker.js                                            — .132g4 bump
backend/tests/test_v58_13_132g4_drag_handle_and_copy.py                      — 8 source pins
backend/tests/test_v58_13_132g1_tiles_3dots_and_reorder.py                   — Hide-label pin loosened
backend/tests/test_v58_13_132g3_launcher_modal_3dots_and_reorder.py          — version pin regex
scripts/verify_132g4.py                                                      — human-cadenced Playwright drag
memory/v58_13_132g4_launcher.png                                             — Playwright screenshot
memory/v58_13_132g4_drag_handle_and_copy_shipped_finish_deferred.md          — this memo
```

## NOT changed
- `verify-pin` endpoint, `pin_protected` model, PIN modal semantics
  — all `.132g1` behaviour retained.
- Credential-launch auto-copy-password / cheat-sheet popup — untouched.
- `/app/mobile/` — untouched. `MOBILE_BUNDLE_VERSION` unchanged.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still
  parked for `v58.14.x`.
- `finish` / `testing_agent` / `e1_tester` — none used, per standing
  directive.

## Session ships to date
- `.132fy` `d756885` — Show inactive workers + Restore
- `.132fz` `57b9e2a` — Legacy template matcher additions
- `.132g0` `f48707f` — Duplicate detection tightening
- `.132g1` `4424e3c` — Apps Directory tiles: 3-dots + reorder + PIN gate
- `.132g2` `bcb133e` — Avatar-scale range bump
- `.132g3` `5b71669` — HOTFIX: launcher modal picks up all `.132g1` affordances
- **`.132g4`** — HOTFIX: prominent drag handle + lower sensor threshold + Hide/PIN copy
