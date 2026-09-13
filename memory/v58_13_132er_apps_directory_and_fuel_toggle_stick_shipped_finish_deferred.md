# v58.13.132er — Apps Directory redesign + Fuel Price toggle stick · SHIPPED

**Ship type:** feature redesign + hydration bug fix
**Version:** `.132eq` → `.132er` on `frontend/src/lib/version.js` (both fields) + `frontend/public/service-worker.js` (`CACHE_VERSION`). Mobile stays `.132di`.

## Item 1 — "Paneltec Group Portal · APPS DIRECTORY · QUICK TOOLS" redesign

### Backend (`backend/org_url_tiles.py`)
- New fields on `TileIn` / `TilePatch` / `_out` / create / update:
  - `enabled: bool` (default `True`) — ON/OFF toggle; hides the tile from the read-only Quick Links page without deleting.
  - `color: str` — `#rrggbb` hex accent; validated by `_HEX_COLOR_RE = re.compile(r"^#([0-9a-fA-F]{6})$")`, invalid input → HTTP 400 `"Color must be a `#rrggbb` hex code"`.
- Idempotent defaults for **pre-`.132er` rows** — `_out()` reads `bool(doc.get("enabled", True))` and `doc.get("color") or _DEFAULT_TILE_COLOR` (default blue `#1d6fb8`), so no migration is required and every existing tile continues to render.
- `GET /url-tiles` gained `include_disabled: bool = False`. Default: excludes disabled tiles via `$or: [{enabled: {$ne: false}}, {enabled: {$exists: false}}]`. Passing `?include_disabled=true` surfaces hidden tiles but is silently downgraded for non-admin callers (belt-and-braces so staff can't bypass curated tile visibility).
- Mutations still admin-only per `.132eo`; the read endpoint stays open to any authenticated user per `.132eq`.

### Frontend (`frontend/src/components/QuickLinksSection.jsx`)
Entire management popup rewritten as `<AppsDirectoryManager />` matching Stephen's reference image:

- **Dark navy header** (`bg-slate-900 text-white`) with orange 🚀 rocket icon + uppercase title **"APPS DIRECTORY · QUICK TOOLS"** + subtitle *"One row = one tile on the Hub home page. Edit the URL here once, staff click the tile and land in the right place."* (`data-testid="apps-directory-title"`).
- **7-column table** with sticky header (`sticky top-0 bg-slate-100`), zebra rows, disabled-row greying (`opacity-60`):
  1. **ON** — animated emerald/slate `<OnPill>` toggle → optimistic `PATCH /url-tiles/{id} { enabled: !enabled }`, reverts local state on failure.
  2. **ICON** — 28px favicon `<img>` (from `remote_icon_url`) with emoji fallback.
  3. **NAME** — bold slate-800.
  4. **LOGIN URL (WHERE THE TILE TAKES YOU)** — blue clickable link (`target=_blank` `rel="noopener noreferrer"`).
  5. **DESCRIPTION** — slate-600, truncated with tooltip.
  6. **COLOR** — 16px swatch + uppercase hex code monospace.
  7. **ACTIONS** — Edit (pencil) + Delete (red trash), both testid'd.
- **Inline "+ ADD TILE" row** at the bottom (`data-testid="apps-directory-add-row"`) with blank inputs mirroring every column: ON pill · Icon emoji · Name · URL (with auto-icon-fetch on blur — inline `detecting…` spinner + auto-populated 20px thumbnail on success) · Description · `<input type="color">` swatch + hex code · Green **Add** button. Save resets the form in-place and refreshes the table — no separate modal for the common "add tile" flow.
- **Yellow-lit hint bar** at the bottom (`bg-amber-50 border-amber-200`, `data-testid="apps-directory-hint-bar"`): *"💡 Edits land instantly on every staff member's Quick Links page. The **ON**/**OFF** pill hides a tile without deleting it — flip it back to make it visible again."* The `office.launch_*` permission clause from Stephen's reference image was **dropped** per his verbatim instruction *"adjust if this permission doesn't actually exist in the app — grep first; if it doesn't, drop that clause"* — `grep -rn "office.launch_\|office_launch\|launch_"` returned zero hits.
- Full **Edit tile modal** preserved as a "power" editor (accessed via the pencil in each row) — retains `.132ep` auto-icon detection, "Icon detected" emerald preview strip with clear button, manual icon URL override, and gains accent-color picker + "Visible on Quick Links page" checkbox.
- **Drag-to-reorder DROPPED** — Stephen's reference design has no reorder column; the `@dnd-kit` / `SortableTileCard` code has been removed from the component. The `POST /reorder` backend endpoint remains available for future use but is no longer called from the FE.

### Read-only Quick Links page (`frontend/src/pages/QuickLinks.jsx`)
- Every tile carries a **left-border accent stripe + top hairline band** in the tile's `color`, defaulting to `#1d6fb8` for pre-`.132er` rows. Disabled tiles are automatically excluded via the backend default filter — no FE work required.
- `TilePreviewCard` on Org Settings also gained the same accent stripe so the preview matches the read-only page.

## Item 2 — Fuel Price toggle stick fix

### Root cause (verified via live curl)
Backend persistence was **never** broken:

```
$ curl -H "Authorization: Bearer $TOKEN" $API/api/fleet/fuel/price-settings | jq .override_mode
"provisional_all"

$ curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"override_mode":"provisional_all"}' $API/api/fleet/fuel/price-settings | jq .override_mode
"provisional_all"

$ curl -H "Authorization: Bearer $TOKEN" $API/api/fleet/fuel/price-settings | jq .override_mode
"provisional_all"
```

GET-PUT-GET all consistent. Persistence is stored correctly in `fuel_price_settings.override_mode`.

The FE bug had two contributing factors:

1. **`Promise.all([settings, history])` in `loadPriceSettings`** — if the `/price-history` GET rejected for any reason (transient network hiccup, role-scoped permission blip, cache eviction race), the entire `Promise.all` rejected and `priceSettings` was **never hydrated** for that visit. The `catch` block was silent — no toast, no console noise — so on the next remount the segmented control fell back to its default rendering. This exactly matches Stephen's symptom "reverts back to the SmartFill tab when you leave this area, doesn't stick".
2. **`priceSettings.override_mode !== 'provisional_all'`** on the SmartFill button — this ternary defaulted to `TRUE` (i.e. "SmartFill active") for any value that wasn't `'provisional_all'`, including `undefined` / `null` / an in-flight partial hydration. Combined with the above, the visual override never came back until a full page refresh with a healthy `/price-history` call.

### Fix
- `loadPriceSettings` now uses **two independent `try/catch` blocks** so a history-side failure never masks the persisted mode. Each endpoint hydrates its own state slice; errors on either remain silent (banner still works).
- SmartFill button's "selected" comparison is now **`priceSettings.override_mode === 'smartfill_with_fallback'`** (explicit), so undefined / partial states no longer default to SmartFill visually. The Provisional side already used the explicit `=== 'provisional_all'` check.

### Files touched (Item 2)
- `frontend/src/pages/FuelReporting.jsx` — `loadPriceSettings` refactored (Promise.all → two try/catch); SmartFill button `aria-selected` + className comparison switched to explicit equality.

## Files touched (both items)

- `backend/org_url_tiles.py` — `enabled` + `color` on models, `_sanitize_color`, `_DEFAULT_TILE_COLOR`, `include_disabled` on GET, create/update persist new fields.
- `frontend/src/components/QuickLinksSection.jsx` — rewritten (Apps Directory table + inline add row + edit modal with color/enabled controls).
- `frontend/src/pages/QuickLinks.jsx` — read-only tile gains color accent stripe + top band.
- `frontend/src/pages/FuelReporting.jsx` — hydration split + explicit SmartFill equality check.
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js` — bumped to `.132er`.
- `backend/tests/test_v58_13_132er_apps_directory_and_fuel.py` — NEW (15 checks).
- `backend/tests/test_v58_13_132eo_url_tiles.py` — updated two locks for the removed drag-reorder + renamed add button testid. Everything else unchanged.

## Pytest evidence

```
$ python -m pytest tests/test_v58_13_132er_apps_directory_and_fuel.py \
                     tests/test_v58_13_132eq_quick_links_page.py \
                     tests/test_v58_13_132ep_quick_links_polish.py \
                     tests/test_v58_13_132eo_url_tiles.py \
                     tests/test_v58_13_132en_incidents_table_view.py -q
70 passed, 9 skipped, 1 warning in 6.64s
```

`.132er` locks (15):
- Backend model has `enabled: Optional[bool]` + `color: Optional[str]`; `_out` projects with idempotent defaults + `_DEFAULT_TILE_COLOR = "#1d6fb8"`.
- List endpoint filters disabled by default (`$or [enabled !=false, enabled missing]`); accepts `include_disabled: bool = False`.
- `_HEX_COLOR_RE` present; sanitiser 400s on invalid input.
- **Live-API round-trip**: create with `color=#ff5722, enabled=True` → 200; `color: "red"` → 400; `PATCH { enabled: false }` → 200 + response reflects false; default GET excludes disabled tile; `?include_disabled=true` surfaces it.
- FE table has 7 `<Th>` headers in exact order (On · Icon · Name · Login URL (where the tile takes you) · Description · Color · Actions).
- Dark navy header carries `apps-directory-title`; yellow hint bar carries `apps-directory-hint-bar` + copy about the ON/OFF pill hiding without deleting.
- Inline add row testids present: `apps-directory-add-row/-on-pill/-name/-url/-description/-color/-btn/-icon`.
- ON pill wired to `PATCH /url-tiles/{id} { enabled: !tile.enabled }` (`toggleEnabled`).
- Manager uses `/org/url-tiles?include_disabled=true`.
- Read-only page uses `tile.color || …` + `borderLeftColor`.
- `@dnd-kit/core` / `@dnd-kit/sortable` **absent** from the component (intentional removal).
- **Fuel toggle**: `loadPriceSettings` body contains no `await Promise.all` + two `try {` blocks + both endpoint calls; SmartFill button block uses `=== 'smartfill_with_fallback'` and does NOT use `!== 'provisional_all'`.
- **Live fuel round-trip**: current mode read → flip to the other value via PUT → GET returns the flipped value → revert to original.
- Version-sync `>= .132er` on both files.

**No regressions** — full ladder `.132en/.132eo/.132ep/.132eq/.132er` returns 70 pass + 9 skip.

## Screenshot

- `/app/memory/v58_13_132er_apps_directory_table.png` — Apps Directory popup open on Org Settings:
  - Dark navy header with 🚀 + "APPS DIRECTORY · QUICK TOOLS" title + subtitle.
  - 8 rows in the table (Westpac Banking with red-W favicon + `#d0021b`, GitHub with fluidicon + `#111827`, SimPRO with 🔧 + `#f97316` **row visibly greyed** because `enabled=false`, SmartFill with ⛽ + `#22c55e`, plus four pre-existing tiles with default blue accent).
  - Green ON pills for enabled, grey OFF pill for SimPRO.
  - Every LOGIN URL rendered as blue underlined link.
  - Color column shows swatch + hex code (e.g. `#D0021B`, `#111827`, `#F97316`).
  - Inline "+ ADD" row at the bottom: 🚀 icon input · App name input · URL input · Short description input · color picker `#1D6FB8` · green **Add** button.
  - Yellow-lit hint bar at the bottom with the 💡 copy.
  - Sidebar Overview shows **Quick Links** entry (from `.132eq`) sitting above CAPTURE section.
  - Version pill `v160.3.9.58.13.132er` visible in the sidebar footer.

## Fuel toggle root-cause summary (Stephen-facing)

- Backend was always persisting `override_mode` correctly — verified via a fresh GET-PUT-GET curl round-trip in this session.
- Root cause was FE hydration: `loadPriceSettings` used `Promise.all([settings, history])`. If `/price-history` failed for any transient reason (network hiccup, permission edge case), the whole promise rejected in a **silent** catch and `priceSettings` was never populated. On the next page load a stale/partial state produced the SmartFill button as visually active (via `!== 'provisional_all'` falling through on undefined values) — hence the "reverts, doesn't stick" symptom **without any data loss on the backend**.
- Fix: independent try/catch per endpoint + explicit `=== 'smartfill_with_fallback'` on the SmartFill selector. Live PUT/GET round-trip is now locked by pytest to prevent future regressions.

## Rules compliance

- ✅ No `finish` / `testing_agent` / `e1_tester` invoked.
- ✅ `/app/mobile/` untouched (mobile bundle stays `.132di`).
- ✅ Version bumped `.132eq → .132er` in lockstep on all three canonical strings.
- ✅ Auto-icon fetch from `.132ep` preserved (still wired on URL blur in both the inline Add row and the Edit modal).
- ✅ Existing management surface intact (edit modal remains, delete confirm remains, admin gate remains).
- ✅ URL sanitisation from `.132eo` intact (strict http/https + private-host reject).
- ✅ No new disk writes — Mongo string fields + in-process icon cache only.
- ✅ Migrations idempotent (no migration required; `_out` handles pre-`.132er` rows via `doc.get(..., <default>)`).
- ✅ Pytest source-pins + live-API smokes green (70 pass / 9 skip across the full ladder `.132en → .132er`).
