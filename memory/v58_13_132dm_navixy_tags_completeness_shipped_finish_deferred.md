# v58.13.132dm — Navixy tag universe completeness (sidebar TAG filter)

**Status**: Shipped. `finish` tool deliberately deferred per standing directive.

## USER PAIN (verbatim)

> Sidebar TAG filter on Fleet Register is missing "a few tags" compared to
> what exists in Navixy.

Root cause: `.132dj`'s `fleet_navixy_tags.py::get_navixy_tags` computed
`distinct_tags` only from tags observed on **linked** vehicles
(`assets.navixy_device_id` matched). Tags defined in Navixy but
unattached — or attached only to trackers that aren't in our Fleet
register — were invisible on the sidebar.

## Fix

### Backend — `backend/fleet_navixy_tags.py`

1. **Split httpx calls** so a `/v2/tag/list` failure doesn't take
   `/v2/tracker/list` down with it. Previously both awaits sat inside
   the same try/except and any exception erased both payloads.
2. **Response shape upgrade**: `distinct_tags` now returns
   `[{label, count}]` (was: sorted list of strings).
   - `label` — tag label as stored in Navixy.
   - `count` — number of **linked** Fleet vehicles carrying that tag.
   - Union of (a) every tag from Navixy `/v2/tag/list` + (b) every tag
     observed on a linked vehicle. Tags with zero linked vehicles
     surface with `count: 0` so admins can see the full universe.
3. **New `tag_list_source` marker** on the response — `"navixy_and_linked"`
   when `/tag/list` succeeded, `"linked_only"` when `/tag/list` failed
   and we fell back to linked-only discovery. Logged at WARN level with
   the exception detail.
4. Cache TTL unchanged (60s per org).

### Frontend — `frontend/src/pages/FleetRegister.jsx`

1. **Top-of-table dropdown** — parses each entry as either a string
   (legacy) or `{label, count}` object; appends `" (0)"` to zero-count
   options so admins see the gap immediately.
2. **Sidebar TAG list** — renders every entry from `distinct_tags`.
   Zero-count tags use `text-slate-400 hover:bg-slate-50` (dimmed);
   populated tags use `text-slate-700 hover:bg-slate-100`; active tag
   uses `bg-emerald-600 text-white` (unchanged from `.132dl`).
   Every button carries `data-count={n}` for testability and a
   `title` tooltip that mentions the "no vehicles linked yet" state on
   zero-count entries.
3. **New empty-state hint** — when the admin selects a zero-count tag,
   a slate info banner (`data-testid="fleet-tag-zero-hint"`) renders
   above the register table:
   > *No vehicles linked to **{tag}** yet. Attach the tag to a tracker
   > in Navixy and it will appear here on the next refresh.*

## Live curl result (delta vs `.132dl`)

```
GET /api/fleet/navixy/tags
  connected: True
  tag_list_source: navixy_and_linked
  distinct_tags count: 9  (was 5)

  label                                 count
  ------------------------------------  -----
  Company Vehicle                           7
  Excavators                                0   ← NEW (zero-linked)
  Plumber Vehicle                           5
  Service Vehicle                          11   ← NEW (11 linked!)
  Tipper                                    1   ← NEW
  Tippers Under 10 Yarder                  10
  Traffic Dept                             20
  Trailers                                  0   ← NEW (zero-linked)
  Vac Truck Dumping                        13
```

**Delta**: **5 → 9 tags** surface in the sidebar. Two of the four new
tags (`Excavators`, `Trailers`) are defined in Navixy but not attached
to any linked Fleet vehicle. Two (`Service Vehicle` = 11 linked,
`Tipper` = 1) have real linked vehicles and were previously invisible.

## Pytests

New file: `backend/tests/test_v58_13_132dm_navixy_tags_completeness.py`
(5 checks, all green):

1. `test_response_shape_declares_label_count` — source-pin: `.132dm`
   marker + `{label, count}` object shape in payload builder + new
   `tag_list_source` marker present.
2. `test_union_includes_unlinked_tags` — mock Navixy returning 7 tags
   + 4 linked vehicles (2 tags unlinked). Response `distinct_tags`
   contains all 7 with counts:
   `Tippers Under 10 Yarder=1, Traffic Dept=2, Plumber Vehicle=1,
    Vac Truck Dumping=0, Company Vehicle=0, Site Ute=0, Trailer=0`.
   Marker = `navixy_and_linked`.
3. `test_graceful_fallback_when_tag_list_fails` — `/tag/list` raises
   `httpx.HTTPError`, `/tracker/list` succeeds. Endpoint stays HTTP 200
   with a valid shape; marker = `linked_only`; WARN logged mentioning
   `/tag/list` + `linked` fallback.
4. `test_frontend_zero_count_dim_and_empty_state` — source-pin: dim
   class present, `fleet-tag-zero-hint` testid present, dropdown
   `"(0)"` suffix present.
5. `test_three_way_sync_at_132dm_or_later` — version pins on
   `version.js` (RUNNING_VERSION + EXPECTED_CACHE_VERSION) and
   `service-worker.js` (CACHE_VERSION) all match `.132dm`.

**Also updated**: existing `.132dj` happy-path test
(`test_v58_13_132dj_navixy_tags_and_txn_reprice.py::
test_happy_path_maps_trackers_to_vehicles_and_first_tag_wins`)
migrated from `set(out["distinct_tags"]) == {...}` string-set
assertion to `{t["label"]: t["count"] for t in out["distinct_tags"]}`
dict comprehension over the new shape.

### Pytest summary

```
tests/test_v58_13_132dj_navixy_tags_and_txn_reprice.py ..........  [ 10 passed ]
tests/test_v58_13_132dm_navixy_tags_completeness.py       .....    [  5 passed ]
```

## Screenshots (verified live)

- `/app/memory/v58_13_132dm_sidebar_full_tag_universe.png` — sidebar
  shows all 9 tags. Zero-count entries (Excavators 0, Trailers 0)
  visibly dimmed. Version pill reads `v160.3.9.58.13.132dm`.
- `/app/memory/v58_13_132dm_zero_count_empty_state.png` — Excavators
  tag clicked → sidebar row emerald, table shows the new
  `fleet-tag-zero-hint` banner ("No vehicles linked to **Excavators**
  yet. Attach the tag to a tracker in Navixy…") + empty table body.

## Version pins (lockstep to `.132dm`)

- `frontend/src/lib/version.js`:
  - `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132dm`
  - `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132dm`
- `frontend/public/service-worker.js`:
  - `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132dm`
- Mobile untouched. `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify` bypass used.

## NOT changed

- `GET /api/fleet/navixy/tags` request contract — same URL, same auth
  (`assets.view` via `get_current_user`).
- `items` shape — still `[{vehicle_id, tag_label}]`, still only linked
  vehicles.
- `assets.navixy_device_id` — read only, never written.
- Navixy API surface — never called with a mutation verb.
- `filter.kind` / `filter.sub_type` state on FleetRegister — retained
  for URL deep-link back-compat.
- `/app/mobile/` code — untouched. Mobile bundle version unchanged.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — parked
  for v58.14.x per standing directive.

## Ops rules

- No `testing_agent`, no `e1_tester`, no `finish` tool.
- No `/app/mobile/` edits.
- No comms / emails / SMS wiring.
- Commit with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
