# v58.13.132x — SHIPPED (Fuel Cards admin UI)

Status: **shipped, 7/7 pytest passing, page live-verified via
Playwright screenshot at
`/app/frontend/public/mobile-screenshots/v132x_fuel_cards_admin.png`.
All 8 unassigned+shared rows rendered.**

## Executive summary

- **New admin page:** `/app/fleet/fuel/cards` (`FuelCardsAdmin.jsx`).
  Single-screen table with per-row attribution dropdown
  (Vehicle · Worker · Shared · Unassigned), searchable target
  picker (asset or worker), inline notes editor, per-row Save.
- **Filters:** "Unassigned only" toggle defaulted ON (surfaces the
  8 orphan cards from `.132v` first); free-text search on
  card # · rego · description · notes.
- **New endpoints:** `GET /api/fleet/fuel/cards` (list + label
  enrichment); `PATCH /api/fleet/fuel/cards/{card_number}` (update).
  Both under existing `require_fleet_register_enabled` flag and
  `assets.view`/`assets.edit` permissions.
- **Version bumps this batch:** `RUNNING_VERSION` +
  `MOBILE_BUNDLE_VERSION` + **`CACHE_VERSION`** +
  **`EXPECTED_CACHE_VERSION`** all → `.132x`. The CACHE bump is
  intentional and matches the user's brief allowance ("ONE
  CACHE_VERSION + EXPECTED_CACHE_VERSION bump allowed at end of
  `.132x`").

## Backend — new endpoints

### `GET /api/fleet/fuel/cards`

Query params:
- `unassigned_only=true` — filter to `attribution_kind ∈ {unassigned, shared}`.
- `q=<text>` — case-insensitive regex across `card_number`,
  `smartfill_description`, `smartfill_registration`, `notes`.

Response shape:
```jsonc
{
  "rows": [
    {
      "card_number": "17079",
      "org_id": "…",
      "attribution_kind": "unassigned",
      "asset_id": null, "worker_id": null,
      "smartfill_description": "Daniel Butler",
      "smartfill_registration": null,
      "notes": "Likely driver name: 'Daniel Butler' — please assign a worker.",
      "fill_count": 7,
      "first_seen_at": "2026-07-13", "last_seen_at": "2026-09-05",
      "source": "auto", "assigned_by": "script:v58.13.132v", "assigned_at": "…",
      "asset_label": null,     // enriched from db.assets
      "worker_label": null,    // enriched from db.workers
    }
  ],
  "total": 8
}
```

Sort: `unassigned` before `shared` before `worker` before
`vehicle`; within a kind, by `last_seen_at` desc. Purpose: surface
the rows that need attention first.

### `PATCH /api/fleet/fuel/cards/{card_number}`

Body:
```jsonc
{
  "attribution_kind": "vehicle" | "worker" | "shared" | "unassigned",
  "asset_id":  "uuid" | null,
  "worker_id": "uuid" | null,
  "notes": "…"
}
```

Validation:
- `attribution_kind=vehicle` requires `asset_id`.
- `attribution_kind=worker` requires `worker_id`.
- Invalid kind → 400.
- Unknown card_number → 404.

Writes:
- `source="manual"`, `assigned_by=<current user id/email>`,
  `assigned_at=<now>`, `updated_at=<now>`.
- `asset_id` / `worker_id` are nulled when the kind doesn't need them,
  even if the client sent both — the kind is source of truth.

## Frontend — page structure

Route: `/app/fleet/fuel/cards` (nested under the authed shell).

- **Header** — H1 "Fuel Card Attribution" + explanatory subcopy.
- **Toolbar** — checkbox "Unassigned only" (default ON), search
  input with icon, right-aligned counter "`filtered` of `total` cards".
- **Table** — 8 columns:
    - Card # (mono)
    - Fills count (tabular-nums)
    - First / Last seen (stacked, small text)
    - SmartFill hint (description + rego + enriched
      `asset_label`/`worker_label` if resolved)
    - Kind — colour-toned `<select>` (green vehicle, blue worker,
      slate shared, amber unassigned)
    - Attribute to — vehicle picker OR worker picker OR italic
      "No single owner"/"To be decided"
    - Notes — inline text editor
    - Save — button, disabled unless the row draft differs from
      persisted state, spinner while saving
- **Dirty-row indicator** — soft amber row background while any
  field is unsaved.
- **Footer** — helper text about override semantics.

Access: server enforces `assets.edit` on the PATCH endpoint. Page
itself renders for anyone who navigates to it (server is the gate).

## Files touched

| File | Change |
|---|---|
| `backend/fleet_fuel.py` | 2 new endpoints appended at EoF (`GET /cards`, `PATCH /cards/{cn}`) + `_FuelCardUpdate` pydantic model |
| `backend/tests/test_v58_13_132x_fuel_cards_admin.py` | **NEW** — 7 tests, all passing |
| `frontend/src/pages/FuelCardsAdmin.jsx` | **NEW** — admin page |
| `frontend/src/App.js` | Import + `<Route path="fleet/fuel/cards" element={<FuelCardsAdmin />} />` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `.132o → .132x` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `.132o → .132x` |
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132w → .132x` + ship-note block |
| `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` | `.132u → .132x` |

## Pytest suite

- File: `backend/tests/test_v58_13_132x_fuel_cards_admin.py`
- Result: **7 passed, 0 failed.**
- Coverage:
    - List endpoint returns ≥67 rows with all enrichment fields.
    - `unassigned_only=true` returns 8 rows (7 unassigned + 1 shared).
    - Free-text search matches on `registration` (Iveco `M76FV` → card 21372).
    - PATCH rejects missing `asset_id` for `kind=vehicle` (400).
    - PATCH rejects missing `worker_id` for `kind=worker` (400).
    - PATCH rejects invalid `attribution_kind` (400).
    - PATCH 404s on unknown card_number.

Non-mutating tests only (no `.live_db_writes` guard needed).

## Live verification

- Login as `stephen@paneltec.com.au` → nav to
  `/app/fleet/fuel/cards` → page rendered with:
    - 8 rows visible (Unassigned only toggle ON, matches
      backend `total: 8`).
    - Correct ordering: 7 unassigned (Iveco, Tipper, Amarok, Ford
      Ranger, 300 Tipper, Service Utility, Daniel Butler) →
      1 shared (Office).
    - Each row shows fills count, first/last seen, description,
      rego, kind dropdown, notes, Save button.
    - Version footer confirms `paneltec-v58.13.132x`.
- Screenshot at
  `/app/frontend/public/mobile-screenshots/v132x_fuel_cards_admin.png`.

## Rollback

- Remove the route from `App.js` (delete `Route path="fleet/fuel/cards"`).
- Optional: revert the two backend endpoints (delete lines from
  `_FuelCardUpdate` class to EoF in `fleet_fuel.py`).
- Optional: roll CACHE_VERSION back to `.132o` — will force all
  users to re-fetch old cache; not usually desired.
- `fuel_cards` collection can stay in place; the ingest wiring
  from `.132w` still populates it going forward.

## Nice-to-haves deferred (backlog, `.132x-tail`)

- **Nav link** on FuelReporting page top-right pointing to
  `/app/fleet/fuel/cards`. Currently admins must type the URL.
- **Bulk select + bulk-apply** across N rows. Sketched in the
  original brief but not built this batch. Effort: **M**.
- **CSV export** of the fuel_cards table.
- **Row inline "View fills"** link that jumps to
  FuelReporting scoped to this card_number.
- **History panel** showing prior attributions (would require
  a `fuel_card_history` collection or embedded `history[]` on
  the doc).

## User-visible next step

Admin opens `/app/fleet/fuel/cards`, sees the 8 orphan cards,
picks the correct vehicle or worker for each, hits Save. From that
point on all future SmartFill ingests (both CSV and API) auto-attribute
those cards without asking.

## Chain complete

`.132u → .132v → .132w → .132x` — all 4 batches shipped in-order,
no interleaving, all ship memos delivered.
