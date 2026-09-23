# v58.13.132ld — Dropbox OAuth authorize + refresh-token flow

Shipped: 2026-09-23
Scope: backend (integrations_dropbox.py rewrite) + frontend (DropboxCallback page, Integrations card, App route, API public-route allow-list) + version bump
Author: agent
Pivot: `.132lb` Phase 0 was blocked on regenerating a manually-minted Dropbox token with new scopes. Stephen couldn't find the Regenerate button in the App Console UI. We pivoted to a proper OAuth flow (Pivot C from the `.132lb` follow-up).

---

## Why OAuth instead of manual regen

- `sl.u.*` short-lived tokens do NOT retro-inherit scopes granted after issue time. Confirmed via direct probe: even after Stephen clicked Submit on the Permissions tab with `files.metadata.read` ticked, the existing token still returned `missing_scope/files.metadata.read` on `/2/files/list_folder`.
- The Regenerate control is hidden in some Dropbox App Console tenants (or under a different section) — we can't reliably direct Stephen through the UI.
- OAuth `authorize → code → tokens` with `token_access_type=offline` gives us a **refresh token** that never expires; access tokens are auto-refreshed by the Dropbox Python SDK on 401 due to expiry. Zero babysitting.

## What shipped

### Backend — `backend/integrations_dropbox.py` (rewrite)

Three admin/public endpoints:

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/dropbox/health` | admin | Live connect + scope probe, overlays `.132lb` audit artifact. Now includes `refresh_token_present: bool`. |
| `GET /api/dropbox/oauth/start` | admin | Mints a `secrets.token_urlsafe(24)` state, caches it in-process (5-min TTL), returns `{authorize_url, state, redirect_uri, scopes, ttl_seconds}`. |
| `POST /api/dropbox/oauth/callback` | **public** | Verifies state (single-use, CSRF gate), exchanges the auth code with Dropbox for `{access_token, refresh_token, account_id}`, writes both to `.env` atomically via `_env_upsert()`, and warms `os.environ` so the running backend picks up the fresh creds without a supervisor restart. |

Client factory:

```python
def _get_dbx_client():
    if refresh + app_key + app_secret:
        return dropbox.Dropbox(
            oauth2_refresh_token=refresh,
            app_key=app_key,
            app_secret=app_secret,
            oauth2_access_token=access or None,
        )
    return dropbox.Dropbox(access)
```

When `oauth2_refresh_token` + `app_key` + `app_secret` are all supplied, the SDK **auto-refreshes** the access token on 401 due to expiry, transparently to callers. No custom refresh helper needed — the SDK is the single source of truth for the token lifecycle.

`_live_probe()` (used by `/health`) is routed through `_get_dbx_client()`, so the health endpoint benefits from auto-refresh too.

CSRF state store: in-process dict (`_OAUTH_STATES: Dict[str, float]`) with 5-minute TTL and single-use pop-on-verify semantics. Safe because uvicorn runs a single worker in this pod; if we ever go multi-worker, migrate to a Mongo collection with a TTL index (`dropbox_oauth_states`).

`.env` update is atomic: tmp-file write → rename. Preserves every unrelated line including comments. Existing `DROPBOX_ACCESS_TOKEN` line is REPLACED in-place; `DROPBOX_REFRESH_TOKEN` is APPENDED with a ship-header comment.

### Frontend

- **`src/pages/DropboxCallback.jsx`** NEW — public route mounted at `/dropbox/callback`. Reads `?code=&state=` from the URL, POSTs to `/api/dropbox/oauth/callback`, renders success / error / loading states, and `postMessage`s the opener window (`type: 'dropbox-oauth-connected'`, `account_email: ...`) so the Integrations tab can flip its state without waiting on the /health poll.
- **`src/App.js`** — `import DropboxCallback` + `<Route path="/dropbox/callback" element={<DropboxCallback />} />` OUTSIDE the `/app/*` guarded shell.
- **`src/lib/api.js`** — added `/dropbox/callback` to `PUBLIC_ROUTE_PREFIXES` so the axios interceptor's `.132kl` stale-JWT bounce logic doesn't clobber the OAuth callback if the visitor happens to have a poisoned JWT in localStorage.
- **`src/pages/Integrations.jsx`** — new `DropboxCard` component alongside the 4 existing connectors (Simpro / M365 / TextMagic / Navixy). Shows:
  - Status chip: `Connected` (green) / `Scopes missing` (amber) / `Not connected` (grey) / `Checking...` (loader).
  - Diagnostic line from `/health.diagnostic` when set.
  - `Signed in as <email>` line when connected.
  - Audit summary from `.132lb` artifact when available.
  - `Connect Dropbox` button → opens authorize URL in a popup (`window.open(url, '_blank', 'noopener,noreferrer')`) → polls `/api/dropbox/health` every 5s → auto-stops when `connected && scopes_ok && refresh_token_present`, or times out after 5 min.
  - Also listens for `postMessage(type: dropbox-oauth-connected)` from the callback tab for instant state update.

### Security posture

- `DROPBOX_APP_SECRET` **never** leaves the backend. Frontend only round-trips `code` + `state`. Server-side does the token exchange.
- CSRF: state token is 192 bits of entropy, single-use, 5-min TTL.
- Redirect URI is HARD-CODED to `https://whs-compliance.preview.emergentagent.com/dropbox/callback` and must match exactly on the Dropbox App Console side (already registered).
- Token / app secret / refresh token are all redacted defensively in any error string via `_redact()` before leaving the backend.
- `.env` write is atomic; no partial-write state possible.

## Live verification (curl)

```
GET  /api/dropbox/health (admin)          → 200 ; refresh_token_present: false
GET  /api/dropbox/oauth/start (admin)     → 200 ; authorize_url present, state=32-char, ttl=300
GET  /api/dropbox/oauth/start (no auth)   → 401
POST /api/dropbox/oauth/callback {}       → 400 "code and state are required"
POST /api/dropbox/oauth/callback bad state → 400 "unknown or expired state token"  (CSRF gate)
```

Frontend visual: `/app/settings/integrations` now shows the Dropbox card in the 5-connector grid with the amber diagnostic and prominent black `Connect Dropbox` button. Screenshot captured, layout matches the existing card style exactly.

## Awaiting user action

1. Stephen clicks **`Connect Dropbox`** on `/app/settings/integrations`.
2. Popup opens with `https://www.dropbox.com/oauth2/authorize?...&scope=files.metadata.read+files.content.read+sharing.read&token_access_type=offline&...`.
3. Stephen approves.
4. Dropbox redirects the popup to `/dropbox/callback?code=...&state=...`.
5. React callback page POSTs `{code, state}` to `/api/dropbox/oauth/callback`.
6. Backend exchanges code, writes `DROPBOX_ACCESS_TOKEN` + `DROPBOX_REFRESH_TOKEN` to `.env`, warms `os.environ`.
7. Callback page shows "Dropbox connected as stephen@paneltec.com.au" + close button, `postMessage`s opener.
8. Integrations tab: `Connect Dropbox` button flips to `Connected` + audit summary appears.
9. Ship agent re-runs `python backend/scripts/dropbox_phase0_audit.py` with the fresh scoped token → populates real folder listing + size projection → updates the `.132lb` artifact JSON.

## Files touched

```
backend/integrations_dropbox.py                 (rewrite — OAuth start + callback + refresh-aware client)
frontend/src/App.js                             (mount /dropbox/callback route)
frontend/src/lib/api.js                         (public route allow-list)
frontend/src/pages/DropboxCallback.jsx          (new — public OAuth landing)
frontend/src/pages/Integrations.jsx             (new DropboxCard component)
frontend/src/lib/version.js                     (.132lc → .132ld + ship header)
frontend/public/service-worker.js               (.132lc → .132ld)
memory/v58_13_132ld_dropbox_oauth_flow.md       (this memo)
```

## NOT touched

- `doc_folders` / `doc_files` — still Phase 0, zero writes.
- `.132lc` doc-tool swap — untouched.
- `.132lb` audit artifact — untouched (will be rewritten by the next audit run after OAuth completes).
- Any other integration surface (Simpro, M365, TextMagic, Navixy) — untouched.
- `/app/mobile/` — untouched (edit ban).
- `MOBILE_BUNDLE_VERSION` — unchanged.
- `.env` file is gitignored; the runtime write to `.env` never touches git.

## Next steps after OAuth completes

- Run full `.132lb` audit script → get real folder listing + total size estimate for `Paneltec-General Administration`.
- Update the recommended-storage-backend paragraph in `v58_13_132lb_dropbox_phase0_audit.md`.
- Move to Phase 1: `POST /api/dropbox/mirror/plan` + `POST /api/dropbox/mirror/apply` for the folder tree mirror.
