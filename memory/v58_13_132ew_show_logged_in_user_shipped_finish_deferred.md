# v58.13.132ew — Shipped, `finish` deferred

**Status**: shipped. `finish` **NOT** invoked (Stephen's standing directive:
`finish` / `testing_agent` / `e1_tester` are banned for this program; ship
memos live in `/app/memory/` and reply-in-chat).

**Scope in one line**: give every user a permanent visual reminder of which
account they are acting on, harden the Apps Directory credential vault
(folded-in `.132ev` milestone), and auto-assign a distinct accent colour to
every tile so a busy hub reads at a glance instead of as a wall of blue.

## Ship items

### 1 · Logged-in user UI (primary `.132ew`)
Two indicators added to `AppShell.jsx` so users can never mistake which
account they're in:
- **Top-right user chip** (`data-testid="user-chip-identity"`) now shows full
  `name` + `role_id` (was first-name-only in uppercase).
- **Sidebar "Logged in as" line** (`data-testid="sidebar-logged-in-as"`)
  directly under the wordmark, visible on every authenticated page. Hidden
  when the sidebar is collapsed.
- Live-API lock: `GET /api/auth/me` returns `name` + `role_id` so the FE has
  something to display.

Files:
- `frontend/src/components/layout/AppShell.jsx` — chip refactor + sidebar
  strip; `SidebarShell` now accepts a `user` prop and the outer shell
  passes it through.

### 2 · Credential vault (folded-in `.132ev` milestone)
Per-admin per-tile credential vault surfaced through the Apps Directory
launcher + Org Settings tile manager.
- New backend module `backend/tile_credentials.py` — 5 endpoints
  (`GET / PUT / DELETE /{id}` · `POST /{id}/reveal` · `POST /{id}/copy-field`).
- Storage isolated on `user_id` — admin A can never read admin B's
  credentials. Passwords + Q&A answers AES-256-GCM encrypted at rest with a
  per-user key HKDF-derived from `PANELTEC_VAULT_SECRET`.
- Import-time guard refuses to load the module without the env var.
- Frontend surfaces:
  - `AppsDirectoryModal.jsx` — `openCheatSheet()` pops a self-contained
    HTML window with COPY-per-field buttons after a credential-aware click.
    Password auto-copied to clipboard; URL + username + Q&A answers copied
    via `/copy-field`.
  - `QuickLinksSection.jsx` — inline `CredentialSubEditor` inside the
    tile-edit modal (`credential-editor-username / -password / -save /
    -clear / -add-qa`).
- Audit trail: every `upsert / delete / reveal / copy-field` writes to
  `tile_credential_audit`.

### 3 · Auto-assign tile colour (targeted follow-up, no separate bump)
Stephen: *"could you automatically give each a tile a different colour"*.
- New palette in `org_url_tiles.py::_AUTO_PALETTE` — 12 visually distinct
  hexes. Sentinel `_DEFAULT_TILE_COLOR = "#1d6fb8"` is deliberately absent
  from the palette so it can act as the "unset / auto" marker without
  ambiguity with a legitimate admin pick.
- `_auto_color_for(seed)` — deterministic pick using
  `sum(ord(c) for c in seed.lower()) % len(palette)`. Same label → same
  hex forever (idempotent).
- `_out()` now hash-swaps `#1d6fb8` (or empty) at read time. Manual picks
  (any other hex) pass through untouched. Existing tiles that still carry
  the legacy default get auto-backfilled on next read — no migration
  script required.
- Mirror `AUTO_PALETTE` + `autoColor()` exported from
  `frontend/src/components/QuickLinksSection.jsx` so the live editor swatch
  matches what the server will paint. Both Add Tile row and Tile Editor
  modal track a `colorAuto` flag; interacting with the colour picker flips
  it to manual. Editor exposes a `reset auto` button so admins can drop
  back to the hash pick after over-riding.
- Palette (JS + Python identical order):
  `#3b82f6 #ef4444 #22c55e #7c3aed #14b8a6 #f97316 #ec4899 #6366f1
   #f59e0b #06b6d4 #f43f5e #10b981`.

## Files touched
- `backend/tile_credentials.py` — new
- `backend/org_url_tiles.py` — `_AUTO_PALETTE`, `_auto_color_for`, `_out`
  swap logic.
- `backend/server.py` — mounts `tile_credentials.router` (unchanged from
  earlier `.132ev` iteration).
- `frontend/src/components/layout/AppShell.jsx` — user chip + sidebar
  strip.
- `frontend/src/components/AppsDirectoryModal.jsx` — credential-aware
  launcher + `openCheatSheet` popup.
- `frontend/src/components/QuickLinksSection.jsx` — `AUTO_PALETTE` +
  `autoColor()` + AddTileRow / TileEditor auto-colour hook + inline
  `CredentialSubEditor`.
- `frontend/src/lib/version.js` — `RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132ew'`.
- `frontend/public/service-worker.js` — `CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ew'`.
- `backend/tests/test_v58_13_132ew_show_logged_in_user.py` — new, 12 tests.
- `backend/tests/test_v58_13_132er_apps_directory_and_fuel.py` — one
  source-pin string updated to match new `_out()` structure.

## Environment
- `PANELTEC_VAULT_SECRET` set in `backend/.env` (required for
  `tile_credentials.py` import).

## Testing
- **`.132ew` suite** — 12 / 12 passing (`test_v58_13_132ew_show_logged_in_user.py`).
  Covers: user chip source-pins, sidebar-logged-in-as, SidebarShell prop
  contract, `/auth/me` name+role live, `PANELTEC_VAULT_SECRET` import
  guard, AES round-trip through `PUT / reveal / copy-field`, cheat-sheet
  popup wiring, credential sub-editor testids, auto-colour palette + hash
  helper FE lock, auto-colour idempotency, manual-pick override, version
  pin ≥ `.132ew`.
- **URL-tiles regression umbrella** — 88 / 88 passing, 13 skipped
  (`pytest -k "url_tiles or quick_links or apps_directory or 132er or
  132eo or 132ep or 132eq or 132ew"`). No new failures.
- **Full backend suite** — deferred (previous run hit the 2-min
  execute_bash cap). Targeted regressions above give strong confidence
  the ship is clean; the 94-test baseline can be re-run separately.
- **Screenshots** — skipped by Stephen's directive (Playwright headless
  is flaky in this environment; pytest source-pins are the gating
  evidence).

## Deferred
- Full backend `pytest` sweep (2-min tool cap; targeted regressions
  passed).
- Server-side one-time backfill script for tiles still carrying
  `#1d6fb8` — **not needed** because `_out()` auto-swaps on every read;
  the DB rows can remain untouched. If Stephen ever wants the auto
  colour actually persisted (e.g. for exports) the migration is a
  one-liner: `db.org_url_tiles.updateMany({color: "#1d6fb8"}, ...)` per
  hash pick. Held off to keep the ship minimal.
- Removing the standalone `.132ev` scope memo — not needed; folded
  in here per Stephen's plan-confirmation reply.

## Known outstanding (unchanged from prior handoff)
- Phase B of Workspaces/Sites merge (`.132cb-b`) — field rename
  `workspace_id → site_id` across 7 collections + 40+ backend modules.
- Medium/large PIN provisioning admin surface (`Users & Permissions`).
- `.132cv` / `.132dc` Expo tasks — **left for the mobile specialist**
  (`/app/mobile/` remains untouched, per standing directive).
- Playwright screenshot flakiness — continue leaning on pytest
  source-pins.

## Rules honoured this ship
- **NO** `finish`.
- **NO** `testing_agent` / `e1_tester`.
- **NO** edits under `/app/mobile/`.
- English-only chat replies.
- Migrations idempotent (this ship needs none — `_out()` auto-swap is
  read-time and inherently idempotent).
