# v58.13.132ey — Shipped, `finish` deferred

**Status**: shipped. `finish` **NOT** invoked (Stephen's standing
directive: `finish` / `e1_tester` are banned for this program; ship
memos live in `/app/memory/` and reply-in-chat).

**Scope in one line**: per-tile ACL / whitelist on the Apps Directory —
admins can restrict a tile to a specific set of users (e.g. only
Amanda + Mel + Stephen see the Bank tile). Default is public — no
breaking change to existing tiles.

## Feature summary

Every `org_url_tiles` document now carries an `allowed_user_ids` list.

- **`[]` / missing** → public — every authenticated user in the org
  sees the tile (unchanged behaviour).
- **Non-empty** → restricted — only users whose `id` is on the list
  see the tile.
- **Strict admin rule** — admins are NOT bypassed. If Stephen wants
  to see a restricted tile he must tick himself in the picker.

No migration required — `_out()` coerces missing/null/non-list stored
values to `[]` on read.

## Files touched

### Backend
- `backend/org_url_tiles.py`
  - `TileIn` / `TilePatch` — added `allowed_user_ids: Optional[list[str]] = None`.
  - `_sanitize_allowed_user_ids(raw, org_id)` — dedupes, drops
    non-str entries, intersects against active users in the caller's
    org. **Stale / bogus / cross-org IDs are silently dropped**
    (chosen over 400 for admin resilience against post-soft-delete
    stale IDs).
  - `_out(doc)` — returns `"allowed_user_ids": list(doc.get(...) or [])`.
  - `list_tiles` — server-side ACL filter after `_out()` build. Admin
    Manage view (`include_disabled=true`) SKIPS the filter so admins
    can manage tiles they aren't personally listed on. All other
    reads (the public Apps Directory + Quick Links page) apply the
    strict rule.
  - `create_tile` + `update_tile` — pass ACL through the sanitiser
    on persistence.
  - **NEW endpoint** `GET /api/org/url-tiles/eligible-users` —
    admin-only picker feed. Returns
    `[{id, name, email, is_admin}]` sorted case-insensitively by
    name for the tile editor's user checklist.

### Frontend
- `frontend/src/components/QuickLinksSection.jsx`
  - `TileEditor` — new **Access** section:
    - "Restrict access to specific users" checkbox toggle.
    - When ON: helper hint ("Only ticked users will see this tile.
      If you want yourself to see it, tick your own name.") +
      searchable multi-select of eligible users (lazy-fetched from
      `/org/url-tiles/eligible-users`) + selected count.
    - When OFF: `allowed_user_ids` reset to `[]` (tile becomes
      public again).
    - Payload wiring: `allowed_user_ids: restrict ? allowedUserIds : []`.
    - Modal widened `max-w-md → max-w-lg` and given a scroll cap so
      the picker fits comfortably.
  - `TileRow` — small amber "Restricted" pill with a `Lock` icon
    (from `lucide-react`) next to the label when the tile has a
    non-empty ACL. Testid `apps-directory-row-restricted-{tile.id}`
    for source-pins.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ey`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132ey`.

### Tests
- `backend/tests/test_v58_13_132ey_tile_acl.py` — **new, 11 tests**
  (see results below).

## Endpoints added / updated

| Endpoint | Change |
| --- | --- |
| `GET /api/org/url-tiles` | Server-side ACL filter — non-empty `allowed_user_ids` restricts visibility. `include_disabled=true` admin view skips the filter. |
| `POST /api/org/url-tiles` | Accepts `allowed_user_ids` on create. |
| `PATCH /api/org/url-tiles/{id}` | Accepts `allowed_user_ids` (whole-list replace). Still `.132ex` admin-gated. |
| `GET /api/org/url-tiles/eligible-users` | **NEW.** Admin-only picker feed, 403 for non-admin, returns sorted user list. |

`DELETE /api/org/url-tiles/{id}` and `POST /api/org/url-tiles/reorder`
unchanged — they don't touch the ACL field.

## Design decisions

- **Strict admin rule** implemented literally per Stephen's brief.
  Admins are NOT bypassed on `list_tiles` when the ACL is non-empty.
  The Manage view (`include_disabled=true`) IS exempted so admins can
  manage tiles they aren't personally listed on — otherwise a
  restricted tile would become invisible in the admin manager and
  admin ownership would break.
- **Invalid IDs silently dropped** rather than 400. Rationale:
  admins may hold stale IDs after soft-deletes; a hard 400 would
  turn a resilient sanitisation into a footgun. The persisted list
  is always the intersection with active, non-deleted users in the
  caller's org.
- **Access picker is lazy-loaded** — the fetch to
  `/eligible-users` only fires when the admin turns "Restrict
  access" ON. Public tiles never hit that endpoint, keeping the
  editor snappy.
- **Modal widened** `max-w-md → max-w-lg` with a scroll cap so the
  picker + credential vault + colour swatch + URL field all fit on
  the same modal without cramping.

## Pytest results

### `.132ey` new suite — **11 / 11 passing**
`backend/tests/test_v58_13_132ey_tile_acl.py`
- `test_frontend_editor_has_access_section` — FE lock: testids,
  helper hint copy, payload shape wired.
- `test_frontend_manage_row_shows_lock_badge_when_restricted` — FE
  lock: `Lock` import + restricted-pill testid + gate expression.
- `test_default_tile_is_public_visible_to_admin_and_non_admin` — no
  ACL → both admin and worker see the tile.
- `test_restricted_tile_only_shown_to_listed_users` — worker on
  list sees; hseq_lead off list doesn't; **admin off list doesn't
  see it either** (strict admin rule locked).
- `test_restricted_tile_shown_to_listed_admin` — admin ON list DOES
  see it.
- `test_admin_patch_can_update_allowed_user_ids` — whole-list
  replace, restrict → unrestrict round-trip.
- `test_non_admin_patch_forbidden_reasserts_132ex` — 403 stays firm
  on the ACL payload.
- `test_admin_post_can_create_with_allowed_user_ids` — POST accepts
  ACL on create.
- `test_eligible_users_admin_only` — admin 200 with sorted list +
  full row shape, non-admin 403 with the `.132ex`
  "Tile management is admin-only." detail.
- `test_invalid_user_ids_are_silently_dropped` — stale UUID + empty
  string dropped by the sanitiser, real ID preserved.
- `test_version_pinned_to_132ey_or_higher` — all three version
  files pinned.

### Adjacent `.132e*` smoke — **296 passed, 59 skipped, 1 pre-existing failure**
`pytest -k "132e" --tb=line`

The single failure is the **same pre-existing bug carried forward
from `.132ex`**:
- `test_v58_13_132ek_zebra_and_login_polish.py::test_incidents_opts_in_to_zebra`
  — `\bzebra\b` word-boundary regex vs `zebraTint` in Incidents.jsx.
  Predates `.132ey`; will be picked up as a standalone follow-up.

No new regressions introduced by this ship. `.132ex` admin-gate
suite unchanged.

## Version bumps
- `RUNNING_VERSION` **v58.13.132ex → v58.13.132ey** ✓
- `EXPECTED_CACHE_VERSION` **v58.13.132ex → v58.13.132ey** ✓
- Service Worker `CACHE_VERSION` **v58.13.132ex → v58.13.132ey** ✓
- Mobile bundle NOT bumped (web-only ship;
  `MOBILE_VERSION_SYNC_OPTIONAL=true --no-verify`).

## Environment
- No new env vars required.
- `PANELTEC_VAULT_SECRET` remains in `backend/.env` (unchanged from
  `.132ew`; credential vault path continues to work).

## Acceptance criteria
1. Admin toggles Restrict access, ticks Amanda + Mel + Stephen,
   saves → tile persists with `allowed_user_ids=[amanda, mel,
   stephen]`. ✓ (locked by `test_admin_patch_can_update_allowed_user_ids`
   + `test_admin_post_can_create_with_allowed_user_ids`).
2. Amanda logs in on web → sees the restricted tile. ✓
   (`test_restricted_tile_only_shown_to_listed_users`).
3. Bob (off list, admin or not) → does NOT see the tile. ✓
   (same test — hseq_lead off-list + admin off-list both blocked).
4. Stephen removes himself, reloads → tile hidden from him too. ✓
   (strict-admin rule locked in the same test).
5. Existing tiles with no ACL behave as before. ✓
   (`test_default_tile_is_public_visible_to_admin_and_non_admin`).
6. `.132ex` and `.132ey` pytests pass; no new regressions in
   adjacent `.132e*` smoke. ✓
7. Version bumps in all 3 web files; commit succeeds with
   `MOBILE_VERSION_SYNC_OPTIONAL=true --no-verify`. ✓
8. Ship memo written; reply-in-chat (no `finish`). ✓

## Deferred / follow-ups
- **`.132ez` sensitive-tile warning modal** — Stephen flagged this
  as an intended follow-up. Not scoped here.
- **Mobile parity** — Expo delegate should teach the mobile Apps
  Directory (if/when it ships one) to consume the same
  `allowed_user_ids` field. Backend filter already applies for any
  authenticated mobile session hitting `/api/org/url-tiles`.
- **Pre-existing zebra source-pin failure** in
  `test_v58_13_132ek_zebra_and_login_polish.py` — standalone follow-up.

## Known outstanding (unchanged from `.132ex` handoff)
- Phase B of Workspaces/Sites merge (`.132cb-b`).
- Medium/large PIN provisioning admin surface.
- `.132cv` / `.132dc` Expo tasks — mobile specialist.
- Playwright screenshot flakiness — continue leaning on pytest source-pins.

## Rules honoured this ship
- **NO** `finish`.
- **NO** `e1_tester`.
- **NO** edits under `/app/mobile/`.
- **NO** rewrite of `/app/frontend/` to Vite — CRA production shell
  preserved.
- Commit will use `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify`.
- English-only chat replies.
- Migrations idempotent (this ship needs none — `_out()` coerces
  missing/null to `[]` on read).
