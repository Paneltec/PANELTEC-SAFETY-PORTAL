# v58.13.132z — SHIPPED (dead-code sweep)

Status: **shipped, 44/45 pytest passing (1 known cross-suite loop
clash — passes in isolation).**

## Executive summary

- **3 frontend routes deleted**: `/signup`, `/app/vehicles`,
  `/app/contractors-legacy`. Plus the `Signup.jsx` component file
  (67 LOC) and the `LegacyVehiclesRedirect` component (~40 LOC).
- **1 DB collection dropped**: `_civil_health_probe` (0 rows).
- **2 collections kept** that the audit had flagged for drop —
  grep evidence revealed live consumers:
    - `audit_log` (singular) — used by `ask.py` for Ask AI Q&A
      audit trail (4 refs).
    - `bulk_import_dryrun` — written by `bulk_import_prestarts.py`
      during dry-run mode; cleaned by `backup_service.py`
      at 30 days.
- No CACHE_VERSION / MOBILE_BUNDLE_VERSION bump this batch.

## Grep evidence (drop / keep decisions)

### Kept — `audit_log` singular

```
backend/ask.py:158   await db.audit_log.insert_one(...)
backend/ask.py:274   async for r in db.audit_log.find(...)
backend/ask.py:304   await db.audit_log.update_one(...)
backend/ask.py:464   db.audit_log.find({...}).sort(...)
```

**Verdict: KEEP.** Live consumer. Zero rows because Ask AI is a
low-usage feature (9 lifetime `ai_usage` rows).

### Kept — `bulk_import_dryrun`

```
backend/bulk_import_prestarts.py    (writer during --dry-run mode)
backend/backup_service.py:546       (30-day cleanup of stale rows)
```

**Verdict: KEEP.** Live writer + cleanup path. Zero rows because
no dry-run imports have been executed in the last 30 days.

### Dropped — `_civil_health_probe`

```
grep -rnE "_civil_health_probe" /app/backend /app/frontend/src → 0 hits
```

**Verdict: DROP.** No writer, no reader, 0 rows. Confirmed removed:
`db.list_collection_names()` no longer contains it.

## Frontend deletions

### `/signup` — dead route

- `frontend/src/pages/Signup.jsx` — **DELETED** (67 LOC).
- `frontend/src/App.js` — import removed, `<Route path="/signup">`
  removed.
- `frontend/src/pages/Login.jsx` — "No account yet? Start your free
  trial" link removed. Onboarding now flows exclusively via
  admin-invite → set-password OR Simpro sync + QR sign-on.
- Backend `POST /users` already returns HTTP 410 Gone — left as-is
  (defensive).

Grep sweep confirmed no other inbound references (only the version.js
audit note, which stays).

### `/app/vehicles` + `/app/vehicles/*` — legacy redirect

- `LegacyVehiclesRedirect` component (~40 LOC) — **DELETED**.
- Both `<Route path="vehicles">` and `<Route path="vehicles/*">`
  deleted.
- **Note**: `App.js` had a prior policy comment "retained
  INDEFINITELY (user policy call — old bookmarks)". Superseded by
  the 2026-09-07 user directive. Old bookmarks now 404; the toast
  window `TOAST_EXPIRES_AT` was already expired anyway.

### `/app/contractors-legacy` — duplicate alias

- Single-line `<Route path="contractors-legacy" element={<ContractorsList />} />`
  deleted. `/app/contractors` remains and is unchanged.

## DB deletions

| Collection | Rows | Action |
|---|---:|---|
| `_civil_health_probe` | 0 | **DROPPED** |
| `audit_log` (singular) | 0 | **kept** (live consumer: `ask.py`) |
| `bulk_import_dryrun` | 0 | **kept** (live consumer: bulk-import + backup-cleanup) |

Pre-flight `mongodump` bson dumped all 3 metadata files to
`/app/memory/v58_13_132z_preflight_backup/` (0-row backups —
metadata only). Directory `chmod 0700`, files `chmod 0600`.

## Files touched

| File | Change | LOC delta |
|---|---|---:|
| `frontend/src/pages/Signup.jsx` | **DELETED** | −67 |
| `frontend/src/App.js` | 3 route + 1 component + 2 imports removed | −45 |
| `frontend/src/pages/Login.jsx` | "Start your free trial" link removed | −5 |
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132y → .132z` + ship-note block | +30 |

**Net LOC: −87 lines removed.**

## Pytest suite

Ran all `.132u` → `.132y` test files together:
- **44 passed, 1 failed, 2 warnings.**
- Failure: `test_v58_13_132w_ingest_wiring.py::test_resolve_asset_all_branches`.
- **In isolation this test passes** (`pytest tests/test_v58_13_132w_ingest_wiring.py -q` → 1 passed).
- Cause: known pytest-asyncio + Motor module-singleton event-loop
  clash — the `_resolve_asset` helper uses the module-level `db` in
  `fleet_fuel.py`, which binds to whichever loop first touches it.
  Prior test files' loops close before this test's loop opens.
- **Not a regression from this batch.** No fuel/roles/cards logic
  was touched.

Recommended follow-up (out of scope for `.132z`): add a session-scoped
`event_loop` fixture in `conftest.py` OR migrate Motor tests to
`pytest-mongo` fixtures. **P3** cleanup.

## Rollback

### Restore `_civil_health_probe` collection

```bash
mongorestore --nsInclude='test_database._civil_health_probe' \
  /app/memory/v58_13_132z_preflight_backup
```

### Restore Signup / LegacyVehiclesRedirect

Git revert this commit — the deletions are file-level so a single
revert restores everything, including the Login page link.

## Chain complete — proceeding to `.132aa`

Continuing to `.132aa` diagnosis (daily_job_assignments empty)
per your instruction. Diagnosis-first, fix only if root cause is
trivial.
