"""Microsoft 365 (Graph) integration: OAuth2 auth-code + token mgmt + sendMail."""
from __future__ import annotations
import base64
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from auth import get_current_user, require_roles
from db import db
from models import now_iso

log = logging.getLogger("paneltec.m365")
router = APIRouter(prefix="/integrations/microsoft365", tags=["integrations-m365"])

# Short-lived in-memory state store. {state: {user_id, org_id, expires_at}}
_OAUTH_STATE: dict[str, dict] = {}
GRAPH_BASE = "https://graph.microsoft.com/v1.0"
SCOPE = "offline_access Mail.Send User.Read"


class M365Config(BaseModel):
    tenant_id: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    sender_email: Optional[EmailStr] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    token_expires_at: Optional[str] = None


def _frontend_url() -> str:
    return (os.environ.get("FRONTEND_PUBLIC_URL")
            or os.environ.get("FRONTEND_URL")
            or "http://localhost:3000").rstrip("/")


def _backend_url() -> str:
    # Same origin as frontend (kubernetes ingress). Callbacks hit /api/...
    return _frontend_url()


def _redirect_uri() -> str:
    return f"{_backend_url()}/api/integrations/microsoft365/oauth/callback"


async def _cfg(org_id: str) -> dict:
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "microsoft365"})
    if not doc or not doc.get("config"):
        raise HTTPException(400, "Microsoft 365 not configured")
    return doc["config"]


def _purge_states() -> None:
    now = datetime.now(timezone.utc)
    for k in list(_OAUTH_STATE.keys()):
        if _OAUTH_STATE[k]["expires_at"] < now:
            _OAUTH_STATE.pop(k, None)


@router.get("/oauth/start")
async def oauth_start(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _cfg(user["org_id"])
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        raise HTTPException(400, "Configure tenant_id, client_id, client_secret first.")
    _purge_states()
    state = secrets.token_urlsafe(24)
    _OAUTH_STATE[state] = {
        "user_id": user["id"],
        "org_id": user["org_id"],
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
    }
    params = {
        "client_id": cfg["client_id"],
        "response_type": "code",
        "redirect_uri": _redirect_uri(),
        "response_mode": "query",
        "scope": SCOPE,
        "state": state,
        "prompt": "consent",
    }
    authorize_url = (f"https://login.microsoftonline.com/{cfg['tenant_id']}"
                     f"/oauth2/v2.0/authorize?" + urlencode(params))
    return {"authorize_url": authorize_url, "redirect_uri": _redirect_uri()}


@router.get("/oauth/callback")
async def oauth_callback(code: str = Query(...), state: str = Query(...)):
    _purge_states()
    st = _OAUTH_STATE.pop(state, None)
    if not st:
        raise HTTPException(400, "Invalid or expired state")
    org_id = st["org_id"]
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "microsoft365"})
    if not doc:
        raise HTTPException(400, "M365 config missing")
    cfg = doc.get("config") or {}
    tenant = cfg.get("tenant_id")
    if not tenant:
        raise HTTPException(400, "tenant_id missing")
    url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _redirect_uri(),
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "scope": SCOPE,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, data=payload)
    except Exception as e:
        return RedirectResponse(
            f"{_frontend_url()}/app/settings/integrations/microsoft365?error="
            f"upstream_unreachable", status_code=302)
    data = {}
    try:
        data = r.json()
    except Exception:
        pass
    if r.status_code != 200 or not data.get("access_token"):
        msg = data.get("error_description") or data.get("error") or r.text[:200]
        log.warning("M365 callback token exchange failed: %s", msg)
        await db.integration_configs.update_one(
            {"org_id": org_id, "kind": "microsoft365"},
            {"$set": {"status": "error", "last_error": msg, "updated_at": now_iso()}},
        )
        return RedirectResponse(
            f"{_frontend_url()}/app/settings/integrations/microsoft365?error=token_exchange",
            status_code=302)
    expires_in = int(data.get("expires_in", 3600))
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in - 60)).isoformat()
    await db.integration_configs.update_one(
        {"org_id": org_id, "kind": "microsoft365"},
        {"$set": {
            "config.access_token": data["access_token"],
            "config.refresh_token": data.get("refresh_token"),
            "config.token_expires_at": expires_at,
            "status": "connected", "last_tested_at": now_iso(),
            "last_error": None, "updated_at": now_iso(),
        }},
    )
    return RedirectResponse(
        f"{_frontend_url()}/app/settings/integrations/microsoft365?connected=1",
        status_code=302)


async def _refresh_if_needed(org_id: str) -> Optional[str]:
    """Return a valid access_token, refreshing if expired. None on failure."""
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "microsoft365"})
    if not doc:
        return None
    cfg = doc.get("config") or {}
    token = cfg.get("access_token")
    expires_at = cfg.get("token_expires_at")
    if token and expires_at:
        try:
            ts = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) < ts:
                return token
        except Exception:
            pass
    # refresh
    rt = cfg.get("refresh_token")
    if not rt or not cfg.get("tenant_id"):
        return None
    url = f"https://login.microsoftonline.com/{cfg['tenant_id']}/oauth2/v2.0/token"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, data={
                "grant_type": "refresh_token",
                "refresh_token": rt,
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "scope": SCOPE,
                "redirect_uri": _redirect_uri(),
            })
    except Exception as e:
        log.warning("M365 refresh failed: %s", e)
        return None
    data = {}
    try:
        data = r.json()
    except Exception:
        pass
    if r.status_code != 200 or not data.get("access_token"):
        log.warning("M365 refresh denied: %s", data)
        return None
    expires_in = int(data.get("expires_in", 3600))
    new_expires = (datetime.now(timezone.utc) + timedelta(seconds=expires_in - 60)).isoformat()
    await db.integration_configs.update_one(
        {"org_id": org_id, "kind": "microsoft365"},
        {"$set": {
            "config.access_token": data["access_token"],
            "config.refresh_token": data.get("refresh_token", rt),
            "config.token_expires_at": new_expires,
            "updated_at": now_iso(),
        }},
    )
    return data["access_token"]


@router.post("/test-connection")
async def m365_test(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    token = await _refresh_if_needed(user["org_id"])
    if not token:
        raise HTTPException(400, "Not connected — start OAuth first.")
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{GRAPH_BASE}/me",
                            headers={"Authorization": f"Bearer {token}"})
    except Exception as e:
        raise HTTPException(502, f"Graph unreachable: {e}")
    if r.status_code != 200:
        msg = r.text[:200]
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "microsoft365"},
            {"$set": {"status": "error", "last_error": msg, "updated_at": now_iso()}},
        )
        raise HTTPException(400, f"Graph /me failed: HTTP {r.status_code} {msg}")
    data = r.json() or {}
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "microsoft365"},
        {"$set": {"status": "connected", "last_tested_at": now_iso(),
                  "last_error": None, "graph_user": {
                      "displayName": data.get("displayName"),
                      "userPrincipalName": data.get("userPrincipalName"),
                      "mail": data.get("mail"),
                  }, "updated_at": now_iso()}},
    )
    return {"displayName": data.get("displayName"),
            "email": data.get("mail") or data.get("userPrincipalName")}


@router.post("/disconnect")
async def m365_disconnect(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "microsoft365"},
        {"$set": {
            "config.access_token": None,
            "config.refresh_token": None,
            "config.token_expires_at": None,
            "graph_user": None,
            "status": "not_connected", "last_error": None,
            "updated_at": now_iso(),
        }},
    )
    return {"ok": True}


async def graph_send_mail(org_id: str, *, to: List[str], cc: List[str], subject: str,
                          body_html: str, attachments: List[dict]) -> dict:
    """Send an email via Graph. Returns {ok: bool, error?: str}.

    Caller should already know M365 is configured/connected. We refresh tokens
    transparently.
    """
    token = await _refresh_if_needed(org_id)
    if not token:
        return {"ok": False, "error": "no_valid_token"}
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "microsoft365"})
    cfg = (doc or {}).get("config") or {}
    sender = cfg.get("sender_email") or (doc or {}).get("graph_user", {}).get("mail")
    if not sender:
        return {"ok": False, "error": "sender_email_missing"}

    msg_attachments = []
    for a in attachments or []:
        # If file is local on disk, base64-encode. Otherwise skip (Graph requires
        # raw bytes — no remote URLs allowed).
        path = a.get("local_path") or a.get("file_url", "").replace("/api/files/", "")
        if path and os.path.exists(path):
            with open(path, "rb") as f:
                content = base64.b64encode(f.read()).decode("ascii")
            msg_attachments.append({
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": a.get("filename") or a.get("label") or "attachment",
                "contentBytes": content,
            })
    message = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": body_html},
        "toRecipients": [{"emailAddress": {"address": e}} for e in to],
        "ccRecipients": [{"emailAddress": {"address": e}} for e in (cc or [])],
        "attachments": msg_attachments,
    }
    url = f"{GRAPH_BASE}/users/{sender}/sendMail"
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(url,
                             headers={"Authorization": f"Bearer {token}",
                                      "Content-Type": "application/json"},
                             json={"message": message, "saveToSentItems": True})
    except Exception as e:
        return {"ok": False, "error": f"network: {e}"}
    if r.status_code in (200, 202):
        return {"ok": True}
    return {"ok": False, "error": f"HTTP {r.status_code} {r.text[:160]}"}


@router.post("/flush-queue")
async def m365_flush(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    """Drain `outbound_emails` where status=queued for this org, send each via Graph."""
    token = await _refresh_if_needed(user["org_id"])
    if not token:
        raise HTTPException(400, "Not connected — start OAuth first.")
    queued = await db.outbound_emails.find(
        {"org_id": user["org_id"], "status": "queued"}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    sent = failed = 0
    for em in queued:
        res = await graph_send_mail(
            user["org_id"],
            to=em.get("to", []), cc=em.get("cc", []),
            subject=em.get("subject", ""), body_html=em.get("body_html", ""),
            attachments=em.get("attachments", []),
        )
        if res["ok"]:
            await db.outbound_emails.update_one(
                {"id": em["id"]},
                {"$set": {"status": "sent", "provider": "microsoft365",
                          "sent_at": now_iso(), "error": None, "updated_at": now_iso()}},
            )
            sent += 1
        else:
            await db.outbound_emails.update_one(
                {"id": em["id"]},
                {"$set": {"status": "failed", "error": res["error"],
                          "updated_at": now_iso()}},
            )
            failed += 1
    return {"sent": sent, "failed": failed, "remaining_queued": 0}
