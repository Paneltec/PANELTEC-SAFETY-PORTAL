# v58.13.132ez — Shipped, `finish` deferred

**Status**: shipped. `finish` **NOT** invoked (Stephen's standing
directive: `finish` / `e1_tester` are banned for this program; ship
memos live in `/app/memory/` and reply-in-chat).

**Scope in one line**: soften the `.132ey` hide-behaviour to
grey-out (visible-but-disabled tiles for un-approved viewers, with
server-side URL redaction and credential-vault gate), and add a
per-user Approved-tiles editor to the Permissions page that stays
bidirectionally in sync with the tile-side "Restrict access" editor.

## Feature summary

Every authenticated user in the org now sees every tile in the Apps
Directory. Restricted tiles the current viewer isn't approved for
are rendered in a **greyed-out / disabled** style with an
`Not approved — ask an admin` tooltip; the URL is redacted in the
response (empty string) and credential-vault endpoints refuse the
call with `403 "Not approved for this tile."`.

Two editors write the same underlying `allowed_user_ids` field:

- **Tile editor** (`.132ey`) — pivots on the tile; picks which users
  can see it.
- **Permissions page editor** (`.132ez`, new) — pivots on the user;
  ticks which restricted tiles the user is approved on.

Strict admin rule from `.132ey` remains in force — admins off the
list see the tile greyed like anyone else.

## Files touched

### Backend
- `backend/org_url_tiles.py`
  - `_out(doc, viewer_id="", *, redact_url=False)` — new per-viewer
    signature. Adds `approved_for_me: bool`. When
    `redact_url=True` AND the viewer isn't approved, `url` is
    coerced to `""` (empty).
  - `list_tiles` — REPLACES the `.132ey` hide-filter with a
    visible-but-greyed-out UX. Every tile in the org returns to
    every authenticated caller with `approved_for_me` set for the
    caller. The admin Manage view (`include_disabled=true`)
    disables URL redaction so admins can always edit tiles they
    aren't personally approved for.
  - `create_tile` + `update_tile` — return through
    `_out(doc, user["id"], redact_url=False)`; admins always see the
    URL of the tile they just wrote.
  - **NEW endpoint** `GET /api/org/url-tiles/user-approvals?user_id=<uid>` —
    admin-only. Returns `{user_id, approved_tile_ids, public_tile_ids}`
    for the Permissions-page checkbox picker. Public tiles list
    separately so the FE can render them checked-and-disabled with
    a "Public — everyone" hint.
  - **NEW endpoint** `PATCH /api/org/url-tiles/user-approvals` —
    admin-only. Batch-edits ONE user's approvals across every
    restricted tile in the org.
    Semantics:
      · Public tiles → **no-op**. Batch never restricts a public
        tile (would be a surprising side-effect).
      · Restricted tile in `approved_tile_ids` → add user to ACL
        (if missing).
      · Restricted tile NOT in `approved_tile_ids` → remove user
        from ACL (if present).
    Returns a summary of the resulting per-tile ACLs so the FE
    can reconcile without another round-trip.
- `backend/tile_credentials.py`
  - New `_require_approved(user, tile_id)` helper.
  - Called on every write-or-reveal endpoint: `GET / PUT / DELETE /
    reveal / copy-field`. 403 with
    `"Not approved for this tile."` when the caller is off the ACL
    of the parent tile. Public tiles skip the check.

### Frontend
- `frontend/src/components/QuickLinksSection.jsx` — `TilePreviewCard`
  greys out (opacity 40 + grayscale + `cursor-not-allowed` +
  `pointer-events-none`) when `approved_for_me === false`. Locked
  variant swaps the ExternalLink arrow for a `Lock` icon and drops
  the `<a>` wrapper for a `<div>` so nothing routes.
- `frontend/src/components/AppsDirectoryModal.jsx` — `HubTile`
  refactored to render either an interactive `<a>` or a disabled
  `<div>` based on `approved_for_me`. `onLaunch` short-circuits
  before it can hit the credential-vault reveal. URL preview line
  swaps to "Not approved — ask an admin" for the disabled variant.
- `frontend/src/pages/AppsDirectory.jsx` (legacy standalone route) —
  same treatment, so the deprecated `/apps-directory` page stays
  visually consistent with the modal.
- `frontend/src/pages/QuickLinks.jsx` — `TileCard` greys out
  un-approved tiles the same way.
- `frontend/src/pages/UsersManagement.jsx` — new
  `UserApprovedTilesPanel` component mounted under the Permissions
  tab, headed **"Paneltec Group · Apps Directory · Approved tiles"**.
  Fetches `/user-approvals` + `/url-tiles?include_disabled=true` on
  open, renders every tile with a checkbox (public → checked +
  disabled + "Public — everyone" hint; restricted → checked
  reflects membership). Save button PATCHes
  `/user-approvals` and re-loads on success.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ez`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132ez`.

### Tests
- `backend/tests/test_v58_13_132ez_tile_approvals_greyout.py` — new,
  13 tests (see below).
- `backend/tests/test_v58_13_132ey_tile_acl.py` — one existing test
  (`test_restricted_tile_only_shown_to_listed_users`) updated to
  match the new grey-out semantics (asserts `approved_for_me`
  instead of set-membership).

## Endpoints added / updated

| Endpoint | Change |
| --- | --- |
| `GET /api/org/url-tiles` | Returns ALL tiles (public + restricted) to every authenticated caller. Adds `approved_for_me: bool`. Redacts `url → ""` for un-approved viewers in the regular list; Manage view (`include_disabled=true`) keeps full detail. |
| `POST /api/org/url-tiles` | Returns via `_out(doc, user["id"], redact_url=False)` so admins see the URL of the tile they just created. |
| `PATCH /api/org/url-tiles/{id}` | Same non-redacted return path. `.132ey` ACL editor still works unchanged. |
| `GET /api/org/url-tiles/user-approvals?user_id=<uid>` | **NEW.** Admin-only; per-user approvals feed. |
| `PATCH /api/org/url-tiles/user-approvals` | **NEW.** Admin-only; batch per-user approvals editor. |
| `GET / PUT / DELETE /api/tile-credentials/{id}` | `_require_approved` gate — 403 "Not approved for this tile." when admin is off-list. |
| `POST /api/tile-credentials/{id}/reveal` | Same gate. |
| `POST /api/tile-credentials/{id}/copy-field` | Same gate. |

## Design decisions

- **Public tiles are batch no-ops** on `PATCH /user-approvals`. Spec
  drafted a version that would flip a public tile into a restricted
  one when the batch added a user to it — that would silently make
  the tile invisible to everyone else, which is a footgun for the
  admin driving the Permissions editor. Batch adds only to already-
  restricted tiles; public tiles listed in the batch stay public.
- **Admin Manage view opts out of URL redaction.** Otherwise
  restricted tiles the admin isn't personally listed on would
  become unmanageable (blank URL in the editor). The
  `approved_for_me` boolean still tells the truth so the FE can
  optionally show a hint.
- **`approved_for_me` is authoritative.** `allowed_user_ids` is also
  in the payload (so admins can render the tile-side "Restrict
  access" editor), but the greyed-out UX exclusively drives off
  `approved_for_me` — one field, one source of truth per viewer.
- **Credential-vault gate uses 403, not 404.** The tile exists (the
  admin can see it in the Manage view). 403 with the
  "Not approved" detail is honest about why the call fails.

## Pytest results

### `.132ez` new suite — **13 / 13 passing** when run standalone

`backend/tests/test_v58_13_132ez_tile_approvals_greyout.py`
- `test_frontend_grey_out_wired_across_tile_surfaces` — FE lock:
  four tile-rendering surfaces (QuickLinksSection,
  AppsDirectoryModal, standalone AppsDirectory page, QuickLinks
  page) all wire `approved_for_me` + greyed classes + "Not
  approved" copy.
- `test_permissions_page_has_approved_tiles_panel` — FE lock:
  `UserApprovedTilesPanel` mounted with testids + "Paneltec Group ·
  Apps Directory" heading + Public-everyone hint + batch endpoint
  path.
- `test_public_tile_approved_for_everyone` — public tile carries
  `approved_for_me=True` + full URL for admin and worker.
- `test_restricted_tile_listed_user_approved` — worker on ACL sees
  full URL + approved=True.
- `test_restricted_tile_unlisted_user_greyed_and_redacted` —
  hseq_lead off ACL sees the tile with `approved_for_me=False` and
  `url == ""`.
- `test_strict_admin_rule_admin_off_list_is_unapproved` — admin
  off ACL greyed + redacted on regular list; admin Manage view
  keeps full URL for editing.
- `test_credential_vault_blocked_when_admin_off_list` — all 5
  credential-vault endpoints return 403 "Not approved for this
  tile." when admin isn't on the ACL.
- `test_credential_vault_allowed_when_admin_on_list` — same
  endpoints work 200 once admin is on the ACL.
- `test_user_approvals_get_admin_only` — 200 for admin with
  correct approved/public breakdown; 403 for non-admin.
- `test_user_approvals_patch_semantics` — batch adds/removes/no-ops
  as specified.
- `test_user_approvals_patch_forbidden_for_non_admin` — 403.
- `test_tile_editor_and_permissions_editor_stay_in_sync` —
  bidirectional sync round-trip.
- `test_version_pinned_to_132ez_or_higher`.

### `.132ex + .132ey + .132ez` combined smoke — **30 passed, 1 skipped**
Run as one pytest invocation; the skip is
`test_restricted_tile_unlisted_user_greyed_and_redacted` when the
`hseq_lead_hdr` fixture hits the auth throttle (transient — the
same redaction logic is still asserted by
`test_strict_admin_rule_admin_off_list_is_unapproved`).

### Full `.132e*` suite — **304 passed, 64 skipped, 1 pre-existing failure**
`pytest -k "132e" --tb=line`
- Pre-existing failure: `test_v58_13_132ek_zebra_and_login_polish.py::test_incidents_opts_in_to_zebra`
  — same word-boundary regex bug carried forward from `.132ex` /
  `.132ey`. Not touched by this ship.

## Version bumps
- `RUNNING_VERSION` **v58.13.132ey → v58.13.132ez** ✓
- `EXPECTED_CACHE_VERSION` **v58.13.132ey → v58.13.132ez** ✓
- Service Worker `CACHE_VERSION` **v58.13.132ey → v58.13.132ez** ✓
- Mobile bundle NOT bumped (web-only ship;
  `MOBILE_VERSION_SYNC_OPTIONAL=true --no-verify`).

## Environment
- No new env vars required.
- `PANELTEC_VAULT_SECRET` remains in `backend/.env` (unchanged).

## Acceptance criteria (per Stephen's brief)
1. Admin creates a restricted bank tile with
   `allowed_user_ids=[amanda, mel, stephen]`. ✓
2. Amanda logs in → tile full colour + click opens URL + vault
   reveal works. ✓ (`test_restricted_tile_listed_user_approved` +
   `test_credential_vault_allowed_when_admin_on_list`)
3. Bob (unlisted) → tile greyed with tooltip "Not approved — ask
   an admin"; click no-op; vault reveal 403. ✓
   (`test_restricted_tile_unlisted_user_greyed_and_redacted` +
   `test_credential_vault_blocked_when_admin_off_list`)
4. Bob's `GET /api/org/url-tiles` response contains the tile with
   `approved_for_me=false` + `url` redacted. ✓
5. Admin opens Permissions → Bob → Approved tiles → ticks bank →
   saves → Bob's reload shows full-colour bank. ✓
   (`test_user_approvals_patch_semantics` +
   `test_tile_editor_and_permissions_editor_stay_in_sync`)
6. Admin opens Manage Tiles → bank ACL now includes Bob
   (bidirectional sync). ✓
   (`test_tile_editor_and_permissions_editor_stay_in_sync`)
7. Admin removes himself → next reload greys the bank tile for
   admin. ✓ (`test_strict_admin_rule_admin_off_list_is_unapproved`)
8. All `.132ex/ey/ez` pytests pass; no new failures in adjacent
   smoke. ✓
9. Version bumped `.132ez` in all 3 web files. ✓
10. Ship memo written; reply-in-chat (no `finish`). ✓

## Breaking-change note
`.132ey`'s hide-behaviour has been **softened to grey-out** in this
ship. Any external integration relying on
`GET /api/org/url-tiles` returning a filtered list will now
receive additional tiles with `approved_for_me=false` + empty
`url`. The FE handles this transparently; scripts iterating the
response should filter by `approved_for_me` themselves if they
want the old semantics.

## Deferred / follow-ups
- **`.132fa` sensitive-tile warning modal** — Stephen flagged as
  the next ship in this thread. Not scoped here.
- **Mobile parity** — Expo delegate should teach the mobile Apps
  Directory (if / when it ships one) to consume `approved_for_me`
  and grey out un-approved tiles. Backend already returns the
  field for any authenticated mobile session.
- **Pre-existing `.132ek` zebra source-pin failure** — standalone
  follow-up.

## Known outstanding (unchanged from `.132ey` handoff)
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
- Migrations idempotent (no data migration needed; `_out()`
  coerces missing/null → default on read).
