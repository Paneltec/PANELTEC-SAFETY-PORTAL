# v58.13.132di — Perms preview toast + schematic Edit-mode + orphan prune — SHIPPED (finish deferred)

## Item 1 · P1 — Permissions Matrix "Preview as role" 500 toast

### Root cause
`GET /api/mobile/preview-user?scope=external_contractor` returned **HTTP 400** (surfaced by the Expo iframe's error handler as the "500 toast" Stephen described). The FE `MobileModulesSection.computeExpoUrl` shipped `external_contractor` in its `SCOPES` set (all 4 canonical `.132s` role buckets), but the backend's `SCOPE_KEYS` was still the pre-`.132s` triple `{paneltec_civil, viatec_traffic, admin}` — so a `preview_scope=external_contractor` iframe URL made the mobile bundle fetch a preview session that the backend rejected.

Verified via curl BEFORE the fix:
```
scope=external_contractor  HTTP=400  {"detail":"scope must be one of ['admin','paneltec_civil','viatec_traffic']"}
```

### Fix — `backend/mobile_preview.py`
- Added `"external_contractor"` to `SCOPE_KEYS`.
- Added `SCOPE_META["external_contractor"]` with `matches=("contractor",)`. `_resolve_scope_modules` OR-merges every role_id whose lowercase form contains `contractor`, then falls back to the `worker` baseline row when a fresh org has no contractor rows.
- Downstream shim: `effective_role = "admin" if scope == "admin" else "worker"` unchanged — `external_contractor` joins the other two worker-persona scopes and inherits the worker mobile-home tile-grid resolver, which is exactly what Stephen picks External Contractor for in the preview.
- Docstring updated to reference `.132di` and describe why the FE was already sending the 4th scope.

### Verified via curl AFTER the fix
```
scope=paneltec_civil       HTTP=200  role_id=worker  preview=True
scope=viatec_traffic       HTTP=200  role_id=worker  preview=True
scope=admin                HTTP=200  role_id=admin   preview=True
scope=external_contractor  HTTP=200  role_id=worker  preview=True    ← fixed
scope=bogus_scope          HTTP=400  {detail: "scope must be one of [...]"}
```

Frontend: **no changes needed**. The pre-existing `SCOPES` set in `computeExpoUrl` was already correct; the backend just needed to catch up.

## Item 2 · P1 — Program Schematic overlay Edit-mode

Backend CRUD (`.132cr`) was already mounted at `/api/program-schematic/overlays`. Wired the FE.

### `frontend/src/pages/settings/ProgramSchematicPage.jsx`

- **Overlay fetch on mount** — `GET /api/program-schematic/overlays` populates a `{ cluster_key: { node_key: overlay } }` map used for read-time tile styling.
- **Admin gate** — `useCan()('users', 'edit')` mirrors the backend `require_permission("users", "edit")` on the CRUD routes. Non-admins never see the toolbar.
- **Header toolbar** — new pill button `data-testid="schematic-overlay-edit-toggle"` toggles edit mode; when active, a hint reads *"Click K / D / A on any tile to mark it Kept, Dropped, or Added. Changes save immediately."*
- **Per-tile edit-bar** — floating pill under every tile in edit mode with three chips `K / D / A`, each with `data-testid="schematic-tile-status-<node.id>-<kept|dropped|added>"`. Selected status is white-on-black; hover states tinted per-status.
- **Overlay-driven tile styling**
  - `status="dropped"` → faded, `line-through` label, `opacity-50`, click disabled.
  - `status="added"` → emerald ring + emerald-50 bg.
  - `status="kept"` (default) → neutral slate.
  - `data-overlay-status="{status}"` attribute for downstream test coverage.
- **Immediate persistence** — each K/D/A click calls the CRUD endpoint synchronously:
  - `K` (kept, revert to registry default) → `DELETE /overlays/:cluster/:node` (soft delete).
  - `D` / `A` → `PUT /overlays/:cluster/:node` with `{ status }`.
  - Toast confirms each mutation. Errors surface via `apiError(e)`.
- **Nav guard** — while `editMode=true`, `onNavigate` is a no-op so an accidental tile tap doesn't leave the page mid-edit.

### Backend CRUD contract exercised (curl)

```
PUT    /api/program-schematic/overlays/capture/pytest-…   {"status":"dropped"}      → 200
GET    /api/program-schematic/overlays                                                → 200 (grouped)
PUT    /api/program-schematic/overlays/capture/pytest-…   {"status":"added",...}    → 200
DELETE /api/program-schematic/overlays/capture/pytest-…                              → 200 {"deleted":true}
GET    /api/program-schematic/overlays                                                → 200 (row gone)
```

All three routes gated on `users.edit`; matches the FE `useCan` gate.

## Item 3 · P2 — Prune 14 orphaned schematic overlay rows

### Script
`backend/scripts/prune_orphan_schematic_overlays_v58_13_132di.py` — idempotent, soft-delete only. Reads `MONGO_URL` + `DB_NAME` from env (fails fast if either missing). Stamps `deleted_at` + `updated_at` on match; sets `updated_by = "migration:v58.13.132di"` as an audit sentinel.

**Retired cluster keys** (5 total, all removed from the FE registry by the `.132dd` mobile-cluster rebake):
`mobile`, `mobile_home_admin`, `mobile_home_paneltec`, `mobile_home_viatec`, `mobile_modals`.

### Run output (pruned 14 rows)

```
Pruned 14 row(s) (matched=14).
```

Row IDs (all `org_id=3116f250-a4eb-43f3-98a5-2a3656d6cb63`):

| # | id | cluster | node_key | status | label |
|---|---|---|---|---|---|
| 1 | `9ec34a19-e207-4b45-add4-1fb16fc37be3` | mobile | mobile-profile-inductions | kept | My Inductions |
| 2 | `ff73c5a7-4703-4e46-aadf-7485b84f30b1` | mobile | mobile-visitor-step2 | kept | Visitor · Induction |
| 3 | `a8aa782b-e26c-4f5b-bb13-c092dfdbeaf9` | mobile_home_admin | mobile-home-admin-workers | dropped | — |
| 4 | `a691efd9-0d51-45b6-b949-b47fae375884` | mobile_home_admin | mobile-home-admin-sites | dropped | — |
| 5 | `7e784202-a102-4267-8f99-72e4b248c74e` | mobile_home_admin | mobile-home-admin-reports | dropped | — |
| 6 | `de29fee6-ee59-4d12-8bb6-fe6e58b915ec` | mobile_home_admin | mobile-home-admin-fleet | dropped | — |
| 7 | `382300be-6d7e-478c-8a6a-4c36e99d0a8a` | mobile_home_admin | mobile-home-admin-swms | dropped | — |
| 8 | `4938cdff-4312-4b9e-9ea1-2ae0f926f501` | mobile_home_admin | mobile-home-admin-audit | dropped | — |
| 9 | `81535bce-8a6b-4d0d-8874-c462d54badb9` | mobile_home_paneltec | mobile-home-paneltec-swms | dropped | — |
| 10 | `bbecb42d-9594-44c6-b2dd-dcc9aacce4e8` | mobile_home_paneltec | mobile-home-paneltec-hazards | dropped | — |
| 11 | `4ba69d05-cb1f-467a-8c8e-fa276bf57fe2` | mobile_home_viatec | mobile-home-viatec-sitescan | dropped | — |
| 12 | `5c2d6878-026e-46ba-b254-7cafc09b1174` | mobile_home_viatec | mobile-home-viatec-prestarts | kept | — |
| 13 | `e14ba03d-6bb3-4d5a-9841-bfd3dbfd1d1c` | mobile_modals | mobile-modal-signin | dropped | — |
| 14 | `627138b7-5e05-4084-a1b9-d33e0c943252` | mobile_modals | mobile-modal-signout | dropped | — |

Post-run counts (verified by pytest `test_prune_left_zero_live_orphans`):
- **0 live orphans** on retired keys.
- **14 soft-deleted rows** preserved as history.
- Re-running the script prints `Nothing to prune. Exiting cleanly (idempotent).`

## Files touched

- `backend/mobile_preview.py` — SCOPE_KEYS + SCOPE_META updated; docstring.
- `backend/scripts/prune_orphan_schematic_overlays_v58_13_132di.py` — new.
- `frontend/src/pages/settings/ProgramSchematicPage.jsx` — overlay fetch + Edit-mode toolbar + per-tile K/D/A editbar + immediate CRUD persistence + read-time tile styling.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132di`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132di`.
- `backend/tests/test_v58_13_132di_perms_schematic_prune.py` — new (8 tests).

Mobile bundle stays at `.132dc` (Expo specialist is running in parallel per Stephen's brief; commit web with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify` if the pre-commit hook flags it).

## Pytest lock — 8/8 · Combined regression 49/49

```
tests/test_v58_13_132di_perms_schematic_prune.py::test_scope_keys_include_external_contractor      PASSED
tests/test_v58_13_132di_perms_schematic_prune.py::test_preview_user_accepts_all_four_scopes        PASSED  ← curl E2E
tests/test_v58_13_132di_perms_schematic_prune.py::test_preview_user_still_rejects_unknown_scope    PASSED
tests/test_v58_13_132di_perms_schematic_prune.py::test_frontend_overlay_edit_mode_wired            PASSED
tests/test_v58_13_132di_perms_schematic_prune.py::test_overlay_crud_roundtrip_via_api              PASSED  ← curl E2E
tests/test_v58_13_132di_perms_schematic_prune.py::test_prune_script_is_idempotent_and_soft         PASSED
tests/test_v58_13_132di_perms_schematic_prune.py::test_prune_left_zero_live_orphans                PASSED  ← DB E2E
tests/test_v58_13_132di_perms_schematic_prune.py::test_three_way_sync_at_132di_or_later            PASSED
```

Combined suite regression check across the fuel-toggle stack (`.132de → .132di`): **49/49 green**.

## Screenshots

1. **Schematic Edit mode entered** — header shows `Exit edit mode` button + hint. 77 tile edit-bars visible (one per node). Each bar carries three chips `K / D / A`.
2. **Simpro marked dropped** — Simpro tile fades, label struck through, its edit-bar shows the `D` chip highlighted (black background, white text). Toast: *"Marked integrations-simpro as dropped."* Then restored to `K` (kept, DELETE roundtrip) — Simpro tile returns to normal.

Sidebar version pill reads `v160.3.9.58.13.132di`.

## Decisions

- **Per-tile immediate save (no "exit-to-save" queue)** — matches how Stephen already uses the mobile-modules matrix (immediate save on every toggle). Cheaper than reconciliation UX and avoids leaving unsaved state visible when the admin walks away.
- **`K` == DELETE** — the CRUD backend already treats a soft-deleted row as "revert to registry default". No custom "revert" endpoint needed. Keeps FE wire count at 3 verbs (GET/PUT/DELETE).
- **`external_contractor` matches on `"contractor"`** substring — captures every SIMPRO-imported contractor sub-role too (`custom_traffic_contractor` etc.), not just the canonical `external_contractor` row.
- **Migration is soft-delete only** — history preserved for auditability. Re-running prints "0 pruned" without churn. The RETIRED_CLUSTER_KEYS list is code, not data, so future retirements only need a code diff.
- **Admin gate cross-checked on both sides** — FE `useCan()('users','edit')` and backend `require_permission("users","edit")` are the same predicate; non-admins never see the toolbar OR reach the CRUD.

## Non-blockers left in place (per standing directives)

- 20 pre-existing `ephemeral-upload-storage` lints — v58.14.x scope.
- 4 pre-existing `fuel_cards` pytest failures — unrelated data-state drift.
- Mobile bundle stays at `.132dc` (Expo specialist ships separately).

## Ship checklist

- [x] Item 1 backend fix + docstring; curl proof of all 4 scopes returning 200.
- [x] Item 2 FE: overlay fetch, edit-mode toggle, per-tile K/D/A bar wired to CRUD.
- [x] Item 2 admin-gate on both FE + backend.
- [x] Item 3 idempotent soft-delete migration script; run once, printed 14 IDs.
- [x] 3-way web version sync at `.132di`.
- [x] Pytest 8/8 (`.132di`) + 49/49 combined regression.
- [x] Live curl proofs (Item 1 + Item 2 CRUD roundtrip).
- [x] UI screenshots (Item 2 edit mode + dropped state).
- [x] Row-ID audit for Item 3 embedded above.
- [ ] `finish` tool — **deferred per standing directive**.
- [ ] Mobile bundle bump — **Expo specialist owns**.
