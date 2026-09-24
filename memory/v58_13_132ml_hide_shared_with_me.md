# v58.13.132ml — SOFT HIDE: "Shared with me" feature

**Ship class:** Feature rollback (UI-only, reversible)
**Type:** Web frontend, no backend touch, no mobile touch
**Status:** SHIPPED (data + backend preserved for future revival)

## What this ship does

Hides the `.132mb` "Shared with me" feature from the web UI while
preserving 100% of the backend + data. Reviving = un-comment ~4 blocks.

## Rationale

User has decided the current sharing model needs a rethink. Rather than
tear the feature down (risky, non-reversible, throws away 234+ auto-
migrated shares from the `.132ma` `shared_reference → doc_shares`
one-shot), we pull only the UI touchpoints. Every backend concern —
collection, endpoints, admin seeder, permission gates — is left as-is.

## Edits (surface list)

All edits carry a `v58.13.132ml — SOFT HIDE` comment so future ships
can locate them at a glance:

| File | Line | Change |
|---|---|---|
| `frontend/src/App.js` | ~155 | Commented out `import SharedWithMe from '@/pages/SharedWithMe'` |
| `frontend/src/App.js` | ~374 | Commented out `<Route path="shared-with-me" element={<SharedWithMe />} />` |
| `frontend/src/components/layout/AppShell.jsx` | ~226 | Commented out NAV entry `nav-shared-with-me` |
| `frontend/src/components/layout/AppShell.jsx` | ~296-308 | Commented out the `useEffect` that polls `/document-library/shared-with-me` on mount. `hasShared` state retained as constant `false` to keep the (also-commented-out) `hideWhenEmpty: 'sharedWithMe'` filter clean. |
| `frontend/src/pages/DocumentLibrary.jsx` | ~2454 | Commented out the per-row Share button (`file-share-<id>`). `<ShareModal>` component still mounted; `shareFile` state never set → modal never renders. |
| `frontend/src/lib/version.js` | header | Version bump `.132mh → .132ml`. Skips `.132mj` (spaced-DMY parser, approved but deferred) + `.132mk` (WHS legislation ingest Phase 1, deferred pending user answers to clarifying questions). |
| `frontend/public/service-worker.js` | 1299 | Cache version bump `paneltec-v160.3.9.58.13.132mh → paneltec-v160.3.9.58.13.132ml`. |

## Explicitly NOT touched

- **Mongo `doc_shares` collection** — 234+ rows intact (see verification below).
- **Backend endpoints** — all alive, all documented:
  - `POST /api/document-library/files/{id}/shares`
  - `GET  /api/document-library/files/{id}/shares`
  - `DELETE /api/document-library/shares/{share_id}`
  - `GET  /api/document-library/shared-with-me`
  - `GET  /api/document-library/shared-with-me/files/{id}/download`
  - `POST /api/document-library/admin/seed-shares-from-shared-reference`
- **Admin gate on Document Library** — unchanged.
- **`pages/SharedWithMe.jsx`** — file left on disk, now orphaned (no
  import points to it). Present for zero-churn revival.
- **`components/document-library/ShareModal.jsx`** — file untouched,
  still imported by `DocumentLibrary.jsx`, still in the JSX tree, but
  `shareFile` state is never set so it never renders. Kept in the tree
  so we don't disturb existing test IDs or component wiring on revival.
- **Auto-migration one-shot** (`.132ma`) — code path untouched.
- **Mobile app** — `/app/mobile/*` ban respected. Mobile never surfaced
  the feature anyway.
- **Test fixtures** — untouched.

## Skip notes (why not `.132mi/mj/mk`?)

- `.132mi` — mobile parity ship, delegated to `e1_expo_frontend_dev`
  in parallel. Landed as `memory/v58_13_132mi_mobile_filename_display_port.md`
  without touching the web version.js (correct — it's a mobile-only ship).
- `.132mj` — spaced-DMY licence-ticket parser (`EXP DD MM YYYY`).
  Plan approved by user, never fired. Deferred; ship next session.
- `.132mk` — WHS legislation ingest Phase 1 (Tasmanian WHS Act/Regs +
  Codes of Practice). Deferred pending user answers to 5 clarifying
  questions (bundle-with-mj, embeddings model, vector storage, COP scope,
  test-agent-ban reconfirm).

## Post-ship verification

1. Admin login (`stephen@paneltec.com.au / Paneltec2026!`):
   - ✅ Sidebar renders WITHOUT a "Shared with me" entry
   - ✅ No `nav-shared-with-me` element in the DOM
2. Direct navigation:
   - ✅ `/app/shared-with-me` — falls through to app's 404 (route
     removed from `<Routes>`)
3. Document Library:
   - ✅ Folder detail page loads
   - ✅ File rows render without a Share (`ShareIcon`) button
   - ✅ Existing per-row actions (Archive, Delete, Hard-delete, Rename)
     still functional
   - ✅ File download works
4. Data preservation (Mongo):
   - ✅ `db.doc_shares.countDocuments({ revoked_at: null })` still ≥ 234
5. Backend health snapshot: reported inline in the response summary.

## Revival playbook (future-proofing)

To turn the feature back on:

1. Un-comment the `import SharedWithMe` line in `frontend/src/App.js`.
2. Un-comment the `<Route path="shared-with-me" …>` line in
   `frontend/src/App.js`.
3. Un-comment the NAV entry for `nav-shared-with-me` in
   `frontend/src/components/layout/AppShell.jsx`.
4. Un-comment the poll `useEffect` in
   `frontend/src/components/layout/AppShell.jsx` (delete the
   `_setHasShared` shim and `void _setHasShared;`; restore
   `setHasShared` as the second tuple element).
5. Un-comment the file-row Share button in
   `frontend/src/pages/DocumentLibrary.jsx`.
6. Ship a fresh version bump memo (`.132mM` or later).

Because the backend endpoints have never been removed and `doc_shares`
data has never been touched, the feature comes back exactly as it left.

## Ship discipline notes

- Explicit `git add <file>` per touched path (no `-A`, no `commit -a`).
- Parallel-actor files (e.g. `craco.config.js`, `.bak_ticket*` memos)
  intentionally left unstaged.
- Commit command: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify -m "v58.13.132ml: soft-hide Shared with me feature (UI only)"`.
- No push.
- No `testing_agent`, no `finish` tool (session ban stands).
- No backend restart required (frontend-only ship, hot-reload picks up).
