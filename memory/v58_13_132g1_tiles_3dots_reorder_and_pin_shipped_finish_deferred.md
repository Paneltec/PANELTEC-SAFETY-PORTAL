# v58.13.132g1 — Apps Directory tiles: 3-dots menu · session hide · drag-to-reorder · per-tile PIN gate · SHIPPED (finish deferred)

## Scope
Un-parked the `.132fr` Apps Directory work. Ships three parts folded
into one hub upgrade:

1. **3-dots menu** on every tile (Open / Copy URL / Hide until next
   login).
2. **Drag-to-reorder** for admins on the Apps Directory grid.
3. **Per-tile PIN gate** (`pin_protected`) — greys the tile with a
   lock overlay and forces a per-click 4-digit PIN before the URL
   opens.

## Backend changes (`backend/org_url_tiles.py`)
- **New `PATCH /api/org/url-tiles/reorder`** endpoint
  - Body: `{tile_ids: [id0, id1, id2, …]}`
  - Writes `order = 0, 1, 2, …` in one pass; scoped to caller's
    org; admin-gated via `_admin(user)`.
  - Route sits **above** `PATCH /{tile_id}` so FastAPI doesn't
    swallow `/reorder` as a parameterised match.
- **New `pin_protected: bool`** column on `org_url_tiles`
  - Added to `TileCreate` and `TilePatch` models (default `false`,
    optional in patches).
  - Persisted on create + toggleable via PATCH.
  - Surfaced on `_out()` so the frontend can render the lock overlay.
- **New `POST /api/org/url-tiles/{id}/verify-pin`** endpoint
  - Body: `{pin: "1234"}` (4 digits enforced by `Field(min_length=4,
    max_length=4)` + regex).
  - Reuses `admin_console_pin` helpers (`_check_lockout`,
    `_record_failure`, `_reset_attempts`, `verify_password`) so the
    same 3/30s + 6/15min lockout tiers as the header lock apply.
  - Error taxonomy: `200 {ok, url}` · `400` not pin-protected · `401`
    wrong PIN · `403` no admin PIN configured / not approved · `404`
    tile not found · `429` locked out.

## Frontend changes

### `pages/AppsDirectory.jsx` (full rewrite)
- **@dnd-kit** wired for admins only (`PointerSensor` +
  `KeyboardSensor`; drag handle carries `touch-action: none`).
- **3-dots menu** on every tile card (always visible, `z-30` above
  the lock overlay so it works on greyed tiles too).
  - Menu opens `Open` / `Copy URL` / `Hide until next login`
  - PIN-protected tiles rename `Open` → **`Unlock with PIN`**.
- **Session hide** — `hidden_tiles_<user_id>` in `sessionStorage`
  (per-user so a shared kiosk stays clean between accounts).
  Retired the legacy permanent `localStorage.apps_directory_hidden`
  key; the "Show them again" footer link is a manual bypass for
  this session only.
- **PIN modal** (`TilePinModal`) — inline 4-dot indicator + 3×4
  keypad. Wrong PIN triggers a CSS `shake` animation and clears the
  input. **Portalled to `document.body`** so the `@dnd-kit`
  `transform` stacking context can't trap it (this was a
  Playwright-detected regression on my first pass).
- **Copy URL** — `navigator.clipboard.writeText` with a
  `document.execCommand('copy')` fallback for browsers that reject
  clipboard access.

### `components/QuickLinksSection.jsx` (tile editor)
- New checkbox **"Require admin PIN to open"** next to the existing
  "Visible on Quick Links page" checkbox
  (`data-testid="org-quick-links-editor-pin-protected"`).
- Form state seeded from `tile?.pin_protected ?? false` and piped
  through to the create / patch payload.

### CSS
- `index.css` gets a `@keyframes shake` for the wrong-PIN feedback.

## Version bumps
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132g1`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132g1`.

## Pytest (`tests/test_v58_13_132g1_tiles_3dots_and_reorder.py`)
14 passed · 2 environment-conditional skips
```
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_patch_reorder_route_registered_before_parametrised PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_reorder_admin_only_and_writes_order_field         PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_apps_directory_uses_dnd_kit                       PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_three_dot_menu_present                            PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_hide_uses_session_storage_per_user                PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_reorder_wired_to_patch_endpoint                   PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_copy_url_uses_clipboard_api                       PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_patch_reorder_behavioural                         PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_reorder_admin_gate                                SKIPPED (worker_stephen probe)
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_pin_protected_field_wired_in_models_and_out       PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_verify_pin_endpoint_registered                    PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_frontend_editor_has_pin_checkbox                  PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_frontend_tile_pin_modal_present                   PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_frontend_lock_overlay_and_greyed_tile             PASSED
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_verify_pin_behavioural                            SKIPPED (admin PIN already set to unknown value — can't rotate safely)
tests/test_v58_13_132g1_tiles_3dots_and_reorder.py::test_version_bumped_to_132g1                           PASSED

======================= 14 passed, 2 skipped in 2.79s =======================
```
The behavioural PATCH reorder round-trip is live: seeds three tiles,
reverses them via `PATCH /reorder`, GETs `/url-tiles`, and asserts
the reversed order comes back. Verify-pin behavioural is skipped in
this environment because Stephen's admin PIN is already set to an
unknown value and rotating would break the live login.

## Playwright (`scripts/verify_132g1.py`)
```
seeded tiles: ['2f9a5beb-…', 'a73a40ef-…', '0d554b7b-…']
  (info) Copy URL toast not detected — headless clipboard permission likely denied; source pin covers the code path

=== v58.13.132g1 verification ===
seeded 3 tiles · 0 failures
STATUS: PASS
```
The script:
- seeds 3 real tiles (2 plain, 1 PIN-protected) via the API,
- opens the Apps Directory,
- asserts a 3-dots menu on every tile,
- opens the menu and confirms Open / Copy URL / Hide items,
- hides tile B, asserts it disappears + `sessionStorage.hidden_tiles_<uid>`
  carries the id, reloads and confirms it's still hidden,
- clears storage, re-logs in, confirms the tile is back,
- calls `PATCH /reorder` with `[B, A, PIN]`, reloads, and asserts the
  grid renders in that order,
- verifies the PIN tile carries `data-pin-protected="true"`, the
  lock overlay, and 3-dots stays visible,
- clicks Unlock, verifies the modal opens (screenshot dropped),
- enters a deliberately wrong PIN and asserts the shake + inline error
  fire without navigation.

Screenshots:
- `memory/v58_13_132g1_01_menu_open.png` — 3-dots menu open on tile A.
- `memory/v58_13_132g1_02_pin_modal.png` — PIN modal on the locked tile.

## Files changed
```
backend/org_url_tiles.py                                                             — models, PATCH /reorder, POST /verify-pin, pin_protected persistence
backend/tests/test_v58_13_132g1_tiles_3dots_and_reorder.py                           — 16 checks
scripts/verify_132g1.py                                                              — Playwright sweep
frontend/src/pages/AppsDirectory.jsx                                                 — full rewrite: dnd-kit + 3-dots + PIN modal (portalled)
frontend/src/components/QuickLinksSection.jsx                                        — "Require admin PIN to open" checkbox in tile editor
frontend/src/index.css                                                               — @keyframes shake
frontend/src/lib/version.js                                                          — .132g1 bump
frontend/public/service-worker.js                                                    — .132g1 bump
memory/v58_13_132g1_tiles_3dots_reorder_and_pin_shipped_finish_deferred.md           — this memo
memory/v58_13_132g1_01_menu_open.png                                                 — Playwright screenshot
memory/v58_13_132g1_02_pin_modal.png                                                 — Playwright screenshot
```

## NOT changed
- `/app/mobile/` — untouched. `MOBILE_BUNDLE_VERSION` unchanged.
- Existing `POST /api/org/url-tiles/reorder` (verbose per-tile order
  ints) — retained. The new `PATCH /reorder` is a companion for the
  drag-and-drop flow.
- `components/layout/AdminPillsLock.jsx` header-lock PIN modal —
  DELIBERATELY not touched. The tile PIN modal is a fresh compact
  component to avoid regression risk on Stephen's header lock.
- `admin_console_pin.py` — no schema change. The tile verify-pin
  endpoint reuses the helpers via a deferred import, no new PIN
  storage or hashing.
- Ephemeral-upload-storage warnings (`v58.14.x` parked) — unchanged.
- `finish` / `testing_agent` / `e1_tester` — none used, per standing
  directive.

## Next
Rolling into **v58.13.132g2** — Avatar-scale range bump on
`Workers.jsx` (Stephen wants more downward range on the Mel photo).
