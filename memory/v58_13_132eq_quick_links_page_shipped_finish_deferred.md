# v58.13.132eq — Quick Links sidebar entry + read-only page · SHIPPED

**Ship type:** feature (sidebar nav + new page + auth-level change)
**Version:** `.132ep` → `.132eq` on `frontend/src/lib/version.js` (both fields) + `frontend/public/service-worker.js` (`CACHE_VERSION`). Mobile stays `.132di`.

## What shipped

- **New sidebar entry** "Quick Links" (Bookmark24 icon, no permission gate, testid `nav-quick-links`) placed in the **Overview section** at the top of the sidebar — sits above the Settings → Organisation entry per Stephen's *"link above the settings/organisation"* ask.
  - Placement rationale: Settings section is delegated to the draggable `<SettingsNav />` (registry-driven, per-org saved layouts). Adding a flat NAV entry inside the Settings group would not render, and adding to the Settings registry would be filtered out of existing saved layouts. Overview placement always renders for every user, no per-org drift.
- **New route** `/app/quick-links` → `<QuickLinks />` at `frontend/src/pages/QuickLinks.jsx`. Read-only tile grid (1/2/4 columns responsive), remote-icon `<img>` with emoji fallback via `onError`, `target="_blank" rel="noopener noreferrer"`, empty state.
- **Admin affordance** — `<Link to="/app/settings/org">` "Manage tiles →" in the page header, gated by `useCan('users','edit')` (matches OrgSettings' own admin check). Non-admins do not see it.
- **Backend GET opened up** — `list_tiles` no longer calls `_admin(user)`; any authenticated user in the caller's org can now read the tile list. Mutations (POST/PATCH/DELETE/reorder + fetch-icon) remain admin-only.
- **Management surface untouched** — `<QuickLinksSection />` stays on Org Settings (`.132eo/.132ep`) with all CRUD, drag-reorder, and auto-icon flow intact.

## Files touched

- `backend/org_url_tiles.py` — `_admin(user)` removed from `list_tiles` only.
- `frontend/src/pages/QuickLinks.jsx` — NEW page.
- `frontend/src/App.js` — import + `<Route path="quick-links">`.
- `frontend/src/components/layout/AppShell.jsx` — Bookmark icon imports + new NAV entry in Overview section.
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js` — bumped to `.132eq`.
- `backend/tests/test_v58_13_132eq_quick_links_page.py` — NEW (14 checks).
- `backend/tests/test_v58_13_132eo_url_tiles.py` — updated `test_live_api_admin_only_guard` + `test_backend_admin_guard_helper_present` to reflect `.132eq` auth semantics (GET open, mutations still admin-only). No other `.132eo` checks touched.

## Pytest evidence

```
$ python -m pytest tests/test_v58_13_132eq_quick_links_page.py \
                     tests/test_v58_13_132ep_quick_links_polish.py \
                     tests/test_v58_13_132eo_url_tiles.py \
                     tests/test_v58_13_132en_incidents_table_view.py -q
...........................ss..........sssss....................         [100%]
57 passed, 7 skipped, 1 warning in 4.67s
```

`.132eq` locks (14):
- `list_tiles` scope check — no `_admin(user)` in the handler body (scope-precise slicing).
- Every mutating handler (`create_tile`, `update_tile`, `delete_tile`, `reorder_tiles`, `fetch_icon`) still invokes `_admin(user)`.
- Live-API: non-admin `GET /url-tiles` → 200 with `tiles: []` shape; non-admin `POST/PATCH/DELETE/reorder/fetch-icon` → 403.
- FE page: exports `QuickLinks`, uses `api.get('/org/url-tiles')`, grid+empty+loading testids, `target=_blank` + `rel=noopener noreferrer`, admin `isAdmin ? (` gate wrapping the `quick-links-manage-link` deep-link to `/app/settings/org`, `<img src=remote_icon_url>` + `onError` fallback.
- `App.js` imports `QuickLinks` and registers the `<Route path="quick-links">`.
- `AppShell.jsx` imports `Bookmark24Regular/Filled` and carries the entry `to='/app/quick-links'` + label `'Quick Links'` + testid `'nav-quick-links'` inside the Overview NAV group, with **no** `requiresCan/resource/permission` prop.
- Version-sync `>= .132eq`.

The 7 skips are auth-rate-limited live-login tests deferring to source-pin evidence — the project's standing directive relies on pytest source-pins as primary FE gating.

## NOT changed

- `.132eo/.132ep` management surface (`<QuickLinksSection />`) untouched — CRUD, drag-reorder, auto-icon fetch all preserved.
- Draggable `<SettingsNav />` registry untouched.
- No other Settings entries touched, no App.js routes altered beyond the additive `/quick-links` route.
- `/app/mobile/` — untouched.

## How to verify (manual)

1. Log in.
2. Sidebar → top "Overview" section shows: Dashboard · Ask Intelligence · **Quick Links** (visible to all roles).
3. Click Quick Links → read-only tile grid renders. Admin sees "Manage tiles →" top-right; non-admin does not.
4. Click any tile → opens in new tab.
5. Empty state renders when no tiles exist, with admin CTA linking to Settings → Organisation.

## Rules compliance

- ✅ No `finish` / `testing_agent` / `e1_tester` invoked.
- ✅ `/app/mobile/` untouched.
- ✅ Version bumped `.132ep → .132eq` in lockstep on all three canonical strings.
- ✅ Existing management surface preserved.
- ✅ URL sanitisation + icon fetch from `.132eo/.132ep` untouched.
- ✅ Pytest source-pins green (57 pass across `.132en/.132eo/.132ep/.132eq`).

## Screenshot

Deferred — auth-endpoint rate-limit exhausted during multi-ship session (screenshot attempts consume the same throttle budget as the pytest live-API tests). Version bump is verified live on the login page footer (`PANELTEC-V160.3.9.58.13.132EQ`). Pytest source-pins provide primary gating evidence per standing directive.
