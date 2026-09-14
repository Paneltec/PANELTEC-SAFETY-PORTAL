# v58.13.132g5 — HOTFIX: PIN gate now applies to the 3-dots menu too · SHIPPED (finish deferred)

## Root cause
Stephen: **"so it looks like you have given everybody the ability
with out signing in on the 3 dots"**.

Pre-`.132g5`, PIN protection only gated the URL launch — the tile
body was greyed and clicking it prompted for the admin PIN. But the
3-dots menu opened freely, so Copy URL and Hide-from-my-view were
accessible without any PIN. Any user could still peel the URL off
a PIN-protected tile.

## Model (after `.132g5`)

```
              non-PIN tile              PIN-protected tile
              ────────────              ──────────────────
click body    → open URL                → PIN modal (intent=launch)
                                          correct → open URL
                                          wrong   → shake · no nav

click 3-dots  → open menu directly      → PIN modal (intent=menu)
                                          correct → open menu once
                                          wrong   → shake · no menu

menu close    → nothing                 → next 3-dots click prompts
                                          for PIN AGAIN (per-click)
```

## Implementation (`components/apps-directory/TileCard.jsx`)

Single new state slot `pinIntent` (`'launch' | 'menu' | null`) —
tracks WHY a PIN unlock was requested. `TilePinModal.onUnlocked`
snapshots the intent, clears it, then branches:
- `intent === 'menu'` → `setMenuOpen(true)`.
- `intent === 'launch'` → `doPlainOpen(url)`.
- anything else → no-op.

New `toggleMenu` handler replaces the raw 3-dots setter:
```js
const toggleMenu = (e) => {
  e.preventDefault(); e.stopPropagation();
  if (menuOpen) { setMenuOpen(false); return; }
  if (pinProtected) {
    setPinIntent('menu');
    setPinModalOpen(true);
    return;
  }
  setMenuOpen(true);
};
```

The URL-launch path (`openTile`) now sets `pinIntent='launch'`
before opening the modal so the shared `onUnlocked` can tell the
two paths apart.

`TilePinModal.onClose` resets **both** `pinModalOpen` AND
`pinIntent` so a stale intent can never bleed between clicks.

## Copy nudge
3-dots tooltip is now conditional:
- Non-PIN → `"Actions for this tile"` (unchanged).
- PIN → `"PIN required · actions for this tile"` so the gate is
  discoverable on hover before the click.

Same `title` and `aria-label` in lockstep.

## Backend
**Unchanged.** Reuses the `.132g1` `POST /org/url-tiles/{id}/verify-pin`
endpoint — no schema change, no new endpoint.

## Version bumps
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132g5`.
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132g5`.

## Pytest — 40 passed / 2 environment-conditional skips
```
tests/test_v58_13_132g5_3dots_pin_gate.py             9 passed
tests/test_v58_13_132g4_drag_handle_and_copy.py       8 passed
tests/test_v58_13_132g3_launcher_modal_3dots_and_reorder.py  9 passed
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py    14 passed · 2 skipped
======================== 40 passed, 2 skipped in 2.21s =========================
```
`.132g5` pins (9 new):
- `pinIntent` state exists, documents the three legal values.
- URL-launch branch sets `intent='launch'`.
- `toggleMenu` gates on `pinProtected` and sets `intent='menu'`.
- 3-dots button now wired to `toggleMenu` (not the raw setter).
- Tooltip pin — conditional PIN-required copy.
- `onUnlocked` snapshots `pinIntent` before clearing and branches
  correctly.
- Modal close resets both `pinModalOpen` AND `pinIntent`.
- `POST /verify-pin` reuse pin (no new endpoint).
- Non-PIN path unchanged (fall-through order).

Older `.132g4` pins retargeted:
- Trigger tooltip pin accepts either the static string OR the new
  conditional JSX expression.
- `.132g4` version pin relaxed to `.132g\d` regex.

## Playwright (`scripts/verify_132g5.py`)
```
seeded: PIN=69fe65ea-… OPEN=5cb6876b-…

=== v58.13.132g5 3-dots PIN-gate verification ===
failures 0
STATUS: PASS
```
The script asserts four behaviours we can verify WITHOUT knowing
Stephen's PIN (the env has `POST /users` disabled — "use Simpro
import" — so we can't seed an ephemeral admin with a known PIN):

1. Click 3-dots on the PIN-protected tile → `tile-pin-modal-<id>`
   opens; the menu panel does NOT render.
2. Enter a wrong PIN → inline `tile-pin-error-<id>` appears; menu
   panel still absent.
3. Close PIN modal + click 3-dots again → PIN modal reopens
   (proving the state resets per-click, not per-session).
4. Click 3-dots on the non-PIN tile → menu panel opens directly;
   no PIN modal appears.

The "correct PIN → menu opens" and "menu-close re-prompts" paths
are covered exclusively by the source-pin tests
(`test_onUnlocked_branches_on_intent`,
`test_pin_intent_reset_on_modal_close`) — the runtime `onUnlocked`
branch requires the correct PIN which we deliberately can't rotate
in this environment.

Screenshots:
- `memory/v58_13_132g5_01_pin_prompt.png` — PIN modal after clicking
  3-dots on the PIN-protected tile.
- `memory/v58_13_132g5_02_non_pin_menu.png` — non-PIN tile's menu
  opening directly on 3-dots.

## Files changed
```
frontend/src/components/apps-directory/TileCard.jsx                          — pinIntent state, toggleMenu, branched onUnlocked
frontend/src/lib/version.js                                                  — .132g5 bump
frontend/public/service-worker.js                                            — .132g5 bump
backend/tests/test_v58_13_132g5_3dots_pin_gate.py                            — 9 source pins
backend/tests/test_v58_13_132g4_drag_handle_and_copy.py                      — tooltip + version pin relaxed
scripts/verify_132g5.py                                                      — 4-branch Playwright
memory/v58_13_132g5_01_pin_prompt.png                                        — Playwright screenshot
memory/v58_13_132g5_02_non_pin_menu.png                                      — Playwright screenshot
memory/v58_13_132g5_3dots_pin_gate_shipped_finish_deferred.md                — this memo
```

## NOT changed
- `POST /verify-pin` endpoint (`.132g1`), `pin_protected` field,
  `TilePinModal` component internals, credential auto-launch flow.
- Standalone `/apps-directory` page: also picks up the gate via the
  shared `TileCard` (same source of truth).
- `components/AppsDirectoryModal.jsx`: no change — sensor tuning
  and DnD context wiring from `.132g4` still in force.
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
- `.132g4` `0953679` — HOTFIX: prominent drag handle + lower sensor threshold + Hide/PIN copy
- **`.132g5`** — HOTFIX: 3-dots menu ALSO gated by admin PIN on PIN-protected tiles
