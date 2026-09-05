# v58.13.120g — Fleet Drawer punch-list — SHIPPED (finish deferred)

The `finish` tool is bypassed by the 20 pre-existing
`ephemeral-upload-storage` lint warnings, parked for v58.14.x per
user directive. This memo covers what shipped in `.120g`.

## Rules obeyed

- **No testing_agent** (per user).
- **No `/app/mobile/` code** (only `MOBILE_BUNDLE_VERSION` bumped).
- **No comms** touched.
- **20 deferred warnings still parked** for v58.14.x.
- **Destructive migration gated**: `scripts/normalize_subtype_v58_13_120g.py`
  ran DRY-RUN only. Live commit awaits user green-light.

## Items shipped (8 of 9)

### 1. Drawer header cut off — FIXED
- `AssetDrawer.jsx` header rebuilt as a fixed-height two-row block:
  eyebrow + title (`break-words`, not `truncate`) + X close on row 1,
  action toolbar (`← Close`, `Print QR label`) on row 2.
- Both rows wrapped in a `shrink-0` container so flex children below
  can never collapse them. Tab strip also `shrink-0` +
  `overflow-x-auto` so tabs scroll horizontally on narrow viewports
  instead of getting clipped.
- Testid `asset-drawer-header` locked.

### 2. Overview inline edit — WIRED + PERMISSION-GATED
- Save button in `AssetDrawer.jsx` footer wrapped in
  `<Can resource="assets" action="edit">`. Footer container carries
  the `.111` `emergent-badge-safe` utility so the button is never
  covered by the Emergent badge.
- Playwright confirmed: Details tab shows editable inputs (name, rego,
  make, model, year, owner, status), Save button visible for admin.

### 3. Maintenance History row-click → sub-modal — WIRED
- `PlantMaintenanceHistory.jsx` refactored: retired inline expand,
  row-click now sets `selected` and mounts `RecordSubModal` at
  `z-[80]` above the drawer's `z-[70]` backdrop.
- Sub-modal carries full record detail (cost, company, performed_by,
  status, description, all secondary fields) + a "← Back to drawer"
  button in the footer. Escape key closes.
- Testids: `pmh-detail-modal`, `pmh-detail-modal-close`,
  `pmh-detail-modal-back`, `pmh-row-open-{id}`.

### 4. sub_type "Vac Truck" vs "Vacuum Truck" — DRY-RUN COMPLETE
- New script `backend/scripts/normalize_subtype_v58_13_120g.py`:
  `--commit` required (dry-run default), `--reverse` bundled,
  audit markers (`sub_type_normalised_v120g`,
  `sub_type_before_v120g`, `sub_type_normalised_at`) stamped on
  every touched row.
- **Dry-run result** (against live DB):
  - `assets.asset_type`: 101 rows would change (13+5 = 18 rows go to
    `Vacuum Truck` — user's explicit callout).
  - `plant_maintenance.sub_type`: 165 rows would change (all 165 `Vac
    Truck` → `Vacuum Truck` — user's callout).
  - **Total: 266 rows, spanning 10 canonical mappings.**
  - See ship prompt for the full table.
- **Live commit gated**: waiting for user green-light per the
  dry-run + gate rule.
- **Frontend `displaySubtype()` defence**: `FleetRegister.jsx` also
  ships a client-side mirror of the same canonical map. Applied to
  the FilterTree sub-type labels AND the register table's `Sub-type`
  column, so users see canonical labels *before* the backend commit
  runs. The raw value is preserved in the filter query so pre-commit
  data still filters correctly.

### 5. No Close/Back button — FIXED
- Explicit `← Close` button in the drawer header actions row
  (testid `asset-drawer-back`). Sits alongside the top-right X.
- Both fire `onClose`. Footer button also lifted to Title Case.

### 6. Navixy-only filter under KIND — WIRED
- `FilterTree` gains a `Show only Navixy-tracked` checkbox at the
  top with a pulsing green LED. State flows through
  `setFilter({...filter, navixy_only})` → passed as `navixy_only=true`
  query param to `/api/fleet/register`.
- Backend `fleet.py::get_register` accepts the param and applies
  `filt["navixy_device_id"] = {"$nin": [None, ""]}` (matches string
  or numeric device ids). Playwright confirmed: rows drop to the
  Navixy-linked subset when checked.

### 7. Add/Edit/Delete per kind — WIRED
- **Add**: `+` icon button next to each kind heading in FilterTree.
  Permission-gated on `assets.edit` (there is no `create` action in
  the permission catalogue — `edit` is what `POST /assets` actually
  enforces). Click opens AssetDrawer in new-asset mode (`id: null`,
  `kind` preset).
- **Edit**: row-click already opens AssetDrawer with editable
  Details tab (item 2). Existing row-open flow.
- **Delete**: row-hover trash icon (permission-gated on
  `assets.delete`) opens a confirm modal (`fleet-delete-confirm`)
  with copy noting that linked service history is retained. Uses
  existing `DELETE /api/assets/{id}` endpoint.

### 8. "Service history" → "Maintenance History" — RENAMED
- Tab labels rewritten to Title Case: `Service log` → `Service Log`,
  `Maintenance history` → `Maintenance History`.
- The pre-.120f "Service history" section that was inline in the
  retired FleetDrawer no longer exists — replaced by the two distinct
  AssetDrawer tabs. Ambiguity resolved: `Service Log` = in-app
  records (`/assets/{id}/records`); `Maintenance History` = XLSX
  ingested (`/plant/{id}/maintenance`). Cross-references added in
  the tab hint copy.

### 9. Add-a-photo — ROOT CAUSED + FIXED
- **Root cause 1** — `<img src="/api/assets/.../photo/...">` fires
  without any Authorization header, so the GridFS stream endpoint
  (`assets.py:950`) 401'd → broken image → user saw upload as failed.
- **Root cause 2** — the upload call manually set
  `Content-Type: multipart/form-data`, which some browsers treat as a
  hard override (dropping the boundary). Axios sets the correct
  boundary automatically when you pass a FormData instance and leave
  headers alone.
- **Fixes**:
  - Backend `stream_asset_photo` accepts `?token=<jwt>` fallback via
    the v143 `auth_helpers.verify_bearer_token` pattern. Bearer header
    still honoured when present.
  - `PhotoTab` appends `?token=<jwt>` to `photo_url` via a
    `_authedSrc()` helper before rendering `<img>`.
  - `PhotoTab.uploadPhoto` no longer sets Content-Type manually.

## Endpoint audit — no new endpoints; three existing endpoints reused

| endpoint | used by | permission |
|---|---|---|
| `POST /api/assets` | Add per kind (`+`) | `assets.edit` |
| `DELETE /api/assets/{id}` | Row-hover delete | `assets.delete` |
| `POST /api/assets/{id}/photos` | Photo upload | `assets.edit` |
| `GET /api/assets/{id}/photo/{gid}` | Photo `<img>` — **now accepts `?token=`** | Bearer or token |
| `GET /api/fleet/register` | Register table — **now accepts `navixy_only`** | `assets.view` |

## Files touched (13)

### Frontend
- `frontend/src/components/AssetDrawer.jsx` — header rebuild, PhotoTab
  `?token=` src helper, multipart header removed, tab labels
  retitled, footer `emergent-badge-safe`.
- `frontend/src/components/PlantMaintenanceHistory.jsx` — sub-modal
  refactor.
- `frontend/src/pages/FleetRegister.jsx` — Navixy checkbox,
  Add-per-kind + button, row-hover Delete + confirm modal,
  `displaySubtype` client normaliser.

### Backend
- `backend/assets.py` — `stream_asset_photo` accepts `?token=`.
- `backend/fleet.py` — `get_register` accepts `navixy_only`.
- `backend/scripts/normalize_subtype_v58_13_120g.py` — NEW
  (dry-run + `--commit` + `--reverse` + audit markers).

### Tests
- `tests/backend_unit/test_fleet_punchlist_v58_13_120g.py` — NEW,
  25 checks covering items 1-9 + version pins.

### Versions
- `frontend/src/lib/version.js` — `RUNNING_VERSION → .120g`.
- `frontend/public/service-worker.js` — `CACHE_VERSION → .120g`.
- `mobile/src/lib/version.ts` — `MOBILE_BUNDLE_VERSION → .120g` only.

## Playwright verification (5 screenshots)

- `v58_13_120g_fleet_navixy_filter.png` — Sub-type column shows the
  canonicalised `Vacuum Truck`, `Ute`, `Tipper`, `Service Truck`
  labels (client-side normaliser working pre-backend-commit).
- `v58_13_120g_navixy_only_active.png` — Navixy-only checkbox
  checked, filter tree count still visible, register rows restricted.
- `v58_13_120g_drawer_full_header.png` — Header renders fully:
  eyebrow, title, Synced-from-Navixy pill, X close, and the actions
  row (`← Close`, `Print QR label`) all visible. 7 tabs across the
  bottom. Live Counters + Trip cards below.
- `v58_13_120g_maint_history_tab.png` — Maintenance History tab
  active, empty-state copy visible for an asset with no PM rows.
- `v58_13_120g_photo_tab.png` — Photo tab active with `Add photo`
  grid tile visible and Legacy photo file id input below.

## Tests

- New `.120g` file: 25/25 pass.
- Full fleet suite: 106/106 pass (`.120a`–`.120g` locks).
- Full backend suite: 973 pass, 4 skip, 2 pre-existing environmental
  flakes (Motor loop-isolation + safe_mode toggle) unchanged from
  the .120f baseline.

## Awaiting user green-light

- `python backend/scripts/normalize_subtype_v58_13_120g.py --commit`
  to write the 266 sub_type renames to the live DB.

---

## Live commit — SHIPPED (green-light received)

Green-light received. Live commit executed at
`2026-09-04T23:54:07.598740+00:00`.

### Commit result
- Total rows modified: **286** (up from the dry-run projection of
  266 because the `'vehicle'` bucket in `assets` grew from 20 to 40
  rows between dry-run and green-light — Navixy sync ingested new
  tracker-only rows in the interim). Every other bucket matched the
  dry-run count exactly.
- Breakdown: `assets.asset_type` = 121 rows across 10 mappings;
  `plant_maintenance.sub_type` = 165 rows across 1 mapping.

### Post-commit verification
- `assets.sub_type_normalised_v120g == true` — 121 rows.
- `plant_maintenance.sub_type_normalised_v120g == true` — 165 rows.
- Residual `'Vac Truck'` / `'vacuum_truck'` / `'ute'` rows in each
  target collection — **0** (fully drained).
- 3-row audit sample verified: `sub_type_before_v120g` preserves
  the exact raw casing per row (one row shows `'Vac Truck'`, another
  shows `'vacuum_truck'` — snake_case retained — so reverse restores
  exactly the prior value).

### `/api/fleet/categories` post-commit
FilterTree now surfaces a single canonical bucket per label. No more
split "Vac Truck" / "vacuum_truck" — one `'Vacuum Truck'` bucket with
18 rows under Vehicle. Full breakdown:

```
Kind: vehicle  (total=98)   Ute 27 · Commercial 20 · Vacuum Truck 18 ·
                            Other 18 · Tipper 11 · Service Truck 2 ·
                            Crane Truck 1 · Passenger 1
Kind: plant    (total=52)   Vehicle 40 · Excavator 6 · Compactor 3 ·
                            Telehandler 1 · Directional Drill 1 ·
                            Road Roller 1
Kind: trailer  (total=20)   Trailer 20
```

### Round-trip pytest — 21/21 pass
New `test_normalize_subtype_roundtrip_v58_13_120g.py` parametrises
all 18 mappings + already-canonical no-op + commit idempotency +
reverse idempotency. Every mapping proves:
1. Seed row with `raw` → commit → assert `field == canonical` +
   audit markers stamped + `sub_type_before_v120g == raw` (exact).
2. Reverse → assert `field == raw` restored + all three audit markers
   removed.

### Full backend suite
**994 pass**, 4 skipped, 2 pre-existing environmental flakes
(Motor loop-isolation + safe_mode toggle) unchanged from the .120f
baseline. Tally moved 951 (.120f) → 973 (.120g frontend punch-list)
→ 994 (.120g sub_type round-trip).

### If a rollback is needed
```bash
python /app/backend/scripts/normalize_subtype_v58_13_120g.py --reverse
```
Reverses row-by-row using each row's stored `sub_type_before_v120g`.
Verified idempotent (second reverse is a no-op).
