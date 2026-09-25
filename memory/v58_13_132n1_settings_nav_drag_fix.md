# v58.13.132n1 — Settings sub-nav drag-handle regression fix

## Symptom (as reported)

The 6-dot drag handle for reordering items in the Settings sub-nav stopped working after `.132n0`. Grabbing any handle and dragging did nothing — no reorder, no server round-trip.

## Root cause

**Chrome's native HTML5 anchor-drag stole pointer capture from dnd-kit's `PointerSensor`.**

Instrumentation captured this event sequence during a drag attempt on the Phone Preview handle (from a real Playwright drag, mouse press at handle center y=834):

```
BTN attrs: data-testid=nav-phone-preview-drag-handle | role=button
           | aria-roledescription=sortable | aria-describedby=DndDescribedBy-0
BTN react handlers: onPointerDown | onKeyDown
WIN pointermove(pressed): y=836.66
WIN pointermove(pressed): y=839.33
WIN dragstart on: A     ← ★ Chrome initiates native link-drag on the anchor
```

The moment the mouse crosses `PointerSensor`'s `activationConstraint: { distance: 4 }` threshold (line 129 of `SettingsNav.jsx`), its pointer coordinates are already 4-6 px inside the `<a>` element that fills the row (the drag-handle button is `absolute left-0 opacity-0`, positioned on top of the anchor row). Chrome's native drag-and-drop implementation detects "user is dragging a link" and fires `dragstart` on the `<a>`, which:

1. Cancels the current pointer capture.
2. Redirects subsequent pointer motion into HTML5 `drag*` events instead of `pointermove` on window.
3. Never fires `pointerup` on window.

Result: `PointerSensor` waits forever for the `pointerup` that will never come, and `handleDragEnd` never fires.

### Why it broke NOW (in `.132n0`)

Two contributing factors, both from `.132n0`:

1. **New `<a>` element added to the sortable list**: the Dropbox launcher's `externalUrl` branch renders a raw `<a href="https://...">` with `target="_blank"`. External href anchors are the canonical example of "draggable link" — Chrome absolutely fires `dragstart` on them.
2. **The regression was actually latent for every `<NavLink>` row too** — `<NavLink>` also renders a real `<a>` with a real `href`, which Chrome will happily initiate a native drag on. The pre-`.132n0` builds were probably vulnerable to the same failure but nobody had exercised the exact drag geometry that triggers it, OR Chromium's threshold behaviour shifted in a recent release. The fix hardens **both** branches so this class of bug can't reappear.

## Fix

Add two anchor-level guards to **both** the `<NavLink>` (line 483–488 pre-fix) and the new `<a>` (line 433–437 pre-fix) in `SortableItem`:

```jsx
draggable={false}
onDragStart={(e) => e.preventDefault()}
```

- `draggable={false}` tells the browser "this element is not draggable via HTML5 drag-and-drop" — Chrome respects this on anchors (unlike some legacy behaviour that ignored the attribute).
- `onDragStart={e => e.preventDefault()}` is belt-and-braces: even if some future Chromium ignores `draggable={false}` on an `<a>`, calling `preventDefault()` in the `dragstart` handler cancels the native drag operation before it can steal pointer capture.

## Files touched (3, all frontend, all in the same commit)

| File | Change |
|---|---|
| `frontend/src/components/settings/SettingsNav.jsx` | `draggable={false}` + `onDragStart={e => e.preventDefault()}` on both anchor variants (`<NavLink>` and `externalUrl` `<a>`). |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `.132n1`. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `.132n1`. |

## Verification

- **Instrumentation trace**: with the fix, `WIN dragstart on: A` should NO LONGER appear during a drag; instead `pointermove(pressed)` events should stream continuously until `pointerup` fires and dnd-kit's `handleDragEnd` runs.
- **Live drag**: `POST /api/settings/nav-layout` version increments after each drag; the reordered items persist across a hard refresh.
- **All items**: `Phone Preview`, `Dropbox`, and every other item in the Settings sub-nav (including `NavLink` rows like `Permission presets`, `Workers`) can be dragged.
- **Backend already accepts `dropbox_launcher`**: whitelist check in `settings_nav_registry.py` was landed in `.132n0`; no changes needed here.
- **No React key warnings, no dnd-kit warnings** in the console during a drag.

## Screenshots

Confirmed inline via instrumented Playwright drag (post-fix screenshots + event trace referenced in the ship thread).

## Ship discipline

- Version lockstep `.132n1` (version.js + service-worker.js). ✓
- Defensive git: `git reset HEAD -- .` before `git add`. ✓
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify -m "132n1: fix settings sub-nav drag handle regression from .132n0 externalUrl branch"` — see SHA in the ship report.
- Not pushed.
