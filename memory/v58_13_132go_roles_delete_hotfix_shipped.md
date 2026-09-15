# v58.13.132go — Custom Roles delete "no-op" hotfix · SHIPPED

## Root cause (backend, not frontend)

Stephen's screenshot showed the trash button on `/app/settings/roles`
doing nothing. Frontend code inspection cleared the FE — every path
was wired correctly:

* `RolesAdmin.jsx:476` → `onClick={() => onDelete(r)}` opens the
  confirm modal (`setConfirmDelete(r)`).
* `RolesAdmin.jsx:331` → confirm modal's "Delete" button calls
  `doDelete()`.
* `RolesAdmin.jsx:115` → `await api.delete('/admin/roles/${role_id}')`
  then `await load()`.

**The bug lived in the backend list endpoint.** `roles_catalogue.py:435`
was:

```python
docs = await db.roles.find({}, {"_id": 0}).sort("role_id", 1).to_list(200)
```

No filter on `deleted_at`. Meanwhile the DELETE handler at line 685
does a soft-delete:

```python
{"$set": {"is_active": False, "deleted_at": now, "updated_at": now}}
```

So the DELETE succeeded (HTTP 200 · `{"deleted": true, "soft": true}`)
but the immediate `await load()` refetched the SAME rows with
`deleted_at` set — the FE couldn't tell soft-deleted from live rows,
and the trash icon appeared decorative because the row stayed put.

Curl reproduction, before fix:

```
POST /api/admin/roles       → 201 · role_id: custom_go_hotfix_probe
DELETE /api/admin/roles/…   → 200 · {"deleted":true,"soft":true}
GET /api/admin/roles        → count: 7, role STILL present     ← bug
```

## Fix — one-line filter

`backend/roles_catalogue.py:435`:

```python
docs = await db.roles.find(
    {"$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
    {"_id": 0},
).sort("role_id", 1).to_list(200)
```

`$or` covers both new writes (which explicitly set `deleted_at: null`
at create time) and legacy pre-migration rows that never had the
field at all.

## Verification

### Curl (end-to-end after fix)
```
POST /api/admin/roles      → 201 · role_id: custom_go_hotfix_e2e
GET  /api/admin/roles      → count: 7 · new role present
DELETE /api/admin/roles/…  → 200 · {"deleted":true,"soft":true}
GET  /api/admin/roles      → count: 6 · new role GONE           ← fixed
```

Also swept the stale probe from before the fix
(`custom_go_hotfix_probe`) — final count settled at **6** live
roles (7 minus the two test rows).

### Pytest
```
$ pytest backend/tests/test_v58_13_132go_roles_soft_delete_filter.py -q
3 passed in 6.08s
```

Covers:
1. Backend source pin — new `$or` filter present, old un-filtered
   `find({}, ...)` call gone.
2. Behavioural — POST → GET (present) → DELETE 200/deleted:true →
   GET (absent) → count decrement by exactly 1.
3. Version lockstep across 3 web files.

### Playwright note
Backend end-to-end flow already proven via curl; the FE code path
was already correct (verified by source inspection). Skipping
Playwright for this hotfix — the fix is a one-line server filter,
and adding a browser-driven test on top of the curl round-trip
that already proves count decrement would be pure ceremony.

## Files changed
```
backend/roles_catalogue.py                              +12 −2  (list filter)
frontend/src/lib/version.js                             × 2 version bump
frontend/public/service-worker.js                       CACHE_VERSION bump
backend/tests/test_v58_13_132go_roles_soft_delete_filter.py  NEW 55 lines
memory/v58_13_132go_roles_delete_hotfix_shipped.md      NEW (this)
```

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester`.
* `/app/mobile/` untouched.
* CRA — no Vite.
* Version bump → `paneltec-v160.3.9.58.13.132go`.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Message for Stephen

Hard-refresh once `.132go` is live and the two test roles will drop
off the Custom Roles list. New deletes will now vanish from the UI
immediately (they always did on the backend — the list just wasn't
filtering them out).
