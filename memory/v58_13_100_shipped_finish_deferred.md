# v58.13.100 — Shipped (finish tool deferred)

**Status**: SHIPPED. `finish` tool deferred under the standing Option A
directive (platform lint gate still blocks on the 20 pre-existing
`ephemeral-upload-storage` warnings — those are parked for v58.14.x
object-storage migration, per user's cumulative direction across
.88 / .99 close-outs).
**Date**: 2026-09-04.
**Environment executed**: PREVIEW. Prod execution deferred to the
user's next Re-publish window (the reconciliation script is
idempotent and org-blind, safe to run against prod's larger dataset
with the same `--dry-run` → `--commit` sequence).

## Ship scope delivered

Single-topic ship: **Asset taxonomy reconciliation — `kind` is the
source of truth. Frontend tab count filtered. Maintenance chip labels
de-ambiguated.**

## Item 1 — Data reconciliation (executed on preview)

### Pre-migration state (preview, at ship-time)
Grew from 246 → 287 live assets since the .97 audit.

| Field slice | Count | Status |
|---|---:|---|
| Total live assets (`deleted_at=None`) | 287 | — |
| `kind='vehicle'` | 72 | ✅ ground truth (matches user's mental model) |
| `kind='plant'` | 215 | ✅ |
| `kind='plant'` AND `asset_type='vehicle'` | **209** | ❌ **reconciliation target** |
| `kind='vehicle'` AND `asset_type ∈ {ute, other, vacuum_truck, tipper, service_truck, crane_truck}` | 72 | ✅ already valid |
| `kind='plant'` AND `asset_type ∈ {excavator, compactor}` | 6 | ✅ already valid |

### Reconciliation script
`/app/backend/scripts/analysis/reconcile_asset_taxonomy_v58_13_100.py`

Rule table (`VALID_BY_KIND`) — encodes the set of `asset_type` values
that are semantically valid for each `kind`:

| kind | Valid `asset_type` values |
|---|---|
| `vehicle` | `vacuum_truck` · `tipper` · `dump_truck` · `semi_trailer` · `ute` · `crane_truck` · `service_truck` · `trailer` · `other` · `vehicle` |
| `plant` | `excavator` · `loader` · `bulldozer` · `grader` · `compactor` · `skid_steer` · `backhoe` · `generator` · `pump` · `compressor` · `lighting_tower` · `other` · `plant` |
| `tool` | `tool` · `other` |
| `container` | `container` · `other` |

Each set includes its own kind literal + `other` as a universal
fallback so `asset_type = kind` (the post-reconciliation state) is
valid — the invariant `is_valid(kind, kind) == True` holds for every
kind. Pytest-anchored.

Modes:
- `--dry-run` — snapshot + per-bucket count print, no writes.
- `--commit` — snapshot as `committed_at`, update the docs, re-scan
  and assert zero remaining mismatches (belt-and-braces invariant).

Idempotent: a second `--commit` run against a clean DB finds zero
mismatches and no-ops. Marker guard on `reconciliation_v58_13_100`
prevents double-stamping.

### Preview execution log

```
$ python scripts/analysis/reconcile_asset_taxonomy_v58_13_100.py --dry-run
[reconcile v58.13.100] found 209 mismatched asset rows
  · kind='plant'  previous asset_type='vehicle'  n=209
[reconcile v58.13.100] dry-run snapshot: /app/memory/asset_taxonomy_reconciliation_v58_13_100.json

$ python scripts/analysis/reconcile_asset_taxonomy_v58_13_100.py --commit
[reconcile v58.13.100] found 209 mismatched asset rows
  · kind='plant'  previous asset_type='vehicle'  n=209
[reconcile v58.13.100] committed — 209 docs updated
[reconcile v58.13.100] post-commit invariant verified (0 mismatches)

$ python scripts/analysis/reconcile_asset_taxonomy_v58_13_100.py --commit   # rerun
[reconcile v58.13.100] found 0 mismatched asset rows
[reconcile v58.13.100] nothing to do — invariant already holds
```

### Post-migration DB state (preview)

| Field slice | Count | Note |
|---|---:|---|
| Total live | 287 | unchanged |
| `kind='vehicle'` | 72 | unchanged |
| `kind='plant'` | 215 | unchanged |
| `kind!='vehicle'` AND `asset_type='vehicle'` (orphan) | **0** | was 209 |
| `asset_type='plant'` | **209** | was 0 (created by reconciliation) |
| Rows carrying `reconciliation_v58_13_100` marker | **209** | one per reconciled row |

### Rollback breadcrumb

Full pre-migration state snapshotted to
`/app/memory/asset_taxonomy_reconciliation_v58_13_100.json` — id,
org_id, kind, asset_type, name, rego_serial, updated_at for every
affected row + the exact rule table used. Snapshot payload also
carries `committed_at` so a re-run can distinguish "never run" from
"already committed".

To reverse: iterate `rows[]`, restore each `asset_type` to its
snapshot value, `$unset` the `reconciliation_v58_13_100` marker.

## Item 2 — Frontend fixes

### `frontend/src/pages/PlantVehicles.jsx`

**Bug**: Tab 3 badge labelled "Vehicles from Navixy" showed 287 (or
246 pre-.100) — the entire assets collection — instead of just the
72 vehicles. The tab underlying list respects the user's kind-chip
selection, but the BADGE on a vehicle-labelled tab should
semantically be a vehicle count.

**Fix** (single line, line 497):

```diff
-  {assets.length}
+  {assets.filter((a) => a.kind === 'vehicle').length}
```

Rendering matrix now:
- Chip='All' → badge shows 72 (was 287) ✅
- Chip='Vehicles' → badge shows 72 (unchanged) ✅
- Chip='Plant' → badge shows 0 (semantically correct — no vehicles in a plant-only view)

testid `vehicles-tab-list-count` preserved.

### `frontend/src/pages/PlantMaintenanceTab.jsx`

**Bug**: Chip labels `All (837)` · `Matched (491)` · `Unmatched (346)`
were being misread — user reported "another unmatched (491)" because
the parenthesised form scans like a mathematical annotation.

**Fix** (chip config, lines 116-118):

```diff
-  { k: 'all', label: `All (${items.length})` },
-  { k: 'matched', label: `Matched (${items.length - unmatched.total_unmatched_rows})` },
-  { k: 'unmatched', label: `Unmatched (${unmatched.total_unmatched_rows})` },
+  { k: 'all', label: `All: ${items.length}` },
+  { k: 'matched', label: `Matched: ${items.length - unmatched.total_unmatched_rows}` },
+  { k: 'unmatched', label: `Unmatched: ${unmatched.total_unmatched_rows}` },
```

Numbers unchanged; colon-form reads unambiguously as "of this kind:
this many rows". testids `pm-filter-{all|matched|unmatched}`
preserved so any prior smoke / e2e coverage keeps working.

## Item 3 — Backend endpoint consistency (verified, no writes)

Grep sweep confirmed vehicle-count logic already sources from
`kind == 'vehicle'` everywhere:

- `assets.py::list_assets` — `kind` and `asset_type` are independent
  query params; server never hardcodes `asset_type='vehicle'`.
- `asset_service.py:464` — form-recommendation branch reads
  `kind == 'vehicle'`.
- `migrate_seed_form_applies_to.py` — `applies_to` seed uses
  `kinds: ['vehicle']`.

No mutation shipped. Pytest source-scan enforces the invariant so
any future endpoint that HARDCODES an `asset_type='vehicle'` filter
for vehicle-scoped logic fails CI immediately.

## Item 4 — Version bumps (all 3 canonical strings)

- `frontend/src/lib/version.js#RUNNING_VERSION` → `paneltec-v160.3.9.58.13.100` (+ full changelog block prepended)
- `frontend/public/service-worker.js#CACHE_VERSION` → `paneltec-v160.3.9.58.13.100`
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` → `paneltec-v160.3.9.58.13.100`

## Tests

NEW `tests/backend_unit/test_taxonomy_reconciliation_v58_13_100.py`:
21 source-pin tests across script structure, snapshot artifact,
frontend wire-in, backend consistency, and version-sync ≥ 100.

**Full pytest suite: 626 passed, 1 skipped, 0 regressions**
(was 605 pre-ship — .99 baseline. Delta +21 matches the new tests
exactly.) Webpack: compiled with 110 pre-existing warnings, none
from touched files.

## Explicit non-changes (per user's constraints)

- ❌ **NO new asset records** for the ~104 orphan maintenance regos.
  User explicitly reserved that decision (needs rego validation +
  Simpro dedup + policy call).
- ❌ **NO writes to `plant_maintenance`** collection. Untouched.
- ❌ **NO changes to Simpro/Navixy sync**. Untouched.
- ❌ **NO changes to `AssetType` enum** in `backend/assets.py`. The
  enum only validates INBOUND API payloads; `asset_type='plant'` is
  a legitimate DB value that renders as "Plant" via the existing
  `type_label = (asset_type or '—').replace('_', ' ').title()`
  helper. Adding `'plant'` to the enum literal would ripple to
  every create/patch call site.
- ❌ **NO `/app/mobile/` code changes** (only `MOBILE_BUNDLE_VERSION`
  bumped).
- ❌ **NO scope creep** into the 20 pre-existing
  `ephemeral-upload-storage` lint warnings (still parked for
  v58.14.x).

## Screenshot description (per user's ask, no image asset shipped)

Once the user hits `/app/vehicles` on prod post-Re-publish:

- **Tabs row** (top): `All Maintenance` · `Unmatched` (with rose
  badge showing 346 on prod) · `Vehicles from Navixy` (with EMERALD
  badge now showing **72**, was 246) · `Dashboard` · `Service Inbox`.
- **All Maintenance sub-tab, filter chip row**:
  `All: 837` · `Matched: 491` · `Unmatched: 346` (colon-form, not
  parens). Same numbers as before.
- **Ambient count** at the right end of the toolbar (line 150-153 of
  PlantMaintenanceTab.jsx) unchanged — `N of M maintenance records`.

## Rollout plan

- **PREVIEW**: reconciliation already committed (209 docs). Frontend
  hot-reload picks up the JSX changes. SW cache version rolled to
  `.100` — next full page load serves the fresh bundle. No backend
  restart needed (script is standalone; no server.py edits).
- **PROD**: user Re-publishes when ready. Same three canonical
  strings go live. Then run the reconciliation script against prod
  with the same `--dry-run` → `--commit` sequence. Expected prod
  count: similar-order-of-magnitude (audit noted preview reproduces
  prod 1:1). Prod snapshot will be written to the same
  `/app/memory/…_v58_13_100.json` file (overwrites preview's — copy
  aside first if preview snapshot needs archiving).

## Roadmap items still queued

- **P1**: Wire `comms_safe_mode.edit` grant/revoke into the Users &
  Permissions matrix UI checkbox.
- **P1**: (New from this ship's discovery) Decide whether to create
  the ~104 missing asset records to vacuum the 346 orphan
  maintenance rows. Needs rego dedup pass and Simpro cross-check.
- **P2**: `TEST_MODE_BYPASS_RATE_LIMIT` env toggle for pytest.
- **P2**: `frontend/scripts/check-routes.js` compile-time guard for
  `<Link to>` paths.
- **P2**: Relabel/change behaviour of "Clear Blocked Outbox" button
  (F4 from the .97 audit).
- **P3**: Rename `plant_maintenance.registration_matched` →
  `rego_serial_captured` (F1 from the .97 audit).
- **Future**: v58.14.x object-storage migration — clears the 20
  blocking `ephemeral-upload-storage` warnings, unblocks the
  `finish` tool.
