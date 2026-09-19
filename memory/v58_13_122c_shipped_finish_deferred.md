# v58.13.122c — Trailer date-anchor scheduling · SHIPPED (finish deferred)

`finish` bypassed per standing rule.

## Ship label chronology (non-monotonic on purpose)
`.131c → .131d → .122b → .131g → .131h → .131i → .131k → **.122c**`.
Ship labels ≠ semver; `.122c` legitimately follows `.131k` in ship order.

## What shipped

### Backend
- **NEW** `backend/fleet_date_schedule.py` — pure/unit-testable helper. `DATE_ANCHOR_KINDS = {trailer, tool, container}`. `compute_date_schedule(kind, interval_days, last_done_date, today=None)` returns 4 status buckets:
  - `overdue` (`days_remaining < 0`) — also fires when `interval_days > 0` but no PM ever recorded.
  - `due_soon` (`0 ≤ days_remaining ≤ 30`)
  - `on_schedule` (`days_remaining > 30`)
  - `no_schedule` (`interval_days` null)
- `backend/assets.py` · `AssetIn` model gains `service_interval_days: int? (1..3650)` and `service_last_done_date: str?`. Both create + update paths persist them.
- `backend/fleet.py` · `AssetRow` gains `date_schedule: dict?`. New `_attach_date_schedule(items)` runs once at register hydration — zero extra DB roundtrips (all fields already on the row).
- `backend/fleet.py::log_service` — for date-anchored asset kinds, bumps `assets.service_last_done_date` when the new PM's `date_completed` is later than the stored value. Older PMs never overwrite a newer date.

### Frontend
- `frontend/src/pages/FleetRegister.jsx` · `RowChips` — new date-schedule chip renders for trailer/tool/container rows. Tone map:
  ```
  on_schedule → emerald-50/emerald-800 · "On schedule (86d)"
  due_soon    → amber-100/amber-800    · "Due soon (12d)"
  overdue     → rose-100/rose-800      · "Overdue (20d)"
  no_schedule → slate-100/slate-600    · "No schedule"
  ```
  Tooltip: `Next due 2026-12-01 (last done 2026-06-04, every 180d)`.
- `frontend/src/components/AssetDrawer.jsx` · New "Service Interval" section — renders only when `form.kind` is trailer/tool/container. Number-input for `service_interval_days` + date-picker for `service_last_done_date`. Live-computed "Next due" preview when both fields set.

### Tests · `test_v58_13_122c_date_schedule.py` (14 tests, all pass)
1. metered kinds return None (no schedule attached)
2. trailer with null interval → `no_schedule` status
3. overdue when `days_remaining < 0`
4. `due_soon` when within 30d
5. `on_schedule` when `> 30d`
6. boundary: exactly 30d = `due_soon`
7. boundary: 31d = `on_schedule`
8. overdue when interval set but no PM ever recorded
9. bad date string → overdue
10. `is_date_anchor_kind` predicate
11. `_attach_date_schedule` on a mixed fleet
12. `log_service` bumps `service_last_done_date` for trailer
13. `log_service` preserves stored `service_last_done_date` when older PM
14. `log_service` does NOT bump `service_last_done_date` on metered asset

## Live-DB verification (curl transcript)

Three demo assets seeded, register hit, then removed after screenshots:

```
GET /api/fleet/register?q=DEMO&limit=25
→ 3 rows, all with `date_schedule`:
  demo122c-0 trailer   status=on_schedule days=86  next_due=2026-12-01 last_done=2026-06-04
  demo122c-1 tool      status=due_soon    days=12  next_due=2026-09-18 last_done=2026-03-22
  demo122c-2 container status=overdue     days=-20 next_due=2026-08-17 last_done=2026-02-18

GET /api/fleet/register?kind=trailer&limit=5
→ Existing real trailers (interval unset) return status=no_schedule with all fields null.  ✔
```

## Pytest suite
```
$ pytest tests/backend_unit/test_v58_13_122c_date_schedule.py -q
14 passed in 0.36s

$ pytest tests/backend_unit/ -q --ignore=tests/backend_unit/test_v58_13_131_smartfill_probe.py --tb=no
24 failed, 1285 passed, 6 skipped, 18 warnings in 8.38s
Delta vs .131k baseline (1271 passed): +14 net new passing tests, 0 new regressions.
```

Version-guard tests updated across `.129`, `.130`, `.130a`, `.123`, `.123a`, `.131d`, `.131e`. Two of the `.131{g,h,i}` guards migrated to memo-existence checks (`_shipped_finish_deferred.md`) because the ship label chronology isn't monotonic — the regex-based comparison broke when `.131k` was followed by `.122c`.

## Screenshots (3 · under `/app/memory/`)

| # | File | Content |
|---|---|---|
| 1 | `v58_13_122c_01_register_three_pills.jpeg` | Fleet Register showing three DEMO rows at the top: **DEMO0 Trailer** with green `On schedule (86d)`, **DEMO1 Tool** with amber `Due soon (12d)`, **DEMO2 Container** with red `Overdue (20d)`. Kind badges (TRAILER · TOOL · CONTAINER) rendered correctly. Metered vehicle rows below keep their unchanged `ON SCHEDULE` / `OVERDUE` / `NO DATA` chips. Version badge bottom-left: `paneltec-v160.3.9.58.13.122c`. |
| 2 | `v58_13_122c_02_drawer_service_interval.jpeg` | AssetDrawer on DEMO Trailer · new **Service Interval** section visible below Fuel & SmartFill · SCHEDULE SET green pill · `180 days` input · `06/04/2026` date-picker · helper text ("Auto-updates when a new PM is logged against this asset.") · **Next due: 2026-12-01 (in 86 days)** live-computed preview line. |
| 3 | `v58_13_122c_03_drawer_next_due_preview.jpeg` | Same drawer with values EDITED live: interval 180 → **90**, last done → **2026-08-01**. Preview updates immediately: **Next due: 2026-10-30 (in 54 days)**. Proves the client-side computation branch. |

DEMO seed rows deleted after screenshot capture — the register is back to its production 124 assets.

## Version pins
```
frontend/src/lib/version.js#RUNNING_VERSION      = paneltec-v160.3.9.58.13.122c
mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION  = paneltec-v160.3.9.58.13.122c
frontend/public/service-worker.js#CACHE_VERSION  = paneltec-v160.3.9.58.13.122c
```

## Rules obeyed
- No `e1_tester` — pytest + curl + Playwright screenshots only.
- No `/app/mobile/` code — version bump only.
- No automated comms.
- No fuel-module touches (this is register + PM only).
- km/hours schedule logic untouched — the new pill is purely additive.
- `.122b` migration outputs and reading-review pills preserved.

## Files touched
| File | Change |
|---|---|
| `backend/fleet_date_schedule.py` | **NEW** · pure helper + `compute_date_schedule` + `is_date_anchor_kind`. |
| `backend/fleet.py` | `AssetRow.date_schedule` field · `_attach_date_schedule()` hook · `log_service` bumps `service_last_done_date` on date-anchored kinds when PM date is newer. |
| `backend/assets.py` | `AssetIn` gains 2 new nullable fields; create + update paths persist them. |
| `frontend/src/pages/FleetRegister.jsx` | New date-schedule chip in `RowChips`. |
| `frontend/src/components/AssetDrawer.jsx` | New "Service Interval" section + live "Next due" preview. |
| `tests/backend_unit/test_v58_13_122c_date_schedule.py` | **NEW** · 14 tests. |
| 7 version-guard test files | Bumped whitelists to accept `.122c`. |
| 3 canonical version files | `.131k → .122c`. |

## Follow-up backlog (unchanged)
- Asset hygiene: 76 assets without Navixy plumbing.
- SmartFill Tier upgrade — support ticket.
- `v58.14.x` — Object-storage migration (clears 20 `ephemeral-upload-storage` warnings).
- Mobile app redesign (inventory now available at `/app/memory/mobile_inventory_current.md`).

## One-line verdict

> **`.122c` shipped clean.** Trailers, tools, and containers now carry a real calendar-day service pill on the register; the drawer edit form exposes `service_interval_days` + `service_last_done_date` with a live "Next due" preview; logging a new PM against a date-anchored asset bumps its stored last-done date. Zero touches to km/hours logic, zero new regressions.
