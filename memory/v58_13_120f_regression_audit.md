# v58.13.120f — Regression audit: features lost in the Fleet rebuild

**Status**: Investigation. No code changes made in this memo.

## Executive summary

**User's callouts are all correct.** The `.120` rebuild replaced two
different drawers with a single new one, and I chose the WRONG drawer
to model on. The old `PlantVehicles.jsx` opened `AssetDrawer.jsx` (a
7-tab drawer with Details / Pairing / Schedules / Service log /
Maintenance history / Photo / Notes) which is **still on disk and
still wired to real endpoints**. The new `FleetRegister.jsx` drawer
is a slim 6-section flat panel that duplicates only a subset of what
`AssetDrawer` already offered.

**Good news**: `AssetDrawer.jsx`, `FleetLiveDashboards.jsx`,
`AssetServiceTabs.jsx` (with `ServiceLogTab` + `ServiceSchedulesTab`),
`LiveCountersPanel.jsx`, and every backend endpoint they consume are
all still alive. The .120 cleanup deleted the *page shell*
(`PlantVehicles.jsx`) but not the reusable drawer + panels — so the
restoration is mostly a wiring job, not a rebuild.

## Feature inventory + diff

Legend: ✅ present · ⚠️ partial/degraded · ❌ missing entirely

### From the OLD `AssetDrawer.jsx` 7-tab surface (still on disk!)

| feature | old location | new Fleet drawer | verdict |
|---|---|---|---|
| **Details tab** (edit rego, make, model, year, owner, status) | AssetDrawer → Details | Overview section, read-only | ⚠️ read-only; no inline edit |
| **Pairing tab** (NFC UID, QR scan_token, print single label) | AssetDrawer → Pairing | none | ❌ missing |
| **Schedules tab** (upcoming/overdue services, per-asset intervals) | AssetDrawer → Schedules · `ServiceSchedulesTab` | Compliance placeholder "coming in Phase 5" | ❌ missing (still Phase 5) |
| **Service log tab** (new service form + history, includes **`performed_by`**, **`company`**, **`odometer`**, **`hours_reading`**, **`next_service_at`** etc.) | AssetDrawer → Service log · `ServiceLogTab` | Log Service modal (4 required + 3 optional) | ⚠️ **user's callout #2** — new modal is skinnier; missing odometer/hours/next-due-usage |
| **Maintenance history tab** (full paginated PM history, no cap) | AssetDrawer → Maintenance history | drawer's Service history section, capped at 50 | ⚠️ **user's callout #3** — no pagination, cap hides older rows |
| **Photo tab** (single primary photo via `photo_file_id`) | AssetDrawer → Photo | Photos grid (multi-photo array via GridFS) | ✅ **upgraded** (multi vs single) |
| **Notes tab** | AssetDrawer → Notes | Notes textarea | ✅ present |

### From the OLD `PlantVehicles.jsx` page shell

| feature | old location | new Fleet page | verdict |
|---|---|---|---|
| **Fleet Live Dashboards (Navixy)** — Fleet Live Status / Trips / Technical Conditions from `/api/assets/navixy/dashboards/*` | PlantVehicles → dedicated section (component: `FleetLiveDashboards.jsx`) | none | ❌ **user's callout #1** — component still on disk, endpoints still respond, just not rendered anywhere |
| **Live counter panel** (last-ping time, odometer, ignition, fuel from `LiveCountersPanel`) | AssetDrawer → hosted at line 314 for Navixy assets | drawer's Counters tile (5 static counters — records/spend/last-service/hazards/incidents) | ⚠️ different data; the Navixy-live values are gone |
| **"Live · Navixy" chip** on each row | PlantVehicles row header | none | ❌ missing |
| **NFC UID chip** on each row | PlantVehicles row header | none | ❌ missing (violet chip removed) |
| **Print single QR** (per-row PNG download) | row action | none | ❌ missing (bulk-print survived; single-row didn't) |
| **Print Labels modal** (custom layout picker per print run) | dedicated modal | Print Labels button on toolbar (single click, no picker) | ⚠️ simplified — layout is hard-coded `avery_l7160` |
| **Purge test data modal** | header button | none | ❌ modal file deleted; endpoint still alive |
| **5-tab structure** (All Maintenance / Vehicles from Navixy / Dashboard / Service Inbox / Contractors) | Tabs bar | none | ❌ retired by design (per Option 3 plan) |
| **`?assetDrawer=<id>&tab=<tab>` deep-link** | PlantVehicles | `?open=<id>` only (no `&tab=`) | ⚠️ deep-link works but tab param is ignored |

### From `PlantMaintenanceTab.jsx` (deleted)

| feature | old location | new Fleet page | verdict |
|---|---|---|---|
| XLSX import UI | inline drawer on the tab | `/app/settings/imports` page | ✅ moved cleanly |
| Category chip row (Service / Repair / etc.) | above table | filter tree in left rail | ✅ moved to filter tree |
| Full flat pm table | tab body | fleet register table (assets, not services) | ❌ different pivot — was pm-row, now asset-row |
| Search across pm fields | search input | fleet search (cross-collection) | ✅ moved (and expanded) |

### From `PlantMaintenanceDrawer.jsx` (deleted)

| feature | old location | new Fleet drawer service-history row | verdict |
|---|---|---|---|
| Full pm row detail (all fields) | drawer body | history-row line-clamp-2 preview | ⚠️ drawer no longer opens on individual pm row click |
| Print single pm record | drawer footer | none | ❌ missing |

---

## User's three explicit callouts — verdict

1. **Live Navixy data** — ❌ MISSING. `FleetLiveDashboards.jsx` + `LiveCountersPanel.jsx` still on disk, endpoints `/api/assets/navixy/dashboards/*`, `/api/assets/{id}/trip-summary`, `/api/assets/{id}/meter-history` all alive. Not rendered anywhere in the new Fleet page or drawer.
2. **Service section — "new service and by whom"** — ⚠️ PARTIAL. The Log Service modal has `performed_by` and `company` as optional fields (both wire correctly). What's missing vs the old `ServiceLogTab`: odometer at service, hours reading at service, next-service-due-hours / next-service-due-km trigger fields, and a "recent services on this asset" inline list under the form.
3. **Service history for all** — ⚠️ CAPPED. The new drawer caps at 50 rows with a "showing latest 50" hint. Old `AssetDrawer → Maintenance history` tab paginated through the full set.

## Additional gaps I found (user didn't call out)

- **NFC pairing UI** entirely absent. The old Pairing tab supported single-label print + NFC UID edit. Endpoints `/api/assets/{id}/pair-nfc`, `/api/assets/{id}/scan-token` still alive.
- **Service schedules** (per-asset service intervals, next-due countdown, overdue chip) — old Schedules tab wired to `asset_service_schedules` collection. Currently rendered as "Compliance placeholder — coming in Phase 5". User's earlier Q9 said "Compliance = Phase 5" so this is by design, but the **Schedules** part of the old tab is a separate concept from Compliance and shouldn't have been folded in.
- **Inline asset edit** (rego / make / model / year / owner / status). The new Fleet drawer's Overview section is read-only.
- **`?tab=` deep-link parameter** — old surface let Ask Intelligence deep-link to a specific tab. New drawer has no tabs, so the param is silently ignored.

## Root cause

The `.120c` (Phase 3) frontend I built was modelled on the plan memo's
spec, which listed **six flat sections in a slide-in panel**. That
matched the visual sketch but didn't match what `AssetDrawer.jsx`
already offered. The plan memo didn't call out that `AssetDrawer`
existed and was reusable, so I built a parallel surface. The .120e
cleanup then deleted the page shell (`PlantVehicles.jsx`) but left
`AssetDrawer.jsx` alive — which is why every endpoint still responds
but nothing renders it.

## Restoration plan (v58.13.120f)

### Option A — Mount `AssetDrawer` inside FleetRegister (small, ~1 day)
**Recommended.** Swap the new custom `FleetDrawer` component for the
existing `AssetDrawer`. Effort: ~30 lines of change in `FleetRegister.jsx`.

Wins:
- Restores every drawer feature immediately (7 tabs, LiveCountersPanel, inline edit, NFC, schedules, service log with all fields, full pagination on history)
- Zero new backend work
- Keeps the new page shell (register table, filter tree, cross-collection search, Print Labels)

Losses:
- The new drawer's Photos-grid + drag-drop-upload becomes secondary to the old Photo tab's single-file flow. Fix: extend the Photo tab to render the `assets.photos[]` array too.

### Option B — Restore piece-by-piece into the new drawer (medium, ~2-3 days)
Rebuild each missing feature as a new section inside the current 6-section drawer. More work, retains the flat-panel aesthetic.

### Option C — Hybrid (medium, ~1.5 days)
Keep the new page shell and search bar; mount `AssetDrawer` on row-click; add the FleetLiveDashboards component above the register table as a collapsible header (mirrors old placement).

## Restoration plan detail (Option A — recommended)

1. **In `FleetRegister.jsx`**: replace the inline `FleetDrawer` component with `<AssetDrawer asset={row} onClose={…} initialTab={…} />`. Wire `initialTab` from a new `?tab=` query param via `useDeepLinkOpen`'s `extraParams`.
2. **Preserve the new drawer's Photos-grid**: extend `AssetDrawer`'s Photo tab to render `assets.photos[]` (the .120a array) alongside the legacy `photo_file_id`. About 30 lines.
3. **Restore Fleet Live Dashboards** above the register table: `<FleetLiveDashboards />` renders when at least one asset has `navixy_device_id`. Component already handles its own data fetching + collapsed-state persistence.
4. **Row-header chips**: restore "Live · Navixy" and NFC chips on the register table rows. ~10 lines each.
5. **Print single QR** from the drawer's Pairing tab (already there — just needs to be re-exposed).
6. **Purge test data modal**: recreate `PurgeTestDataModal.jsx` (189 lines were deleted). Endpoint still alive. Or: leave retired — that flow was rarely used and admin CLI can invoke `/admin/purge-test-data` directly. Recommend leaving retired; note it in the ship report.
7. **`?tab=` deep-link parameter**: add to `useDeepLinkOpen` via `extraParams: ['tab']` and pass through to `AssetDrawer`'s `initialTab` prop.
8. **Pytests**: pin the new mounts (AssetDrawer used, FleetLiveDashboards rendered when applicable, Navixy chip present, ?tab= wired).

**Effort estimate**: ~1 day of coding + 2 hours pytests + version bump + screenshots.

## Rules for the restore ship (v58.13.120f)

- No tester agent, no mobile code, no comms, 20 warnings deferred
- No new backend endpoints needed (every consumer of the restored features already exists)
- No file deletions
- Photos grid stays (upgrade over old single-photo — user didn't complain about it)

## Awaiting your green-light

Please confirm:
1. Option A / B / C?
2. Restore the Purge test data modal, or leave it retired?
3. Anything else you want restored that's not on the list above?

Once green-lit, ship `.120f` per your Step 4 directive.
