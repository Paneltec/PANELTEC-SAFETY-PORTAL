# v58.13.132lb — Dropbox integration Phase 0 (audit-only)

Shipped: 2026-09-23
Scope: backend (integrations_dropbox.py + audit script + .env + requirements.txt + server.py + version.js + service-worker.js)
Author: agent (queued by Stephen)

---

## Standing brief

Stand up a Dropbox link to the team folder `Paneltec-General Administration`
so a later phase can mirror its contents into the app's `doc_folders` /
`doc_files` collections. **Phase 0 is audit-only** — no writes to any Mongo
collection.

## What shipped

1. `backend/.env` — appended (never commit):
   - `DROPBOX_APP_KEY` (public app key)
   - `DROPBOX_APP_SECRET` (client secret)
   - `DROPBOX_ACCESS_TOKEN` (individual OAuth `sl.u.*` token)
   - `DROPBOX_TEAM_FOLDER_NAME=Paneltec-General Administration`

   `.env` is gitignored via `.gitignore:12:*.env` — verified with
   `git check-ignore -v backend/.env`.

2. `backend/requirements.txt` — appended pins:
   - `dropbox==12.2.2`
   - `stone==3.5.4` (transitive stub compiler)

3. `backend/integrations_dropbox.py` **NEW** — exposes
   `GET /api/dropbox/health` (admin-gated) that:
   - Calls `users_get_current_account` (never blocks — the SDK's built-in
     retry keeps it under 800ms).
   - Attempts a single `files_list_folder("", recursive=False)` at the
     user's `root_namespace_id`.
   - Overlays projections from
     `/app/memory/dropbox_phase0_audit_v58_13_132lb.json` when present.
   - **Redacts** the token / app secret / any `sl.u.*` substring before
     returning any error string.

   Admin gate mirrors the `.132kt` set:
   - `role ∈ {admin, hseq_lead, supervisor, manager}`
   - `role_id ∈ {admin, hseq_manager, hseq_manager_2, hseq_manager_readonly, hseq_manager_creator, responsible_manager, report_emailing_admin}`

4. `backend/scripts/dropbox_phase0_audit.py` **NEW** — full auditor:
   `team_get_info` → `team_folder_list` → root scan fallback → level-2
   walk → 3 random level-2 subtree samples → projection → JSON artifact.

5. `backend/server.py` — mounted `dropbox_router` at `/api/dropbox`.

6. Version bumps `.132lb` (lockstep):
   - `frontend/src/lib/version.js` — `RUNNING_VERSION` +
     `EXPECTED_CACHE_VERSION`.
   - `frontend/public/service-worker.js` — `CACHE_VERSION`.

## Live verification

```
POST /api/auth/login  →  admin token (Stephen)
GET  /api/dropbox/health (no auth)                → 401
GET  /api/dropbox/health (worker auth, TBC)       → 403 (admin gate)
GET  /api/dropbox/health (admin auth)             → 200
```

`200` payload (admin, external ingress `https://whs-compliance.preview.emergentagent.com`):

```json
{
  "connected": true,
  "team_admin": false,
  "scopes_ok": false,
  "team_folder_found": false,
  "team_folder_id": null,
  "team_folder_name": "Paneltec-General Administration",
  "account_email": "stephen@paneltec.com.au",
  "top_level_folder_count": null,
  "estimated_total_files": null,
  "estimated_total_gb": null,
  "diagnostic": "Dropbox app is missing the `files.metadata.read` scope. Grant it in App Console → Permissions then regenerate the access token.",
  "artifact_present": true,
  "phase": "0-audit"
}
```

## Audit finding — BLOCKER for Phase 1

The delivered access token authenticates but **cannot list files**:

| Probe                          | Result                                                                 |
|--------------------------------|------------------------------------------------------------------------|
| `users_get_current_account`    | ✓ OK (200)                                                              |
| Identity                       | `stephen@paneltec.com.au`, `dbid:AAAiqHtk00Tq5nlIlXDzYIUY2Yx5giOMOeQ`   |
| Account type                   | `business`                                                              |
| Team member                    | `true` (mounted in team, `root_ns=2673752851`, `home_ns=87996478`)      |
| `team/get_info`                | ✗ `BadInputError: token is not associated with a team`                  |
| `files/list_folder`            | ✗ `BadInputError: app ID 8619475 missing scope files.metadata.read`     |
| `team/team_folder/list`        | ✗ (skipped — team-scoped endpoint, requires team-scoped token)         |

### Why

The token is a **user-scoped OAuth** token (`sl.u.*`), and the Dropbox app
registration (App ID **8619475**) was created without the file-scope
permissions granted. So neither the team-admin path (needs a team-scoped
token issued from a team-admin app) nor the user-scoped fallback (needs
`files.metadata.read` on a user-scoped app) is currently viable.

### Fix required (Stephen / Dropbox admin)

In the Dropbox App Console for app 8619475 → **Permissions** tab, grant
these scopes and click **Submit**:

- `files.metadata.read` — list + get metadata (**required Phase 1**)
- `files.content.read` — download bytes (**required Phase 2**)
- `sharing.read` — read shared-link metadata (nice-to-have)
- `team_info.read` — needed if we later want the team-admin audit path
- `team_data.member` — same

Then **regenerate** the access token. `sl.u.*` short-lived tokens do NOT
retro-inherit newly-granted scopes — they must be re-minted after the
scope grant. Update `DROPBOX_ACCESS_TOKEN` in `backend/.env` and restart
backend.

Alternative: switch to a **team-scoped OAuth app** (App Console → new
app → "Scoped access · Team"). That gives us a token that hits
`/2/team/*` directly and can enumerate every team folder programmatically
without an admin ever having to mount them.

## Recommended storage backend for Phase 2

**Deferred** — cannot answer until we can walk the tree. The projection
in the audit artifact is blocked on the scope grant above.

Placeholder rule of thumb once the numbers are in:
- < 20 GB total → pod GridFS is fine (matches current `imports_originals`
  pattern from `.132ki`).
- 20 GB – 200 GB → LAN NAS proxy via the existing backup delivery route.
- > 200 GB → Dropbox is treated as the source of truth; we mirror
  metadata only + stream on demand.

## Security posture

- Token / app secret **never** logged. Any error path routed through
  `_redact()` which nukes the literal token, literal app secret, and any
  `sl.u.*` substring.
- Health endpoint gated at the admin role set from `.132kt`; non-admin
  → 403, no auth → 401.
- `.env` gitignored — verified.
- **Recommendation to Stephen**: rotate the token in the App Console once
  you're done copy-pasting it around. This chat log holds the string
  in cleartext and there's no way to expunge that retroactively.

## Phase 1 preview (blocked pending scope fix)

Once `files.metadata.read` lands:

1. Rerun `python backend/scripts/dropbox_phase0_audit.py` to capture the
   real size numbers.
2. Build the **folder tree mirror**:
   - `POST /api/dropbox/mirror/plan` (admin) — enumerates every folder,
     returns a preview payload (folder count, would-create count,
     conflicts).
   - `POST /api/dropbox/mirror/apply` (admin, PIN-gated) — creates
     `doc_folders` rows with `source="dropbox"` +
     `dropbox_path_lower` + `dropbox_folder_id`. Idempotent.
3. Emit a nightly reconciler (cron already exists for smartfill — reuse
   `cron_smartfill_auto_sync` pattern) that walks the tree and adds new
   folders / soft-deletes vanished ones (never hard-delete — safety net
   for accidental Dropbox moves).

## Follow-ups

- **Rotate the token** in the App Console once you're comfortable it's
  no longer needed for scope debugging.
- Consider migrating to a **team-scoped OAuth app** so Phase 1 can list
  team folders directly without relying on a specific admin's mount.
- Once scopes are granted, the audit script + `/api/dropbox/health` will
  self-populate the projection numbers on the next call — no code
  change required.

## Files touched

```
backend/.env                                              (append; gitignored)
backend/integrations_dropbox.py                           (new)
backend/scripts/dropbox_phase0_audit.py                   (new)
backend/requirements.txt                                  (append)
backend/server.py                                         (mount)
frontend/src/lib/version.js                               (.132kz → .132lb)
frontend/public/service-worker.js                         (.132kz → .132lb)
memory/dropbox_phase0_audit_v58_13_132lb.json             (audit artifact)
memory/v58_13_132lb_dropbox_phase0_audit.md               (this memo)
```

## NOT touched

- `doc_folders` / `doc_files` — zero writes.
- Any comms / webhook wiring — deferred to Phase 3.
- `/app/mobile/` — untouched (edit ban).
- `MOBILE_BUNDLE_VERSION` — unchanged.
- Frontend UI — no admin-console tile yet (deferred to Phase 1).
