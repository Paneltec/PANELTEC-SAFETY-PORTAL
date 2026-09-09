# v58.13.132u — SHIPPED (cleanup + fuel-report sort polish)

Status: **shipped, all writes committed, 3/3 pytest passing.**

## Executive summary

- **7 dead form_templates backup collections dropped** (294 rows).
  Pre-flight bson dump preserved at
  `/app/memory/v58_13_132u_preflight_backup/` (chmod 0700 / 0600).
- **Audit correction:** The `vehicles` collection **did not exist**
  — the Rev 2 audit's row #59 was wrong. Nothing to drop there. The
  frontend `LegacyVehiclesRedirect` route at `App.js:288` was the
  false-positive that led me to the wrong conclusion.
- **Fuel Reports sort:** rollup table now defaults to `$/L desc`
  primary + `total_price desc` tiebreaker + null-dpl-sink. Verified
  live via curl — 66 rows, XT02AX ($11,906 · $3.000/L) at top,
  F84KT ($65 · $3.000/L) at bottom (all $/L tied at $3.000/L under
  provisional; tiebreaker doing the work).
- **Top 5 $/L outliers** already sorted `$/L desc` since `.131i` —
  no change needed.
- Version bumps: `RUNNING_VERSION` + `MOBILE_BUNDLE_VERSION`
  `.132t → .132u`. **CACHE_VERSION NOT bumped.**

## Writes

### Drops (destructive Mongo)

| Collection | Rows dropped |
|---|---:|
| `form_templates_backup_v160_1_6` | 27 |
| `form_templates_backup_v160_2_2` | 43 |
| `form_templates_backup_v160_2_3` | 43 |
| `form_templates_backup_v160_2_6cat` | 43 |
| `form_templates_backup_v160_3_0` | 45 |
| `form_templates_backup_v160_3_0_apply` | 48 |
| `form_templates_backup_v160_3_0_ungate_incidents` | 45 |
| **TOTAL** | **294** |

### Left in place (not in this batch's scope)

- `worker_certifications_backup_v160_2_6cleanup` (212 rows) — user's
  brief targeted form-template backups only.
- `user_permissions_backup_v160_2_7` (4 rows) — same.

Recommendation: bundle these two into a follow-up `.132u-tail`
cleanup if user green-lights.

## `vehicles` collection — audit correction

- `db.list_collection_names()` shows **no** collection named
  `vehicles` (and none matching `*vehicle*`).
- `mongodump --collection=vehicles` returned "namespace … does not
  exist".
- Backend code grep for `db.vehicles` / `db['vehicles']` /
  `"vehicles"` returns only:
    - `permissions.py`, `roles_catalogue.py` — permission key
      `vehicles` (the resource token, not a collection). **Kept.**
    - `forms.py`, `assets.py` — form-template shape field
      `vehicles` (a list-of-items on a form doc). **Kept.**
    - `dashboards.py:1034` — `_aggregate_vehicles` module dashboard
      handler. **Kept.**
    - `integrations.py:639` — payload key `vehicles: [...]` in a
      response body. **Kept.**
- None of these refer to a real `db.vehicles` collection. **Zero
  cleanup needed.** Frontend `LegacyVehiclesRedirect` remains as
  a compatibility route for old bookmarks.

## Sort polish (backend-driven)

File: `backend/fleet_fuel_reports.py:206-213`

```python
# v58.13.132u — Default sort: highest $/L first (primary),
# highest total $ as tiebreaker. Rows with a null $/L
# (missing cost data) sink to the bottom.
rows.sort(
    key=lambda r: (
        -(r["dpl"] if r["dpl"] is not None else -1),
        -r["total_price"],
    )
)
```

**Prior:** `rows.sort(key=lambda r: -r["total_price"])` — dollars desc.

**Behaviour now:**
- Rows with genuine per-fill price variance surface highest-$/L
  outliers at top by default.
- Under current provisional state (all rows @ $3.000/L), the
  tiebreak by `total_price desc` degrades gracefully so the sort
  still shows the biggest-spend vehicles at top.
- Once the user's supplier-confirmed prices land via CSV re-upload,
  the sort becomes genuinely useful for procurement.

**Top 5 outliers** at `fleet_fuel_reports.py:210` was already
`(-dpl, date_iso)` — no change.

### Live verification (post-restart)

```
GET /api/fleet/fuel/reports?scope=vehicle&period=monthly
Top 5:
  XT02AX  dpl=$3.0  total_price=$11906.46
  XT16AB  dpl=$3.0  total_price=$10791.42
  XT04CS  dpl=$3.0  total_price=$10318.47
  XT36DO  dpl=$3.0  total_price=$7651.23
  XT35DO  dpl=$3.0  total_price=$7273.23
Bottom 3:
  I73JN   dpl=3.0  total_price=$142.83
  J46QW   dpl=3.0  total_price=$121.80
  F84KT   dpl=3.0  total_price=$64.83
```

## Files touched

| File | Change |
|---|---|
| `backend/fleet_fuel_reports.py` | Rollup sort logic |
| `backend/tests/test_v58_13_132u_cleanup_and_sort.py` | **NEW** — 3 tests, all passing |
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132t → .132u` + ship note block |
| `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` | `.132t → .132u` |
| `/app/memory/v58_13_132u_preflight_backup/` | **NEW** — bson dump of 7 dropped collections + `vehicles` metadata (0 rows) |

## Pytest suite

- File: `backend/tests/test_v58_13_132u_cleanup_and_sort.py`
- Result: **3 passed, 0 failed.**
- Coverage:
    - `test_form_template_backups_dropped` — all 7 target
      collections absent from `list_collection_names()` (idempotency:
      running the drop script again on already-dropped names would
      be a no-op).
    - `test_form_templates_current_untouched` — live
      `form_templates` collection still has ≥100 rows (139 pre-drop).
    - `test_reports_sort_dpl_desc_then_price_then_null_sink` —
      combined sort invariants (dpl desc primary, total_price desc
      tiebreak, null-dpl rows sink to bottom).

## Rollback

### Restore any dropped backup collection

```bash
mongorestore \
  --nsInclude='test_database.form_templates_backup_v160_1_6' \
  /app/memory/v58_13_132u_preflight_backup
```

Repeat for each collection name. Backup files are read-only
(0600) and were dumped in the pre-flight step of this batch.

### Revert sort direction

Replace the `.132u` sort block at `fleet_fuel_reports.py:206-213`
with the prior single line:
`rows.sort(key=lambda r: -r["total_price"])`.

## Deferred / follow-ups

- **`.132u-tail`** — drop `worker_certifications_backup_v160_2_6cleanup`
  (212) + `user_permissions_backup_v160_2_7` (4) if user green-lights.
- **Batch continues:** `.132v` card back-fill next (approved in
  the same green-light).
