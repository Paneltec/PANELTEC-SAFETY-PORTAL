# v58.13.132ex — Shipped, `finish` deferred

**Status**: shipped. `finish` **NOT** invoked (blocked by 20 pre-existing
`ephemeral-upload-storage` lint warnings + Stephen's standing directive
that `finish` / `e1_tester` are banned for this program).

**Scope in one line**: admin-gate the Apps Directory · Tile Management
"Manage tiles" button so non-admins like Amanda see it greyed-out with an
"Admin only" tooltip, and tighten backend 403 detail strings for
defense-in-depth.

## Bug (Stephen)

> "Amanda (non-admin) logged in and the 'Manage tiles' view in Apps
> Directory was reachable with no gate."

Expected: only admins can reach Tile Management. Tile grid remains open
for everyone; management affordance greyed-out for non-admins with an
"Admin only" tooltip; backend refuses non-admin writes with a clear 403.

## Fix

### Frontend — `frontend/src/components/QuickLinksSection.jsx`
- Imported `useCan` from `../lib/permissions` (same hook that gates every
  other admin-only surface in the shell).
- Computed `isAdmin = can('users', 'edit')` at the top of
  `QuickLinksSection`.
- "Manage tiles" button now carries `disabled`, `aria-disabled`,
  `title="Admin only"`, and `opacity-50 cursor-not-allowed
  pointer-events-none` classes for non-admins. `onClick` short-circuits
  via `if (isAdmin) setManagerOpen(true)`.
- Empty-state copy branches on `isAdmin` — non-admins get "Admin can add
  them in Settings → Organisation → Apps Directory · Tile management."
- `AppsDirectoryManager` mount is now guarded by `isAdmin &&
  managerOpen` so a rogue state can never open the modal.
- Preview grid is unchanged — every authenticated user still sees the
  tile grid and can launch tiles.

### Backend — defense-in-depth
Both modules already carried an `_admin(user)` guard on every mutating
handler. This ship tightens the 403 detail string to match Stephen's
brief:

- `backend/org_url_tiles.py::_admin` →
  `HTTPException(403, "Tile management is admin-only.")`
  Applies to `create_tile / update_tile / delete_tile / reorder_tiles /
  fetch_icon`. `list_tiles` (GET) remains open to any authenticated user
  in the caller's org (unchanged from `.132eq`).
- `backend/tile_credentials.py::_admin` → same detail string. Applies to
  all 5 credential-vault endpoints (`GET / PUT / DELETE / reveal /
  copy-field`). All are admin-only by design.

## Files touched
- `backend/org_url_tiles.py` — `_admin` detail tightened.
- `backend/tile_credentials.py` — `_admin` detail tightened.
- `frontend/src/components/QuickLinksSection.jsx` — button greyed-out
  path + modal mount guard + empty-state copy branching.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ex`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132ex`.
- `backend/tests/test_v58_13_132ex_tile_management_admin_only.py` — new,
  7 tests (see below).
- `backend/tests/test_v58_13_132es_apps_directory_modal.py` — one
  source-pin refreshed (`test_manage_tiles_opens_manager_directly` used
  to hardcode the pre-`.132ex` `onClick={() => setManagerOpen(true)}`
  literal; now asserts the broader `setManagerOpen(true)` substring +
  reaffirms "no PIN gate" via the `requestManagerOpen` +
  `apps-directory-pin-modal` negatives).

## Version bumps
- `RUNNING_VERSION` **v58.13.132ew → v58.13.132ex** ✓
- `EXPECTED_CACHE_VERSION` **v58.13.132ew → v58.13.132ex** ✓
- Service Worker `CACHE_VERSION` **v58.13.132ew → v58.13.132ex** ✓
- Mobile bundle version: **NOT bumped this ship** (web-only per
  Stephen's directive; `MOBILE_VERSION_SYNC_OPTIONAL=true` used on
  commit).

## Endpoints hardened (defense-in-depth)
`org_url_tiles.py`:
- `POST /api/org/url-tiles` — 403 for non-admin ✓
- `PATCH /api/org/url-tiles/{id}` — 403 ✓
- `DELETE /api/org/url-tiles/{id}` — 403 ✓
- `POST /api/org/url-tiles/reorder` — 403 ✓
- `POST /api/org/url-tiles/fetch-icon` — 403 ✓
- `GET /api/org/url-tiles` — **stays 200** for any authenticated user ✓

`tile_credentials.py`:
- `GET / PUT / DELETE /api/tile-credentials/{id}` — 403 ✓
- `POST /api/tile-credentials/{id}/reveal` — 403 ✓
- `POST /api/tile-credentials/{id}/copy-field` — 403 ✓

All non-admin 403 responses now carry
`detail: "Tile management is admin-only."`.

## Pytest results

### `.132ex` new suite — 7 / 7 passing
`backend/tests/test_v58_13_132ex_tile_management_admin_only.py`
- `test_manage_tiles_button_is_admin_gated_in_source` — FE lock: `useCan`
  imported, `can('users', 'edit')` present, `disabled={!isAdmin}` +
  `aria-disabled={!isAdmin}` + `"Admin only"` tooltip + `opacity-50` +
  `cursor-not-allowed` + `pointer-events-none` all present. Manager
  modal mount guarded by `isAdmin && managerOpen`. Click handler
  short-circuits via `if (isAdmin) setManagerOpen(true)`.
- `test_backend_admin_guards_use_clear_detail` — both modules carry
  the shared detail string.
- `test_non_admin_403_on_url_tiles_writes` — worker (Amanda-like) hits
  403 on POST / PATCH / DELETE / reorder / fetch-icon.
- `test_non_admin_403_on_tile_credentials_writes` — worker hits 403 on
  all 5 credential-vault endpoints.
- `test_non_admin_200_on_url_tiles_list` — worker still gets 200 on GET
  list (Quick Links page keeps working).
- `test_admin_200_on_url_tiles_writes` — Stephen (admin) full
  create-patch-delete round trip stays green.
- `test_version_pinned_to_132ex_or_higher` — version-sync check across
  `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` + SW `CACHE_VERSION`.

### Adjacent `.132e*` smoke — **296 passed, 48 skipped, 1 pre-existing failure**
`pytest -k "132e" --tb=line` — full suite of 132e-series ships.

The one failure is **pre-existing and unrelated to `.132ex`**:
- `test_v58_13_132ek_zebra_and_login_polish.py::test_incidents_opts_in_to_zebra`
  — asserts `\bzebra\b` (word-boundary) in the `<GroupedTilesView />`
  block on `Incidents.jsx`. The source uses `zebraTint` (a prop) which
  does not match the word-boundary regex. This regression predates
  `.132ex` (the file was last touched in `.132en` when the Incidents
  table view toggle landed). Left as-is per scope — will be picked up
  as a standalone fix in a follow-up ship.

`.132es` source-pin was refreshed to reflect the new admin-gated click
handler shape.

## Environment
- `PANELTEC_VAULT_SECRET` remains in `backend/.env` (required for
  `tile_credentials.py` import; unchanged since `.132ew`).

## Acceptance criteria
1. **Amanda (non-admin)** — Apps Directory → tile grid visible;
   Org Settings → Apps Directory · Tile management → "Manage tiles"
   button greyed-out with "Admin only" tooltip, click is a no-op. ✓
   (locked by FE source-pin test + backend 403 tests).
2. **Stephen (admin)** — button active, opens Tile Management as
   before. ✓ (`test_admin_200_on_url_tiles_writes` proves the write
   path still works end-to-end).
3. `curl` as Amanda's session vs `POST /api/org/url-tiles` → **403** ✓
4. `curl` as Amanda's session vs `GET /api/org/url-tiles` → **200** ✓
5. All new pytests pass; no new regressions in adjacent `.132e*`
   tests. ✓ (296 passed, 48 skipped, 1 pre-existing zebra failure).
6. Version bumped to `.132ex` in all 3 files ✓
7. Ship memo written; final reply in chat (no `finish` invocation) ✓

## Rules honoured this ship
- **NO** `finish` tool invocation.
- **NO** `e1_tester` usage.
- **NO** edits under `/app/mobile/` — mobile follow-up delegated to
  `e1_expo_frontend_dev`.
- **NO** rewrite of `/app/frontend/` to Vite — CRA production shell
  preserved.
- Commit will use `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify` per Stephen's directive.
- English-only chat replies.

## Follow-ups
- **Mobile parity** — Expo delegate should mirror the "Admin only"
  greyed-out treatment in the mobile Apps Directory (if it ships one)
  in a follow-up bump.
- **Pre-existing zebra failure** — `test_incidents_opts_in_to_zebra` in
  `.132ek` — will be picked up as a standalone fix.

## Known outstanding (unchanged from `.132ew` handoff)
- Phase B of Workspaces/Sites merge (`.132cb-b`).
- Medium/large PIN provisioning admin surface.
- `.132cv` / `.132dc` Expo tasks — mobile specialist.
- Playwright screenshot flakiness — continue leaning on pytest source-pins.
