# v58.13.132bj — Program Schematic visual polish [SHIPPED · finish deferred]

Landed: 2026-02 · pure-visual redesign atop the v56 responsive grid.

## Page redesigned

**File:** `frontend/src/pages/settings/ProgramSchematicPage.jsx`
**Route:** `/app/settings/schematic` (also aliased from `/app/settings/program-schematic`)

## Cluster palette applied (locked)

Stephen's brief listed 6 palette entries, but the actual DB catalogue
has 6 clusters and only 4 of them share a name with his grid
("Integrations", "Overview", "Capture", "Compliance"). His "Analysis"
and "Admin" entries don't exist as codebase clusters. Per Stephen's
own rule ("if there are more clusters than palette entries, rotate;
if fewer, use the first N"), I've mapped the 6 real clusters to the
6 palette hues **in the exact display order** he specified:

| # | Cluster (actual key) | Palette | Border stripe | Icon badge | Count pill |
|---|---|---|---|---|---|
| 1 | `integrations` | **sky**     | `border-l-sky-500`     | `bg-sky-100` / `text-sky-600`     | `bg-sky-100` / `text-sky-700` |
| 2 | `overview`     | **indigo**  | `border-l-indigo-500`  | `bg-indigo-100` / `text-indigo-600`  | `bg-indigo-100` / `text-indigo-700` |
| 3 | `capture`      | **emerald** | `border-l-emerald-500` | `bg-emerald-100` / `text-emerald-600` | `bg-emerald-100` / `text-emerald-700` |
| 4 | `compliance`   | **amber**   | `border-l-amber-500`   | `bg-amber-100` / `text-amber-600`   | `bg-amber-100` / `text-amber-700` |
| 5 | `register`     | **rose**    | `border-l-rose-500`    | `bg-rose-100` / `text-rose-600`    | `bg-rose-100` / `text-rose-700` |
| 6 | `settings`     | **violet**  | `border-l-violet-500`  | `bg-violet-100` / `text-violet-600`  | `bg-violet-100` / `text-violet-700` |

All Tailwind hues written out as full literal class names (no
dynamic template strings) so the JIT scanner picks them up in the
production bundle.

### Per-cluster header icons (lucide-react)

| Cluster | Icon |
|---|---|
| `integrations` | `Plug` |
| `overview`     | `LayoutDashboard` |
| `capture`      | `ClipboardPlus` |
| `compliance`   | `ShieldCheck` |
| `register`     | `Boxes` |
| `settings`     | `Settings` |

## Card shell (per Stephen's spec, applied to each cluster)

```jsx
<section className="
  rounded-2xl bg-white shadow-md
  border border-slate-200
  border-l-4 border-l-{accent}-500
  p-5 md:p-6 mb-6
  transition-all duration-200
  [@media(hover:hover)]:hover:-translate-y-1
  [@media(hover:hover)]:hover:shadow-lg
">
  <header class="flex items-center gap-3 mb-5">
    <div class="w-10 h-10 rounded-full flex items-center justify-center bg-{accent}-100">
      <HeaderIcon size={20} class="text-{accent}-600" strokeWidth={2.25} />
    </div>
    <h2 class="text-slate-900 text-lg font-extrabold uppercase tracking-[0.18em]">
      {cluster.label}
    </h2>
    <span class="bg-{accent}-100 text-{accent}-700 px-2.5 py-0.5 rounded-full text-xs font-medium">
      {n} {n === 1 ? 'module' : 'modules'}
    </span>
  </header>

  {/* IconTile grid — unchanged .132bi visual, unchanged handlers */}
</section>
```

### Hover-lift guarded for touch devices

Both `hover:-translate-y-1` and `hover:shadow-lg` sit inside
Tailwind's `[@media(hover:hover)]:` arbitrary variant → touch
devices (which report `hover: none`) skip the transform entirely,
so tapping a card on mobile never jitters mid-tap. Tailwind
3.4.17 (installed) supports arbitrary variants natively.

## What was NOT touched

* `IconTile` markup, click handlers, and every `data-testid` value
  (downstream `test_program_schematic_routes_v47.py` continues to pass).
* `SCHEMATIC_NODES` / `SCHEMATIC_CLUSTERS` / `SCHEMATIC_SUB_CLUSTERS`
  registries.
* Legend row content — only re-styled from inline-hex tinting to
  Tailwind classes matching each card's accent (so at-a-glance
  colour ↔ cluster identity is preserved).
* Page background gradient (`.5` lightened style kept).
* Body text stays `text-slate-800` / `text-slate-900` — the accent
  hue only appears in the border stripe, icon badge, count pill, and
  legend chip. **No cluster's accent tint bleeds into body copy.**

## Legibility + responsiveness

* Body text on cards remains neutral (`text-slate-800`); no
  cluster hue overrides body text contrast.
* Individual `IconTile`s inside cards keep their existing
  `text-slate-800` colour and off-white background — inheriting the
  card's white surface means WCAG AA is preserved everywhere.
* Grid at ≥1280px = 4 col, ≥768px = 3, ≥480px = 2, else 1 col — the
  existing `.schematic-tile-grid` CSS rules (index.css) are untouched.
* Mobile snapshot below confirms cards stack cleanly at 420px width;
  hover-lift is a no-op on touch pointers.

## Screenshots

| Viewport | Path | Note |
|---|---|---|
| Desktop 1440×900 | `/app/frontend/public/schematic_before_132bj.png` | before |
| Desktop 1440×900 | `/app/frontend/public/schematic_after_132bj_desktop.png` | after — card shells, accent stripes, icon badges |
| Mobile 420×900 | `/app/frontend/public/schematic_after_132bj_mobile.png` | after — cards stack, hover-lift skipped on touch |

All three saved into `/app/frontend/public/` and available at:
* `${REACT_APP_BACKEND_URL}/schematic_before_132bj.png`
* `${REACT_APP_BACKEND_URL}/schematic_after_132bj_desktop.png`
* `${REACT_APP_BACKEND_URL}/schematic_after_132bj_mobile.png`

## Version pair bumped in lockstep

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132bi` | `.132bj` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `.132bi` | `.132bj` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `.132bi` | `.132bj` |

Production build: **PASS** (`yarn build` — no compile errors).

## Files touched

```
frontend/src/pages/settings/ProgramSchematicPage.jsx    (redesigned — cluster cards + accent map)
frontend/src/lib/version.js                             (RUNNING/EXPECTED → .132bj)
frontend/public/service-worker.js                       (CACHE_VERSION → .132bj)
frontend/public/schematic_before_132bj.png              (new — before screenshot)
frontend/public/schematic_after_132bj_desktop.png       (new — after desktop screenshot)
frontend/public/schematic_after_132bj_mobile.png        (new — after mobile screenshot)
```

## Ship rule compliance

* e1_tester / testing_agent: **NOT USED**
* `finish` tool: **NOT INVOKED**
* Mobile / metro.config.js: **untouched**
* No new backend work — this is a pure frontend visual pass
* No mocks — screenshots produced by driving the live preview URL

## Known follow-up (optional)

* If Stephen adds a real "Analysis" cluster (his brief mentioned it),
  the palette map already has a spare `amber` slot to shuffle in;
  right now `amber` sits on `compliance`. Two-line change if he
  wants to relabel.
* The 6 individual `IconTile` bodies still carry per-cluster hex
  colour styles from the old `.color` field — they render as soft
  peach/orange rings today. If Stephen wants those to also switch to
  Tailwind accent hues, that's a ~15-minute follow-up letter
  (would touch every `SCHEMATIC_CLUSTERS[i].color` reference).

Finish tool intentionally NOT invoked — awaiting Stephen's tab-reload
verification.
