# v58.13.132bs — Bulk anomaly actions on Fuel Anomaly Inbox

**Status:** SHIPPED · finish tool deferred.
**Version pins:** RUNNING_VERSION / EXPECTED_CACHE_VERSION / SW CACHE_VERSION → `paneltec-v160.3.9.58.13.132bs`.

## USER PAIN
1,400+ open fuel anomalies. Single-row Resolve/Dismiss is too slow for a real bulk sweep. Admin needs to blast through in batches — resolve, dismiss, or attribute a whole selection to a vehicle at once.

## Files changed
| File | Change |
|---|---|
| `backend/fleet_fuel.py` | 4 new endpoints: `bulk-resolve`, `bulk-dismiss`, `bulk-attribute`, `bulk-reopen`. Shared `_bulk_flip` helper for resolve/dismiss. Max-batch guard at 500 txn_ids per call. Same `assets.edit` gate as single-row endpoints. |
| `frontend/src/pages/FuelAnomalyInbox.jsx` | Multi-select state (Set of txn_ids). Header + per-row checkboxes. Sticky slate-900 bulk action bar with emerald Resolve / slate Dismiss / indigo Attribute / outline Clear. Selection auto-clears on Status tab change and after any bulk action succeeds. Undo toast on resolve/dismiss (5s window, `POST /bulk-reopen`). New `BulkAttributeModal` component reusing `/fleet/register` search. |
| `frontend/src/lib/version.js` + SW | Version bump. |
| `backend/tests/test_v58_13_132bs_bulk_anomaly_actions.py` | **NEW** — 15 pytests. |

## Endpoint contracts

### `POST /api/fleet/fuel/anomalies/bulk-resolve`
```
Body:  { "txn_ids": ["...", ...] }
200 →  { "resolved": N, "flags_resolved": M, "failed": [{txn_id, reason}, ...] }
400 →  empty txn_ids | batch > 500
403 →  assets.edit gate
```
Resolves EVERY currently-open flag on EVERY listed txn. Rows with no open flags land in `failed` with reason `"no open flags"`. Unknown txn_ids land in `failed` with reason `"not found"`.

### `POST /api/fleet/fuel/anomalies/bulk-dismiss`
Mirror of bulk-resolve; response field `dismissed` / `flags_dismissed`.

### `POST /api/fleet/fuel/anomalies/bulk-attribute`
```
Body:  { "txn_ids": ["...", ...], "vehicle_id": "..." }
200 →  { "attributed": N, "no_change": K, "failed": [...],
         "vehicle_id": "...", "vehicle_rego": "XT36DO" }
400 →  empty txn_ids | batch > 500 | empty vehicle_id
404 →  vehicle_id not found in org
```
Writes `asset_id`, `match_status=manual`, `matched_by`, `matched_at`, and snapshots the previous `asset_id` into `prior_asset_id_pre_bulk_attribute` so a future attribute-undo has a restore path. Idempotent — txns already pointing at the requested vehicle land in `no_change`.

### `POST /api/fleet/fuel/anomalies/bulk-reopen`
```
Body:  { "txn_ids": ["...", ...] }
200 →  { "reopened": N, "flags_reopened": M, "failed": [...] }
```
Undo for bulk-resolve + bulk-dismiss. Clears `resolved_at`/`resolved_by`/`resolved_action`/`resolved_note`/`resolution_reason`/`resolution_kind`/`dismissed_at` on every flag of every listed txn. Rows with no resolved flags land in `failed` with reason `"no resolved flags"`.

## Frontend UX

- **Per-row checkbox** (testid: `fuel-anomaly-select-<txn_id>`) prepends every row when `canEdit`.
- **Select-all** (testid: `fuel-anomaly-select-all`) toggles all currently-visible rows (page + `q`-filter aware). NOT the entire 1,400+ dataset.
- **Sticky bulk bar** (testid: `fuel-anomaly-bulk-bar`) mounts only when ≥1 row selected. `top-2 z-20 rounded-2xl border border-slate-900 bg-slate-900 text-white shadow-lg`.
- **Undo toast**: 5s Sonner toast with an emerald pill `Undo` action that hits `bulk-reopen` and reloads. Bulk-attribute uses a plain success toast (no undo — irreversible per single click).
- **Auto-deselect on tab change**: `useEffect(() => setSelected(new Set()), [status])`.

## Pytest
```
============================== 15 passed in ~3s ================================
```
Covers: happy paths, DB verification, empty body 400, > 500 400, unknown vehicle 404, empty vehicle 400, mixed real+fake ids (real succeed, fake in `failed`), reopen reverses resolve, bulk-attribute idempotency (no_change branch), frontend source pins (checkboxes, bulk bar, modal, endpoint calls, tab-change reset), version bump.

## Screenshots
- `/app/memory/v58_13_132bs_01_bulk_bar.jpeg` — 3 rows selected, sticky slate-900 bulk bar with `3 transactions selected` + emerald/slate/indigo/outline buttons.
- `/app/memory/v58_13_132bs_02_bulk_attribute_modal.jpeg` — Indigo `Attribute {count} to a vehicle` modal with fleet-register search.
- `/app/memory/v58_13_132bs_03_bulk_resolve_undo_toast.jpeg` — `✓ Resolved · 2 transactions` toast with emerald `Undo` action.

Live console:
```
select-all present: True
row checkboxes visible: 50
bulk bar shown after selecting: True
bulk count text: '3 transactions selected'
bulk-attribute modal shown: True
bulk-resolve Undo action visible: True
```

## NOT changed
- No hard deletes of `fuel_transactions` — every operation is field-level on `anomaly_flags` or a pointer update on `asset_id`.
- No `/app/mobile/` code touched.
- `metro.config.js` untouched.
- `assets.edit` permission gate reused verbatim from `_flip_anomaly`.
- No comms/emails/SMS wiring.
