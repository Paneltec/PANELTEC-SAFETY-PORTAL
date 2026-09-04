# v58.13.118 (REVISED) — Shipped · finish-deferred (lint bypass)

## Why this memo exists
`finish` tool pre-completion lint check flags 20 pre-existing
`ephemeral-upload-storage` violations across 15 backend files. All 20
predate the .118 work — same set parked in every ship memo since
.111. User directive: **defer to v58.14.x object-storage migration.**
This memo bypasses the pre-completion block per the standard
`memory/v58_13_xxx_shipped_finish_deferred.md` handover pattern.

## Ship contents
### 1. Backend rollback (executed LIVE)
- New: `/app/backend/scripts/rollback_vacuum_orphan_v58_13_118.py`.
- Enumerated 60 phantom assets across 3 accidental run_ids:
    - `orphan-vac-20260904T115850` → 54 assets
    - `orphan-vac-20260904T120333` → 3 assets
    - `orphan-vac-20260904T120340` → 3 assets
  (User quoted "54 assets" — that's the first run only; two
  subsequent partial re-runs before the argparse guard landed added
  6 more when the drift map re-fired.)
- Enumerated 346 linked `plant_maintenance` rows.
- Time-window guard (2026-09-04T11:00 .. 13:00 UTC) verified every
  target — passed.
- Executed live:
  - **BEFORE**: `assets_backfill=60, pm_total=837,
    pm_with_plant_id=837, pm_registration_matched_true=346`
  - **AFTER**:  `assets_backfill=0,  pm_total=837,
    pm_with_plant_id=491, pm_registration_matched_true=0`
- Idempotent — a second run finds nothing to do, exits 0.
- Rollback stamped `rollback_v58_13_118=True` +
  `rollback_v58_13_118_at=<iso>` on every nulled row for the audit
  trail.

### 2. Vacuum argparse safety (was in aborted .118, retested)
`vacuum_orphan_maintenance_v58_13_109.py` now defaults to dry-run.
`--commit` required to write. `--dry-run` accepted as no-op for
back-compat wrappers.

### 3. Frontend — matched/unmatched UI concept retired
- `pages/PlantMaintenanceTab.jsx`: removed the entire "Match state"
  secondary chip row (container + toggle + all per-filter testids).
  Category chip row intact.
- `components/vehicles/PlantMaintenanceDrawer.jsx`: removed the
  amber "Missing asset link" pill, the amber "Reconcile — coming in
  v58.13.118a" body banner, the `const unmatched = !row.plant_id`
  gate, and the now-unused `Info` + `ExternalLink` lucide imports.
  Null `plant_id` renders `—` in both the drawer body and the
  printable card.

### 4. Pytests (56 pass, backend suite regression-free)
- REWRITTEN `test_pm_rename_and_orphan_count_v58_13_118.py`
  (15 checks) — locks the .118-REVISED contract:
    - Chip-row removal source-pin
    - Drawer pill + banner removal source-pin
    - Rollback script shape + behavioural round-trip + window-guard
      abort test
    - Vacuum default-dry-run source-pin + live-invocation test
- UPDATED `test_plant_maintenance_restructure_v58_13_117.py` +
  `test_taxonomy_reconciliation_v58_13_100.py` — flipped the
  present-chip pins to absence pins, per the retired contract.

### 5. Version bump
Already at `paneltec-v160.3.9.58.13.118` across all three canonical
files (bumped in the aborted .118 pass, verified via
`test_version_bumps_meet_118`):
- `frontend/src/lib/version.js#RUNNING_VERSION` — added a REVISED
  changelog block at the top of file describing the rollback +
  UI-retirement scope.
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` — no code
  changes, version-string only.
- `frontend/public/service-worker.js#CACHE_VERSION` — no code
  changes, version-string only.

## Deliberately NOT changed
- `GET /api/plant-maintenance/orphan-count` — kept per user
  directive. Zero UI surface today, cheap query, useful for future
  admin-only data-hygiene tooling.
- Import-result toast strings (`Matched: X, unmatched: Y`) — those
  are legitimate backend response fields, unrelated to the retired
  UI concept.
- `PlantChip` ⚠ variant, pink "⚠ N unmatched regos" toolbar toggle
  + drill-down panel, "Unknown vehicles" section of grouped view —
  these are data-quality flags for the underlying XLSX import, not
  the retired categorisation concept. Flagged in the changelog for
  a future scrub if the user wants them removed too.
- `/app/mobile/` code (per absolute rule).
- The 20 `ephemeral-upload-storage` warnings (deferred to v58.14.x
  per user directive).

## Deployment gate
Manual pytest + curl + rollback-log verification is the tester of
record. Automated `testing_agent` intentionally skipped per absolute
user rule.

## Ship signed
2026-09-04 — v58.13.118 (revised)
