# v58.13.132em — Row-based zebra shading + slate-200 tint

**Ship status**: shipped. `finish` tool deferred per standing directive.

## Two root causes fixed

### Cause 1 — Parity was per-TILE, not per-ROW
`GroupedTilesView` computed `zebraTint: rowIdx % 2 === 1` off the
flat tile index. In an 8-column grid that produces a scattered
per-tile checker rather than clean horizontal stripes.

**Fix**: track live grid-columns count via `ResizeObserver` reading
`getComputedStyle(el).gridTemplateColumns` on each group's grid
element. Compute `visualRow = Math.floor(rowIdx / cols)` and stripe
`visualRow % 2 === 1`. Result: every OTHER horizontal row of tiles
gets the tint — proper zebra stripes across the grid, responsive to
viewport breakpoints.

### Cause 2 — Tint still too subtle
`bg-slate-100` (#F1F5F9) shipped in `.132el` was still barely
readable on a wide desktop. Bumped to `bg-slate-200` (#E2E8F0) —
~11% luminance drop from white, roughly double the `.132el`
contrast. Archived-row override still owns `bg-slate-50` +
`opacity-60` + `saturate-50` so archived reads as disabled distinct
from a zebra row.

## Live Playwright DOM proof (Incident Reports, 215 tiles)

```
grid template columns: '135.5px × 8'  →  cols = 8

card[0..7]  (row 0) → zebra=false  bg=rgb(255, 255, 255)   white
card[8..11] (row 1) → zebra=true   bg=rgb(226, 232, 240)   slate-200
```

Perfect horizontal-row zebra. First row all white, second row all
slate-200. Screenshot also confirms the sidebar version chip has
bumped to `v160.3.9.58.13.132em`.

## Files touched

### Frontend
- `frontend/src/components/capture/GroupedTilesView.jsx`:
  - New `gridRefs` map + `colsByGroup` state + `ResizeObserver`
    effect that reads `gridTemplateColumns` on each grid element
    and updates when the layout reflows.
  - Renamed the per-tile ref pass to `gridRefs.current[key] = el`
    on the grid `<div>`.
  - `zebraTint: zebra && (visualRow % 2 === 1)` where
    `visualRow = Math.floor(rowIdx / cols)`.
- `frontend/src/components/CaptureCard.jsx`:
  - `zebraTint` tint class `bg-slate-100` → `bg-slate-200`.
  - Archived override unchanged (`bg-slate-50 opacity-60 saturate-50`).
- `frontend/src/lib/version.js` — `.132em`.
- `frontend/public/service-worker.js` — `.132em`.

### Tests
- `backend/tests/test_v58_13_132em_zebra_row_based.py` — **4 pass**:
  - Zebra tint is `bg-slate-200`.
  - `Math.floor(rowIdx / cols) % 2` parity present.
  - `ResizeObserver` + `gridTemplateColumns` + `setColsByGroup`
    plumbing present.
  - Version pin ≥ `.132em`.
- `.132ek` + `.132el` tests widened to accept the new form so all
  three ship pins co-exist:
  - `.132ek` now accepts either `rowIdx % 2` OR `visualRow % 2`.
  - `.132el` now accepts `bg-slate-100` OR `bg-slate-200`.
- Full `.132e*` regression: **175 passed, 43 skipped** (skips =
  login rate-limit; source-pins all green).

## Not changed
- Zebra opt-in stays opt-in (only Incidents uses `zebra` prop).
- Archived-row styling — untouched.
- Login cover copyright + gold headline — untouched.
- Backend — no changes.
- Mobile bundle: `.132di` (unchanged).
- `/app/mobile/` — untouched.
- `finish` / `testing_agent` / `e1_tester` — not invoked.

## Version state
- `frontend/src/lib/version.js` : `paneltec-v160.3.9.58.13.132em`
- `frontend/public/service-worker.js` : `paneltec-v160.3.9.58.13.132em`
- Mobile bundle : `.132di` (unchanged, mobile untouched)
