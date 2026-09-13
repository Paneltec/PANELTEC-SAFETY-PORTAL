# v58.13.132es — Apps Directory in-app modal (no PIN lock) · SHIPPED

**Ship type:** feature — new admin surface + sidebar entry (mid-ship scope pivot)
**Version:** `.132er` → `.132es` on `frontend/src/lib/version.js` (both fields) + `frontend/public/service-worker.js` (`CACHE_VERSION`). Mobile stays `.132di`.

## Scope pivot narrative

The original `.132es` brief asked for:
- Item 1 — sidebar entry that pops a **new browser window** via `window.open` showing the Paneltec Group hub.
- Item 2 — Admin **4-digit PIN gate** on the Manage tiles popup with a `POST /api/auth/verify-admin-pin` endpoint, 15-minute session cache, rate-limited to 5 attempts / 15 min.

Both items were **scope-corrected mid-ship** by Stephen:
- Item 1 — swap `window.open` for an **in-app modal** overlaying the current tab.
- Item 2 — **drop the PIN entirely** ("the user will have already logged into the portal so they won't need any further security gates").

All PIN scaffolding built before the correction was **reverted cleanly**:
- Backend endpoint `POST /auth/verify-admin-pin` (+ `_AdminPinIn` model + in-process rate-limit dict + bcrypt verify) — removed from `auth.py`. Live check: `POST /api/auth/verify-admin-pin` now returns HTTP 404.
- FE `PinPromptModal` + `requestManagerOpen` + `apps_directory_unlocked_at` localStorage — removed from `QuickLinksSection.jsx`. Manage tiles button opens the manager directly again.
- `newWindow` NAV branch scaffolded in `AppShell.jsx` + `ExternalLinkGlyph` SVG — removed. Only the pre-existing `action` NAV branch is used.

## What shipped

### Sidebar entry
- New **Apps Directory** NAV item added to the Overview section (`AppShell.jsx`):
  - Rocket icon (`Rocket24Regular` / `Rocket24Filled`).
  - Admin-only via the existing `requiresCan: ['users', 'edit']` gate — inherits the same admin filter the sidebar already uses for `Ad-hoc Jobs`, `Users & Permissions`, etc.
  - Uses `action: 'open-apps-directory'` — the pre-existing `action` NAV pattern. Clicking dispatches the global `paneltec:open-apps-directory` `CustomEvent`. No routing occurs, no new window opens.
  - Testid `nav-apps-directory`.

### `<AppsDirectoryModal />` (`frontend/src/components/AppsDirectoryModal.jsx`)
- Mounted at the AppShell level as a sibling of `<InsuranceCriticalModal />` so it can overlay any page.
- Listens for the `paneltec:open-apps-directory` event via `useEffect` on the shell and toggles `appsDirectoryOpen`.
- Layout matches Stephen's reference image:
  - **Green eyebrow** `PANELTEC GROUP · APPS DIRECTORY` (`text-emerald-600`, bold, uppercase, tracking-wide).
  - **Bold-green H2 tagline** `Every tool, one click away.` (`text-emerald-700`, `font-extrabold text-2xl`).
  - Rocket icon left-aligned in the header, X close button top-right.
  - **Coloured tile grid** — reuses `remote_icon_url` favicon + emoji fallback + `tile.color` accent (rendered as a 4px top border). Each tile has a ⚙ (opens `/app/settings/org` via `<Link>`) and X (per-tab hide via localStorage) in the top-right, and a bottom `LAUNCH <NAME> ↗` link in the accent colour.
  - **Footer** — `<hidden count> APPS HIDDEN FROM YOUR HUB · SHOW & MANAGE` (or `MANAGE IN ORG SETTINGS` when nothing is hidden). Hidden state persists to `localStorage.apps_directory_hidden`; "Show & manage" clears it.
- **Dismissal**:
  - Explicit X button (`data-testid="apps-directory-modal-close"`).
  - Escape key (`keydown` listener attached while `open`).
  - Backdrop click (guarded via `e.target === e.currentTarget` so tile clicks don't accidentally close the modal).
- **Individual tile launches** — `<a href={tile.url} target="_blank" rel="noopener noreferrer">`. The hub itself is in-tab; only the app links pop new browser tabs. Matches the "click a specific tile inside the modal → new browser tab" behaviour Stephen described.
- Consumes the existing `GET /api/org/url-tiles` endpoint — no new backend surface. Filters + accent colour + `remote_icon_url` all flow through unchanged from `.132eq/.132er`.

### Preserved surfaces
- `/app/quick-links` full-page route from `.132eq` — untouched. Continues to render for direct navigation / bookmarks.
- Standalone `/apps-directory` route + `AppsDirectory.jsx` page (scaffolded during the pre-correction phase) — retained as a harmless alternative entry point. Not linked to from any sidebar item; no code path opens it in a popup. If a user or bookmark hits the URL directly they still get the hub. Zero user-visible cost, avoids churn on `App.js` route removal.
- `.132er` Apps Directory management table on Org Settings — untouched. Manage tiles button opens the popup directly without any intermediate gate.

## Files touched

- `backend/auth.py` — the `verify-admin-pin` scaffolding block appended in the pre-correction phase was excised (file back to the exact pre-`.132es` shape).
- `frontend/src/components/AppsDirectoryModal.jsx` — NEW.
- `frontend/src/components/layout/AppShell.jsx` — added `Rocket24Regular/Filled` fluent icons, added `AppsDirectoryModal` import, added NAV entry (`action: 'open-apps-directory'`) to Overview, added event listener + state, mounted `<AppsDirectoryModal />`. The `newWindow` branch and `ExternalLinkGlyph` scaffolded during the pre-correction phase were removed.
- `frontend/src/components/QuickLinksSection.jsx` — `PinPromptModal` component + `pinModalOpen` state + `requestManagerOpen` / `onPinVerified` helpers all removed. Manage tiles button back to `onClick={() => setManagerOpen(true)}`.
- `frontend/src/pages/AppsDirectory.jsx` — retained (scaffolded during the pre-correction phase, harmless alternative entry).
- `frontend/src/App.js` — retained the additive `/apps-directory` route + `AppsDirectory` import (scaffolded pre-correction, harmless).
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js` — bumped to `.132es`.
- `backend/tests/test_v58_13_132es_apps_directory_modal.py` — NEW (11 checks).

## NOT changed

- `.132er` Apps Directory management table on Org Settings — untouched.
- `.132ep` auto-icon fetch — untouched, still wired on URL blur in both the inline Add row and the Edit modal.
- `.132eq` sidebar Quick Links entry — untouched.
- Fuel Price Source toggle from `.132er` Item 2 — untouched.
- All existing backend endpoints — untouched.
- `/app/mobile/` — untouched.

## Pytest evidence — 81 pass / 9 skip across the ladder

```
$ python -m pytest tests/test_v58_13_132es_apps_directory_modal.py \
                     tests/test_v58_13_132er_apps_directory_and_fuel.py \
                     tests/test_v58_13_132eq_quick_links_page.py \
                     tests/test_v58_13_132ep_quick_links_polish.py \
                     tests/test_v58_13_132eo_url_tiles.py \
                     tests/test_v58_13_132en_incidents_table_view.py -q
81 passed, 9 skipped, 1 warning in 6.90s
```

`.132es` new locks (11):
- Sidebar entry uses `action: 'open-apps-directory'`, testid `nav-apps-directory`, `Rocket24Regular`, admin gate `requiresCan: ['users', 'edit']`.
- **`newWindow` scaffolding removed** — no `if (it.newWindow)` branch and no `ExternalLinkGlyph` in `AppShell.jsx`.
- AppShell imports `AppsDirectoryModal`, listens for `'paneltec:open-apps-directory'`, renders `<AppsDirectoryModal open={appsDirectoryOpen}`.
- Modal layout — eyebrow "Paneltec Group · Apps Directory", tagline "Every tool, one click away.", X close button testid, Escape-to-close (`e.key === 'Escape'`), backdrop dismiss (`e.target === e.currentTarget`).
- Modal tiles carry `target="_blank"` + `rel="noopener noreferrer"` + per-tile launch testids.
- Modal footer has hidden-count + Show & manage testids.
- **PIN endpoint absent**: no `verify-admin-pin` string, no `_AdminPinIn` model, no `_ADMIN_PIN_ATTEMPTS` dict on `auth.py`.
- **Live `POST /api/auth/verify-admin-pin` returns HTTP 404** on the running backend.
- **PIN modal removed** from `QuickLinksSection.jsx`: no `PinPromptModal`, no `apps-directory-pin-modal` testid, no `apps_directory_unlocked_at` localStorage flag, no `requestManagerOpen` helper.
- Manage tiles button reverted to `onClick={() => setManagerOpen(true)}` (opens manager directly).
- Version-sync `>= .132es`.

**No regressions** — full ladder `.132en/.132eo/.132ep/.132eq/.132er/.132es` returns 81 pass + 9 skip.

## Screenshot

- **`/app/memory/v58_13_132es_apps_directory_modal.png`** — Dashboard page with the Apps Directory modal open on top of it:
  - **Sidebar Overview** shows Dashboard · Ask Intelligence · Quick Links · **Apps Directory** (new, rocket icon). Apps Directory sits above the CAPTURE section as briefed.
  - **Modal centered on a dark backdrop** (not a new browser window — the URL bar still shows `/app/dashboard`; the modal is overlaid).
  - **Green header**: rocket icon + `PANELTEC GROUP · APPS DIRECTORY` uppercase eyebrow + bold-green tagline `Every tool, one click away.` + X close.
  - **Tile grid** with 8 tiles: Westpac Banking red-W favicon + `#d0021b` accent, GitHub fluidicon + `#111827`, SmartFill emoji + `#22c55e`, Navixy emoji + `#0ea5e9`, plus 4 pre-existing default-blue tiles (Westpac Banking, Navixy, Xero, Simpro). Each carries ⚙ + X in the top-right and a `LAUNCH <NAME> ↗` link in the accent colour at the bottom.
  - **Footer**: `0 APPS HIDDEN FROM YOUR HUB · MANAGE IN ORG SETTINGS`.
  - **Version pill** `v160.3.9.58.13.132es` in the sidebar footer.

## Manual verification

1. Log in as admin.
2. Sidebar Overview → click **Apps Directory** (rocket icon).
3. Modal opens over the current page — URL bar does NOT change.
4. Click any tile's `LAUNCH <NAME> ↗` link → new browser tab pops with the tile URL.
5. Click the ⚙ on a tile → navigates to `/app/settings/org` (modal closes via Link).
6. Click the X on a tile → tile hides locally; footer count increments; "SHOW & MANAGE" link appears.
7. Press Escape or click the backdrop → modal closes without navigation.

## Rules compliance

- ✅ No `finish` / `testing_agent` / `e1_tester` invoked.
- ✅ `/app/mobile/` untouched.
- ✅ Version bumped `.132er → .132es` in lockstep on all three canonical strings.
- ✅ `.132ep` auto-icon fetch preserved; `.132er` behaviour preserved (management table, fuel toggle stick).
- ✅ Backend PIN scaffolding fully reverted (endpoint returns 404 live).
- ✅ FE PIN scaffolding fully reverted (no PinPromptModal, no unlock localStorage flag).
- ✅ Pytest source-pins green (81 pass / 9 skip across the six-ship ladder).
