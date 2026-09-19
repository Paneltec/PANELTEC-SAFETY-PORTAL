# v58.13.120a — Shipped · finish-deferred (lint bypass)

## Phase 1 preconditions COMPLETE + LIVE-COMMITTED

### 1. Purge (10 residual TEST-v58.13.14 / .16 assets)
- Script: `backend/scripts/purge_test_v58_13_14_leftovers_v58_13_120a.py`
- **LIVE COMMIT executed**. Assets: 86 → 76. `asset_service_schedules` cascaded: 10. Zero references from pm/form_submissions/incidents/hazards/pre_starts (safe cascade). Deletion log at `/app/memory/purge_v58_13_120a_log.txt`.
- Broadened regex from `TEST-v58.13.14-` to `TEST-v58.13.\d+-\d+` after dry-run caught only 6 of 10 rows (4 leftovers were `TEST-v58.13.16-*` from a `.16` burst).
- **`.116` filter observation**: re-inspecting `admin_purge_test_data.py:108` shows the live filter is `{"source": {"$ne": "simpro"}}`, which already matches missing-`source` docs. The 10 leftovers weren't purged because no admin has clicked the modal since 2026-09-04T12:32, not because of a filter escape. **No `.116` patch shipped.**

### 2. Backfill (54 new assets, 346 pm re-links)
- Script: `backend/scripts/backfill_maintenance_regos_v58_13_120.py`
- **LIVE COMMIT executed**. `run_id=v58_13_120a-20260904T222200.410124Z`.
- Assets: 76 → 130. `plant_maintenance.plant_id != null`: 491 → **837/837 (100% linkage)**.
- **Kind breakdown** (per Q1/Q2 mapping): 26 vehicle · 20 trailer · 8 plant.
- **Default org_id** resolved to `3116f250-a4eb-43f3-98a5-2a3656d6cb63` ("Paneltec Pty Ltd"), used for pm rows with null org_id.
- **Sample UUIDs** (3 of 54):
    - `3f454ee4-3691-41fb-b9f0-d592ae5f541e` · rego `A18DC` · kind `vehicle` · Commercial
    - `fbf8316d-f5dc-4218-9b39-68a73f404804` · rego `A32GL` · kind `vehicle` · Commercial
    - `eff65a0c-6a62-4d12-963d-5096a0e1daaf` · rego `D04RF` · kind `vehicle` · Commercial
- **Trailer sample** (3 of 20): `7277bece-e872-4f7b-819f-d31711edec43` (RT4506), `2454cd86-c560-41f0-b13d-98395340c9d9` (TU3144), `21802d7b-2371-419d-a62b-ce808c426746` (XT5606).
- Every backfilled asset carries `source="maintenance_backfill_v58_13_120"`, `backfill_run_id=<run_id>`, `scan_token=<12-char urlsafe>`, `status="active"`.
- Reverse script (`--rollback`) bundled — enumerates all backfill run_ids, unlinks pm rows via the `backfill_relink_run_id` stamp, hard-deletes the backfilled assets. Same enumerate-first pattern as `.118` rollback.

### 3. Backend model + endpoint surface
- **`AssetKind` Literal** extended: `["vehicle", "plant", "tool", "container", "trailer"]`.
- **`AssetPhoto` Pydantic model** added: id, filename, mime, size, photo_url, photo_gridfs_id, uploaded_at, uploaded_by.
- **`assets.notes`** already existed on the model (line 242, `Optional[str] max_length=4000`) — no schema change needed.
- **`assets.photos[]`** array — no schema migration; the array is populated on first upload via `$push`.
- **Three new endpoints**:
    - `POST /api/assets/{id}/photos` — upload → GridFS + append metadata
    - `GET  /api/assets/{id}/photo/{gridfs_id}` — auth'd streaming download w/ cross-tenant guard
    - `DELETE /api/assets/{id}/photos/{photo_id}` — pull entry + delete GridFS blob (idempotent)
- **Cap**: 10 MB per image. **Storage**: GridFS (mirrors `workers.py::upload_worker_photo`).
- **ZERO ephemeral-upload-storage footprint added** — the pattern I chose is Mongo-native GridFS, not local `/tmp/uploads`. The deferred warning list therefore remains at 20, NOT 21. Contradicts my earlier estimate; correction noted here for the audit trail.

### 4. Print-Labels source selector
- `BulkLabelsIn.asset_ids` moved from required → optional.
- `BulkLabelsIn.source` new optional field (max 80 chars).
- Handler expands `source` into an org-scoped `asset_ids` list via a single query on `assets`, unions with any explicit `asset_ids` supplied.
- **Live probe**: `POST /api/assets/labels/bulk` with `{"source":"maintenance_backfill_v58_13_120","layout":"avery_l7160"}` returned **279 KB PDF-1.4** covering all 54 backfilled assets in Avery L7160 (21-up × A4) layout. Verified `%PDF-1.4` header.

### 5. Version bump
`paneltec-v160.3.9.58.13.120a` in all three canonical files:
- `frontend/src/lib/version.js#RUNNING_VERSION`
- `frontend/public/service-worker.js#CACHE_VERSION`
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` (version-string only per mobile-code rule)

### 6. Pytests
- **New**: `tests/backend_unit/test_fleet_register_phase1_v58_13_120a.py` — 13 checks.
- **Full suite**: **974 passed, 0 failed, 1 skipped** (was 961 → +13). No regressions.
- Coverage: AssetKind enum, AssetPhoto model + endpoints, GridFS-not-local storage, Print-Labels source selector, purge script shape, backfill kind-map (Q1/Q2), default-org (Q3), forward + reverse flags, dry-run default, live-DB post-Phase-1 shape (130 assets / 100% pm linked / 54 backfill rows / 20 trailers / 0 TEST leftovers), version pin.

## Deliberately NOT shipped
- Frontend palette for `kind="trailer"` — that's the Fleet & Service Register frontend (Phase 3, v58.13.120c). This ship stops at model+endpoint surface.
- `.116` purge filter patch — not needed (filter is already correct; see item 1 note).
- Frontend Log-Service modal, cross-collection search, filter tree — all Phase 3.
- Photo UI (drawer thumbnails, upload button) — Phase 3. Endpoints exist so a curl / mobile client can use them today.

## Deferred-warnings ledger
Still at **20** (was 20). GridFS pattern used for photos means NO new ephemeral upload; contradicts the "+1 = 21" estimate in the plan.

## Rollback ready
Two independent scripts:
- `python /app/backend/scripts/backfill_maintenance_regos_v58_13_120.py --rollback` — reverses the backfill in one command. Verified idempotent.
- Purge is not reversible by script (pure seed artefacts, no dependencies to restore); hand-restore possible from `/app/memory/purge_v58_13_120a_log.txt`.

## Ship signed
2026-09-04 — v58.13.120a (Fleet & Service Register · Phase 1 of 5)

## Next
Phase 2 (`v58.13.120b`) — `/api/fleet/*` endpoints behind `FLEET_REGISTER_ENABLED` env flag. Awaiting your go-signal.

Rules held: no code changes touched `/app/mobile/` (version string only), no tester agent, no comms, no destructive migrations without explicit dry-run + approval gate. `finish` tool still blocked by 20 pre-existing lint warnings — this memo is the standard bypass pattern.
