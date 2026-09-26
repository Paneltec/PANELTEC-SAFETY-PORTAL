# v58.13.132n4b — Dropbox browser sharing / permissions

## TL;DR

Follow-up ship to `.132n4a`. Removes the "sharing is disabled
until scopes land" placeholder from the row menu + details panel
and replaces it with a full Dropbox-style share modal. All five
sharing operations wired end-to-end against the newly authorised
`sharing.read` + `sharing.write` scopes:

1. Create shared link (team-only or public)
2. Toggle link visibility (team-only ↔ anyone-with-link)
3. Revoke shared link
4. Invite by email (viewer / editor)
5. Remove direct member

Members list surfaces both **direct** and **inherited** access
holders (files in team folders inherit membership from parent
folders). Direct members get a Remove button; inherited ones are
collapsed into an expandable block and can't be removed at this
scope (Dropbox would 400 anyway — the parent folder is where you
manage them).

## Scope verification (pre-ship)

`sharing.read` + `sharing.write` verified live via the team-
namespace-scoped SDK client (`_get_dbx()`):

- `sharing_list_shared_links(direct_only=True)` → returned 6
  existing links across the team folder.
- `sharing_share_folder(<any folder>)` → returned a
  `ShareFolderLaunch` (no scope error).
- `sharing_create_shared_link_with_settings(<file>, team_only)`
  → returned a live shared link URL.
- `sharing_list_file_members(<file>)` → returned the 11
  inherited team members.

No scope-related 403s during smoke-testing.

## Backend additions

5 new endpoints on `dropbox_browse.py` (appended below the
`.132n4a` block, ~350 lines of net new code):

| Method | Path                                        | Purpose                                             |
| ------ | ------------------------------------------- | --------------------------------------------------- |
| GET    | `/api/dropbox/browse/share`                 | Get share state (links + members) for a path       |
| POST   | `/api/dropbox/browse/share/link`            | Create/get shared link (idempotent on already-exists) |
| POST   | `/api/dropbox/browse/share/link/revoke`     | Revoke a shared link by URL                        |
| POST   | `/api/dropbox/browse/share/invite`          | Invite by email (viewer/editor)                    |
| POST   | `/api/dropbox/browse/share/remove-member`   | Remove a direct member                             |

All 5 go through the team-namespace-scoped `_get_dbx()` client,
route errors through a new `_wrap_sharing_error` (falling back
to the general `_wrap_dropbox_error` for shared paths), and
audit-log mutations to `dropbox_browse_audit`.

Two helpers earn their keep for folder sharing:

- **`_is_folder_path(dbx, path)`** — one metadata lookup that
  decides whether to route through the `*_file_member` or
  `*_folder_member` SDK families.
- **`_ensure_shared_folder_id(dbx, path, verb)`** — converts a
  plain folder into a formal Dropbox shared folder via
  `sharing_share_folder`. Polls the async job for up to 10 s and
  raises a clean 504 on timeout. Idempotent when the folder is
  already shared (returns the existing `shared_folder_id`).

Link creation is **idempotent**: when Dropbox returns
`shared_link_already_exists`, we fetch the existing link and
return that instead of surfacing a 409 — matches the Dropbox web
UI behaviour and lets the FE render the "share" pill without
special-casing existing links.

## Frontend additions

New component:

- **`components/dropbox/ShareModal.jsx`** — 480-line modal with
  three sections (Invite / People with access / Shared link).
  Uses the same layout patterns as `MovePickerModal.jsx`
  (max-w-2xl, rounded-2xl, DBX_BLUE accent). State refreshes
  after every mutation so the UI never drifts from the server.

Section-by-section:

1. **Invite people** — email input (comma / space / semicolon
   separated), `Can view` / `Can edit` role dropdown, optional
   message toggle, `Send` button (invites in a serial loop so
   partial failures surface per-email in a toast).
2. **People with access** — accepted direct members + pending
   invitees rendered inline. Inherited members collapsed under
   an expandable "Inherited from parent · N" block. Direct
   members get a Remove action.
3. **Shared link** — read-only URL field + Copy + Revoke, plus
   visibility pills (Team only / Anyone with link). Visibility
   changes revoke-then-recreate the link because Dropbox
   doesn't expose an in-place update.

Wiring changes:

- **`RowActionMenu.jsx`** — dropped the `disabled` on the Share
  slot, forwarded the `onShare` prop that was previously kept
  for the ship. `.n4b` badge (only shown on disabled items) auto-
  hides since the slot is now enabled.
- **`DetailsPanel.jsx`** — Share action row enabled + wired to
  new `onShare` prop. The "Sharing" meta-row now shows a live
  summary (`N links · M people`) fetched in parallel with the
  version count. Empty state renders as `Not shared`.
- **`DropboxBrowser.jsx`** — new `shareFor` state, renders
  `<ShareModal>` on demand. Wired both the row menu and the
  details-panel action to open it.

## Testing

Manual end-to-end verified via Playwright screenshots:

- Row menu → Share opens the modal with the correct file name.
- Create link → real Dropbox URL appears (~12 s round-trip incl.
  refresh — Dropbox API is not fast). Team-only visibility pill
  active by default.
- Toggle to "Anyone with link" → toast "Visibility: Anyone with
  the link", visibility pill flips, live tag updates to match.
- Revoke → link disappears, "No link yet. Create one…" empty
  state returns.
- Inherited members (11 team members for the test file) render
  under a collapsible block with correct role labels.

Backend curl coverage (see the pre-ship exploration):

- `POST /share/link` × 2 in a row → second call returns the
  same URL (idempotent).
- `GET /share` on a file with inherited members → returns 11
  members with `is_inherited: true`.
- `POST /share/link/revoke` → `{revoked: true}`.
- Revoke on a URL that no longer exists → `{revoked: true,
  already_gone: true}` (soft-idempotent).

## Deferred (future ships)

- **Password-protected links** — the backend accepts
  `visibility: "password"` + a password, but the FE only
  exposes the two-way team/public toggle. Ship as a `.n4c` UI
  polish if a user asks.
- **Link expiry** — Dropbox supports it via `SharedLinkSettings.expires`;
  no UI yet.
- **File-level (non-inherited) member editing** — the SDK
  supports changing an individual member's access level via
  `sharing_change_file_member_access` (files) or
  `sharing_update_folder_member` (folders). The current modal
  removes + re-invites when you want to change a role; a
  dedicated "change role" dropdown per direct-member row is a
  polish item for `.n4c`.
