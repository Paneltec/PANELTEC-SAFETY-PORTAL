"""Microsoft 365 / Graph SendMail integration — APP-ONLY (client_credentials).

No user OAuth dance. The app authenticates with its own credentials and sends
mail as a configured mailbox (Application permission Mail.Send).
"""
from __future__ import annotations
import base64
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from auth import require_roles
from db import db
from models import now_iso

log = logging.getLogger("paneltec.m365")
router = APIRouter(prefix="/integrations/microsoft365", tags=["integrations-m365"])

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
SCOPE = "https://graph.microsoft.com/.default"

# In-process token cache: {org_id: (access_token, expires_at)}
_TOKEN_CACHE: dict[str, tuple[str, datetime]] = {}


class M365Config(BaseModel):
    tenant_id: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    sender_email: Optional[EmailStr] = None
    reply_to: Optional[EmailStr] = None


async def _cfg(org_id: str) -> dict:
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "microsoft365"})
    if not doc or not doc.get("config"):
        raise HTTPException(400, "Microsoft 365 not configured")
    return doc["config"]


async def get_app_only_access_token(org_id: str) -> str:
    """Acquire (and cache) an app-only access token for Microsoft Graph.

    Raises HTTPException(400, …) on any failure with the upstream error message.
    """
    cached = _TOKEN_CACHE.get(org_id)
    now = datetime.now(timezone.utc)
    if cached and cached[1] > now:
        return cached[0]

    cfg = await _cfg(org_id)
    tenant = cfg.get("tenant_id")
    cid = cfg.get("client_id")
    secret = cfg.get("client_secret")
    if not tenant or not cid or not secret:
        raise HTTPException(400, "Tenant ID, Client ID and Client Secret are required.")

    url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, data={
                "client_id": cid,
                "client_secret": secret,
                "scope": SCOPE,
                "grant_type": "client_credentials",
            })
    except Exception as e:
        raise HTTPException(502, f"Microsoft token endpoint unreachable: {e}")

    data: dict = {}
    try:
        data = r.json()
    except Exception:
        pass
    if r.status_code != 200 or not data.get("access_token"):
        msg = data.get("error_description") or data.get("error") or r.text[:200]
        raise HTTPException(400, f"Microsoft token failed: {msg}")

    token = data["access_token"]
    expires_in = int(data.get("expires_in", 3600))
    _TOKEN_CACHE[org_id] = (token, now + timedelta(seconds=max(60, expires_in - 60)))
    return token


@router.post("/test-connection")
async def m365_test(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    """Self-test: fetch app-only token and send a self-test email via Graph."""
    cfg = await _cfg(user["org_id"])
    sender = cfg.get("sender_email")
    if not sender:
        raise HTTPException(400, "Send-from Mailbox is required.")
    # Clear cache so credentials are freshly validated.
    _TOKEN_CACHE.pop(user["org_id"], None)
    token = await get_app_only_access_token(user["org_id"])
    payload = {
        "message": {
            "subject": "Paneltec Civil — test email",
            "body": {
                "contentType": "HTML",
                "content": ("<p>This is a test email from <strong>Paneltec Civil</strong> "
                            "to verify Microsoft 365 Graph SendMail is configured correctly.</p>"
                            "<p style='color:#64748B;font-size:12px'>If you received this, "
                            "the Application permission flow is working.</p>"),
            },
            "toRecipients": [{"emailAddress": {"address": sender}}],
        },
        "saveToSentItems": False,
    }
    url = f"{GRAPH_BASE}/users/{sender}/sendMail"
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(url,
                             headers={"Authorization": f"Bearer {token}",
                                      "Content-Type": "application/json"},
                             json=payload)
    except Exception as e:
        raise HTTPException(502, f"Graph unreachable: {e}")
    if r.status_code not in (200, 202):
        msg = r.text[:400]
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "microsoft365"},
            {"$set": {"status": "error", "last_error": msg, "updated_at": now_iso()}},
        )
        raise HTTPException(400, f"Graph SendMail failed: HTTP {r.status_code} — {msg}")

    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "microsoft365"},
        {"$set": {"status": "connected", "last_tested_at": now_iso(),
                  "last_error": None, "updated_at": now_iso()}},
    )
    # Best-effort: drain queued emails now that we know creds are good.
    try:
        queued = await db.outbound_emails.find(
            {"org_id": user["org_id"], "status": "queued"}, {"_id": 0}
        ).sort("created_at", 1).to_list(200)
        flushed = 0
        for em in queued:
            res = await graph_send_mail(
                user["org_id"],
                to=em.get("to", []), cc=em.get("cc", []),
                subject=em.get("subject", ""), body_html=em.get("body_html", ""),
                attachments=em.get("attachments", []),
            )
            if res.get("ok"):
                await db.outbound_emails.update_one(
                    {"id": em["id"]},
                    {"$set": {"status": "sent", "provider": "microsoft365",
                              "sent_at": now_iso(), "error": None, "updated_at": now_iso()}},
                )
                flushed += 1
    except Exception as e:
        log.warning("Post-test flush failed: %s", e)
        flushed = 0

    return {"ok": True, "sent_to": sender, "flushed_from_queue": flushed}


async def graph_send_mail(org_id: str, *, to: List[str], cc: List[str], subject: str,
                          body_html: str, attachments: List[dict]) -> dict:
    """Send an email via Graph using app-only auth. Returns {ok: bool, error?: str}."""
    # Phase 4.7.3 — defensive Safe Mode check. queue_email_doc already blocks
    # in front of us, but any direct caller hitting this function MUST also be
    # gated. We persist a `comms_outbox_blocked` row and return ok=True with
    # `blocked=True` so callers don't crash on a falsey ok.
    from comms_safe_mode import is_blocked, record_blocked
    if await is_blocked(org_id):
        await record_blocked(
            channel="email", org_id=org_id, to=list(to),
            subject=subject, body=body_html,
            triggered_by_endpoint="graph_send_mail",
            extra={"cc": list(cc or [])},
        )
        return {"ok": True, "blocked": True, "provider": "safe_mode"}
    try:
        token = await get_app_only_access_token(org_id)
    except HTTPException as e:
        return {"ok": False, "error": str(e.detail)}
    except Exception as e:
        return {"ok": False, "error": f"token: {e}"}

    cfg = await _cfg(org_id)
    sender = cfg.get("sender_email")
    if not sender:
        return {"ok": False, "error": "sender_email_missing"}
    reply_to = cfg.get("reply_to")

    msg_attachments = []
    for a in attachments or []:
        # Graph requires base64 contentBytes — only embed files we can read locally.
        path = a.get("local_path")
        if not path:
            fu = a.get("file_url") or ""
            if fu.startswith("/api/files/"):
                # /api/files/<id> → backend/uploads/<id>
                candidate = os.path.join(os.path.dirname(__file__), "uploads",
                                         fu.replace("/api/files/", ""))
                if os.path.exists(candidate):
                    path = candidate
        if path and os.path.exists(path):
            with open(path, "rb") as f:
                content = base64.b64encode(f.read()).decode("ascii")
            msg_attachments.append({
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": a.get("filename") or a.get("label") or os.path.basename(path),
                "contentBytes": content,
            })

    message = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": body_html},
        "toRecipients": [{"emailAddress": {"address": e}} for e in to],
        "ccRecipients": [{"emailAddress": {"address": e}} for e in (cc or [])],
        "attachments": msg_attachments,
    }
    if reply_to:
        message["replyTo"] = [{"emailAddress": {"address": reply_to}}]

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
    return {"ok": False, "error": f"HTTP {r.status_code} {r.text[:200]}"}


@router.delete("")
async def m365_disconnect(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    """Wipe stored M365 credentials and status."""
    _TOKEN_CACHE.pop(user["org_id"], None)
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "microsoft365"},
        {"$set": {
            "config": {},
            "status": "not_connected", "last_error": None,
            "updated_at": now_iso(),
        }},
    )
    return {"ok": True}
