"""v58.13.132lb — Dropbox integration Phase 0 (audit-only).
v58.13.132ld — Added OAuth authorize + refresh-token flow (Pivot C).
v58.13.132le — Added Phase 1 folder-tree mirror trigger + status.

Endpoints:

  GET  /api/dropbox/health              (admin)  — connect + scope diagnostic
  GET  /api/dropbox/oauth/start         (admin)  — begin OAuth authorize flow
  POST /api/dropbox/oauth/callback      (public) — code → token exchange
  POST /api/dropbox/mirror-run          (admin)  — kick off async folder mirror
  GET  /api/dropbox/mirror-status/{id}  (admin)  — poll mirror job progress

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

import asyncio
import json
import logging
import os
import re
import secrets
import time
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, Optional

import requests
from fastapi import APIRouter, Body, Depends, HTTPException

from auth import get_current_user

log = logging.getLogger("paneltec.dropbox")
router = APIRouter(prefix="/dropbox", tags=["dropbox"])

# v58.13.132mb — Strong references to background tasks so Python's
# WeakSet-based asyncio._all_tasks doesn't GC them mid-execution.
# Root cause of the .132lm silent-death bug: `asyncio.create_task(...)`
# without a held ref → task collected after first `await` yield → the
# copy job wrote initial "running" status then vanished, no bytes ever
# enqueued, no traceback logged. The done-callback removes the ref
# once the task settles so this set stays bounded.
_BACKGROUND_TASKS: set = set()

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
_DROPBOX_SCOPES = (
    "account_info.read "
    "files.metadata.read files.content.read sharing.read"
)


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

    # Identity probe — nice-to-have. Needs `account_info.read` scope
    # which is NOT in our default scope set (`files.metadata.read
    # files.content.read sharing.read`). Failing here is expected on
    # tokens minted without account_info.read; it must NOT flip
    # `connected` to false because the data-plane below is what
    # actually decides whether the mirror pipeline can work.
    try:
        me = dbx_user.users_get_current_account()
        out["account_email"] = me.email
        out["root_namespace_id"] = me.root_info.root_namespace_id
    except Exception as e:  # noqa: BLE001
        msg = _redact(str(e))
        if "account_info.read" in msg:
            # Fall back to a hard-coded root ns lookup — we captured
            # this during the `.132lb` OAuth completion. Not ideal
            # (would break if the account moves teams) but keeps the
            # health endpoint functional without re-consenting the
            # user to widen scopes.
            out["root_namespace_id"] = os.environ.get(
                "DROPBOX_ROOT_NAMESPACE_ID", "2673752851"
            )
        else:
            out["diagnostic"] = _redact(f"users_get_current_account failed: {e}")
            # Non-fatal — keep going.

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

    # Scope + team-folder probe — THIS is the authoritative
    # "connected" signal because it's what the mirror pipeline
    # actually calls. Data-plane success flips `connected: true`
    # regardless of whether the identity endpoint worked.
    try:
        from dropbox.common import PathRoot
        from dropbox.files import FolderMetadata
        team_folder_path = "/" + out["team_folder_name"]
        dbx_root = dbx_user.with_path_root(
            PathRoot.namespace_id(out["root_namespace_id"])
        )
        res = dbx_root.files_list_folder(
            team_folder_path, recursive=False,
        )
        # If we got here, the token can list files. That's the
        # scope we care about.
        out["connected"] = True
        out["scopes_ok"] = True
        folders = 0
        files = 0
        for e in res.entries:
            if isinstance(e, FolderMetadata):
                folders += 1
            else:
                files += 1
        out["top_level_folder_count"] = folders
        out["top_level_file_count"] = files
        out["team_folder_found"] = True
        # team_folder_id is captured in the .132lb artifact; overlay
        # in the /health handler picks it up.
    except Exception as e:  # noqa: BLE001
        msg = _redact(str(e))
        if "files.metadata.read" in msg:
            out["diagnostic"] = (
                "Dropbox app is missing the `files.metadata.read` scope. "
                "Grant it in App Console → Permissions then reconnect "
                "via the OAuth flow."
            )
        elif "not_found" in msg.lower() or "path/not_found" in msg:
            out["diagnostic"] = (
                f"Team folder path {team_folder_path!r} not found in the "
                f"authorised account's root namespace. Check the "
                f"`DROPBOX_TEAM_FOLDER_NAME` env var + the account has "
                f"the folder mounted."
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
        # team_folder_id — always prefer the artifact when the live
        # probe couldn't capture it (data-plane list_folder doesn't
        # return the shared_folder_id for the folder we're inside).
        if not payload["team_folder_id"] and art.get("team_folder_id"):
            payload["team_folder_id"] = art.get("team_folder_id")
        if not payload["team_folder_found"] and art.get("team_folder_found"):
            payload["team_folder_found"] = True
    return payload


# ── Phase 1 mirror trigger + status ────────────────────────────
#
# In-process job registry. Keys are job_id → dict; keeps only the
# last 8 jobs to bound memory. Restart-safe? No — jobs in flight at
# restart are lost. We accept that: the mirror is idempotent, so a
# restart just means the admin re-fires it. Real durability would
# require persisting to Mongo (`dropbox_mirror_jobs`) — deferred to
# a later phase if we ever need multi-worker deployment.
_MIRROR_JOBS: Dict[str, Dict[str, Any]] = {}
_MIRROR_JOB_ORDER: Deque[str] = deque(maxlen=8)
_MIRROR_LOCK = asyncio.Lock()


def _mirror_progress_handler(job_id: str):
    def _on(evt: Dict[str, Any]) -> None:
        job = _MIRROR_JOBS.get(job_id)
        if not job:
            return
        job["last_event"] = evt
        if evt.get("phase") == "upsert":
            job["progress"] = {
                "index": evt.get("index"),
                "total": evt.get("total"),
                "created": evt.get("created"),
                "updated": evt.get("updated"),
                "depth": evt.get("depth"),
                "current_path": evt.get("current_path"),
            }
        elif evt.get("phase") == "walk":
            job["walk"] = {"folders_seen": evt.get("folders_seen")}
        elif evt.get("phase") == "done":
            job["summary"] = evt.get("totals")
    return _on


async def _run_mirror_job(job_id: str, dry_run: bool) -> None:
    """Background task — never raises; errors captured in job state."""
    from dropbox_folder_mirror import run_mirror
    _MIRROR_JOBS[job_id]["status"] = "running"
    try:
        summary = await run_mirror(
            dry_run=dry_run,
            on_progress=_mirror_progress_handler(job_id),
        )
        _MIRROR_JOBS[job_id]["summary"] = summary
        _MIRROR_JOBS[job_id]["status"] = (
            "completed" if not summary.get("errors") else "failed"
        )
    except Exception as e:  # noqa: BLE001
        _MIRROR_JOBS[job_id]["status"] = "failed"
        _MIRROR_JOBS[job_id]["error"] = _redact(str(e))
        log.exception("mirror job %s crashed", job_id)
    finally:
        _MIRROR_JOBS[job_id]["finished_at"] = time.time()


@router.post("/mirror-run")
async def dropbox_mirror_run(
    body: Optional[Dict[str, Any]] = Body(default=None),
    user: dict = Depends(_require_admin),
) -> Dict[str, Any]:
    """Kick off the Phase 1 folder-tree mirror as an async task.
    Returns immediately with `{job_id, status: started}`.
    Body (optional): `{"dry_run": true}` for a read-only walk.
    A single job may be in flight at a time; a second POST while
    another is running returns 409 with the running job's id."""
    async with _MIRROR_LOCK:
        for jid in _MIRROR_JOB_ORDER:
            j = _MIRROR_JOBS.get(jid)
            if j and j.get("status") in {"queued", "running"}:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": "mirror job already running",
                        "job_id": jid,
                        "started_at": j.get("started_at"),
                    },
                )

        dry_run = bool((body or {}).get("dry_run"))
        job_id = f"mirror-{secrets.token_hex(6)}"
        _MIRROR_JOBS[job_id] = {
            "job_id": job_id,
            "dry_run": dry_run,
            "status": "queued",
            "started_at": time.time(),
            "started_by": user.get("email") or user.get("id"),
            "finished_at": None,
            "walk": None,
            "progress": None,
            "summary": None,
            "last_event": None,
            "error": None,
        }
        _MIRROR_JOB_ORDER.append(job_id)
        asyncio.create_task(_run_mirror_job(job_id, dry_run))

    return {"job_id": job_id, "status": "started", "dry_run": dry_run}


@router.get("/mirror-status/{job_id}")
def dropbox_mirror_status(
    job_id: str,
    user: dict = Depends(_require_admin),
) -> Dict[str, Any]:
    """Poll a mirror job's live progress + final summary."""
    j = _MIRROR_JOBS.get(job_id)
    if not j:
        raise HTTPException(404, "job_id not found (or evicted from ring buffer)")
    return {
        "job_id": j["job_id"],
        "dry_run": j["dry_run"],
        "status": j["status"],
        "started_at": j["started_at"],
        "finished_at": j["finished_at"],
        "walk": j["walk"],
        "progress": j["progress"],
        "summary": j["summary"],
        "error": j["error"],
    }


@router.get("/mirror-jobs")
def dropbox_mirror_jobs(user: dict = Depends(_require_admin)) -> Dict[str, Any]:
    """List the last N mirror jobs (bounded ring buffer, most-recent last)."""
    return {
        "jobs": [
            {
                "job_id": jid,
                "dry_run": _MIRROR_JOBS[jid]["dry_run"],
                "status": _MIRROR_JOBS[jid]["status"],
                "started_at": _MIRROR_JOBS[jid]["started_at"],
                "finished_at": _MIRROR_JOBS[jid]["finished_at"],
            }
            for jid in list(_MIRROR_JOB_ORDER)
            if jid in _MIRROR_JOBS
        ],
    }


# ── v58.13.132lj — Phase 2b Ship 1: file-enum + streaming probe ─
@router.post("/enum/start")
async def dropbox_enum_start(
    body: Optional[Dict[str, Any]] = Body(default=None),
    user: dict = Depends(_require_admin),
) -> Dict[str, Any]:
    """Kick off the file-metadata enumeration walk as a background
    task. Optional body: `{"agent_id": "…"}` targets a specific
    NAS agent for the large-file streaming probe (defaults to the
    freshest agent). Returns immediately with `{job_id, state}`.

    Only one enum job at a time — a second POST while an existing
    job is running/complete returns the existing job's status."""
    import dropbox_file_enum as enum
    latest = await enum.latest_status()
    if latest and latest.get("state") in {"running", "walk-complete"}:
        return {"job_id": latest["job_id"], "state": latest["state"],
                "note": "existing job in flight"}
    job_id = f"enum-{secrets.token_hex(6)}"
    agent_id = (body or {}).get("agent_id")
    asyncio.create_task(enum.run_enum_job(job_id, agent_id=agent_id))
    log.info("dropbox_enum kicked off job_id=%s agent_id=%s", job_id, agent_id)
    return {"job_id": job_id, "state": "started",
              "agent_id": agent_id or "auto"}


@router.get("/enum/status")
async def dropbox_enum_status(
    user: dict = Depends(_require_admin),
) -> Dict[str, Any]:
    """Return the latest enum job's status doc from
    `dropbox_migration_status`. Empty payload with `state: none`
    when no job has ever run."""
    import dropbox_file_enum as enum
    s = await enum.latest_status()
    return s or {"state": "none"}


# ── v58.13.132lm — Phase 2b Ship 2: bytes-copy engine ───────────
@router.post("/migration/start")
async def dropbox_migration_start(
    body: Optional[Dict[str, Any]] = Body(default=None),
    user: dict = Depends(_require_admin),
) -> Dict[str, Any]:
    """Kick off the bytes-copy run as a background task.
    Body: `{agent_id: str, dry_run: bool = false}`.
    `dry_run=true` walks `dropbox_files_enum` and counts what
    would be copied (no NAS ops, no Dropbox API calls beyond the
    walk). `dry_run=false` fires the real fetch_and_put chain."""
    import dropbox_bytes_copy as bcopy
    body = body or {}
    dry_run = bool(body.get("dry_run", False))
    agent_id = body.get("agent_id") or ""
    if not dry_run and not agent_id:
        raise HTTPException(400, "agent_id required for a real run")

    latest = await bcopy.latest_status()
    if latest and latest.get("state") in {
        "running", "dry-run-running",
    }:
        return {"run_id": latest["run_id"],
                "state": latest["state"],
                "note": "existing run in flight"}

    run_id = f"copy-{secrets.token_hex(6)}"
    # v58.13.132mb — hold a strong ref + auto-remove on completion so
    # Python 3.11's WeakSet _all_tasks doesn't GC the coroutine
    # after its first await yield (see _BACKGROUND_TASKS docstring).
    task = asyncio.create_task(
        bcopy.run_copy_job(run_id, agent_id, dry_run=dry_run)
    )
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    log.info("dropbox_migration kicked off run_id=%s agent_id=%s "
                "dry_run=%s", run_id, agent_id, dry_run)
    return {"run_id": run_id, "state": "started",
              "agent_id": agent_id or None, "dry_run": dry_run}


@router.get("/migration/status")
async def dropbox_migration_status(
    user: dict = Depends(_require_admin),
) -> Dict[str, Any]:
    """Latest run doc from `dropbox_migration_run`."""
    import dropbox_bytes_copy as bcopy
    s = await bcopy.latest_status()
    if not s:
        s = {"state": "none"}
    # v58.13.132mm — surface watchdog telemetry on the status payload
    # so the admin UI can render "auto-resumed 3× · needs attention".
    s["watchdog_enabled"] = await _watchdog_enabled()
    s["auto_resume_count"] = s.get("auto_resume_count") or 0
    s["last_auto_resume_at"] = s.get("last_auto_resume_at")
    s["needs_attention"] = bool(s.get("needs_attention_reason"))
    return s


# ── v58.13.132mg — Restart-recovery + resume endpoint ─────────────
# Extended in v58.13.132mm — auto-resume watchdog (boot + periodic).
_AUTO_RESUME_TERMINAL_REASONS = {
    "user_cancelled", "hard_fail_limit_hit",
}
# v58.13.132my — Interrupt reasons that are NOT the migration's fault
# (backend restarts, boot-time zombie sweeps). Auto-resuming these
# does NOT increment the strike counter and never trips the cap —
# they're artefactual, not evidence of a stuck fetch_and_put.
_AUTO_RESUME_NON_STRIKING_REASON_PREFIXES = (
    "backend_restart",
    "backend restart",   # legacy string from sweep_zombie_migration_runs
)


def _is_non_striking_reason(reason: str) -> bool:
    r = (reason or "").strip().lower()
    return any(r.startswith(p) for p in _AUTO_RESUME_NON_STRIKING_REASON_PREFIXES)


# Cap consecutive auto-resumes without progress. On the 6th cycle
# without any files_copied advance we flip state=needs_attention.
_AUTO_RESUME_MAX_STRIKES = 5
# Periodic-watchdog cutoffs.
_WATCHDOG_RUNNING_STALE_MIN = 10
_WATCHDOG_INTERRUPT_STALE_MIN = 1


async def _watchdog_enabled() -> bool:
    """Read the global watchdog on/off flag. Default: enabled."""
    from db import db as _db
    doc = await _db.migration_watchdog_settings.find_one(
        {"key": "watchdog"}, {"_id": 0, "enabled": 1},
    )
    if not doc:
        return True
    return bool(doc.get("enabled", True))


async def _launch_resume_task(run_doc: dict, *, source: str) -> Optional[str]:
    """Fire a resume for `run_doc`. Enforces the 5-strike cap and
    updates auto_resume counters on the ORIGINAL run doc before
    starting the new task. Returns new_run_id, or None if skipped."""
    from datetime import datetime, timezone
    from db import db as _db
    import dropbox_bytes_copy as bcopy

    original_id = run_doc.get("run_id")
    agent_id = run_doc.get("agent_id")
    if not original_id or not agent_id:
        log.warning(
            "[watchdog] cannot auto-resume %s: missing run_id/agent_id",
            original_id,
        )
        return None

    reason = (run_doc.get("interrupt_reason") or "").strip().lower()
    if reason in _AUTO_RESUME_TERMINAL_REASONS:
        log.info(
            "[watchdog] skipping %s: terminal reason=%r",
            original_id, reason,
        )
        return None

    # v58.13.132my — Restart-caused interrupts don't reflect a real
    # copy failure. Skip strike accounting entirely so a dev-heavy
    # restart cascade can't burn through the 5-strike budget.
    non_striking = _is_non_striking_reason(reason)

    strikes = int(run_doc.get("auto_resume_count") or 0)
    files_copied = int(run_doc.get("files_copied") or 0)
    last_progress_at = run_doc.get("last_progress_files_copied")
    # Reset strike counter each time files_copied advances vs the
    # snapshot taken at the last auto-resume.
    if last_progress_at is None or files_copied > int(last_progress_at):
        strikes = 0

    if strikes >= _AUTO_RESUME_MAX_STRIKES and not non_striking:
        now_iso = datetime.now(timezone.utc).isoformat()
        await _db.dropbox_migration_run.update_one(
            {"run_id": original_id},
            {"$set": {
                "state": "needs_attention",
                "needs_attention_reason": (
                    f"auto-resume hit {strikes}-strike cap without "
                    "files_copied advancing — investigate"
                ),
                "updated_at": now_iso,
            }},
        )
        log.warning(
            "[watchdog] %s hit 5-strike cap → state=needs_attention",
            original_id,
        )
        return None

    new_run_id = f"copy-{secrets.token_hex(6)}"
    now_iso = datetime.now(timezone.utc).isoformat()
    # v58.13.132my — Skip strike increment when the interrupt was
    # restart-caused. Everything else on the counter row is still
    # written so the run history stays intact.
    new_strikes = strikes if non_striking else strikes + 1
    await _db.dropbox_migration_run.update_one(
        {"run_id": original_id},
        {"$set": {
            "auto_resume_count": new_strikes,
            "last_auto_resume_at": now_iso,
            "last_progress_files_copied": files_copied,
            "last_auto_resumed_into": new_run_id,
            "updated_at": now_iso,
        }},
    )
    task = asyncio.create_task(
        bcopy.run_copy_job(new_run_id, agent_id, dry_run=False),
    )
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    log.warning(
        "[watchdog:%s] AUTO-RESUME %s -> %s (strike %d/%d%s)",
        source, original_id, new_run_id, new_strikes,
        _AUTO_RESUME_MAX_STRIKES,
        " · non-striking (restart)" if non_striking else "",
    )
    return new_run_id


async def sweep_zombie_migration_runs() -> Dict[str, int]:
    """Called once on backend startup. Marks any `state=running`
    migration doc whose `updated_at` is older than 5 min as
    `interrupted` — the previous uvicorn worker died mid-run and
    the task can't recover its own state doc from a hard SIGTERM.
    v58.13.132mm — Auto-fires resume for the most recent interrupted
    run per agent (unless watchdog is paused or reason is terminal).
    Returns `{marked_interrupted, auto_resumed}` for the startup log.
    """
    from datetime import datetime, timezone, timedelta
    from db import db as _db   # v58.13.132mg — canonical db module
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()
    n = 0
    async for run in _db.dropbox_migration_run.find(
        {"state": {"$in": ["running", "dry-run-running"]},
         "updated_at": {"$lt": cutoff}},
        {"_id": 0, "run_id": 1},
    ):
        rid = run["run_id"]
        r = await _db.dropbox_migration_run.update_one(
            {"run_id": rid,
             "state": {"$in": ["running", "dry-run-running"]}},
            {"$set": {
                "state": "interrupted",
                "updated_at": now_iso,
                "interrupted_at": now_iso,
                "interrupt_reason": "backend restart (auto-swept on boot)",
            }},
        )
        if r.modified_count:
            n += 1
            log.warning(
                "[migration-sweep] marked run %s as interrupted", rid,
            )
        # Also clear any stale in_flight ops on this run so a resume
        # doesn't wait forever on a ghost.
        await _db.nas_ops.update_many(
            {"meta.run_id": rid, "status": "in_flight"},
            {"$set": {
                "status": "error",
                "error": ("orphaned — agent-ack never received "
                          "before backend restart"),
                "finished_at": now_iso,
            }},
        )
    # v58.13.132mm — Auto-resume the most recent interrupted run per
    # agent (dedupe by agent_id so we don't double-fire on a fleet).
    auto_resumed = 0
    if await _watchdog_enabled():
        seen_agents: set = set()
        cursor = _db.dropbox_migration_run.find(
            {"state": "interrupted"},
            sort=[("updated_at", -1)],
        )
        async for run in cursor:
            agent_id = run.get("agent_id") or ""
            if not agent_id or agent_id in seen_agents:
                continue
            seen_agents.add(agent_id)
            new_id = await _launch_resume_task(run, source="boot")
            if new_id:
                auto_resumed += 1
    return {"marked_interrupted": n, "auto_resumed": auto_resumed}


async def watchdog_tick() -> Dict[str, Any]:
    """v58.13.132mm — Periodic watchdog. APScheduler fires this
    every 5 min. Two behaviours:
      · state=running + updated_at > 10 min old → mark interrupted
        (the state doc is stuck; the task is dead).
      · state=interrupted + non-terminal reason → auto-resume
        (respects the 5-strike cap).
    Skipped when the watchdog is globally paused."""
    from datetime import datetime, timezone, timedelta
    from db import db as _db

    if not await _watchdog_enabled():
        return {"ok": True, "skipped": "watchdog_paused"}

    now = datetime.now(timezone.utc)
    running_cutoff = (
        now - timedelta(minutes=_WATCHDOG_RUNNING_STALE_MIN)
    ).isoformat()
    marked = 0
    resumed = 0

    # 1. Force-interrupt stale-running runs.
    async for run in _db.dropbox_migration_run.find(
        {"state": {"$in": ["running", "dry-run-running"]},
         "updated_at": {"$lt": running_cutoff}},
        {"_id": 0, "run_id": 1},
    ):
        rid = run["run_id"]
        r = await _db.dropbox_migration_run.update_one(
            {"run_id": rid,
             "state": {"$in": ["running", "dry-run-running"]}},
            {"$set": {
                "state": "interrupted",
                "interrupted_at": now.isoformat(),
                "updated_at": now.isoformat(),
                "interrupt_reason": "watchdog (stale updated_at)",
            }},
        )
        if r.modified_count:
            marked += 1
            log.warning(
                "[watchdog] force-interrupted stale run %s", rid,
            )

    # 2. Auto-resume interrupted runs, one per agent.
    seen_agents: set = set()
    async for run in _db.dropbox_migration_run.find(
        {"state": "interrupted"},
        sort=[("updated_at", -1)],
    ):
        agent_id = run.get("agent_id") or ""
        if not agent_id or agent_id in seen_agents:
            continue
        seen_agents.add(agent_id)
        new_id = await _launch_resume_task(run, source="tick")
        if new_id:
            resumed += 1

    return {
        "ok": True, "marked_interrupted": marked, "auto_resumed": resumed,
    }


@router.post("/migration/watchdog/pause")
async def dropbox_watchdog_pause(
    user: dict = Depends(_require_admin),
) -> Dict[str, Any]:
    """v58.13.132mm — Globally pause the auto-resume watchdog."""
    from datetime import datetime, timezone
    from db import db as _db
    now_iso = datetime.now(timezone.utc).isoformat()
    await _db.migration_watchdog_settings.update_one(
        {"key": "watchdog"},
        {"$set": {
            "enabled": False,
            "updated_at": now_iso,
            "updated_by": user.get("id") or user.get("email") or "unknown",
        }},
        upsert=True,
    )
    log.warning("[watchdog] PAUSED by %s", user.get("email"))
    return {"watchdog_enabled": False, "updated_at": now_iso}


@router.post("/migration/watchdog/resume")
async def dropbox_watchdog_resume(
    user: dict = Depends(_require_admin),
) -> Dict[str, Any]:
    """v58.13.132mm — Re-enable the auto-resume watchdog."""
    from datetime import datetime, timezone
    from db import db as _db
    now_iso = datetime.now(timezone.utc).isoformat()
    await _db.migration_watchdog_settings.update_one(
        {"key": "watchdog"},
        {"$set": {
            "enabled": True,
            "updated_at": now_iso,
            "updated_by": user.get("id") or user.get("email") or "unknown",
        }},
        upsert=True,
    )
    log.info("[watchdog] RESUMED by %s", user.get("email"))
    return {"watchdog_enabled": True, "updated_at": now_iso}


@router.post("/migration/{run_id}/resume")
async def dropbox_migration_resume(
    run_id: str,
    user: dict = Depends(_require_admin),
) -> Dict[str, Any]:
    """Resume a run that was `interrupted` by a previous restart.
    Fires a fresh copy task using the same `agent_id` from the
    interrupted run doc. Skips enum rows with
    `copy_state=copied` so already-transferred files aren't
    re-copied. Idempotent — resuming a completed run is a no-op."""
    import dropbox_bytes_copy as bcopy
    run = await bcopy.get_run(run_id)
    if not run:
        raise HTTPException(404, f"run {run_id} not found")
    if run.get("state") not in {"interrupted", "failed", "cancelled"}:
        raise HTTPException(
            409,
            f"run state is {run.get('state')!r} — "
            "only interrupted/failed/cancelled runs can be resumed",
        )
    agent_id = run.get("agent_id")
    if not agent_id:
        raise HTTPException(422, "run has no agent_id — cannot resume")
    new_run_id = f"copy-{secrets.token_hex(6)}"
    task = asyncio.create_task(
        bcopy.run_copy_job(new_run_id, agent_id, dry_run=False),
    )
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    log.info(
        "dropbox_migration RESUMED old_run=%s new_run=%s agent=%s",
        run_id, new_run_id, agent_id,
    )
    return {
        "resumed_from": run_id,
        "new_run_id": new_run_id,
        "state": "started",
        "agent_id": agent_id,
    }



# ── v58.13.132my — graceful-shutdown hook + false-cap cleanup ─────
async def shutdown_migration_jobs(*, drain_timeout_s: float = 2.0) -> Dict[str, Any]:
    """Called from FastAPI's `on_shutdown` before the event loop tears
    down. Mirrors `.132mq`'s backup shutdown pattern:

      1. Cancel all tracked `_BACKGROUND_TASKS`. The tasks' own
         `except BaseException` handlers will TRY to write a final
         status via motor — but motor's sync-in-thread executor gets
         cancelled by the loop teardown, so we can't rely on that.
      2. Wait bounded (`drain_timeout_s`) for the cancellations to
         propagate.
      3. Fallback bulk-update: any doc still in `state=running` is
         forcibly flipped to `state=interrupted` +
         `interrupt_reason=backend_restart`. Uses motor's async
         `update_many` — NOT sync pymongo. This step is what
         actually guarantees the run doc reflects reality after a
         SIGTERM.

    Never blocks shutdown indefinitely — the bounded wait is
    strict, and the final DB write is a single `update_many` with
    a short server-side deadline.
    """
    from datetime import datetime, timezone
    from db import db as _db

    log.warning(
        "[migration-shutdown] entering (drain=%.1fs)", drain_timeout_s,
    )
    report: Dict[str, Any] = {
        "tasks_cancelled": 0,
        "wait_completed": False,
        "docs_flipped": 0,
    }

    # 1 — cancel every tracked background task.
    live = [t for t in list(_BACKGROUND_TASKS) if not t.done()]
    for t in live:
        t.cancel()
    report["tasks_cancelled"] = len(live)

    # 2 — bounded drain so the tasks' finalizers get a chance to
    # run. asyncio.wait swallows CancelledError from the awaited
    # tasks so we don't have to catch it.
    if live:
        try:
            await asyncio.wait(live, timeout=drain_timeout_s)
            report["wait_completed"] = True
        except Exception as e:  # noqa: BLE001 — must never block shutdown
            log.warning("[migration-shutdown] drain wait failed: %s", e)

    # 3 — best-effort DB fix-up for anything left as state=running.
    # Uses motor's async client (NOT sync pymongo) so a mid-loop
    # SIGTERM doesn't hang us mid-write.
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        r = await _db.dropbox_migration_run.update_many(
            {"state": {"$in": ["running", "dry-run-running"]}},
            {"$set": {
                "state": "interrupted",
                "interrupt_reason": "backend_restart",
                "interrupted_at": now_iso,
                "updated_at": now_iso,
            }},
        )
        report["docs_flipped"] = r.modified_count
        if r.modified_count:
            log.warning(
                "[migration-shutdown] flipped %d state=running "
                "doc(s) to interrupted (backend_restart)",
                r.modified_count,
            )
    except Exception as e:  # noqa: BLE001 — never block shutdown
        log.warning("[migration-shutdown] db flip failed: %s", e)

    log.warning("[migration-shutdown] exiting report=%s", report)
    return report


async def cleanup_false_needs_attention_on_startup() -> Dict[str, Any]:
    """One-shot idempotent cleanup for the false-positive
    `state=needs_attention` flags produced by the pre-`.132my`
    strike accounting when the strike cascade was entirely
    restart-caused.

    Targets:
      · The specific run flagged by the user (`copy-25b404b74680`).
      · Every historical run whose `needs_attention_reason` starts
        with `"auto-resume hit"` — that string is only ever written
        by `_launch_resume_task` when the 5-strike cap is hit, and
        after `.132my` those strikes are only accumulated on real
        failures (restart-caused interrupts skip strike accounting).
        Clearing historical instances is safe and idempotent.

    Effect: `state=needs_attention` → `state=interrupted`,
    `interrupt_reason=backend_restart`, `needs_attention_reason`
    unset. This lets the watchdog auto-resume them on the next
    tick without hitting the (now-cleared) cap.
    """
    from datetime import datetime, timezone
    from db import db as _db

    now_iso = datetime.now(timezone.utc).isoformat()
    query = {
        "$or": [
            {"run_id": "copy-25b404b74680"},
            {"needs_attention_reason": {
                "$regex": "^auto-resume hit", "$options": "i",
            }},
        ],
    }
    # Count before flipping so we can report both the target
    # doc-set and the audit-friendly modified count.
    matched = await _db.dropbox_migration_run.count_documents(query)
    r = await _db.dropbox_migration_run.update_many(
        query,
        {
            "$set": {
                "state": "interrupted",
                "interrupt_reason": "backend_restart",
                "updated_at": now_iso,
            },
            "$unset": {"needs_attention_reason": "", "needs_attention": ""},
        },
    )
    report = {"matched": matched, "modified": r.modified_count}
    if r.modified_count:
        log.warning(
            "[cleanup-false-needs-attention] cleared %d run(s) "
            "(matched=%d)",
            r.modified_count, matched,
        )
    else:
        log.info("[cleanup-false-needs-attention] no rows to clear")
    return report
