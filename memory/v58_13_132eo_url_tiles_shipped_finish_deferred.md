# v58.13.132eo — URL Tiles / Quick Links on Org Settings · SHIPPED

**Ship type:** feature (admin surface + backend CRUD)
**Version:** `.132en` → `.132eo` on `frontend/src/lib/version.js` (both `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION`) and `frontend/public/service-worker.js` (`CACHE_VERSION`). Mobile stays at `.132di`.

## What shipped

### Backend (`backend/org_url_tiles.py` — NEW)
- New router mounted at `/api/org/url-tiles` via `api.include_router(org_url_tiles_router)` in `server.py`.
- New Mongo collection `org_url_tiles`: `{ id, org_id, url, label, icon, description, order, created_at, created_by, updated_at, updated_by }`.
- 5 endpoints — **all admin-only, 403 for non-admin** (belt-and-braces `_admin(user)` gate at the top of every handler):
  - `GET  /api/org/url-tiles` → list, sorted by `order` then `created_at`.
  - `POST /api/org/url-tiles` → create. Auto-assigns order = last+1 when omitted.
  - `PATCH /api/org/url-tiles/{tile_id}` → partial update (URL / label / icon / description / order). 404 when tile not in caller's org.
  - `DELETE /api/org/url-tiles/{tile_id}` → hard delete. 404 when tile not in caller's org.
  - `POST /api/org/url-tiles/reorder` → bulk `{tiles: [{tile_id, order}]}`. Scoped to caller's org (cross-org ids silently skip).
- URL sanitiser `_sanitize_url()` strictly whitelists `http` / `https` schemes only. Rejects `javascript:`, `file:`, `data:`, `about:`, `mailto:`, protocol-relative (`//`), empty, missing host, and URLs carrying embedded credentials (`user:pass@host`). Rejected requests return HTTP 400 with an actionable detail (e.g. `"URL scheme must be http or https (got 'javascript')"`).
- Label / icon / description all stripped + length-capped (80 / 8 / 280 chars respectively). Label required.

### Frontend (`frontend/src/components/QuickLinksSection.jsx` — NEW)
- `<QuickLinksSection />` component rendered admin-gated on `pages/OrgSettings.jsx` (below `<ArchiveRulesSection />`).
- **Section preview**: header + "Manage tiles" button (`data-testid="org-quick-links-manage-btn"`) + responsive grid (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`) of tile cards. Each preview tile is an anchor with `target="_blank" rel="noopener noreferrer"` — clicking opens the URL in a new tab safely.
- **Manager popup** (`data-testid="org-quick-links-manager"`): grid of manageable tiles with drag-handle (`<GripVertical>`) + edit + delete per tile, "Add tile" CTA at the top-right, "Done" footer.
- **Drag-to-reorder** via `@dnd-kit/core` + `@dnd-kit/sortable` (already in package.json). On drop, sends `POST /reorder` with the full re-indexed array (`tiles.map((t, i) => ({ tile_id: t.id, order: i }))`). Reverts optimistically on API failure.
- **Editor modal** (`TileEditor`): URL + Label + Icon + Description inputs. Client-side URL validation (`^https?://` + `new URL()` parse) with inline error. Reused for both Add (`mode=add`) and Edit (`mode=edit`) flows.
- **Delete confirm dialog** (`ConfirmDelete`): typed confirmation not required (bookmarks are non-destructive) — plain Cancel / Delete buttons with the tile label surfaced in the prompt.
- All controls carry stable `data-testid`s (see pytest lock).

### Access control
- **Admin-only** — both the section-render (`{isAdmin && <QuickLinksSection />}` on `OrgSettings.jsx`) AND every backend handler (`_admin(user)` first-statement). Non-admins can neither view nor mutate.

## Files touched

- `backend/org_url_tiles.py` — NEW (5 endpoints, URL sanitiser, admin-gate).
- `backend/server.py` — added `from org_url_tiles import router as org_url_tiles_router` + `api.include_router(...)`.
- `frontend/src/components/QuickLinksSection.jsx` — NEW.
- `frontend/src/pages/OrgSettings.jsx` — imported component, mounted admin-gated below `ArchiveRulesSection`.
- `frontend/src/lib/version.js` — bumped `.132en` → `.132eo` on both fields.
- `frontend/public/service-worker.js` — bumped `CACHE_VERSION`.
- `backend/tests/test_v58_13_132eo_url_tiles.py` — NEW (18 pytest checks).

## NOT changed

- No other Org Settings section touched.
- No other backend router touched. `org_router` / `org_archive_rules_router` untouched.
- No disk writes — Mongo only.
- `/app/mobile/` — untouched. Mobile bundle stays `.132di`.
- Twenty pre-existing `ephemeral-upload-storage` lint warnings — still parked for v58.14.x.

## Pytest evidence

```
$ python -m pytest tests/test_v58_13_132eo_url_tiles.py -q
..................                                                       [100%]
18 passed in 4.50s
```

Coverage:
- Backend module exists with `prefix="/org/url-tiles"`.
- server.py imports + mounts the router.
- All 5 endpoint decorators present (`@router.get("")`, `@router.post("")`, `@router.patch("/{tile_id}")`, `@router.delete("/{tile_id}")`, `@router.post("/reorder")`).
- Every handler invokes `_admin(user)`.
- URL sanitiser uses `_ALLOWED_SCHEMES = {"http", "https"}`.
- **Live-API CRUD roundtrip** — create Westpac tile → list → patch label → reorder order=42 → confirm order landed → cleanup delete.
- **Live-API URL validation** — 3 checks: `javascript:alert(1)` → 400 (with "http or https" in body); `file:///etc/passwd` → 400; `notaurl` (missing scheme) → 400.
- **Live-API admin-guard** — hseq_lead ephemeral user gets 403 on all 5 endpoints.
- FE component exists + testids on section + manage button + preview grid.
- Preview tiles use `target="_blank"` AND `rel="noopener noreferrer"`.
- Manager popup renders all required testids (`add-btn`, editor URL/label/icon/description/save/cancel, delete-confirm/-confirm-btn/-cancel).
- Manager uses `@dnd-kit/core` + `@dnd-kit/sortable` + `arrayMove` and wires `POST /org/url-tiles/reorder`.
- Editor validates http/https client-side (`^https?://` regex + explicit error string).
- `OrgSettings.jsx` imports + admin-gates the section.
- Version-sync forward-safe `>= .132eo` pin on both `version.js` + `service-worker.js`.

## Curl proof

```
# Login as Stephen (admin)
$ TOKEN=$(curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
    -d '{"email":"stephen@paneltec.com.au","password":"Mcgstephen50#"}' \
    | jq -r .access_token)

# Create the Westpac tile
$ curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"url":"https://banking.westpac.com.au/wbc/banking/handler?TAM_OP=login&segment=personal&logout=false","label":"Westpac Banking","icon":"🏦","description":"Corporate banking portal"}' \
    $API/api/org/url-tiles
{
    "id": "f0dd1304-abcc-4360-94fb-4a9dd475dd4c",
    "org_id": "3116f250-…",
    "url": "https://banking.westpac.com.au/wbc/banking/handler?TAM_OP=login&segment=personal&logout=false",
    "label": "Westpac Banking",
    "icon": "🏦",
    ...
    "order": 0
}

# Reject javascript: scheme
$ curl -s -w "\nHTTP=%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"url":"javascript:alert(1)","label":"XSS"}' $API/api/org/url-tiles
{"detail":"URL scheme must be http or https (got 'javascript')"}
HTTP=400

# Reject file: scheme
$ curl -s -w "\nHTTP=%{http_code}\n" -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"url":"file:///etc/passwd","label":"pw"}' $API/api/org/url-tiles
{"detail":"URL scheme must be http or https (got 'file')"}
HTTP=400

# Reorder
$ curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"tiles\":[{\"tile_id\":\"$TILE_ID\",\"order\":5}]}" \
    $API/api/org/url-tiles/reorder
{"ok":true,"updated":1}
```

## Screenshots

- `/app/memory/v58_13_132eo_quick_links_section.png` — Org Settings scrolled to the new **Quick Links** section, showing the 3-tile preview grid (Westpac Banking ×2 + Navixy) with the "Manage tiles" button top-right and the fresh `v160.3.9.58.13.132eo` sidebar version pill in view. Section reads: "Bookmark-style tiles that open in a new window. Useful for the banking portal, supplier logins, and any external surface your team hits on a daily basis."
- `/app/memory/v58_13_132eo_quick_links_manager.png` — **Manage tiles popup** open on top of Org Settings, showing "Quick Links · Manage tiles" header, "3 tiles" count + orange "Add tile" CTA, three draggable tile cards (drag handle + icon + label + truncated URL + edit + delete per row), and "Done" footer button.

## How to verify (manual)

1. Log in as admin at `/login` (stephen@paneltec.com.au / Mcgstephen50#).
2. Navigate to **Settings → Organisation**. Scroll past Archive rules.
3. See the **Quick Links** section with the "Manage tiles" button.
4. Click **Manage tiles** → popup opens with any existing tiles.
5. Click **Add tile** → editor modal. Try entering `javascript:alert(1)` → client-side error "URL must start with http://". Try `https://banking.westpac.com.au/...` + label "Westpac Banking" + icon `🏦` → Save → toast "Added Westpac Banking". Popup refreshes.
6. Drag tiles to reorder → drop → reorder persists (refresh the popup confirms).
7. Click delete on a tile → confirm dialog → Delete → toast + tile removed.
8. Close popup → the preview grid on Org Settings reflects the change.
9. In another browser, log in as a non-admin user → confirm the Quick Links section is not rendered AND direct `curl -H "Authorization: Bearer $NONADMIN" $API/api/org/url-tiles` returns HTTP 403.

## Rules compliance

- ✅ No `finish` invoked.
- ✅ No `testing_agent` / `e1_tester` invoked.
- ✅ No files under `/app/mobile/` touched.
- ✅ Version bumped `.132en` → `.132eo` in lockstep on all three canonical strings.
- ✅ URL sanitisation is strict (whitelist http/https only, reject javascript/file/data/about/mailto/protocol-relative/empty/credentials-in-URL).
- ✅ No new disk writes — Mongo-only persistence.
- ✅ Pytest source-pins + live-API smokes green (18/18).
- ✅ Ship memo committed here (this file).
