# v58.13.132jo — Fleet register limit 50 → 200 (mobile alignment)

## User pain
Mobile Fleet tab showed:
- **50 assets** instead of the master register's **115**.
- **4 Vac Trucks** instead of **14**.
- **Fewer Company Vehicles** than the master's **8**.

The web `Compliance / Fleet & Service Register` was correct; only
the mobile Fleet tab under-counted.

## Root cause
`mobile/src/services/profile.ts::fetchFleetRegister` line 142 hardcoded
`params: { limit: 50, page: 1 }`.

The backend `/api/fleet/register` returns paginated results sorted
alphabetically; only the first 50 assets came through. Client-side
tag enrichment (from `/api/fleet/navixy/tags`, which correctly maps
all 109 tagged assets including all 14 vac trucks) then had only 50
assets to project tags onto — so `tagOptions.count` in `fleet.tsx`
under-reported every tag.

## What ships in `.132jo`
Single-line mobile change:

```diff
- params: { limit: 50, page: 1 },
+ params: { limit: 200, page: 1 },
```

200 is the backend's hard cap
(`fleet.py::register` uses `Query(50, ge=1, le=200)` — 500 returns
422). 200 is comfortably above the current 115-asset register with
~74% headroom before we need to teach the mobile to paginate.

### Not changed
- **Backend**: untouched. `/api/fleet/register`, `/api/fleet/navixy/
  tags`, and `/api/fleet/categories` are all already correct.
- **`/api/fleet/navixy/tags` call in mobile**: kept as-is. It was
  never the bug; it returns the correct tag map (14 vac trucks
  live). Deprecating it would have emptied the mobile tag dropdown
  because `/fleet/register` doesn't include `tag_label` on its
  response items (projection strips it — verified via curl before
  ship).
- **Web frontend**: no behavioural change. Version bump only, for
  lockstep cache invalidation across desktop clients.
- **Search resilience**: already in place at
  `mobile/app/(tabs)/fleet.tsx` line 161-167. Search filter matches
  `name / rego / make / tag` substrings client-side. With the
  register now fully loaded, typing "vac" finds every one of the
  14 vac trucks by name even if a tag were missing.

## Verification (live)

### Before
```
Mobile Fleet tab header: "50 assets"
Vac Truck Dumping (tag filter): 4 results
Company Vehicle (tag filter):   ~2 results
```

### After (backend snapshot, mobile will match on next fetch)
```
curl /api/fleet/register?limit=200 →
  items:  115
  total:  115
  limit:  200 (echoed)

curl /api/fleet/navixy/tags → tag_list_source=navixy_and_linked, 109 items
  distinct_tags:
    Company Vehicle         → 8
    Excavators              → 0
    Plant-Machinery         → 8
    Plumber Vehicle         → 5
    Service Vehicle         → 18
    Tipper                  → 5
    Tippers Under 10 Yarder → 10
    Traffic Dept            → 25
    Trailers                → 16
    Vac Truck Dumping       → 14
```

### 14 Vac Trucks confirmed live
| Name | Rego | Type | Navixy tag |
|---|---|---|---|
| Industrial - XT02AX | XT02AX | vacuum_truck | Vac Truck Dumping |
| Cap Recycler - XT96AZ | XT96AZ | vacuum_truck | Vac Truck Dumping |
| VW Crafter - CCTV Van - H01PZ | H01PZ | vacuum_truck | Vac Truck Dumping |
| Cappelotto 1 - XT44DL - Kor 3200 | XT44DL | vacuum_truck | Vac Truck Dumping |
| RSP - XT62BQ | XT62BQ | vacuum_truck | Vac Truck Dumping |
| Cappellotto 3 - Volvo (2600CL) - XT42BN | XT42BN | vacuum_truck | Vac Truck Dumping |
| DW - FX50 - D67YQ | D67YQ | vacuum_truck | Vac Truck Dumping |
| Vacvator 2 - Hino 500 - XT35DO | XT35DO | vacuum_truck | Vac Truck Dumping |
| Vacvator 1 - Hino 500 - XT36DO | XT36DO | vacuum_truck | Vac Truck Dumping |
| Kroll Recycler - XT04CS | XT04CS | vacuum_truck | Vac Truck Dumping |
| Cappellotto 2 - Volvo - XT48AK | XT48AK | vacuum_truck | Vac Truck Dumping |
| DW - FX60 - F30UM | F30UM | vacuum_truck | Vac Truck Dumping |
| Ditch Witch FX60 Vacuum Truck | E34UD | commercial | Vac Truck Dumping |
| Vermeer Vacuum Trailer - V100G | Z74QU | commercial | Vac Truck Dumping |

## Files touched
- `mobile/src/services/profile.ts` — 1-line + comment.
- `mobile/app.json` — `version 1.0.28 → 1.0.29`, `versionCode 150 → 151`.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` `.132jk → .132jo`.
- `frontend/public/service-worker.js` — `CACHE_VERSION`
  `.132jk → .132jo`.

## Version skip note
Web went `.132jk → .132jo`, skipping `jl / jm / jn` because the
mobile team claimed those ships during this session (their tab
background unify + category icons + folder icons). Mobile is on
1.0.28 → 1.0.29 for this change.

## Follow-up / risks
- If the fleet register ever exceeds 200 assets, the mobile needs
  proper pagination. Cheap headroom for now (74% free capacity).
  If growth is forecast, a follow-up ship should:
    - Raise the backend `le=200` cap, OR
    - Teach the mobile Fleet tab to page through
      `data.total` in a loop and dedupe.
- `/api/fleet/navixy/tags` still returns `count: 0` for the
  "Excavators" tag — that tag exists in Navixy but no assets are
  bound to it. Cosmetic. Follow-up housekeeping.
