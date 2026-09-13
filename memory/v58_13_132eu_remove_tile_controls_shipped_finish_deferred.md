# v58.13.132eu — Strip per-tile controls from AppsDirectoryModal · SHIPPED

**Ship type:** UX cleanup — restrict user actions.
**Version:** `.132et` → `.132eu` on `frontend/src/lib/version.js` (both fields) + `frontend/public/service-worker.js` (`CACHE_VERSION`). Mobile stays `.132di`.

## Stephen's directive

> "why would you give a user a delete x for thats a job for super admin meaning me"

Regular users should not be able to hide tiles or edit them from the read-only Apps Directory modal. All management is admin-only via Org Settings → **Apps Directory · Tile management** (the `.132er` table). Full-org tile visibility is a super-admin decision; it applies to everyone.

## What was removed

- **Per-tile X (hide) button** — `apps-directory-modal-tile-hide-*` testid + the `onHide` prop threaded through `HubTile`.
- **Per-tile ⚙ settings button** — `apps-directory-modal-tile-settings-*` testid + its `<Link to="/app/settings/org">` deep-link.
- **Footer strip** — `N APPS HIDDEN FROM YOUR HUB · SHOW & MANAGE` (`apps-directory-modal-footer`, `-hidden-count`, `-show-manage`, `-manage-link` all gone).
- **Per-user hidden state** — `localStorage.apps_directory_hidden` key, the `locallyHidden` state variable, and the `persistHidden` helper all removed.
- **`Settings` icon import** from `lucide-react` (unused after this cleanup).

## What was kept

- Modal header (green eyebrow + tagline + rocket + X close button).
- Modal body — clean launcher grid.
- Modal empty-state hint (`No tiles yet — Admin can add them in Settings → Organisation → Apps Directory · Tile management.`).
- Escape / X / backdrop dismissal from `.132et` — all three paths still route through the stabilised `onCloseRef`.
- Individual tile launches (`target="_blank" rel="noopener noreferrer"`).

## Tile shape (before → after)

**Before (`.132es/.132et`)** — every tile had two top-right controls (⚙ + X) and a bottom `<a>` for launch. Nested anchors + button overlays required backdrop-guard `stopPropagation`, per-user hide state, and a footer showing the hidden count.

**After (`.132eu`)** — the entire tile is a single `<a href={tile.url} target="_blank" rel="noopener noreferrer">`. Icon + name + URL + description + a bottom `<span>` with the launch caption in the accent colour. No nested interactive controls. Whole card is the click target.

```jsx
function HubTile({ tile }) {
  ...
  return (
    <a href={tile.url} target="_blank" rel="noopener noreferrer"
       style={{ borderTopColor: accent, borderTopWidth: 4 }}
       data-testid={`apps-directory-modal-tile-${tile.id}`}
       className="group ...">
      <div className="flex items-center gap-3">
        {/* icon + label + url */}
      </div>
      {tile.description && <p>...</p>}
      <span style={{ color: accent }}
            data-testid={`apps-directory-modal-tile-launch-${tile.id}`}>
        Launch {tile.label} <ExternalLink size={12} />
      </span>
    </a>
  );
}
```

## Files touched

- `frontend/src/components/AppsDirectoryModal.jsx` — rewritten (per-tile controls removed, footer removed, localStorage hidden state removed, `HubTile` restructured to a single `<a>` root).
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js` — bumped to `.132eu`.
- `backend/tests/test_v58_13_132eu_remove_tile_controls.py` — NEW (7 checks).
- `backend/tests/test_v58_13_132es_apps_directory_modal.py` — one lock flipped to assert the footer is intentionally absent.

## NOT changed

- `.132er` Apps Directory management table on Org Settings — untouched. Admin ON/OFF pill still controls org-wide visibility.
- `.132ep` auto-icon fetch — untouched.
- `.132er` Fuel toggle stick — untouched.
- `.132et` close-fix + `/app/quick-links` redirect — untouched.
- All backend endpoints — untouched. No backend delta on this ship.
- `/app/mobile/` — untouched. Mobile bundle stays `.132di`.

## Pytest evidence — 94 pass / 14 skip across the ladder

```
$ python -m pytest tests/test_v58_13_132eu_remove_tile_controls.py \
                     tests/test_v58_13_132et_apps_directory_close_fix.py \
                     tests/test_v58_13_132es_apps_directory_modal.py \
                     tests/test_v58_13_132er_apps_directory_and_fuel.py \
                     tests/test_v58_13_132eq_quick_links_page.py \
                     tests/test_v58_13_132ep_quick_links_polish.py \
                     tests/test_v58_13_132eo_url_tiles.py \
                     tests/test_v58_13_132en_incidents_table_view.py -q
94 passed, 14 skipped, 1 warning in 3.22s
```

`.132eu` new locks (7):
- `apps-directory-modal-tile-hide-*` and `apps-directory-modal-tile-settings-*` testids **absent**.
- `Settings` **not** in the `lucide-react` import list (unused after removing ⚙).
- `apps_directory_hidden` localStorage key, `locallyHidden` state, and `persistHidden` helper all **absent**.
- Footer testids (`apps-directory-modal-footer`, `-hidden-count`, `-show-manage`, `-manage-link`) all **absent**.
- `HubTile` root element is a single `<a>` carrying `target="_blank"` + `rel="noopener noreferrer"`; launch caption is a `<span>` (no more nested anchors).
- `onHide` prop **absent** from the module (was the last link between HubTile and the persistence layer).
- Version-sync `>= .132eu`.

**No regressions** — full eight-ship ladder `.132en/.132eo/.132ep/.132eq/.132er/.132es/.132et/.132eu` returns 94 pass + 14 skip.

Note: 14 skips (up from 9 in `.132et`) reflect the auth throttle rolling over multi-ship sessions — expected, source-pins remain primary evidence per standing directive.

## Rules compliance

- ✅ No `finish` / `testing_agent` / `e1_tester` invoked.
- ✅ `/app/mobile/` untouched.
- ✅ Version bumped `.132et → .132eu` in lockstep on all three canonical strings.
- ✅ `.132er` management surface preserved — admin ON/OFF pill still hides tiles for the whole org.
- ✅ Pytest source-pins green (94 pass across the eight-ship ladder).

## Screenshot

Deferred — the auth login endpoint returned HTTP 429 on the screenshot attempt for this ship (accumulated throttle across the multi-ship session). Version bump verified live on the Cover / login page footer: `PANELTEC-V160.3.9.58.13.132EU`. Pytest source-pins provide primary FE evidence per project's standing directive; the 7 locks in the new `.132eu` suite scope-precisely assert the button/testid/import/state removals.
