# v58.13.132g6 — HOTFIX: 3-dots menu gated by admin PIN on ALL tiles + hidden without PIN · SHIPPED (finish deferred)

## Root cause
Stephen: **"why do you give every body the ability to log the view
and the ability to bring them back again and not password control"**.

`.132g5` gated the 3-dots menu behind the admin PIN, but only on
`pin_protected` tiles. Public tiles still let any authenticated
user Copy URL / Hide-from-my-view via the 3-dots without a PIN.
Same policy hole as `.132g3`, one layer deeper.

## Model (after `.132g6`)

```
              public tile              PIN-protected tile
              ────────────              ──────────────────
click body    → open URL directly       → PIN modal (intent=launch)
                                          correct → open URL
                                          wrong   → shake · no nav

click 3-dots  → PIN modal (intent=menu) → PIN modal (intent=menu)
                correct → open menu       correct → open menu
                wrong   → shake · no menu wrong   → shake · no menu

3-dots render → ONLY if caller has an admin PIN configured
                (hasAdminPin from /auth/admin-console/status).
                Non-admins get 403 on that probe → flag stays
                false → button not rendered → no gate to leak.
```

## Backend change (`org_url_tiles.py`)
- **Dropped the `400 "Tile is not PIN-protected"` branch** in
  `verify_tile_pin`. The endpoint now accepts verification against
  any tile — it's the admin-PIN gate for both the URL launch (on
  pin_protected tiles) and the 3-dots menu (on all tiles). Wrong
  PIN still 401; missing PIN still 403; 404 on unknown tile; 429
  on lockout tiers unchanged.

## Frontend changes

### `components/apps-directory/TileCard.jsx`
- `hasAdminPin` prop added to `TileCard` (JSDoc + destructure).
  Threaded through `SortableTileCard` via `...rest`.
- `toggleMenu` dropped the `if (pinProtected) …` branch. Every
  non-toggle-close path now sets `pinIntent='menu'` and pops the
  PIN modal.
- The 3-dots `<button>` is wrapped in `{hasAdminPin && (…)}`. No
  PIN → no button.
- Tooltip is unconditional now:
  **`"PIN required · actions for this tile"`**.

### `components/AppsDirectoryModal.jsx` + `pages/AppsDirectory.jsx`
- Both fetch `POST /auth/admin-console/status` once on mount into
  a `hasAdminPin` state (defaults to `false`). Non-admins get 403
  from `_require_admin` in that endpoint → catch keeps the flag
  false → 3-dots hidden.
- `hasAdminPin={hasAdminPin}` forwarded on every `SortableTileCard`.

## Version bumps
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132g6`.
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132g6`.

## Pytest — 46 passed / 2 environment-conditional skips
```
tests/test_v58_13_132g6_3dots_universal_pin_gate.py  8 passed
tests/test_v58_13_132g5_3dots_pin_gate.py            9 passed
tests/test_v58_13_132g4_drag_handle_and_copy.py      8 passed
tests/test_v58_13_132g3_launcher_modal_3dots_and_reorder.py  9 passed
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py  14 passed · 2 skipped
======================== 46 passed, 2 skipped in 3.04s =========================
```
`.132g6` pins (8 new):
- `verify_tile_pin` no longer 400s on public tiles (`Tile is not
  PIN-protected` guard removed).
- Behavioural: seed a public tile → wrong PIN returns 401/429/403,
  never the pre-.132g6 400.
- `toggleMenu` no longer special-cases `pinProtected` — the branch
  is gone; every non-close path fires the PIN modal.
- `setMenuOpen(true)` inside `toggleMenu` is retired — every path
  goes through the PIN modal.
- 3-dots button render is wrapped in `{hasAdminPin && (…)}`.
- `hasAdminPin` prop is documented and destructured in `TileCard`.
- Both parents probe `POST /auth/admin-console/status`, state
  slot exists, prop forwarded to `SortableTileCard`.
- Version bumped.

Retargeted older pins (semantic slot preserved; wording follows the
code):
- `.132g1` `verify-pin` error taxonomy pin dropped the pre-.132g6
  400 assertion.
- `.132g5` `toggleMenu` pins accept the `.132g6` collapse (no
  `if (pinProtected)`, no `setMenuOpen(true)` inside toggleMenu).
- `.132g5` version pin relaxed to `.132g\d` regex.
- `.132g4` tooltip pin accepts the collapsed unconditional
  `"PIN required · actions for this tile"`.

## Playwright (`scripts/verify_132g6.py`)
```
seeded: public=ef34f7d5-…  pin=9cabbabe-…

=== v58.13.132g6 universal 3-dots PIN-gate verification ===
failures 0
STATUS: PASS
```
The script:
- Seeds one public tile and one pin_protected tile.
- Opens the launcher, waits for the admin-console/status probe
  to resolve so the 3-dots renders.
- Asserts the 3-dots button IS rendered for Stephen on BOTH tiles
  (he has a PIN).
- Clicks the 3-dots on the PUBLIC tile → asserts `tile-pin-modal-<id>`
  opens; menu panel does NOT.
- Enters a wrong PIN → asserts the inline `tile-pin-error-<id>`
  appears; menu panel still absent.
- Closes the modal + clicks 3-dots again → asserts the PIN modal
  reopens (per-click, not per-session).
- Repeats the click on the pin_protected tile → asserts the same
  behaviour (unchanged from `.132g5`).

Screenshots:
- `memory/v58_13_132g6_01_public_pin_prompt.png` — PIN modal
  after clicking 3-dots on a PUBLIC tile.
- `memory/v58_13_132g6_02_pin_tile_prompt.png` — same on the
  pin_protected tile.

The **"3-dots hidden for users without a PIN"** branch is
source-pinned only — this env has `POST /users` disabled ("use
Simpro import") so we can't seed an ephemeral non-PIN admin at
runtime. The `{hasAdminPin && (…)}` conditional + the
`/admin-console/status` fetch are locked in the pytest.

## Files changed
```
backend/org_url_tiles.py                                                     — dropped `Tile is not PIN-protected` 400 in verify_tile_pin
backend/tests/test_v58_13_132g6_3dots_universal_pin_gate.py                  — 8 source pins + behavioural
backend/tests/test_v58_13_132g1_tiles_3dots_and_reorder.py                   — verify-pin taxonomy pin retargeted
backend/tests/test_v58_13_132g4_drag_handle_and_copy.py                      — tooltip pin loosened
backend/tests/test_v58_13_132g5_3dots_pin_gate.py                            — toggleMenu pins retargeted; version pin relaxed
frontend/src/components/apps-directory/TileCard.jsx                          — hasAdminPin prop, unconditional PIN gate, conditional render
frontend/src/components/AppsDirectoryModal.jsx                               — /admin-console/status probe + hasAdminPin forward
frontend/src/pages/AppsDirectory.jsx                                         — same
frontend/src/lib/version.js                                                  — .132g6 bump
frontend/public/service-worker.js                                            — .132g6 bump
scripts/verify_132g6.py                                                      — Playwright coverage of the public-tile gate
memory/v58_13_132g6_01_public_pin_prompt.png                                 — Playwright screenshot
memory/v58_13_132g6_02_pin_tile_prompt.png                                   — Playwright screenshot
memory/v58_13_132g6_3dots_universal_pin_gate_shipped_finish_deferred.md      — this memo
```

## NOT changed
- `POST /verify-pin` request/response schema, PIN hashing, lockout
  tiers (`admin_console_pin_attempts`) — all reused.
- `pin_protected` field semantics (URL-launch gate + greyed / lock
  overlay) — unchanged.
- `TilePinModal` component internals — same portalled 4-dot
  keypad, same shake keyframe.
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
- `.132g3` `5b71669` — HOTFIX: launcher modal picks up `.132g1` affordances
- `.132g4` `0953679` — HOTFIX: drag handle + sensor threshold + Hide/PIN copy
- `.132g5` `d1a9f3b` — HOTFIX: 3-dots gated by PIN on pin_protected tiles
- **`.132g6`** — HOTFIX: 3-dots gated by PIN on ALL tiles + hidden without PIN
