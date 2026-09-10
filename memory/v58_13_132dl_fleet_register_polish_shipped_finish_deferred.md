# v58.13.132dl — Fleet Register UX Polish + Portal Unit Price Override Respect

**Status**: Shipped. `finish` tool deliberately deferred per standing directive.

## USER PAIN

Stephen's `.132dl` polish request (bundled with a follow-on):

> 1. Kill the FleetLiveDashboards banner in favour of a proper "Live Board" tab.
> 2. Ship the tag pill on the register table in an emerald tone (matches the
>    dashboard chip system).
> 3. Replace the sidebar "KIND" filter section with a "TAG" filter that syncs
>    with the top-of-table `tagFilter` dropdown built in `.132dj`.
> 4. (follow-on, mid-flight) Make the Fuel Transaction Detail modal's
>    "Portal unit price" row respect the `.132dh` `override_mode` so we're
>    not showing stale SmartFill numbers when a provisional override is
>    active org-wide.

The first two items landed earlier in the session. `.132dl` closes the final
two — sidebar KIND → TAG replacement + Portal Unit Price override respect —
plus the version bump.

## Files touched

### Frontend

**`frontend/src/pages/FleetRegister.jsx`**
- `FilterTree` signature: dropped `onAddAsset` (no longer consumed by any
  child inside the tree — the KIND rows that used it are retired), added
  `distinctTags`, `tagsByVehicle`, `tagFilter`, `setTagFilter`.
- Two `useMemo` hooks placed at the TOP of the component (rules-of-hooks):
  - `tagCounts` → `{tag_label: n}` derived from `tagsByVehicle`.
  - `totalTagged` → count of vehicles with any Navixy tag.
- `chooseKind` renamed to `chooseTag`. Click semantics preserved:
  clicking a tag row resets `data_source` to "all" and clears the
  retired view (same interaction contract as the retired KIND rows).
- "Kind" header → "Tag" header (same "Reset filters" button on the right).
- "All kinds" row → "All tags" row (uses `totalTagged || data.total`).
- 4 hardcoded KIND buttons (vehicle/plant/tool/container) with per-kind
  Plus-icon "add" affordances → dynamic map over `distinctTags`.
  - Active tag pill: `bg-emerald-600 text-white` (emerald because that's
    the tag-pill tone already used at the row level in the table).
  - Idle tag row: `text-slate-700 hover:bg-slate-100`.
  - Zero-state: `No Navixy tags yet — vehicles show once tags land in
    Navixy.` (data-testid `fleet-filter-tags-empty`).
- Sub-type expand accordion under the active KIND retired. Data source,
  Service due chip, Retired/Sold section preserved verbatim.
- `resetAll` now also clears `tagFilter` via `setTagFilter?.('')`.
- Parent `<FilterTree>` call site passes the 4 new tag props and drops
  the stale `onAddAsset` prop.
- Lucide `Plus` import removed (no more callers).
- `canCreate = useCan()('assets','edit')` removed from FilterTree
  (used only by the retired per-kind "+" buttons).
- `openAddAsset` in the parent left in place per "no drive-by cleanup"
  guardrail; unused for now, cheap to keep, re-attachable if we surface
  a header "Add asset" button later.

**`frontend/src/components/FuelTransactionDetailModal.jsx`**
- Portal Unit Price row extended with a read-time branch on
  `overrideActive` (`t.price_state?.override_mode === 'provisional_all'`):
  - **Override active** → shows `$fmtDollar(provPrice, 3)` (e.g. `$2.250`)
    + sub-label `PROVISIONAL OVERRIDE ACTIVE — REFLECTS FUEL PRICE POLICY`
    in `text-amber-800`, testid `fuel-txn-detail-portal-unit-price-override`.
  - **Default (`smartfill_with_fallback` or missing state)** → unchanged
    behaviour: shows `t.unit_price` + `stale — ignored, we use total ÷
    litres`, testid `fuel-txn-detail-portal-unit-price`.
- Row visibility guard widened from `t.unit_price != null` to
  `t.unit_price != null || (overrideActive && provPrice != null)` so an
  override-active fill without a portal `unit_price` still surfaces the
  provisional price line.
- The `SmartFill raw (reference)` audit row shipped in `.132dj` stays
  put — those two rows now bracket the visible price policy: what the
  system shows (Portal unit price = provisional) vs what SmartFill sent
  (raw = e.g. `$3.000/L`). No DB mutation.

### Version pins (all lockstep to `.132dl`)

- `frontend/src/lib/version.js`
  - `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132dl`
  - `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132dl`
- `frontend/public/service-worker.js`
  - `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132dl`
- Mobile untouched (`MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify` on commit).

## NOT changed

- `filter.kind` / `filter.sub_type` state on the parent — retained for
  URL-deep-link back-compat and backend query support (`?kind=vehicle`
  still works). The sidebar simply no longer surfaces them.
- Backend endpoints — nothing touched. `.132dj`'s
  `/api/fleet/navixy/tags` and `.132dh`'s
  `/api/fleet/fuel/price-settings` are consumed as-is.
- `AssetDrawer`, `AssetMapModal`, `FleetLiveDashboards` (retired banner
  kept in place for external consumers, per `.132dl` item 1's audit
  trail).
- `FuelTransactionDetailModal` header override pill (already shipped in
  `.132dj`), the metrics strip's `priceTone` amber colouring under
  override (also `.132dj`), and the SmartFill raw reference row.
- `/app/mobile/` code — untouched.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — parked for
  v58.14.x per standing directive.

## Screenshots (verified live at `.132dl`)

- `/app/memory/v58_13_132dl_01_fleet_sidebar_tag.png` — Fleet Register
  page with the new sidebar TAG filter (All tags 55, Company Vehicle 7,
  Plumber Vehicle 5, Tippers Under 10 Yarder 10, Traffic Dept 20, Vac
  Truck Dumping 13). Emerald tag pills in the "Tag" column. Sidebar
  footer version pill reads `v160.3.9.58.13.132dl`.
- `/app/memory/v58_13_132dl_02_fleet_live_board.png` — "Live Board" tab
  active, Navixy live board iframe embedded (loading — full render
  requires Navixy SSO). Register tab available beside it.
- `/app/memory/v58_13_132dl_03_txn_portal_price_override.png` — Fuel
  Transaction Detail modal for XT77AJ, 460.40 L, `$1035.90`.
  - Header pill: `⚠ PROVISIONAL OVERRIDE ACTIVE`.
  - Metrics: Total price = `$1035.90` (amber), $/L = `$2.250` (amber).
  - Portal unit price row: `$2.250 · PROVISIONAL OVERRIDE ACTIVE —
    REFLECTS FUEL PRICE POLICY` ✓ (this ship).
  - SmartFill raw (reference) row: `$1381.20 @ $3.000/L · displayed
    values reflect provisional override ($2.250/L)` (from `.132dj`,
    preserved).

## Ops rules (as per standing directive)

- No `testing_agent`, no `e1_tester`, no `finish` tool.
- No `/app/mobile/` code edits.
- No comms / emails / SMS wiring.
- Commit with
  `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
