# v58.13.132fa — Shipped, `finish` deferred

**Status**: shipped. `finish` **NOT** invoked (Stephen's standing
directive: `finish` / `e1_tester` are banned for this program; ship
memos live in `/app/memory/` and reply-in-chat).

**Scope in one line**: cosmetic + copy pass on top of `.132ez`.
Positive-framing rewrite ("Restrict" → "Approve") across every
admin surface, plus an inline approved-users chip row under each
restricted tile in the Manage Tiles table so admins can see who
has access at a glance without opening the editor.

**No backend schema / API contract change.** Field remains
`allowed_user_ids`; endpoints, response shapes, behaviour all
unchanged from `.132ez`.

## Wording changes (before / after)

### Manage Tiles editor (`TileEditor` in `QuickLinksSection.jsx`)
| Location | Before | After |
| --- | --- | --- |
| Toggle label | `Restrict access to specific users` | `Approved users only` |
| Toggle helper | `When off, every user in your organisation sees this tile.` | `When ON, only the users you tick below can see this tile. When OFF, everyone sees it (public).` |
| Picker sub-heading | — (didn't exist) | `Approved users` |
| Picker hint | `Only ticked users will see this tile. If you want yourself to see it, tick your own name.` | `Tick everyone who should have access. Include yourself if you want to see the tile.` |
| Selected count | `N selected` | `N approved` (relocated next to the sub-heading) |

### Manage Tiles table pill (`TileRow` in `QuickLinksSection.jsx`)
| Before | After |
| --- | --- |
| `[Lock icon] Restricted` | `[Lock icon] Approved · N users` |

Testid `apps-directory-row-restricted-{tile.id}` preserved for
backwards-compat with earlier ships' source-pins.

### Permissions page panel (`UserApprovedTilesPanel` in `UsersManagement.jsx`)
| Location | Before | After |
| --- | --- | --- |
| Panel intro copy | `Restrict Apps Directory tiles to this user. Public tiles are visible to everyone.` | `Tick the tiles this user should see. Public tiles are visible to everyone.` |
| Restricted-tile pill | `Restricted` | `Approved` |
| Public-tile tooltip | `Every user sees this tile — restrict it on the tile itself to change` | `Every user sees this tile — turn on 'Approved users only' on the tile itself to change` |

### Tile grid tooltip (already positive)
| String | Status |
| --- | --- |
| `Not approved — ask an admin` | Unchanged from `.132ez`. |

## Inline approved-users chip row (Manage Tiles table)

Under each **restricted** tile row (i.e. `allowed_user_ids.length > 0`),
`TileRow` renders a second `<tr>` with a `colSpan={7}` cell
containing:

- An `Approved users` label + up to 6 chip pills (alphabetically
  sorted by name).
- Chips carry the user's display name + a small violet `admin` tag
  when applicable.
- Overflow beyond 6 → clickable `+N more` inline expander that
  renders the full list in-place (no modal, no route change).
- Public tiles render NO second row (nothing to list).
- Names hydrate from a **manager-scope cache** of
  `GET /api/org/url-tiles/eligible-users` — one request per open of
  the Manage view, not one-per-tile. Names fall back to the raw
  8-char ID prefix while the cache is still loading (non-blocking).

Testids:
- `apps-directory-row-approved-users-{tile.id}` — the second row.
- `apps-directory-row-approved-users-list-{tile.id}` — the chip
  container.
- `apps-directory-row-approved-chip-{tile.id}-{user.id}` — each chip.
- `apps-directory-row-approved-more-{tile.id}` — overflow button.

## Files touched

### Frontend
- `frontend/src/components/QuickLinksSection.jsx`
  - `AppsDirectoryManager` — added `usersById` state + effect that
    fetches `/eligible-users` at mount and hydrates the map.
  - `TileRow` — accepts `usersById` prop, computes `restricted`
    local, renders new pill copy, and appends a second `<tr>` with
    the alphabetically-sorted chip strip when restricted.
  - `TileEditor` — toggle label + helper + picker heading + hint
    all rewritten to positive framing. Selected-count relocated
    into the picker sub-heading row.
- `frontend/src/pages/UsersManagement.jsx`
  - `UserApprovedTilesPanel` — intro copy + restricted-pill text +
    public-tile tooltip rewritten to positive framing.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fa`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132fa`.

### Tests
- `backend/tests/test_v58_13_132fa_approve_wording.py` — new, 7
  tests (see below).
- `backend/tests/test_v58_13_132ey_tile_acl.py` — two source-pins
  refreshed:
  - `test_frontend_editor_has_access_section` — helper copy pin
    updated to the new "Approved users only" / "Tick everyone…"
    strings.
  - `test_frontend_manage_row_shows_lock_badge_when_restricted` —
    predicate pin updated (`Array.isArray(...) && ....length > 0`
    → `const restricted = allowed.length > 0`).

## Pytest results

### `.132fa` new suite — **7 / 7 passing**
`backend/tests/test_v58_13_132fa_approve_wording.py`
- `test_tile_editor_uses_positive_wording` — new copy strings
  present.
- `test_tile_row_pill_reads_approved_n_users` — pill now reads
  `Approved · {allowed.length} user…`; testid preserved for
  backwards-compat.
- `test_permissions_panel_uses_positive_wording` — panel intro
  rewritten; restricted-pill body reads `Approved`; old
  `Restricted` pill absent from the panel scope.
- `test_old_restrict_wording_removed_from_editor` — every user-
  visible "restrict" phrase from `.132ey` is gone. Variable names
  like `restrict`/`setRestrict` in code are not asserted — those
  are internal.
- `test_manage_table_has_inline_approved_users_row` — manager
  hydrates `usersById`, `TileRow` receives the prop, chip strip
  testids present, sorted `a.name.localeCompare(b.name)`, +N-more
  overflow wired.
- `test_backend_contract_unchanged_from_132ez` — live-API smoke
  proves `allowed_user_ids` + `approved_for_me` on tiles and
  `{id,name,email,is_admin}` on eligible-users still hold.
- `test_version_pinned_to_132fa_or_higher`.

### Combined `.132e* + .132f*` smoke — **296 passed, 79 skipped, 1 pre-existing failure**
`pytest -k "132e or 132f" --tb=line`
- Pre-existing failure: `test_v58_13_132ek_zebra_and_login_polish.py::test_incidents_opts_in_to_zebra`
  — same `\bzebra\b` word-boundary bug carried forward from
  `.132ex` / `.132ey` / `.132ez`. Not touched by this ship.

## Version bumps
- `RUNNING_VERSION` **v58.13.132ez → v58.13.132fa** ✓
- `EXPECTED_CACHE_VERSION` **v58.13.132ez → v58.13.132fa** ✓
- Service Worker `CACHE_VERSION` **v58.13.132ez → v58.13.132fa** ✓
- Mobile bundle NOT bumped (web-only ship;
  `MOBILE_VERSION_SYNC_OPTIONAL=true --no-verify`).

## Design decisions

- **Eligible-users cache lives at the manager scope.** Fetching
  per-tile (or per-row-render) would be N+1. One fetch on manager
  open covers every chip lookup; the map stays warm until the
  admin closes the Manage view.
- **Chip cache falls back to raw ID prefix**, not a spinner.
  Non-blocking: the table renders instantly, chip labels re-render
  in-place once the eligible-users response lands. Better UX than
  a loading state on a cosmetic strip.
- **Testid `apps-directory-row-restricted-{id}` preserved** on the
  new pill even though the visible copy is now "Approved · N
  users". Renaming would have cascaded through `.132ey`'s
  source-pins for no gain — the testid is an implementation detail.
- **Chip cap = 6, expand inline.** Modal would have been overkill
  for a name list. `+N more` follows the same pattern used in
  other capture-record chip strips across the app.
- **Panel restricted-pill re-labelled to "Approved"** (not "Not
  public" or "Custom") — matches the tile-editor toggle language
  so admins learn one word.

## Acceptance criteria
1. Manage Tiles editor:
   - Toggle label reads "Approved users only". ✓
   - Helper reads the new "When ON… When OFF…" copy. ✓
   - Picker heading reads "Approved users" + tick-yourself hint. ✓
2. Manage Tiles list view:
   - Restricted tile → amber "Approved · N users" pill with lock
     icon. ✓
   - Below the row, alphabetical chip strip renders. ✓
   - Public tile → no pill, no chip row. ✓
3. Permissions page → user → "Paneltec Group · Apps Directory ·
   Approved tiles" panel — no "restrict" copy remains. ✓
4. Tile grid greyed-out behaviour from `.132ez` unchanged. ✓
5. New `.132fa` pytests pass; combined smoke shows no new
   regressions beyond the pre-existing `.132ek` zebra. ✓
6. Version bumped `.132fa` in all 3 web files; commit succeeds. ✓
7. Ship memo written; reply-in-chat (no `finish`). ✓

## Deferred / follow-ups
- **Mobile parity** — Expo delegate to mirror the new wording +
  chip strip if / when the mobile Apps Directory ships.
- **Pre-existing `.132ek` zebra source-pin failure** — still on
  the standalone follow-up list.

## Known outstanding (unchanged from `.132ez`)
- Phase B of Workspaces/Sites merge (`.132cb-b`).
- Medium/large PIN provisioning admin surface.
- `.132cv` / `.132dc` Expo tasks — mobile specialist.
- Playwright screenshot flakiness — pytest source-pins remain the
  gating evidence.

## Rules honoured this ship
- **NO** `finish`.
- **NO** `e1_tester`.
- **NO** edits under `/app/mobile/`.
- **NO** rewrite of `/app/frontend/` to Vite — CRA production shell
  preserved.
- Commit uses `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify`.
- English-only chat replies.
- No backend schema / API changes.
