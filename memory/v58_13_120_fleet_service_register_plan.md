# v58.13.120 — Fleet & Service Register: rebuild plan

**Status**: Planning. **NO CODE in this memo.**
**Scope**: Full rebuild of the Plant & Vehicles surface into a
single **Fleet & Service Register** page. Option 3 + option C
(trust the data, backfill every rego) from the .120 audit.
**Estimated total effort**: 2–3 weeks across 5 phases.
**Trigger data (live DB at 2026-09-04)**:
- `plant_maintenance.total` = 837
- Distinct regos on `plant_maintenance` = 103
- Distinct regos in `assets` = 76
- Regos in maintenance NOT yet in assets = **54** ← the backfill target
- `assets` kinds: 72 `vehicle`, 14 `plant` (0 trailer, 0 tool, 0 container)
- `plant_maintenance.sub_type` distribution (top): Commercial 539,
  Vac Truck 165, **Trailer 104**, Excavator 22, Road Roller 2,
  Directional Drill 2, Telehandler 1, TMA 1, Passenger 1
- 10 residual TEST-v58.13.14 assets to purge (from `.120` audit)

---

## 1. Preconditions (Phase 1 · v58.13.120a)

Small, mandatory data-hygiene ship. **Runs as an admin-invoked
script pair, NOT wired into any UI flow.** Every operation
carries a matching reverse script bundled in the same PR so any
step can be rolled back cleanly.

### 1a. Purge 10 residual TEST-v58.13.14 assets
- **Forward**: `backend/scripts/purge_test_v58_13_14_leftovers.py`
- **Reverse**: none needed (these are pure seed artefacts with
  zero real dependencies; no reverse script). Deletion is
  auditable via `_ship_v58_13_120a.log` — the script writes
  the deleted set to disk before delete so a human can restore
  from the log if desired.
- **Filter**:
  ```
  name  ~ ^TEST-v58.13.14-
  kind  == "plant"
  status == "retired"
  created_at ∈ [2026-09-04T12:00:00, 2026-09-04T13:00:00]
  ```
- **Expected impact**: 10 `assets` deleted, ~10
  `asset_service_schedules` cascaded, 0 `plant_maintenance` /
  `form_submissions` / `hazards` / `incidents` touched.
- **Dry-run default**: `--commit` required to write. Prints
  what WOULD be deleted otherwise.
- **Broaden `.116` purge filter**: while we're here, patch
  `backend/admin_purge_test_data.py` to match on
  `{$or: [{source: ""}, {source: {$exists: False}}, {source: None}]}`
  so a repeat of the "missing `source` field" escape hatch is
  structurally impossible. UI unchanged.

### 1b. Backfill 54 missing regos into `assets`
- **Forward**: `backend/scripts/backfill_maintenance_regos_v58_13_120.py`
- **Reverse**: `backend/scripts/rollback_backfill_v58_13_120.py`
- **Source tag**: every backfilled row carries
  `source="maintenance_backfill_v58_13_120"` + a
  `backfill_run_id="v58_13_120a-<utc-timestamp>"` so the reverse
  script can hard-scope to just that run.
- **Enrichment logic** (per rego):
  For each of the 54 missing regos, pick the **most recent**
  `plant_maintenance` row (by `date_completed` DESC) and populate:
  ```
  id                = uuid4()
  rego_serial       = <rego>          (uppercase, whitespace-stripped)
  kind              = deduced from sub_type map (see below)
  asset_type        = sub_type from pm row  ("Trailer", "Vac Truck", …)
  make / model      = null (not stored on pm rows)
  manufacturer      = pm.manufacturer   (if present)
  description       = pm.description[:200]
                        (truncated + suffix "(auto from maintenance)")
  source            = "maintenance_backfill_v58_13_120"
  backfill_run_id   = "v58_13_120a-<ts>"
  status            = "active"
  workspace_id      = null
  org_id            = pm.org_id (if present, else null — admin edits later)
  scan_token        = secrets.token_urlsafe(12)
  created_at / updated_at = now
  deleted_at        = null
  ```
- **`sub_type` → `kind` map**:
  ```
  Trailer                → kind="trailer"       (NEW kind — see 1c)
  Vac Truck / Commercial → kind="vehicle"
  Excavator / Telehandler
    / Directional Drill / Road Roller
    / TMA                → kind="plant"
  Passenger              → kind="vehicle"
  <missing>              → kind="vehicle" (safe fallback)
  ```
- **Post-backfill re-link**: after new `assets` are inserted, run a
  pass over `plant_maintenance` mirroring the .109 vacuum's Pass 2:
  where `pm.registration_no` maps to a freshly created asset, set
  `pm.plant_id = <new asset id>` + `pm.registration_matched = true`.
  Rows with the audit stamp `rollback_v58_13_118 = true` get a
  companion stamp `backfill_relink_v58_13_120 = true` so history is
  legible: they went orphan → vacuum-linked (2026-09-04T11:58) →
  rollback-nulled (12:09) → backfill-linked (v58.13.120a).
- **Expected impact**: `assets` grows from 86 → 140 (+54).
  `plant_maintenance` rows with `plant_id != null` moves from 491 →
  ~837 (100% now linked — depending on whether all 346 currently
  null pm rows have a rego).
- **Dry-run default**: `--commit` required. Dry-run prints the
  full 54-row proposal + kind breakdown + a "would relink N pm
  rows" summary.
- **Reverse script**: hard-deletes every asset with
  `backfill_run_id = "v58_13_120a-<ts>"`, then nulls
  `plant_id` on every `plant_maintenance` row carrying the
  `backfill_relink_v58_13_120` stamp. Same enumerate-first-then-
  execute pattern as `rollback_vacuum_orphan_v58_13_118.py`.

### 1c. Schema addition: `kind = "trailer"`
- `assets.kind` today accepts `vehicle | plant | tool | container`
  (see `assets.py` model). Add `trailer` as a fifth value.
- Backend enum update; frontend chip palette gets a new entry
  (colour TBD in Phase 3).
- No migration needed — existing rows all keep their current
  kind; only the backfill writes the new value.

### 1d. Ship gate for Phase 1
- Version bump to `v58.13.120a` across the 3 canonical files.
- Pytests: dry-run source-pin, reverse-script structure pin, kind
  map correctness, .116 filter broadened for the missing-source
  case.
- One live dry-run screenshot posted before any commit.
- User green-light before `--commit`.

---

## 2. Backend design (Fleet & Service Register)

### 2a. Data model

- `assets` collection stays the canonical register. Post-Phase-1
  it contains 140 rows across 5 kinds.
- No schema changes beyond:
  1. `kind` enum gains `"trailer"`.
  2. New optional field `assets.retired_at` (ISO timestamp) so
     retired-vs-active can be surfaced without conflating
     `status="retired"` with `deleted_at`.
- `plant_maintenance` stays as the service-history collection.
  Every row now has a live `plant_id` post-backfill.

### 2b. Endpoints

**New / consolidated:**

| Endpoint | Purpose | Notes |
|---|---|---|
| `GET  /api/fleet/register` | Paginated cross-kind register list | Params: `kind`, `q`, `status`, `page`, `limit`. Server-side search (see 2c). Feature-flagged in Phase 2. |
| `GET  /api/fleet/assets/{id}` | Asset detail + inline service history + counters + Navixy tie-in | Merges the current `/assets/{id}` + `/plant-maintenance?plant_id=` + `/assets/{id}/meter-trends` into one payload. |
| `GET  /api/fleet/search?q=`  | Cross-collection search (assets ∪ plant_maintenance ∪ inspections ∪ hazards ∪ incidents ∪ pre_starts references) | Returns typed results `{type, id, title, subtitle, deep_link}`. Cap 25 hits/type. Uses `_evidence`-style logic from ask.py so we don't reinvent. |
| `POST /api/fleet/assets/{id}/services` | Log a new service on an asset | Thin wrapper over the existing `plant_maintenance` insert path; server sets `plant_id` from URL param, validates rego match, stamps `created_by`. **Reuses** the pm audit path. |
| `GET  /api/fleet/categories` | Live-count breakdown by `kind`/`sub_type`/`status` | Powers left-rail filter tree. Cached 60s. |

**Reused as-is:**
- `POST /api/plant-maintenance/reimport` (XLSX bulk import).
- `POST /api/assets` (manual create).
- `PATCH /api/assets/{id}` (edit).
- `DELETE /api/assets/{id}` (soft-delete).
- `POST /api/assets/{id}/meter-history` (manual meter snapshot).
- Every Navixy sync + trip-summary endpoint.

**Retired at Phase 4 (kept alive during Phase 2-3 for rollback):**
- `GET  /api/plant-maintenance/unmatched` — already dead UI.
- `GET  /api/plant-maintenance/orphan-count` — dead UI, cheap to
  keep; retire only when we're confident.
- `GET  /api/plant-maintenance/grouped` — replaced by the merged
  asset-detail payload.

**Permission model:**
- Reuse existing `assets` and `plant_maintenance` tokens verbatim.
  `fleet.*` routes gate on
  `require_permission("assets", "view" | "edit")` — no new resource
  ID, so `permissions_matrix` stays unchanged.
- Log-service reuses `plant_maintenance.edit`.

### 2c. Cross-collection search

Server-side, powered by a new `_fleet_search(query, org_id)`
helper that runs 5 scoped queries in parallel and aggregates:

- `assets`: regex on `rego_serial | name | make | model | asset_type | sub_type | description | scan_token`.
- `plant_maintenance`: regex on the 10 existing search fields **plus** `manufacturer` and `asset_code` (fix the .120 audit gap).
- `inspections | hazards | incidents | pre_starts`: regex on their `title | description | location` fields, joined on `linked_asset_id` when present.

Result envelope:
```
{ hits: [
    {kind: "asset", id, title, subtitle, deep_link},
    {kind: "service", id, title, ...},
    {kind: "inspection", id, ...},
    ...
  ],
  total_by_kind: {...},
  q: "trailer",
  scoped_to: "org-uuid"
}
```

Index add: `assets.rego_serial` (already indexed) plus a text
index on `assets.name | description | sub_type | make | model`
if regex latency is >150 ms at production scale.

---

## 3. Frontend design (Fleet & Service Register)

### 3a. Sidebar

Retire the current 4-tab "Plant & Vehicles" page. Replace with a
single sidebar entry: **Fleet & Service** → `/app/fleet`.

Old paths stay as HTTP redirects for a grace period:
- `/app/vehicles` → `/app/fleet` (301)
- `/app/vehicles/*` → `/app/fleet/*` (301)

### 3b. Page layout — `/app/fleet`

```
┌────────────────────────────────────────────────────────────┐
│ Fleet & Service Register                       [+ New] ▾   │
│ Cross-register search: search anything…                    │
├──────────────────┬─────────────────────────────────────────┤
│ Filter tree      │ Register table                          │
│                  │ ┌──────────────────────────────────────┐│
│ ▼ Kind           │ │ Rego  Name          Kind  Sub   Last ││
│   ▸ Vehicles 72  │ │─────  ────          ───── ───── ─────││
│   ▸ Plant 14     │ │ Z25NT trailer AXL   trlr  Trlr  27-Aug││
│   ▸ Trailers 22  │ │ …                                    ││
│   ▸ Tools 0      │ └──────────────────────────────────────┘│
│   ▸ Containers 0 │                                         │
│ ▼ Status         │ ← Row click opens right-pane detail →   │
│   ▸ Active 121   │                                         │
│   ▸ Retired 19   │                                         │
│ ▼ Sub-type       │                                         │
│   ▸ Commercial 45│                                         │
│   ▸ Vac Truck 8  │                                         │
│   ▸ Trailer 22   │                                         │
│   …              │                                         │
└──────────────────┴─────────────────────────────────────────┘
```

- **Single primary list**. No tabs. Filter tree replaces the
  category-chip row that only offered flat filtering.
- **Search bar** is always visible top-of-page. Keyboard shortcut:
  `⌘K` / `Ctrl-K`. Uses `/api/fleet/search`; results overlay in a
  dropdown grouped by hit-type (Asset / Service / Inspection /
  Hazard / Incident / Pre-Start). Enter jumps to first hit; each
  hit has its own deep-link (reuses .115 deep-link map).
- **Filter tree** is server-driven (`/api/fleet/categories`).
  Multi-select within a section, AND across sections. State
  persisted per-user in localStorage (never in URL — filter state
  is not shareable UX here).
- **Register table columns** (default order):
  Rego · Name · Kind · Sub-type · Status · Last service · Next due · Actions.
  Row hover reveals `Log Service` and `Open detail` icons.

### 3c. Asset drawer / right pane

Slide-in from right (existing sheet pattern from
`components/ui/sheet.jsx`). Sections in order:

1. **Header** — rego + name + status chip + kind chip + `[Log Service]` primary CTA + `[Edit]` outlined.
2. **Overview** — make, model, year, workspace, org, source, scan_token QR link.
3. **Service history timeline** — reverse-chronological list of every `plant_maintenance` row for this asset. Each row: date, type, cost, performed_by, expandable to full description. Uses the existing `PlantMaintenanceDrawer`-style card as the row item so the .117 print/print-portal work stays reusable.
4. **Live counters + trip summary** — reuses `LiveCountersPanel` from v113 verbatim (Navixy-linked assets only).
5. **Compliance & inspections** — count + latest date for inspections / pre-starts / hazards / incidents that reference this asset.
6. **Notes** — free-form textarea (new field `assets.notes`).

Log Service is the primary CTA. Modal form: date, type (chip picker from live categories), cost, performed_by, description, notes, next-due date. POST to `/api/fleet/assets/{id}/services`. Optimistic append to the timeline on success.

### 3d. What retires

- Every current `/app/vehicles` tab.
- The `PlantMaintenanceTab.jsx` file → renamed / consumed as an
  inner component of the drawer's Service History section.
- The pink "unmatched" / "orphan" concepts already retired in
  `.118a` — nothing new to remove.
- The XLSX importer moves to `/app/settings/imports` as an
  admin-only tool (already flagged in the audit's Option 3).

### 3e. Tie-ins

- **Site Diary / QR / Navixy** untouched at the endpoint level.
  Frontend surfaces re-point to `/api/fleet/assets/{id}` for the
  drawer payload instead of the current split calls.
- Ask Intelligence citations now have a fifth valid deep-link
  target: `asset` → `/app/fleet?open=<id>`. Add to `_DEEP_LINK_TEMPLATES`
  in `backend/ask.py`.
- Scan resolver (`/scan/<token>`) already routes to
  `/app/scan-resolver?token=…` and doesn't need changes;
  the resolver's landing route flips its "open in register"
  button to `/app/fleet?open=<asset id>`.

---

## 4. Phases

### Phase 1 — Preconditions (v58.13.120a, ~3 days)
- **Scope**: sections 1a–1c above. Purge + backfill + `kind=trailer` enum.
- **Acceptance**:
  - Dry-run outputs match expected 10-purge + 54-backfill counts.
  - Live commit yields `assets.count == 140` (86 + 54).
  - Every distinct rego on `plant_maintenance` resolves to an asset.
  - Reverse scripts run cleanly in a scratch DB to zero-shape.
  - Pytests cover forward + reverse + kind-map + widened `.116` filter.
- **Risks**: mis-classified `sub_type → kind` on a rego with
  ambiguous history. Mitigated by the `source` audit tag and the
  reverse script.
- **Rollback**: run `rollback_backfill_v58_13_120.py`. Total time
  under 30 seconds against a 60-row target set.
- **Independently shippable**: yes. New search / new page not
  required — the data-hygiene lands before any UI change.
- **Ship count**: 1 (v58.13.120a).

### Phase 2 — Backend endpoints (v58.13.120b, ~4 days)
- **Scope**: all new `/api/fleet/*` endpoints from section 2b,
  behind a `FLEET_REGISTER_ENABLED` env feature flag (default
  `false`). Existing endpoints untouched.
- **Acceptance**:
  - `GET /api/fleet/register` returns paged results shaped per spec.
  - `GET /api/fleet/assets/{id}` payload merges 3 current calls.
  - `GET /api/fleet/search?q=trailer` returns ≥107 hits across
    `plant_maintenance.sub_type` matches (the audit-baseline number).
  - `POST /api/fleet/assets/{id}/services` writes a
    `plant_maintenance` row + reuses the existing audit path.
  - 60-second cache on `/categories`.
  - Pytests cover happy-path per endpoint + auth gating +
    org-scope + the fleet-search cross-collection shape.
- **Risks**: search-index performance at 800+ row scale
  (regex-heavy). Mitigation: text index at ship time.
- **Rollback**: flip the feature flag off. Endpoints 404 (guarded
  in the router). No data change.
- **Ship count**: 1 (v58.13.120b).

### Phase 3 — Frontend page behind flag (v58.13.120c, ~5 days)
- **Scope**: new `/app/fleet` page rendered ONLY when the
  `FLEET_REGISTER_ENABLED` flag is true. Old `/app/vehicles` stays
  primary. Sidebar carries both entries so admins can preview.
- **Acceptance**:
  - Register + filter tree + search + drawer + log-service modal
    all functional against Phase 2 endpoints.
  - Empty states, keyboard shortcuts, mobile-responsive breakpoint
    per the sketch.
  - Playwright screenshots of 4 flows: search for "trailer",
    filter by trailer kind, open drawer, log a service.
  - Deep-link `?open=<id>` supported via
    `useDeepLinkOpen` hook shipped in `.119`.
- **Risks**: filter-tree UX confusion at 5 kinds × 9 sub-types
  matrix. Mitigation: pre-collapsed by default, only "Kind"
  section expanded initially.
- **Rollback**: flag off → old page primary → new page 404s.
- **Ship count**: 1 (v58.13.120c).

### Phase 4 — Flip + retire (v58.13.120d, ~2 days)
- **Scope**: default the flag to `true`. Add `/app/vehicles → /app/fleet`
  redirects. Ask-Intelligence `asset` deep-link registered. Sidebar
  drops the old entry.
- **Acceptance**:
  - `/app/vehicles` and children all 301 to `/app/fleet`.
  - New sidebar has exactly one Fleet entry.
  - Ask-Intelligence citations of type `asset` produce clickable
    chips landing on `/app/fleet?open=<id>` and open the drawer.
  - Session smoke: log in, search "trailer", open Z25NT drawer,
    log a service, see it in the timeline within one navigation.
- **Risks**: any user with an in-flight browser tab on
  `/app/vehicles/…` refreshes and gets redirected. Toast:
  "This page has moved to Fleet & Service" for the first 2 weeks
  post-flip.
- **Rollback**: flip the flag back to `false`, revert the redirect
  entries.
- **Ship count**: 1 (v58.13.120d).

### Phase 5 — Cleanup (v58.13.120e, ~2 days)
- **Scope**: retire the now-dead
  `GET /plant-maintenance/{unmatched,orphan-count,grouped}`
  endpoints. Delete `PlantMaintenanceTab.jsx` (replaced by
  drawer's Service History section). Move XLSX importer to
  `/app/settings/imports`.
- **Acceptance**:
  - Grep confirms no live import of the deleted file.
  - Old endpoints return 404 / 410.
  - Nothing user-visible changes except the XLSX importer moved.
- **Risks**: a lingering caller — mitigated by the 2-week grace
  period post-Phase 4 during which every retirement is logged
  before deletion.
- **Rollback**: revert the deletion commits. All dead code — no
  DB or user impact.
- **Ship count**: 1 (v58.13.120e).

**Total: 5 ships across ~2.5 weeks.** Every phase reversible,
independently demoable, and never leaves the app in a broken
state between ships.

---

## 5. Open questions

- **Q1 (kind-map ambiguity)**: 539 `plant_maintenance` rows carry
  `sub_type="Commercial"`. Are all of these road vehicles
  (i.e. `kind=vehicle`), or does "Commercial" span both trucks
  and towed equipment? A stray "Commercial trailer" mis-classifies.
  Backfill accuracy depends on your answer.
- **Q2 (Passenger)**: 1 row has `sub_type="Passenger"`. Vehicle
  or plant? Currently defaulting to vehicle.
- **Q3 (org_id scoping)**: several `plant_maintenance` rows have
  no `org_id` at all. Backfill assets from them will also have
  `org_id=null`. Fine for now, or backfill from a session-active
  default org?
- **Q4 (naming)**: "Fleet & Service Register" — happy with the
  name, or prefer "Fleet Register" / "Plant & Fleet" / other?
- **Q5 (retire timeline)**: 2-week grace period between Phase 4
  flip and Phase 5 endpoint deletion — long enough, or shorten
  to 1 week?
- **Q6 (Log Service form)**: which fields are required vs.
  optional? Current `plant_maintenance` has ~20 fields; the
  drawer form should be lean (date, type, cost, description at
  minimum). Confirm shortlist.
- **Q7 (Trailer QR strategy)**: backfilled trailers get a fresh
  `scan_token`. Do you want printed QR labels generated as part
  of Phase 1, or defer to a follow-up admin action once
  trailers are visible in the new register?
- **Q8 (Notes field)**: new `assets.notes` — is per-asset admin
  notes the right level, or per-service-record note (already exists
  on `plant_maintenance`)?
- **Q9 (Compliance section)**: which compliance items surface on
  the asset drawer — registration expiry, insurance, service
  interval, WoF? Not currently modelled; is this a Phase 5
  extension or out-of-scope for this rebuild?

Rules held: no code changes made in this plan. No tester agent.
No mobile code. No comms. No destructive migrations. 20
`ephemeral-upload-storage` warnings still parked for v58.14.x.
