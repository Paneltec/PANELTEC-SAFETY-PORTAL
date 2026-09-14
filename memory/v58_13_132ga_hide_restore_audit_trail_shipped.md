# v58.13.132ga — Hide/restore audit trail · SHIPPED

Rolls the `.132g9` org-wide hide feature into a full audit trail:
every hide + restore writes an `archive_audit` entry so Stephen has a
paper trail of who took a tile out of the grid (and when it came back).

## Motivation

Stephen: *"Wire hide + restore actions to write an `archive_audit` entry
each time. Fields: `action` (`tile_hidden` | `tile_restored`), `tile_id`,
`tile_name` (denormalised), `actor_id`, `actor_email`, `timestamp`,
`pin_verified: true`."*

Pre-`.132ga`: hide/restore silently mutated `org_url_tiles.hidden` with no
trace. If a tile disappeared org-wide, admins had no way to see who did it.

Post-`.132ga`: the PATCH handler in `org_url_tiles.py` writes a row to the
shared `archive_audit` collection every time the `hidden` field flips.
Idempotent PATCHes (same value twice) do NOT spam the audit log — the row
is only written when `prev_hidden != new_hidden`.

## Schema

Row shape (matches Stephen's brief exactly, plus schema-mirrors for
consistency with the existing helper):

```
{
  "id": <uuid>,
  "module": "org_url_tiles",
  "resource": "org_url_tiles",
  "resource_id": <tile_id>,
  "tile_id": <tile_id>,           # Stephen's requested field name
  "tile_name": "<label at write time>",
  "filename": "<label at write time>",   # legacy schema mirror
  "actor_user_id": <user.id>,
  "actor_id": <user.id>,          # Stephen's requested field name
  "actor_email": "<user.email>",
  "action": "tile_hidden" | "tile_restored",
  "pin_verified": true,
  "batch_id": None,
  "criteria": {},
  "affected_count": 1,
  "reason": None,
  "timestamp": "<iso8601 utc>",
  "org_id": <org.id>,
}
```

`pin_verified: true` is a UX-level attestation — the 3-dots menu and
footer Show-hidden that host these actions are BOTH admin-PIN-gated
(via `.132g6` + `.132g9`), so any real user reaching the PATCH endpoint
has cleared a PIN check. The backend trust boundary itself remains
`_admin(user)` on the PATCH endpoint. Documented in the helper docstring.

## Files touched

### Backend
- `backend/archive_audit_helpers.py`
    - **NEW** `record_tile_visibility_audit()` — best-effort audit writer
      for `tile_hidden` / `tile_restored`. Invalid actions are logged and
      no-op'd; DB failures are swallowed (never blocks the PATCH).
- `backend/org_url_tiles.py`
    - PATCH handler now calls `record_tile_visibility_audit()` when
      `hidden` is in the update AND the value flipped. Uses `doc.get("label")`
      as `tile_name` (denormalised at write time, per Stephen's brief).
    - Import is lazy (function-local) to avoid a top-of-file cycle.

### Version files (3-file bump)
- `frontend/src/lib/version.js#RUNNING_VERSION` →
  `paneltec-v160.3.9.58.13.132ga`
- `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` → same
- `frontend/public/service-worker.js#CACHE_VERSION` → same

### Tests
- **NEW** `backend/tests/test_v58_13_132ga_hide_restore_audit_trail.py`
  (8 tests):
    - Source pins: helper defines `record_tile_visibility_audit` with the
      correct action set, guard, required fields, and `pin_verified: True`.
      Helper is best-effort (try/except/log). PATCH handler imports it,
      guards on `prev != new`, emits the correct action for each direction,
      denormalises `tile_name`.
    - Behavioural: hide writes exactly one `tile_hidden` row with all
      denorm fields populated + `pin_verified: True`; restore writes
      exactly one `tile_restored` row later in time; idempotent PATCH
      does NOT spam the audit log; PATCH that changes only `label` does
      NOT write a visibility audit; version lockstep.
- **NEW** `scripts/verify_132ga.py` — Playwright headed script:
    - Admin hides via 3-dots → PIN → Mongo check for `tile_hidden` row.
    - Admin reveals hidden + restores via 3-dots → PIN → Mongo check for
      `tile_restored` row.
    - Guarded per `memory/test_credentials.md` — NO wrong-PIN attempts
      against Stephen's account.

## Test evidence

### Pytest

```
$ cd backend && python -m pytest tests/test_v58_13_132ga_hide_restore_audit_trail.py -q
8 passed in 4.15s
```

### Playwright verify

```
$ python scripts/verify_132ga.py
seeded tile=0b7793ce-295c-49b4-a09d-b636a9cd4cfc
(info) wrong-PIN branches SKIPPED (Stephen); source pins cover the negatives.

=== v58.13.132ga hide/restore audit-trail verification ===
failures 0
STATUS: PASS
```

Screenshots pushed to `memory/`:
- `v58_13_132ga_01_after_hide.png` — modal after tile hidden via 3-dots.
- `v58_13_132ga_02_after_restore.png` — default view after restore.

### curl smoke (audit collection round-trip)

```
$ TOKEN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"stephen@paneltec.com.au","password":"…"}' | jq -r .access_token)
$ TID=$(curl -s -X POST "$BASE/api/org/url-tiles" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"label":".132ga-smoke","url":"https://example.com/y","icon":"🌐","enabled":true}' | jq -r .id)
$ curl -s -X PATCH "$BASE/api/org/url-tiles/$TID" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"hidden":true}' > /dev/null
# Second identical PATCH — idempotent, must NOT emit second row
$ curl -s -X PATCH "$BASE/api/org/url-tiles/$TID" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"hidden":true}' > /dev/null
# Mongo:
$ mongo test_database --quiet --eval "db.archive_audit.find({resource_id:'$TID'}).count()"
1
$ curl -s -X PATCH "$BASE/api/org/url-tiles/$TID" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"hidden":false}' > /dev/null
$ mongo test_database --quiet --eval "db.archive_audit.find({resource_id:'$TID', action:'tile_restored'}).count()"
1
```

(Actual curls transcribed to pytest bodies — see
`test_hide_writes_tile_hidden_audit_row`, `test_restore_writes_tile_restored_audit_row`,
`test_idempotent_patch_does_not_spam_audit`, `test_non_hidden_patch_does_not_write_visibility_audit`.)

## Standing rules honoured

- No `testing_agent`, no `e1_tester`, no `finish` tool.
- `/app/mobile/` untouched.
- CRA — not Vite.
- 3-web-file version bump (RUNNING_VERSION, EXPECTED_CACHE_VERSION,
  service-worker CACHE_VERSION).
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Playwright wrong-PIN branches SKIP Stephen.
- `ephemeral-upload-storage` — 20 warnings still parked for `v58.14.x`.

## Next ship

`.132gb` — Document Library search (per-folder + global recursive).
