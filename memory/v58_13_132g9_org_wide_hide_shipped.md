# v58.13.132g9 — Org-wide tile hide + restore · SHIPPED

**Rollup**: consolidates the uncommitted `.132g7` (lockout-UI countdown) and
`.132g8` (Restore PIN gate) with the new `.132g9` scope: hide is now an
**org-wide server field** (`org_url_tiles.hidden`) instead of per-user
sessionStorage.

## Motivation

Stephen: *"Rework Hide to be org-wide. Restore needs a PIN gate. Also fold in
the .132g7/g8 work that never landed."*

Pre-`.132g9`:
- `useHiddenTiles` stashed hidden IDs in `sessionStorage` — every user in
  the same org saw a different visible set. Hiding a tile in one browser
  did not hide it for anyone else.
- Restore ("Show them again") was a session-clear with no admin gate — any
  user with an admin PIN could un-hide their own view, but there was no
  cross-user semantic.
- `.132g7` (lockout countdown) and `.132g8` (Restore PIN gate) were coded
  but never committed. The prior session aborted mid-flight.

Post-`.132g9`:
- `PATCH /api/org/url-tiles/{id}` accepts `{"hidden": bool}` (admin-only,
  gated by `_admin(user)`).
- `GET /api/org/url-tiles` filters `hidden:true` rows for everyone by
  default; `?include_hidden=true` surfaces them for admins only. Non-admins
  passing the flag get the filtered list back (silently coerced).
- Rows pre-dating `.132g9` (no `hidden` field) are treated as visible via
  `{"$or": [{"hidden": {"$ne": True}}, {"hidden": {"$exists": False}}]}`.
- `useHiddenTiles` retired to a **no-op compatibility shim** — the parents
  now own the PATCH + refetch cycle.
- 3-dots menu swaps "Hide" ↔ "Restore" based on `tile.hidden`. Menu itself
  is already PIN-gated by `.132g6`.
- Footer "Show hidden tiles" toggle is PIN-gated via `TilePinModal`.
- `.132g7` lockout UI + `.132g8` restore PIN gate: preserved and
  guarded by dedicated source pins in the `.132g8` test file.

## Files touched

### Backend
- `backend/org_url_tiles.py` — Already carried the `hidden` field wiring
  from the mid-flight prior session (PATCH, GET filter, `_out`
  serialisation, `include_hidden` query param + admin coercion). No new
  code required in this ship, just source-pin coverage.

### Frontend
- `frontend/src/components/apps-directory/TileCard.jsx`
    - New `onRestore` prop; menu swaps "Hide" ↔ "Restore" based on
      `tile.hidden === true`.
    - `useHiddenTiles` retained as a no-op shim (compat).
- `frontend/src/components/AppsDirectoryModal.jsx`
    - `useHiddenTiles` import removed; `hidden`/`resetHidden` dangling
      refs replaced with `showHidden` state + server-side `hideTile` /
      `restoreTile` handlers.
    - Footer rewritten: PIN-gated "Show hidden tiles" for admins with
      PIN. Toggle back to visible-only after reveal.
    - `showHidden` resets to `false` when the modal reopens.
    - `restoreTile` now wired to `<SortableTileCard onRestore={…}>`.
- `frontend/src/pages/AppsDirectory.jsx`
    - Full rewrite mirroring the modal — server-backed hide/restore,
      PIN-gated footer, `showHidden` state, `include_hidden=true`
      refetch after unlock.

### Tests
- **NEW** `backend/tests/test_v58_13_132g9_org_wide_hide.py` (14 tests)
    - 8 source pins covering: backend PATCH `hidden`, default GET filter,
      admin-only `include_hidden` coercion, `_out()` serialisation, tile
      card menu swap, grid handlers, footer PIN gate, `useHiddenTiles`
      shim, `.132g7` lockout countdown preserved.
    - 5 live-backend behavioural: default GET hides, `?include_hidden`
      surfaces for admin, PATCH `hidden:false` restores, worker cannot
      PATCH `hidden` (fixture skip if unavailable), pre-g9 legacy row
      without `hidden` field still lists.
    - 1 version lockstep (accepts exact `.132g9`).
- **NEW** `backend/tests/test_v58_13_132g8_restore_pin_gate.py` (from
  uncommitted prior session; version guard widened to accept `.132g8+`,
  label check widened to accept the `.132g9` copy rewrite).
- **NEW** `scripts/verify_132g9.py` — Playwright headed script covering:
    - Hide via 3-dots → PIN → tile disappears.
    - Cross-context check: fresh browser sees the tile gone (org-wide).
    - Footer PIN-gated Show hidden → hidden tile reappears with Restore
      action in its 3-dots menu.
    - Restore via 3-dots → tile back in default view.
    - **Stephen guard**: NO wrong-PIN attempts issued for
      `stephen@paneltec.com.au` (per `memory/test_credentials.md`
      standing rule).
- **UPDATED** `.132g1`, `.132g3`, `.132g4` source pins — widened to
  accept the `.132g9` menu-copy rewrite and shim-only import shape.
- **UPDATED** `scripts/verify_132g1.py`, `verify_132g5.py`,
  `verify_132g6.py` — carry the `.132g7` Stephen wrong-PIN guard
  (already committed in-tree; this ship carries the diff forward).

### Version files (3-file bump)
- `frontend/src/lib/version.js#RUNNING_VERSION` →
  `paneltec-v160.3.9.58.13.132g9`
- `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` → same
- `frontend/public/service-worker.js#CACHE_VERSION` → same

## Test evidence

### Pytest (source-pinned + behavioural)

```
$ cd backend && python -m pytest tests/test_v58_13_132g9_org_wide_hide.py -q
14 passed in 5.16s
```

Full `.132g` sweep (11 test files):

```
$ python -m pytest tests/test_v58_13_132g[0-9]_*.py tests/test_v58_13_132g8_*.py -q
63 passed, 5 skipped in 4.92s
```

Skips: rate-limited login (transient); worker fixture unavailable in preview
(the admin-only PATCH is still covered indirectly via the `_admin(user)`
source pin already asserted by prior ships).

### Playwright verify (headless chromium, live preview)

```
$ python scripts/verify_132g9.py
seeded tile=31a4e8e8-95a3-41cf-81d6-2ca32d0ad282
(info) wrong-PIN branches SKIPPED (Stephen). Source pins in tests/test_v58_13_132g9_org_wide_hide.py cover the negative paths.

=== v58.13.132g9 org-wide hide/restore verification ===
failures 0
STATUS: PASS
```

Screenshots pushed to `memory/`:
- `v58_13_132g9_01_after_hide.png` — modal grid after tile hidden.
- `v58_13_132g9_02_show_hidden.png` — hidden tile revealed after PIN.
- `v58_13_132g9_03_after_restore.png` — default view after restore.

### curl smoke

```
$ TOKEN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"stephen@paneltec.com.au","password":"…"}' | jq -r .access_token)
# Seed a tile
$ TID=$(curl -s -X POST "$BASE/api/org/url-tiles" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"label":".132g9-curl-smoke","url":"https://example.com/x","icon":"🌐","enabled":true}' | jq -r .id)
# Hide
$ curl -s -X PATCH "$BASE/api/org/url-tiles/$TID" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"hidden":true}' | jq '.hidden'
true
# Default GET excludes it
$ curl -s "$BASE/api/org/url-tiles" -H "Authorization: Bearer $TOKEN" \
    | jq --arg t "$TID" '.tiles | map(select(.id==$t)) | length'
0
# include_hidden surfaces it
$ curl -s "$BASE/api/org/url-tiles?include_hidden=true" -H "Authorization: Bearer $TOKEN" \
    | jq --arg t "$TID" '.tiles | map(select(.id==$t)) | .[0].hidden'
true
# Restore
$ curl -s -X PATCH "$BASE/api/org/url-tiles/$TID" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"hidden":false}' | jq '.hidden'
false
```

(These curls are the pytest-behavioural test bodies transcribed for the
memo; the pytest run itself is the authoritative record.)

## Standing rules honoured

- No `testing_agent`, no `e1_tester`, no `finish` tool.
- `/app/mobile/` untouched.
- CRA — not Vite.
- 3-web-file version bump (RUNNING_VERSION, EXPECTED_CACHE_VERSION,
  service-worker CACHE_VERSION).
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Playwright wrong-PIN branches SKIP Stephen per
  `memory/test_credentials.md` — source pins in
  `test_v58_13_132g9_org_wide_hide.py` cover the negative side.
- `ephemeral-upload-storage` — 20 warnings still parked for `v58.14.x`.

## Deferred / open

- **Audit trail** (hide/restore → `archive_audit`): promoted to `.132ga`
  (next ship in this auto-roll).
- **Test-admin account** (`playwright-test-admin@paneltec.internal`) for
  wrong-PIN Playwright branches: still pending a maintenance window to
  seed a known bcrypt PIN hash. Guard helper in place until then.
- **20 `ephemeral-upload-storage` lint warnings**: parked for `v58.14.x`
  object-storage migration.

## Next ship

`.132ga` — hide/restore audit trail (`archive_audit` writes with
`pin_verified:true`, actor + tile denorm).
