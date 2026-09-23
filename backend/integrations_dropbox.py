"""v58.13.132lb — Dropbox integration Phase 0 (audit-only).

Exposes `GET /api/dropbox/health` (admin-gated) which probes the
Dropbox token in `os.environ["DROPBOX_ACCESS_TOKEN"]` and reports:

  · connected          — token authenticates against Dropbox at all.
  · team_admin         — token is TEAM-scoped (can call /2/team/*).
  · scopes_ok          — files.metadata.read is granted.
  · team_folder_found  — DROPBOX_TEAM_FOLDER_NAME resolvable.
  · team_folder_id     — its namespace id (path_root anchor).
  · top_level_folder_count / estimated_total_files / estimated_total_gb
    — coarse audit numbers from the last audit script run
    (`/app/memory/dropbox_phase0_audit_v58_13_132lb.json`), or
    live-probed if the artifact is missing.

NEVER echoes the token value. Errors are surfaced as human-readable
strings with the token substring redacted defensively.

Admin gate mirrors the mobile+web `.132kt` gate:
    role ∈ {admin, hseq_lead, hseq_manager, hseq_manager_2,
            responsible_manager, report_emailing_admin, supervisor,
            manager}
    role_id ∈ {admin, hseq_manager, hseq_manager_readonly,
               hseq_manager_creator, responsible_manager,
               report_emailing_admin, hseq_manager_2}
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user

router = APIRouter(prefix="/dropbox", tags=["dropbox"])

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
        raise HTTPException(status_code=403,
                              detail="Admin only")
    return user


# ── secret-safe redaction ───────────────────────────────────────
def _redact(s: str) -> str:
    tok = os.environ.get("DROPBOX_ACCESS_TOKEN", "")
    sec = os.environ.get("DROPBOX_APP_SECRET", "")
    if tok and tok in s:
        s = s.replace(tok, "[REDACTED_TOKEN]")
    if sec and sec in s:
        s = s.replace(sec, "[REDACTED_APP_SECRET]")
    s = re.sub(r"sl\.u\.[A-Za-z0-9_\-]{40,}", "[REDACTED_SL_TOKEN]", s)
    return s


# ── live probe (kept fast — single call each) ───────────────────
def _live_probe() -> Dict[str, Any]:
    """Sub-second probe: users_get_current_account + a single
    files_list_folder at team_folder root path. Enough to answer the
    health question without walking the tree.
    """
    out: Dict[str, Any] = {
        "connected": False,
        "team_admin": False,
        "scopes_ok": False,
        "team_folder_found": False,
        "team_folder_name": os.environ.get("DROPBOX_TEAM_FOLDER_NAME",
                                             "Paneltec-General Administration"),
        "team_folder_id": None,
        "account_email": None,
        "root_namespace_id": None,
        "top_level_folder_count": None,
        "top_level_file_count": None,
        "diagnostic": None,
    }
    token = os.environ.get("DROPBOX_ACCESS_TOKEN", "").strip()
    if not token:
        out["diagnostic"] = "DROPBOX_ACCESS_TOKEN missing from env."
        return out

    try:
        import dropbox
        from dropbox import DropboxTeam
        from dropbox.common import PathRoot
        from dropbox.exceptions import ApiError, AuthError, BadInputError
        from dropbox.files import FolderMetadata, FileMetadata
    except ImportError as e:
        out["diagnostic"] = f"dropbox SDK not installed: {e}"
        return out

    # Team probe.
    try:
        dbx_team = DropboxTeam(token)
        dbx_team.team_get_info()
        out["team_admin"] = True
        out["connected"] = True
    except (Exception,) as e:  # AuthError / BadInputError / etc.
        # Not team-scoped — that's OK, keep going with user client.
        pass

    # User probe.
    try:
        dbx_user = dropbox.Dropbox(token)
        me = dbx_user.users_get_current_account()
        out["connected"] = True
        out["account_email"] = me.email
        out["root_namespace_id"] = me.root_info.root_namespace_id
    except Exception as e:
        out["diagnostic"] = _redact(f"users_get_current_account failed: {e}")
        return out

    # Scope + team-folder probe (one list_folder call at root ns).
    try:
        from dropbox.common import PathRoot
        from dropbox.files import FolderMetadata
        dbx_root = dbx_user.with_path_root(PathRoot.namespace_id(out["root_namespace_id"]))
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
            out["diagnostic"] = ("Dropbox app is missing the "
                                    "`files.metadata.read` scope. "
                                    "Grant it in App Console → Permissions "
                                    "then regenerate the access token.")
        else:
            out["diagnostic"] = f"list_folder failed: {msg}"

    return out


# ── artifact overlay (last full audit run) ──────────────────────
def _load_artifact() -> Optional[Dict[str, Any]]:
    """The Phase-0 audit script writes
    `/app/memory/dropbox_phase0_audit_v58_13_132lb.json`. If present,
    overlay projected totals onto the live probe."""
    p = Path("/app/memory/dropbox_phase0_audit_v58_13_132lb.json")
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


@router.get("/health")
def dropbox_health(user: dict = Depends(_require_admin)) -> Dict[str, Any]:
    """Admin-gated Dropbox connection + audit summary.

    Response is a flat JSON object with:
      connected, team_admin, scopes_ok, team_folder_found,
      team_folder_id, top_level_folder_count, estimated_total_files,
      estimated_total_gb, diagnostic (or null on healthy).
    """
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
        "diagnostic": live["diagnostic"],
        "artifact_present": art is not None,
        "phase": "0-audit",
    }
    if art:
        # Prefer the audit script's projections when live probe couldn't
        # complete (e.g. scope missing).
        payload["estimated_total_files"] = art.get("estimated_total_files")
        bytes_ = art.get("estimated_total_bytes") or 0
        payload["estimated_total_gb"] = round(bytes_ / (1024 ** 3), 3) if bytes_ else 0
        if payload["top_level_folder_count"] is None:
            payload["top_level_folder_count"] = art.get("top_level_folder_count")
        if not payload["team_folder_found"] and art.get("team_folder_found"):
            payload["team_folder_found"] = True
            payload["team_folder_id"] = art.get("team_folder_id")
    return payload
