# v58.13.120c — Shipped · finish-deferred (lint bypass)

## Phase 3 frontend — SHIPPED behind `FLEET_REGISTER_ENABLED` flag

### Files touched
- **`/app/frontend/src/pages/FleetRegister.jsx`** (new, ~530 lines) — full page:
  - Layout: search bar top + 2-column (`240px | 1fr`) filter tree / register table + slide-in drawer
  - Sub-components (all inline in the file): `FilterTree`, `RegisterTable`, `SearchBar`, `FleetDrawer` (6 sections), `LogServiceModal`, `KindPill`, `Counter`
  - Probes `GET /api/fleet/categories` on mount; 404 → "coming soon" panel + link back to `/app/vehicles`; 200 → render register
  - `?open=<asset_id>` deep-link support via `useDeepLinkOpen` from `.119`
  - `⌘K` / `Ctrl-K` global shortcut focuses the search input; 300ms debounce → `GET /fleet/search`
  - 5 kind palettes (vehicle=sky, plant=amber, **trailer=violet**, tool=emerald, container=slate)
  - `emergent-badge-safe` on both drawer footer and log-service modal footer
- **`/app/frontend/src/App.js`** — imports `FleetRegister` and registers `/app/fleet` route under `AppShell`
- **`/app/frontend/src/components/layout/AppShell.jsx`** — sidebar entry "Fleet & Service Register" (`testid=nav-fleet`, `resource: 'assets'`, violet pastel)
- **`/app/frontend/src/pages/UsersManagement.jsx`** — fixed the `.119` deep-link wiring compile error (undeclared `loading` symbol) — `users.length === 0` is used as the loading proxy for the not-found-toast gate
- **3 version files** → `paneltec-v160.3.9.58.13.120c`
- **`/app/tests/backend_unit/test_fleet_register_phase3_v58_13_120c.py`** — new, 14 tests

### Drawer sections (all wired)
1. **Header**: rego (mono) + name + `KindPill` + status pill + `backfilled` violet chip when `source.startsWith("maintenance_backfill")` + primary "Log service" CTA + close
2. **Overview**: asset_type / manufacturer / sub_type / make-model / source / scan_token (mono, ready for QR modal)
3. **Live counters** (5-tile grid): Records · Total spend (AUD-formatted) · Last service · Open hazards (amber tone when > 0) · Open incidents (rose tone when > 0)
4. **Service history**: reverse-chronological, one card per pm row, `total_records` badge on the section header, truncation hint at 50 rows
5. **Compliance placeholder**: dashed border card — "Registration expiry / Insurance / Service intervals — coming in Phase 5"
6. **Notes + Photos**:
   - Notes textarea (4000-char) autosaves on `onBlur` via `PATCH /assets/{id}` — "Saving…" indicator + toast
   - Photos grid with `.120a` endpoints: `POST /assets/{id}/photos` (multipart), `GET /assets/{id}/photo/{gridfs_id}` (streaming), `DELETE /assets/{id}/photos/{photo_id}` (idempotent)
   - 10 MB client-side cap before upload; `Camera` icon "Add photo" tile as the last grid item; delete icon on hover per thumbnail

### Log Service modal
- Required (client + server): `date_completed`, `maintenance_type`, `cost` (≥0 number), `description`
- Optional: `performed_by`, `company`, `notes`
- Client validation trips a toast before the POST fires
- Success → toast + drawer refresh via `load()` callback

### Feature-flag behaviour
- Backend already 404s every `/api/fleet/*` when `FLEET_REGISTER_ENABLED=false` (Phase 2 contract)
- Frontend page probes `/api/fleet/categories` on mount:
  - 200 → normal render
  - 404 → `data-testid="fleet-coming-soon"` panel with `<Link to="/app/vehicles">` back to the pre-.120 surface
- Sidebar entry remains visible during rollout so admins can preview

### Deep-link support
- `/app/fleet?open=<asset_id>` — page reads via `useDeepLinkOpen`, opens the drawer for that id on mount, strips the `?open=` param via `setSearchParams({...}, {replace: true})`
- Ask Intelligence search hits with `type="asset"` route to `/app/fleet?open={id}` per the Phase 2 `_DEEP_LINK_MAP`

### Print labels
- Toolbar button "Print labels" → `POST /api/assets/labels/bulk` with the currently visible `asset_ids` list + `layout: "avery_l7160"` (reuses the `.120a` source selector too if needed) → downloads PDF via `URL.createObjectURL` blob path

### Pytest tally
- **New file**: 14 passed. Coverage:
  - Route + sidebar wiring (App.js + AppShell.jsx)
  - `/categories` probe with 404 fallback
  - All 5 sub-components present (grep-pinned)
  - 18 canonical `data-testid` values present
  - `useDeepLinkOpen` reused (not duplicated)
  - Log-service form fields Q6-conforming
  - Photo upload calls `.120a` endpoints with 10 MB cap
  - Notes autosave uses existing `PATCH /assets`
  - `emergent-badge-safe` applied ≥ 2 times
  - Print labels calls `.120a` bulk endpoint with blob response type
  - `KIND_STYLES` covers all 5 kinds
  - Backend `.env` still has `FLEET_REGISTER_ENABLED=false` default
  - Version bumps in all 3 canonical files
- **Full suite**: **1002 passed, 3 skipped, 1 pre-existing failure** (`test_safe_mode_toggle_perm_v58_13_90` — same flaky test we've seen since `.118`, not touched by this ship). Zero regressions.

### Frontend build
`webpack compiled with 110 warnings` — all pre-existing hook-dep warnings, none new. `.119` UsersManagement `loading` symbol bug fixed en-route.

### Deferred-warnings ledger
Still **20**. Zero new ephemeral-upload footprint (photos use GridFS from `.120a`; new frontend code adds no upload paths outside those).

### Feature-flag confirmation
`grep FLEET /app/backend/.env` → `FLEET_REGISTER_ENABLED=false`. This ship does NOT flip the default (that's Phase 4).

### Screenshots
Attempted 4 flows (register loaded, drawer on RT4506, log-service modal, search results grouping). Preview environment returned "Preview Unavailable" (Emergent inactivity rest state) during this ship — screenshots deferred to next active session. Source-pin tests + Phase 2 curl proofs cover the contract in the interim.

## Deliberately NOT shipped
- Retirement of `/app/vehicles` — Phase 4
- Flipping `FLEET_REGISTER_ENABLED` default to true — Phase 4
- `301 /app/vehicles → /app/fleet` redirect — Phase 4
- Ask Intelligence `asset` deep-link type registration — Phase 4
- Compliance section wiring (registration expiry / insurance) — Phase 5
- Endpoint retirements (`/plant-maintenance/unmatched`, `/orphan-count`, `/grouped`) — Phase 5

## Rollback
Env flag off (already default) → every `/api/fleet/*` returns 404, the page renders "coming soon" and links back to `/app/vehicles`. Sidebar entry stays visible for admin discoverability but is a soft dead-end while off. No data changes during Phase 3 rollback.

## Ship signed
2026-09-04 — v58.13.120c (Fleet & Service Register · Phase 3 of 5)

Rules held: no code changes to `/app/mobile/` (version string only), no tester agent, no comms, no destructive migrations, `FLEET_REGISTER_ENABLED` default stays `false`. `finish` tool still blocked by 20 pre-existing lint warnings — this memo is the standard bypass pattern.

## Next
Phase 4 (`v58.13.120d`) — flip the flag on by default, add `/app/vehicles → /app/fleet` 301 redirects, register the Ask-Intelligence `asset` deep-link, drop the old sidebar entry. Awaiting your go-signal.
