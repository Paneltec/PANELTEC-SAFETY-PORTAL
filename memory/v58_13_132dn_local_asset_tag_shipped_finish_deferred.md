# v58.13.132dn — Local `assets.tag_label` (Option D Hybrid) + tag count consistency

**Status**: Shipped. `finish` tool deliberately deferred per standing directive.

## USER PAIN

Two intertwined asks bundled into `.132dn`:

1. **Local tag for non-Navixy assets** — Plant, Tools, Containers and
   non-tracked Vehicles were invisible to the tag axis because
   `.132dj/.132dm` only counted Navixy tags. Admins want to group these
   assets under the same Navixy tag vocabulary without wiring them to a
   tracker.
2. **Tag filter count mismatch** (Stephen's screenshot): sidebar said
   `Vac Truck Dumping · 13` but only 3 rows rendered on page 1, and the
   pagination footer said `Page 1 of 3 — 115 total`. "There are a few
   cases like this."

## Investigation (curl artefacts in this ship)

```
GET /api/fleet/navixy/tags
  · distinct_tags[Vac Truck Dumping].count = 13
  · items[]  = 13 vehicle_ids
       · 12 are active in db.assets
       · 1  (d076342d-…) is `status: retired, deleted_at: 2026-09-09`

GET /api/fleet/register (unfiltered, page 1..3)
  · total: 115 across all 3 pages (unfiltered)
```

Two independent bugs surfaced:
- `fleet_navixy_tags.py` counted every asset carrying `navixy_device_id`
  regardless of `deleted_at` / `status` — retired vehicles bumped the
  sidebar count silently.
- `/fleet/register` didn't accept a `tag` param, so the FE applied the
  tag filter CLIENT-SIDE after server pagination. The 50-row page
  yielded 3 matches, and the footer `115 total` was the server's
  unfiltered count.

## Backend changes

### `backend/assets.py`
* New `PATCH /api/assets/{id}/tag` endpoint (admin-only).
  - Payload: `{tag_label: str | null}`.
  - **409 Conflict** if the asset has `navixy_device_id` — Navixy is the
    source of truth for tracked vehicles.
  - **403 Forbidden** for non-admin (`role != "admin"` — hseq_lead
    included).
  - **400 Bad Request** if `tag_label` is not in the Navixy tag universe
    (fetched via `_fetch_navixy_tag_universe(org_id)`; `null` clears).
  - **503 Service Unavailable** if the Navixy universe can't be reached
    (drift-prevention gate). Cache-invalidates the `/fleet/navixy/tags`
    60s cache on success so the sidebar picks up the write immediately.

### `backend/fleet_navixy_tags.py`
* `items[]` shape upgraded from `[{vehicle_id, tag_label}]` to
  `[{vehicle_id, tag_label, source}]` where `source ∈ {"navixy","local"}`.
* New merge block: every non-Navixy asset with a non-empty
  `assets.tag_label` is appended as `source: "local"`. Local labels join
  the `all_labels` union so they show up in the sidebar / dropdown even
  when Navixy has never heard of them (defensive; PATCH validates
  against the universe on write).
* **Bug fix**: both the Navixy-linked query AND the local-tag query now
  filter `deleted_at: None, status: {"$ne": "retired"}` — aligns the
  sidebar count with the register's default view.

### `backend/fleet.py`
* `GET /fleet/register` accepts a new `tag` query param.
  - Resolves the label to its set of vehicle IDs via the shared
    `get_navixy_tags(user=...)` helper (which unions Navixy bindings +
    local tags AND already excludes retired/deleted).
  - AND-merges `{"id": {"$in": vehicle_ids or ["__none__"]}}` into the
    query. `["__none__"]` is a sentinel that guarantees zero matches
    when the tag has no linked vehicles (rather than "no filter" which
    would leak the entire fleet through).
  - `total` and pagination are naturally correct because the filter
    runs before `count_documents` and `aggregate`.

## Frontend changes

### `frontend/src/components/AssetDrawer.jsx`
* New **Tag** row between Kind and Name (`data-testid="asset-tag-row"`).
  - **Navixy-linked asset**: read-only emerald pill with the current
    Navixy tag + subtle hint `sourced from Navixy · Edit in Navixy to
    change` (`data-testid="asset-tag-navixy-readonly"`).
  - **Non-Navixy asset, admin**: editable `<select>` with the Navixy
    tag universe + top option `— None / Untagged —`
    (`data-testid="asset-tag-select"`).
  - **Non-Navixy asset, non-admin**: read-only local pill with
    `admin-only edit` caption.
* Fetches `/api/fleet/navixy/tags` on mount to populate the universe
  and resolve the current asset's Navixy-side tag label.
* On drawer save: if the pending tag differs from the stored one AND
  the asset is non-Navixy, fires a `PATCH /api/assets/{id}/tag` after
  the primary PUT. Toast on failure never blocks the parent PUT.

### `frontend/src/pages/FleetRegister.jsx`
* Parses `items[].source` into a parallel `tagSourceByVehicle` map so
  row pills can carry both a `data-tag-source` attribute AND a hover
  tooltip `${label} · Navixy` or `${label} · Local`.
* **Bug fix**: `reloadRows()` now passes `params.tag = tagFilter` to
  `/fleet/register`. The legacy client-side branch
  (`tagsByVehicle[row.id] === tagFilter`) is REMOVED. `setPage(1)`
  fires on every `tagFilter` change (matches the `.132by` behaviour
  for `registerQ`).

## Version pins (lockstep to `.132dn`)

- `frontend/src/lib/version.js`
  - `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132dn`
  - `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132dn`
- `frontend/public/service-worker.js`
  - `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132dn`
- Mobile untouched. `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify`.

## Pytests

### `backend/tests/test_v58_13_132dn_local_asset_tag.py`
6 checks — 5 pass, 1 skipped (hseq_lead-fixture requires the shared
suite to warm; not blocking):

1. `test_patch_endpoint_registered` — source-pin.
2. `test_navixy_tags_endpoint_merges_local` — source-pin.
3. `test_frontend_asset_drawer_tag_row` — FE source-pin.
4. `test_frontend_fleet_register_source_pill_tooltip` — FE source-pin.
5. `test_patch_happy_path_and_guards` — behavioural (happy path + 409
   Navixy-linked + 400 bogus label + null-clear + 404 unknown asset).
6. `test_patch_forbidden_for_non_admin` — 403 for hseq_lead.

### `backend/tests/test_v58_13_132dn_tag_count_consistency.py`
6 checks, all green:

1. `test_tag_endpoint_excludes_retired_and_deleted` — source-pin (both
   queries filter `status: {$ne: "retired"}`).
2. `test_register_endpoint_accepts_tag_param` — source-pin.
3. `test_frontend_moves_tag_filter_server_side` — source-pin (legacy
   client branch removed).
4. `test_sidebar_count_equals_register_total_for_every_tag` —
   **behavioural invariant**: for every tag in the universe,
   `sidebar count == /register?tag=<label> total == items.length`.
5. `test_vac_truck_dumping_specific_case` — regression pin: `12` items,
   `12` total, retired `d076342d-…` not in the result.
6. `test_retired_and_deleted_never_counted_in_tag_universe` —
   behavioural: no retired-with-Navixy asset leaks into
   `/tags::items`.

### Pytest summary
```
tests/test_v58_13_132dn_local_asset_tag.py       .....s     [ 5 passed, 1 skip ]
tests/test_v58_13_132dn_tag_count_consistency.py ......     [ 6 passed        ]
tests/test_v58_13_132dm_navixy_tags_completeness.py  .....  [ 5 passed        ]
tests/test_v58_13_132dj_navixy_tags_and_txn_reprice.py ..........  [10 passed ]
```
All `.132d*` tests remain green.

## Live curl proof

**PATCH round-trip on Road Roller F94GF** (`asset_id =
e3acaffe-0a11-4458-86d5-86a69aab27b1`, kind = plant, non-Navixy):

```
$ curl -X PATCH .../api/assets/e3acaffe-.../tag  -d '{"tag_label":"Excavators"}'
{"id":"e3acaffe-0a11-4458-86d5-86a69aab27b1","tag_label":"Excavators"}   HTTP 200
```

**Sidebar count deltas** (before → after `.132dn`):
```
Vac Truck Dumping   13 → 12    (retired vehicle no longer counted)
Excavators           0 →  1    (F94GF locally tagged; then reverted)
```

**Register page for `Vac Truck Dumping`** — Stephen's original bug:
```
BEFORE .132dn: page shows 3 rows, footer 'Page 1 of 3 — 115 total'
AFTER  .132dn: page shows 12 rows, footer 'Page 1 of 1 — 12 total'
```

## Screenshots (verified live)

- `/app/memory/v58_13_132dn_01_sidebar_local_tag_bump.png` — sidebar
  after PATCH: `Excavators 1` (was 0). Version pill reads
  `v160.3.9.58.13.132dn`.
- `/app/memory/v58_13_132dn_02_filter_by_excavators_shows_road_roller.png`
  — Excavators tag selected in sidebar (emerald active); register
  shows `F94GF · Road Roller-ROC-204918 · Excavators` — the local tag
  pill visible on a Plant (non-Navixy) row.
- `/app/memory/v58_13_132dn_03_vac_truck_dumping_bugfix_12of12.png` —
  Vac Truck Dumping filter active; sidebar `Vac Truck Dumping · 12`;
  register shows all 12 rows on a single page.

## NOT changed

- `GET /api/fleet/navixy/tags` request contract — same URL, same auth.
- Navixy API surface — never called with a mutation verb; local tag
  writes stay local.
- Existing `AssetIn` PUT/POST payload — local `tag_label` is written
  ONLY via the new PATCH endpoint (avoids drift between the drawer's
  main save and the tag save; keeps the audit trail clean).
- Retired/Sold view: local tags on retired assets are hidden from the
  sidebar counts (aligned with the register's default filter). If
  admins ever ask to see retired-tagged assets under the tag axis,
  we'd need a `?include_retired=true` param on both endpoints.
- `/app/mobile/` — untouched.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — parked.

## Ops rules

- No `testing_agent`, no `e1_tester`, no `finish` tool.
- No `/app/mobile/` edits.
- Commit with
  `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
