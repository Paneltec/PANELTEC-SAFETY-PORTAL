"""v58.13.132lb — Dropbox integration Phase 0 (audit-only).
v58.13.132ld — Added OAuth authorize + refresh-token flow (Pivot C).

Endpoints:

  GET  /api/dropbox/health          (admin)  — connect + scope diagnostic
  GET  /api/dropbox/oauth/start     (admin)  — begin OAuth authorize flow
  POST /api/dropbox/oauth/callback  (public) — code → token exchange

The `/dropbox/callback` frontend route lives on the React app (not on
this router) because the pod's ingress routes non-`/api/*` paths to
the frontend. The React callback page reads `?code=&state=` from the
URL and POSTs to `/api/dropbox/oauth/callback` for server-side
exchange. That keeps `DROPBOX_APP_SECRET` off the browser.

The Dropbox SDK client is instantiated with `oauth2_refresh_token` +
`app_key` + `app_secret` when a refresh token is present in the env;
the SDK then auto-refreshes the access token on 401 due to expiry,
transparently to callers.

NEVER echoes the token or app secret. Errors are surfaced as
human-readable strings with token substrings redacted defensively.
Admin gate mirrors the mobile+web `.132kt` set.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any, Dict, Optional

import requests
from fastapi import APIRouter, Body, Depends, HTTPException

from auth import get_current_user

router = APIRouter(prefix="/dropbox", tags=["dropbox"])

# In-process CSRF-state store. 5-minute TTL. Sufficient because a
# single admin clicks the Connect button and completes the flow
# from the same pod; state is not shared across replicas (we run
# one uvicorn worker) and OAuth flows complete in <60s. If we
# ever go multi-worker, move this to Mongo with a TTL index.
_OAUTH_STATES: Dict[str, float] = {}
_OAUTH_STATE_TTL_S = 5 * 60
_DROPBOX_REDIRECT_URI = (
    "https://whs-compliance.preview.emergentagent.com/dropbox/callback"
)
_DROPBOX_AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize"
_DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"
# Space-separated per Dropbox spec (though the SDK also accepts a list).
_DROPBOX_SCOPES = "files.metadata.read files.content.read sharing.read"


# ── admin gate (.132kt parity) ──────────────────────────────────
_ADMIN_LEGACY_ROLES = {"admin", "hseq_lead", "supervisor", "manager"}
_ADMIN_ROLE_IDS = {
    "admin", "hseq_manager", "hseq_manager_2", "hseq_manager_readonly",
    "hseq_manager_creator", "responsible_manager", "report_emailing_admin",
}


def _is_admin(user: dict) -> bool:
    if not user:
        return False
    rid = (user.get("role_id") or "").strip()
    if rid in _ADMIN_ROLE_IDS:
        return True
    legacy = (user.get("role") or "").strip().lower()
    return legacy in _ADMIN_LEGACY_ROLES


def _require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


# ── secret-safe redaction ───────────────────────────────────────
def _redact(s: str) -> str:
    tok = os.environ.get("DROPBOX_ACCESS_TOKEN", "")
    rtok = os.environ.get("DROPBOX_REFRESH_TOKEN", "")
    sec = os.environ.get("DROPBOX_APP_SECRET", "")
    if tok and tok in s:
        s = s.replace(tok, "[REDACTED_TOKEN]")
    if rtok and rtok in s:
        s = s.replace(rtok, "[REDACTED_REFRESH_TOKEN]")
    if sec and sec in s:
        s = s.replace(sec, "[REDACTED_APP_SECRET]")
    s = re.sub(r"sl\.u\.[A-Za-z0-9_\-]{40,}", "[REDACTED_SL_TOKEN]", s)
    s = re.sub(r"sl\.[A-Za-z0-9_\-]{40,}", "[REDACTED_SL_TOKEN]", s)
    return s


# ── .env update (append-or-replace, atomic) ─────────────────────
_ENV_PATH = Path(__file__).resolve().parent / ".env"


def _env_upsert(updates: Dict[str, str]) -> None:
    """Read `.env`, replace lines matching `KEY=...`, append missing
    keys, write atomically. Preserves comments and unrelated lines
    (including trailing whitespace) exactly.

    NEVER logs the values."""
    if not _ENV_PATH.exists():
        raise RuntimeError(f".env not found at {_ENV_PATH}")
    lines = _ENV_PATH.read_text().splitlines(keepends=True)
    remaining = dict(updates)
    out: list[str] = []
    for ln in lines:
        stripped = ln.lstrip()
        if not stripped or stripped.startswith("#"):
            out.append(ln)
            continue
        if "=" not in stripped:
            out.append(ln)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in remaining:
            newline_char = "\n" if ln.endswith("\n") else ""
            out.append(f"{key}={remaining[key]}{newline_char}")
            del remaining[key]
        else:
            out.append(ln)
    if remaining:
        if out and not out[-1].endswith("\n"):
            out[-1] += "\n"
        out.append(
            f"# v58.13.132ld — Dropbox OAuth tokens "
            f"(updated {time.strftime('%Y-%m-%d %H:%M:%S')})\n"
        )
        for k, v in remaining.items():
            out.append(f"{k}={v}\n")
    # Atomic write.
    tmp = _ENV_PATH.with_suffix(".env.tmp")
    tmp.write_text("".join(out))
    tmp.replace(_ENV_PATH)


# ── Dropbox SDK client factory ─────────────────────────────────
def _get_dbx_client():
    """Returns a `dropbox.Dropbox` client instance. Prefers the
    refresh-token path (SDK auto-refreshes access token on 401 due
    to expiry) when a refresh token is available."""
    import dropbox
    refresh = os.environ.get("DROPBOX_REFRESH_TOKEN", "").strip()
    access = os.environ.get("DROPBOX_ACCESS_TOKEN", "").strip()
    app_key = os.environ.get("DROPBOX_APP_KEY", "").strip()
    app_secret = os.environ.get("DROPBOX_APP_SECRET", "").strip()
    if refresh and app_key and app_secret:
        return dropbox.Dropbox(
            oauth2_access_token=access or None,
            oauth2_refresh_token=refresh,
            app_key=app_key,
            app_secret=app_secret,
        )
    if not access:
        raise RuntimeError("no Dropbox credentials configured")
    return dropbox.Dropbox(access)


# ── /oauth/start — admin-gated ─────────────────────────────────
@router.get("/oauth/start")
def dropbox_oauth_start(user: dict = Depends(_require_admin)) -> Dict[str, Any]:
    """Mint a CSRF `state`, cache it, and return the Dropbox
    authorize URL. Admin clicks the returned URL (or the frontend
    opens it in a new tab) to complete the flow.

    `token_access_type=offline` is the key parameter — it tells
    Dropbox to include a refresh token in the callback response.
    """
    app_key = os.environ.get("DROPBOX_APP_KEY", "").strip()
    if not app_key:
        raise HTTPException(500, "DROPBOX_APP_KEY missing from env")

    # Prune expired states, then mint a fresh one.
    now = time.time()
    for k, ts in list(_OAUTH_STATES.items()):
        if now - ts > _OAUTH_STATE_TTL_S:
            _OAUTH_STATES.pop(k, None)
    state = secrets.token_urlsafe(24)
    _OAUTH_STATES[state] = now

    # URL-encode manually — Dropbox is strict about `scope` spacing.
    from urllib.parse import urlencode
    qs = urlencode({
        "client_id": app_key,
        "response_type": "code",
        "redirect_uri": _DROPBOX_REDIRECT_URI,
        "token_access_type": "offline",
        "scope": _DROPBOX_SCOPES,
        "state": state,
    })
    return {
        "authorize_url": f"{_DROPBOX_AUTHORIZE_URL}?{qs}",
        "state": state,
        "redirect_uri": _DROPBOX_REDIRECT_URI,
        "scopes": _DROPBOX_SCOPES.split(),
        "ttl_seconds": _OAUTH_STATE_TTL_S,
    }


# ── /oauth/callback — public (fired by frontend page) ──────────
@router.post("/oauth/callback")
def dropbox_oauth_callback(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Exchange an authorize code for access + refresh tokens.
    Public route (Dropbox redirects an anon browser here) — CSRF
    is enforced via the `state` allowlist minted in `/oauth/start`.
    On success, writes both tokens to `.env` and warms an
    in-process env update so the running backend picks up the new
    creds without a restart.

    Body shape (POSTed by the React callback page):
      { "code": "...", "state": "..." }
    """
    code = (body.get("code") or "").strip()
    state = (body.get("state") or "").strip()
    if not code or not state:
        raise HTTPException(400, "code and state are required")

    # CSRF check.
    minted = _OAUTH_STATES.pop(state, None)
    if minted is None:
        raise HTTPException(400, "unknown or expired state token")
    if time.time() - minted > _OAUTH_STATE_TTL_S:
        raise HTTPException(400, "state token expired — restart the flow")

    app_key = os.environ.get("DROPBOX_APP_KEY", "").strip()
    app_secret = os.environ.get("DROPBOX_APP_SECRET", "").strip()
    if not app_key or not app_secret:
        raise HTTPException(500, "Dropbox app credentials missing from env")

    # Exchange code → tokens.
    try:
        r = requests.post(
            _DROPBOX_TOKEN_URL,
            data={
                "code": code,
                "grant_type": "authorization_code",
                "client_id": app_key,
                "client_secret": app_secret,
                "redirect_uri": _DROPBOX_REDIRECT_URI,
            },
            timeout=15,
        )
    except requests.RequestException as e:
        raise HTTPException(502, _redact(f"token exchange request failed: {e}"))
    if r.status_code != 200:
        raise HTTPException(
            502,
            _redact(f"Dropbox token exchange HTTP {r.status_code}: {r.text[:400]}"),
        )
    payload = r.json()
    access = payload.get("access_token")
    refresh = payload.get("refresh_token")
    account_id = payload.get("account_id")
    scope = payload.get("scope") or ""
    if not access or not refresh:
        raise HTTPException(
            502,
            "Dropbox response missing tokens (expected access_token + refresh_token — "
            "did you request `token_access_type=offline`?)",
        )

    # Persist to .env AND to in-process env so the SDK picks up
    # immediately without a supervisor restart.
    _env_upsert({
        "DROPBOX_ACCESS_TOKEN": access,
        "DROPBOX_REFRESH_TOKEN": refresh,
    })
    os.environ["DROPBOX_ACCESS_TOKEN"] = access
    os.environ["DROPBOX_REFRESH_TOKEN"] = refresh

    # Fire a quick identity probe so we can echo the account email
    # back to the frontend for the "Connected as ..." UI.
    email = None
    try:
        dbx = _get_dbx_client()
        me = dbx.users_get_current_account()
        email = me.email
    except Exception as e:  # noqa: BLE001
        # Non-fatal — health endpoint will surface any downstream issue.
        pass

    return {
        "ok": True,
        "account_id": account_id,
        "account_email": email,
        "scope": scope,
    }


# ── live probe used by /health ─────────────────────────────────
def _live_probe() -> Dict[str, Any]:
    """Sub-second probe. Uses the refresh-token-aware SDK client so an
    expired access token is transparently swapped for a fresh one."""
    out: Dict[str, Any] = {
        "connected": False,
        "team_admin": False,
        "scopes_ok": False,
        "team_folder_found": False,
        "team_folder_name": os.environ.get(
            "DROPBOX_TEAM_FOLDER_NAME", "Paneltec-General Administration"
        ),
        "team_folder_id": None,
        "account_email": None,
        "root_namespace_id": None,
        "top_level_folder_count": None,
        "top_level_file_count": None,
        "refresh_token_present": bool(
            os.environ.get("DROPBOX_REFRESH_TOKEN", "").strip()
        ),
        "diagnostic": None,
    }
    try:
        dbx_user = _get_dbx_client()
    except Exception as e:  # noqa: BLE001
        out["diagnostic"] = _redact(f"client init failed: {e}")
        return out

    # Identity probe.
    try:
        me = dbx_user.users_get_current_account()
        out["connected"] = True
        out["account_email"] = me.email
        out["root_namespace_id"] = me.root_info.root_namespace_id
    except Exception as e:  # noqa: BLE001
        out["diagnostic"] = _redact(f"users_get_current_account failed: {e}")
        return out

    # Team-scoped probe (nice-to-have; will fail on user-scoped tokens).
    try:
        import dropbox
        DropboxTeam = dropbox.DropboxTeam
        token = os.environ.get("DROPBOX_ACCESS_TOKEN", "").strip()
        if token:
            dbx_team = DropboxTeam(token)
            dbx_team.team_get_info()
            out["team_admin"] = True
    except Exception:
        pass

    # Scope + team-folder probe.
    try:
        from dropbox.common import PathRoot
        from dropbox.files import FolderMetadata
        dbx_root = dbx_user.with_path_root(
            PathRoot.namespace_id(out["root_namespace_id"])
        )
        res = dbx_root.files_list_folder("", recursive=False)
        out["scopes_ok"] = True
        folders = 0
        files = 0
        target = out["team_folder_name"].strip().lower()
        for e in res.entries:
            if isinstance(e, FolderMetadata):
                folders += 1
                if e.name.strip().lower() == target:
                    out["team_folder_found"] = True
                    sfid = getattr(e, "shared_folder_id", None)
                    out["team_folder_id"] = sfid or e.id
            else:
                files += 1
        out["top_level_folder_count"] = folders
        out["top_level_file_count"] = files
    except Exception as e:  # noqa: BLE001
        msg = _redact(str(e))
        if "files.metadata.read" in msg:
            out["diagnostic"] = (
                "Dropbox app is missing the `files.metadata.read` scope. "
                "Grant it in App Console → Permissions then reconnect "
                "via the OAuth flow."
            )
        else:
            out["diagnostic"] = f"list_folder failed: {msg}"

    return out


# ── artifact overlay (last full audit run) ─────────────────────
def _load_artifact() -> Optional[Dict[str, Any]]:
    p = Path("/app/memory/dropbox_phase0_audit_v58_13_132lb.json")
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


@router.get("/health")
def dropbox_health(user: dict = Depends(_require_admin)) -> Dict[str, Any]:
    """Admin-gated Dropbox connection + audit summary."""
    live = _live_probe()
    art = _load_artifact()
    payload: Dict[str, Any] = {
        "connected": live["connected"],
        "team_admin": live["team_admin"],
        "scopes_ok": live["scopes_ok"],
        "team_folder_found": live["team_folder_found"],
        "team_folder_id": live["team_folder_id"],
        "team_folder_name": live["team_folder_name"],
        "account_email": live["account_email"],
        "top_level_folder_count": live["top_level_folder_count"],
        "estimated_total_files": None,
        "estimated_total_gb": None,
        "refresh_token_present": live["refresh_token_present"],
        "diagnostic": live["diagnostic"],
        "artifact_present": art is not None,
        "phase": "0-audit",
    }
    if art:
        payload["estimated_total_files"] = art.get("estimated_total_files")
        bytes_ = art.get("estimated_total_bytes") or 0
        payload["estimated_total_gb"] = (
            round(bytes_ / (1024 ** 3), 3) if bytes_ else 0
        )
        if payload["top_level_folder_count"] is None:
            payload["top_level_folder_count"] = art.get("top_level_folder_count")
        if not payload["team_folder_found"] and art.get("team_folder_found"):
            payload["team_folder_found"] = True
            payload["team_folder_id"] = art.get("team_folder_id")
    return payload
