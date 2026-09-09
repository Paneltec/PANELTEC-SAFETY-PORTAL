# v58.13.132cg — Fleet filter + Permissions 500 + vac_truck merge · SHIPPED (finish-deferred)

## Ship rules honoured
- `testing_agent` — NOT invoked.
- `e1_tester` — NOT invoked.
- `finish` tool — NOT invoked. Finish-deferred per standing directive.
- `/app/mobile/` + `metro.config.js` — untouched.
- No mocks. No hard deletes.
- 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.

## Issue 1 — "Tipper 13 → shows 2" (P0)

### Root cause
`fleet.py::get_categories` (line 774) aggregates `asset_type` values THROUGH `normalize_asset_type()` from `asset_taxonomy.py`, so the sidebar chip labelled `Tipper 13` covers 11 rows with `asset_type='tipper'` + 2 with `asset_type='Tipper'`. But `fleet.py::get_register` (line 219-222 pre-.132cg) did an **exact case-sensitive match** on the incoming `sub_type` param — so clicking the `Tipper` chip queried `{asset_type: "Tipper"}` and returned only the 2 Title-Case rows, hiding the 11 lowercase ones. Same shape breaks every case-mixed sub_type (Vacuum Truck, Ute, Service Truck, etc.).

### Fix
`fleet.py::get_register` `sub_type` block now:
1. Reads `CANONICAL_ASSET_TYPE_MAP` from `asset_taxonomy.py` (same map `get_categories` uses).
2. Reverse-resolves: given `sub_type="Vacuum Truck"`, finds every raw variant (`vacuum_truck`, `Vac Truck`, `VACUUM TRUCK`, `vac truck`, `Vacuum truck`).
3. Matches `{"$in": raw_variants}` **OR** case-insensitive regex fallback — belt-and-braces for operator-invented variants that aren't in the map yet.

### Verified live
```
sub_type=Tipper           → 13 rows  (was 2)
sub_type=Vacuum Truck     → 18 rows  (was 3)
sub_type=Ute              → 42 rows  (was 17)
sub_type=Service Truck    →  7 rows
sub_type=Crane Truck      →  2 rows
```
Every filter result now matches the chip count in the sidebar.

---

## Issue 2 — `vac_truck` → `Vacuum Truck` merge

### Migration script
`backend/scripts/merge_vac_truck_into_vacuum_truck_v58_13_132cg.py` — dry-run default + `--commit`, idempotent, provenance breadcrumb `_asset_type_normalised_at` + `_asset_type_normalised_from` (matches `.132bd`/`.132cb` convention).

### Live output
```
BEFORE:
  · asset_type='vac_truck'                : 2
  · asset_type='Vacuum Truck' (exact)     : 3
  · asset_type ~ /^Vacuum Truck$/i        : 3
  · projected canonical bucket (all)      : 5

COMMIT complete.
  · matched         : 2
  · modified        : 2

AFTER:
  · asset_type='vac_truck'                : 0  (target hit)
  · asset_type ~ /^Vacuum Truck$/i        : 5
```
After migration + Issue 1 filter fix, `Vacuum Truck` chip resolves to **18 rows** end-to-end (13 pre-existing `vacuum_truck` + 3 `Vacuum Truck` + 2 newly-normalised `vac_truck`).

---

## Issue 3 — Company / division tagging (INVESTIGATION ONLY)

### Schema state
`assets` collection has **NO** `division` / `company` / `owner_role_id` field. Existing `owner` field is free-text and unstandardised. Adding `division` (enum `paneltec_civil` | `viatec_traffic` | `admin_staff`, nullable) is greenfield.

### Live count breakdown for the mapping proposal

| Heuristic | Count | Sample |
| --- | --- | --- |
| `name LIKE 'VTS%'` | **20** | `VTS - DC Ranger - K53JU`, `VTS - Dropdeck`, … |
| `asset_type IN {ute}` AND `name LIKE '%Ranger%'` | **11** | `Daniel Butler - RANGER - K21KV`, `Scott Campbell - RANGER - K59JU`, `Timothy Guy - Ford Ranger Wildtrak - M98…`, `Mathew S - Ranger Tray - K68JF`, `Daniel Carr - Ranger - K76KT`, `Nevill Young- Ford Ranger - M07HD`, `Craig Large - Ford Ranger Wildtrak - M78T`, `Jason D - Ranger - K39JZ`, `Ford Ranger Wildtrak - X…`, … |
| `name LIKE '%Dropdeck%'` | **2** | `VTS - Dropdeck` (kind=other, no rego), `Dropdeck Traffic Control Service Truck` (rego I73JN, asset_type=Service Truck) |
| `name LIKE '%Traffic Control Service%'` | **1** | `Dropdeck Traffic Control Service Truck` (I73JN — overlaps with the Dropdeck row above) |
| `sub_type LIKE '%Traffic Control%'` | **0** | (no `sub_type='Traffic Control'` values exist in raw data) |

### Overlap notes for Stephen's approval
- **VTS-prefix (20)** already captures both Dropdeck rows and the Ranger rows starting with `VTS - DC Ranger -`. So the primary rule can just be: `name LIKE 'VTS%'` OR `name LIKE '%Dropdeck%'` OR `name LIKE '%Traffic Control Service%'` → **`viatec_traffic`** (roughly 20-21 rows, deduped).
- **Ranger owners (11)**: the pattern is `<PersonName> - RANGER - <REGO>` or `<PersonName> - Ford Ranger - <REGO>`. These look like staff / lease vehicles. Stephen needs to confirm whether:
   - **(a)** They're `admin_staff` (office / management), OR
   - **(b)** They're `paneltec_civil` (assigned to Paneltec Civil site workers who drive them on-site), OR
   - **(c)** Split further based on the person name (needs Stephen's cross-reference to his roster).
- Everything else remains `null` (unassigned) so Stephen can tag manually via the drawer.

### Proposed `.132ch` scope (queued, awaiting Stephen's mapping approval)
1. Add `assets.division` field (nullable enum).
2. Add a Division chip filter (`All · Paneltec Civil · Viatec Traffic · Admin Staff · Unassigned`) below the existing KIND filter tree on the Fleet & Service Register.
3. Add Division picker to the asset drawer edit form.
4. **Idempotent backfill script** using rules confirmed by Stephen (per above).
5. `.132ch` pytest + version bump.

**Not shipped this batch** — awaiting Stephen's confirmation on the Ranger disposition (a / b / c above).

---

## Issue 4 — Permissions Presets 500 (P1, outstanding from `.132bn`)

### Root cause
`permission_presets.py::_custom_out(doc)` (line 190 pre-.132cg) blindly indexed `doc["key"]`, `doc["id"]`, and `doc["label"]`. Backend logs show:
```
File "/app/backend/permission_presets.py", line 193, in _custom_out
    "key": doc["key"],
           ~~~^^^^^^^
KeyError: 'key'
```
A legacy custom-preset row landed in `db.permission_presets` (4 orphaned rows in Paneltec, matching the 4 "(unnamed preset)" rows now visible) without a `key` field — likely from an early hand-crafted seed pre-`_slugify` era. Bubbles to a full 500 on every `GET /permission-presets` call.

### Fix
`_custom_out()` is now defensive:
```python
key = doc.get("key") or doc.get("id") or _slugify(doc.get("label") or "preset")
return {
    "id": doc.get("id"),
    "key": key,
    "label": doc.get("label") or "(unnamed preset)",
    ...
}
```
No column dropped; malformed rows now render as `(unnamed preset)` with a synthesised key so the FE can still list/duplicate/delete them. Stephen can clean them up via the delete-preset affordance.

### Verified live
```
GET /api/permission-presets → HTTP 200
```
Permissions Presets page loads with the built-in list + 4 previously-hidden `(unnamed preset)` rows visible for cleanup.

---

## Files touched
- `backend/fleet.py` — `import re`; sub_type filter rewritten to reuse `CANONICAL_ASSET_TYPE_MAP` + case-insensitive fallback.
- `backend/permission_presets.py` — `_custom_out` defensive rewrite.
- `backend/scripts/merge_vac_truck_into_vacuum_truck_v58_13_132cg.py` (NEW).
- `backend/tests/test_v58_13_132cg_fleet_filter_and_500_fixes.py` (NEW).
- `frontend/src/lib/version.js` — RUNNING + EXPECTED `.132cf → .132cg`.
- `frontend/public/service-worker.js` — CACHE `.132cf → .132cg`.

## Pytests (`backend/tests/test_v58_13_132cg_fleet_filter_and_500_fixes.py`)
4/4 green:
- `test_fleet_register_uses_canonical_taxonomy_for_sub_type`
- `test_vac_truck_migration_script_exists`
- `test_permission_presets_custom_out_is_defensive`
- `test_three_way_version_sync_at_132cg`

Adjacent regressions (`.132ce + .132cf`) — 24/24 still green.

## Screenshots
- `/tmp/132cg_fleet_register.jpeg` — Fleet & Service Register loads clean, version footer `.132cg`.
- `/tmp/132cg_presets.jpeg` — Permissions Presets page loads with the built-in matrix + 4 previously-broken `(unnamed preset)` rows now safely rendered.

## Deferred to `.132ch` / later
- **Issue 3 backfill** — awaiting Stephen's approval on the mapping table (specifically the Ranger disposition: `admin_staff` vs `paneltec_civil` vs split).
- Debounce on worker/site search (from `.132cf` deferred list).
- Notes maxLength+counter on Ad-hoc Jobs (from `.132cf` deferred list).
- SMS-deferred pill on assignments list (from `.132cf` deferred list).
- Sidebar icon swap for Ad-hoc Jobs (from `.132cf` deferred list).

## NOT changed
- `assets` schema — no `division` column added this ship (Issue 3 is investigation-only).
- Fleet register cache TTL / other endpoints — untouched.
- The 4 legacy `(unnamed preset)` rows — Stephen can delete them via the UI now that the page renders.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — parked for v58.14.x.
- `/app/mobile/` code — untouched. `MOBILE_BUNDLE_VERSION` unchanged.

## finish tool
Deferred by design. Handed off to the next fork with this memo.
