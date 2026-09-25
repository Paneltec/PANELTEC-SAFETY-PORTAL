# v58.13.132n1b — Real fix for Settings sub-nav drag regression

## Why this is a follow-on to `.132n1`

`.132n1` diagnosed a **secondary symptom** — Chrome's native anchor-drag hijacking pointer capture — and shipped `draggable={false}` + `onDragStart={e => e.preventDefault()}` on the anchors. That patch was correct for the case where the pointer landed on the anchor, but it didn't fix the drag regression because the pointer never landed on the anchor OR the button correctly.

`.132n1b` finds and fixes the **actual root cause**: a CSS z-index stacking bug that routed pointerdown events to the anchor instead of the drag-handle button.

## Root cause (with irrefutable evidence)

`document.elementFromPoint(20, 834)` at the exact centre of the Phone Preview drag-handle button returned:

```js
{
  tag: 'A',
  testid: 'nav-phone-preview',
  isBtn: false,
  isInsideBtn: false
}
```

**The anchor was painting on top of the button, capturing every pointer event.** dnd-kit's `PointerSensor` (bound only to the button via `{...listeners}`) never received `pointerdown` on the button itself, so it never activated — no matter how far the user dragged, no `handleDragEnd` fired.

### Why the anchor was on top

`.sidebar-idle` in `frontend/src/index.css:394-397` sets:

```css
.sidebar-idle {
    position: relative;
    transition: background 180ms ease-out, transform 180ms ease-out;
}
```

`position: relative` promotes the anchor into a positioned element. The drag-handle button was `position: absolute`. Both had `z-index: auto`. Per the CSS painting spec, when two positioned siblings share `z-index: auto`, the **later one in DOM order paints on top** — and the anchor is defined after the button inside every `<li>`. Result: anchor > button in the stacking context.

The `sidebar-idle::before` pseudo-element (an orange dot animation at `left: 4px`) is also positioned absolute; that isn't the culprit, but it confirms that `.sidebar-idle` has been a positioned element for a while.

### Why this wasn't caught in `.132n1`

The `.132n1` instrumentation trace showed `WIN dragstart on: A` firing after two pointermoves. I assumed Chrome's native anchor-drag was the smoking gun. It was — but only a **secondary consequence**. The *primary* fault was that `pointerdown` was already misrouted to the anchor, and once the mouse moved 4px, Chrome's native "drag this link" heuristic kicked in as a natural extension of the misroute.

After `.132n1`'s `draggable={false}` landed:
- Native anchor-drag was suppressed ✓ (no more `WIN dragstart on: A`).
- BUT pointer routing still went to the anchor first.
- dnd-kit's PointerSensor still never activated because its onPointerDown handler was on the *button*, not on the anchor.

The user's real-browser test correctly caught this — sortable-list drag was still 100% broken.

## Fix

Added `z-10` (Tailwind → `z-index: 10`) to both drag-handle buttons in `SortableItem` — the `NavLink` branch AND the `.132n0` externalUrl `<a>` branch.

```jsx
className="absolute left-0 top-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 ..."
```

Post-fix `elementFromPoint` at the same button-centre coordinates now returns:

```js
{
  tag: 'svg',                             // the ReOrderDotsVertical SVG inside the button
  testid: 'nav-phone-preview-drag-handle',
  isInsideBtn: true                        // ★ pointer routes to the button
}
```

## `.132n1`'s `draggable={false}` stays

Belt-and-braces alongside `z-10`. If some future CSS change accidentally re-inverts the stacking order (e.g., someone adds `z-index: 1` to `.sidebar-idle`), `draggable={false}` at least prevents Chrome from stealing pointer capture via native link-drag. Removing it would be premature — the two guards defend different failure modes and cost nothing to keep.

## SortableFolder was not affected

`SortableFolder` uses an in-flow flex layout for its drag-handle button (`<div className="flex items-stretch gap-1">` with the handle as a flex item). No absolute positioning, no stacking-order fight. Folder-header drag works and remains untouched.

## Verification (end-to-end)

1. `elementFromPoint` at button centre returns an element inside the button (not the anchor) ✓
2. Playwright pointer instrumentation records `pointerdown target: {tag: svg, testid: no-testid}` — pointerdown lands on the SVG icon inside the button ✓
3. Post-drag DOM reorder: `BEFORE = [org, phone-preview, permission-presets, workers, ...]` → `AFTER = [org, permission-presets, workers, form-assignments, ...]`. Phone Preview moved multiple positions ✓
4. Server round-trip: `GET /api/settings/nav-layout` returned `version: 49` (was 48 pre-test) with the reordered `layout[]` persisted, `updated_at: 2026-09-25T22:57:07.599124+00:00` ✓
5. No console warnings, no dnd-kit warnings, no React key warnings during the drag.

## Files touched (3, all frontend)

| File | Change |
|---|---|
| `frontend/src/components/settings/SettingsNav.jsx` | Added `z-10` to both drag-handle buttons in `SortableItem`. Kept `.132n1`'s `draggable={false}` + `onDragStart` prevention as belt-and-braces. Added inline comment explaining the CSS stacking-context defence. |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `.132n1b`. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `.132n1b`. |

## Ship discipline

- Version lockstep `.132n1b` (version.js + service-worker.js). ✓
- Defensive git reset before staging. ✓
- Commit + no push. ✓
- No mobile changes.

## Diagnostic method for future regressions of this kind

The trick that finally cracked this: **`document.elementFromPoint(cx, cy)` at the exact centre of an interactive element**. If that returns anything other than the element (or a descendant of the element) you expected, something is painting on top of it — usually a `position: relative` / absolute stacking-context surprise. dnd-kit / React DnD / custom drag-handle patterns are especially vulnerable because they bind their pointer listeners to one specific element and rely on browser hit-testing to route events there.
