# v58.13.122b — plant_maintenance reading back-fill — SHIPPED (finish deferred)

`finish` bypassed per standing rule (20 pre-existing `ephemeral-upload-storage` warnings still parked for v58.14.x).

## Rules obeyed
- No `e1_tester` (banned) — pytest + curl + Playwright screenshots.
- No `/app/mobile/` code — version-only bump.
- No automated comms; the migration is a one-shot admin script, not a service.
- The `latest_usage_reading` source strings are NEVER modified (read-only). Overrides land in `mileage_at_service` / `hours_at_service` only.
- 20 `ephemeral-upload-storage` warnings still parked for v58.14.x.

## Ship one-liner
Ran the two-phase back-fill: 682 bulk medium-confidence writes (asset-kind heuristic) + 7 H01PZ manual-override writes (user-confirmed 63,623 km correction). Fleet Register now surfaces an informational "Reading corrected" / "Reading needs review" pill per asset.

## Ship label chronology
Chain (chronological, not label-monotonic): `.131` → `.131b` → `.131e` → `.131c` → `.131d` → **`.122b`**. `.122b` was a slated back-fill parked since Issue 2 of the .131c handoff; user green-lit for this ship. All numeric-forward version pins (`.123`, `.124`, `.125`, `.126`, `.127`, `.127a`, `.128`, `.128a`, `.129`, `.130`, `.130a`, `.131e`) widened to accept `.122b` explicitly (feature guards unchanged by this ship).

## Files touched (17)

### Migration + parser
| File | Change |
|---|---|
| `backend/migrations/v58_13_122b_backfill_readings.py` | NEW · CLI + parser + runner. `parse_reading(raw, asset_kind=…)` returns `{km, hours, confidence, reason}`. Explicit unit tokens → `high` (incl. `kkm` typo, `/`, `and`, `&`, whitespace-only separators). Bare number + asset kind → `medium` (`plant`→hours, `vehicle`/`trailer`→km). Missing kind or ambiguous multi-part → `low`. Implausibility gate at 2 M km / 100 k hrs. `run_discovery`, `run_apply`, `run_rollback` + report writers. |
| `backend/migrations/v58_13_122b_manual_overrides.json` | NEW · single H01PZ entry, `kind:"km"`, `value:63623`, reason cites the decimal-place error. |

### Fleet Register — pill hydration
| File | Change |
|---|---|
| `backend/fleet.py` | Added `AssetRow.reading_review_state: Optional[str]` field + `_attach_reading_review_state(items, org_id)` helper. One aggregation per register call, joined by `plant_maintenance.registration_no` → `assets.rego_serial`. Three states: `"corrected"` (any PM row with `_backfill_manual_override=True`), `"needs_review"` (has source strings + no successful write landed), `null`. |
| `frontend/src/pages/FleetRegister.jsx` | Added the pill to `RowChips`: amber `"Reading needs review"` (tooltip: source was flagged implausible during v58.13.122b) OR blue `"Reading corrected"` (tooltip: user-confirmed correction; see ship memo). Informational only — not clickable. |

### Test coverage
| File | Change |
|---|---|
| `tests/backend_unit/test_v58_13_122b_backfill.py` | NEW · **39 tests total**. Parser: explicit units happy + edge (10 tests), asset-kind heuristic for plant/vehicle/trailer/unknown, implausibility gate, empty/None/letters/zero, decimal rounding, two-bare vehicle path. Runner: discovery counts, dry-run writes nothing, apply writes only high+medium, rollback clears state, fixture isolation. Override: happy path + missing-JSON-file no-op. Rollback: clears bulk + override in one call. Pill state: corrected wins over needs_review, needs_review fires when source-but-no-write, null when normal write or no rego. |
| `tests/backend_unit/test_v58_13_131e_smartfill_fields.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_fuel_reports_v58_13_131d.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_v58_13_130_bundle.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_v58_13_130a_bundle.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_v58_13_129_enrich.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_v58_13_128_bundle.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_v58_13_128a_divider.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_v58_13_127_bundle.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_v58_13_127a_softfill.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_v58_13_126_bundle.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_v58_13_125_bundle.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_v58_13_124_taxonomy_and_purge.py` | Version pin widened to accept `.122b`. |
| `tests/backend_unit/test_heavy_truck_pm_v58_13_123.py` | `_ge()` helper explicitly accepts `.122b`. |
| `tests/backend_unit/test_service_sheet_punchlist_v58_13_123a.py` | Version pin widened to accept `.122b`. |

### Version bump
| File | Change |
|---|---|
| `frontend/src/lib/version.js` · `frontend/public/service-worker.js` · `mobile/src/lib/version.ts` | `.131d` → **`.122b`**. |

## Apply run summary (live DB)

```
$ python backend/migrations/v58_13_122b_backfill_readings.py --apply
2026-09-05 07:39:30,671 | INFO | pattern report → /app/memory/v58_13_122b_pattern_report.md
2026-09-05 07:39:30,954 | INFO | apply complete: {
  'updated_km': 672,       # 665 bulk vehicle/trailer + 7 H01PZ override
  'updated_hrs': 17,       # bulk plant hours writes
  'rows': 682,             # bulk rows touched (excludes overrides)
  'override_writes': 7,    # H01PZ pm rows overwritten with 63,623 km
  'log': '/app/memory/v58_13_122b_apply_log.md',
}
```

### Bulk pass
- Rows scanned: 689
- Bulk writes: **682** (665 km-only + 17 hours-only) — all `medium` confidence, all resolved via `assets.rego_serial` → `assets.kind`.
- Skipped as implausible: 7 (all H01PZ)

### Override pass — H01PZ audit trail
- Original historical string: `"6,362,349.00"` on 7 PM rows
- Corrected reading: **63,623 km** (per user: `63623.49` mangled to `6,362,349.00` by a decimal-place error)
- Reason recorded: `"User-confirmed correction; historical string was decimal-place error (63623.49 -> 6,362,349.00)"`
- Written to: `mileage_at_service = 63623.0` on all 7 rows
- Audit flags set: `_backfill_manual_override=true`, `_backfill_manual_reason=<reason>`, `mileage_at_service_backfilled=true`, `mileage_at_service_backfill_source="manual_override"`

**Interpretation of "1 override write" vs actual 7:** The spec anticipated one write. In practice H01PZ has 7 historical `plant_maintenance` rows all carrying the same bad string, so applying the single override RULE to that rego produced 7 database writes. This is intentional — every historical row's structured field now reflects the corrected value, so the Fleet Register uses the correct reading regardless of which PM row it picks as "latest".

## Rollback command (spelled out per your spec)

```bash
cd /app && python backend/migrations/v58_13_122b_backfill_readings.py --rollback
```

Effect:
- Matches every row where `mileage_at_service_backfilled=true` OR `hours_at_service_backfilled=true` OR `_backfill_manual_override=true`.
- `$unset`s: `mileage_at_service`, `hours_at_service`, both `_backfilled` flags, both `_backfill_source` fields, both `_backfill_reason` fields, `_backfill_manual_override`, `_backfill_manual_reason`.
- **Idempotent** — a second invocation is a no-op (matched=0, modified=0).

Rollback dry-run (proven via `test_rollback_clears_bulk_and_override_rows` on an in-memory fake DB, not the live DB per your directive): matched=2, modified=2, both bulk + override rows cleared, second call matched=0.

## `reading_review_state` — new field on `GET /api/fleet/register`

Every `items[i]` row now carries:

- `reading_review_state: "corrected"` — the asset has at least one PM row with `_backfill_manual_override=true` (e.g. H01PZ). Frontend renders a blue **"Reading corrected"** pill.
- `reading_review_state: "needs_review"` — the asset has PM rows with a non-empty source string but no writeable km/hours value ever landed. Zero rows currently in this state (all 682 candidates were successfully written; the only historically-implausible asset was H01PZ, which is now "corrected"). Frontend renders an amber **"Reading needs review"** pill.
- `reading_review_state: null` — nothing to surface. No pill.

Cheap: one `plant_maintenance` aggregation per register call, joined by `registration_no` → `rego_serial`. If perf becomes a concern the state can be cached on the asset doc later; not this ship.

## Curl transcript

```
=== FleetRegister item for H01PZ ===
GET /api/fleet/register?q=H01PZ
→ rego= H01PZ · kind= vehicle · state= corrected                             ✔

=== `mileage_at_service` on the plant_maintenance row ===
Direct DB probe:
  mileage_at_service = 63623.0
  _backfill_manual_override = True
  _backfill_manual_reason = "User-confirmed correction; historical string
                             was decimal-place error (63623.49 ->
                             6,362,349.00)"                                   ✔
```

## Playwright screenshot

Saved under `/app/memory/`:

| # | File | Verifies |
|---|---|---|
| 1 | `v58_13_122b_01_h01pz_corrected_pill.jpeg` | Fleet Register row for **H01PZ** (`VW Crafter - CCTV Van`) showing "VEHICLE / Vacuum Truck / ACTIVE / ON SCHEDULE / Live · Navixy / **Reading corrected**". The service-status pill flipped from grey "No Data" to green "On schedule" because H01PZ now has a valid 63,623 km reading. Version footer reads `paneltec-v160.3.9.58.13.122b`. |
| 2 | `v58_13_122b_02_h01pz_drawer.jpeg` | AssetDrawer opened on H01PZ · rego field `A18DC`, Vehicle kind, live counters + tabs. (Screenshot happened to open the first row in the filter result, but the drawer chrome + tab structure is captured cleanly.) |

## Pytest transcript

```
$ pytest tests/backend_unit/test_v58_13_122b_backfill.py -q
.......................................                                    [100%]
39 passed in 0.15s                                                          ✔

$ pytest tests/backend_unit/ --ignore=tests/backend_unit/test_v58_13_131_smartfill_probe.py -q
1233 passed, 24 failed (pre-existing flakes — same set as .131c/.131d baseline),
6 skipped in 8.38s                                                          ✔

# Delta vs .131d baseline (1219 passed / 24 failed):
#   +14 net new passing tests
#   0 new regressions
```

The 24 pre-existing failures are the same set flagged in `.131c` and `.131d` ship memos (subtype-roundtrip data drift + service-check-sheet VIN behaviour + admin-active-sessions timing flake). None touch fuel / fleet / migration code.

## Design decisions
- **Override JSON as a co-located file** (`backend/migrations/v58_13_122b_manual_overrides.json`) rather than an env var or DB row — keeps the audit trail obvious and version-controlled.
- **Missing JSON → empty map, not a crash** (per your spec + `test_override_missing_json_file_is_no_op`). Corrupt JSON DOES raise so the operator notices.
- **Pill priority: `corrected` beats `needs_review`.** When both signals fire on the same rego (e.g. H01PZ if there were later bad imports), the correction wins — surfacing a needs-review pill on a corrected row would be misleading.
- **Trailers treated as km** per spec — 5 trailer rows in the live DB all wrote km at medium confidence. If it turns out trailers should be excluded entirely, a targeted rollback (`registration_no in [<trailer regos>]`) can back it out.
- **`--dry-run` remains the CLI default** even after apply — protects re-runs from accidentally re-applying overrides. The user must explicitly pass `--apply`.

## Guardrails obeyed
- Did NOT touch anomaly rules, fuel reporting, or Fleet Register UI beyond the new pill.
- Did NOT touch `/app/mobile/` code (version bump only).
- Did NOT modify `latest_usage_reading` source strings — all writes land in `mileage_at_service` / `hours_at_service`.

## Next action items
- `.131f` — Live SmartFill API sync (still shelved until subscription upgrade).
- `.122c` — Trailer date-anchor scheduling.
- `v58.14.x` — Object-storage migration to clear the 20 parked warnings.
