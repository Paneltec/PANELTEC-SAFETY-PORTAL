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
from permissions import require_permission
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
    # v160.3.9.40 (SEC-003) — decrypt secrets on read.
    from integrations import hydrate_integration_config
    return hydrate_integration_config(doc)


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
async def m365_test(user: dict = Depends(require_permission("integrations", "edit"))):
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
        # v58.13.85 — Actionable message for the common
        # "sender_email placeholder" case. Graph returns:
        #   {"error":{"code":"ErrorInvalidUser","message":"The requested
        #    user 'x@y' is invalid."}}
        # on a non-existent mailbox. The raw message doesn't tell the
        # admin what to do; rewrite it to a specific fix path.
        friendly = None
        if "ErrorInvalidUser" in msg or "requested user" in msg.lower():
            friendly = (
                f"The 'Send from' mailbox '{sender}' does not exist in "
                f"your Microsoft 365 tenant, or its Mail.Send app permission "
                f"has not been granted. Update the Send-from mailbox in "
                f"Settings → Integrations → Microsoft 365 to a real "
                f"licensed mailbox in your tenant."
            )
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "microsoft365"},
            {"$set": {"status": "error", "last_error": msg, "updated_at": now_iso()}},
        )
        raise HTTPException(400, friendly or f"Graph SendMail failed: HTTP {r.status_code} — {msg}")

    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "microsoft365"},
        {"$set": {"status": "connected", "last_tested_at": now_iso(),
                  "last_error": None, "updated_at": now_iso()}},
    )
    # v58.13.87 — Path C DELETED. The old "post-test flush" loop
    # here iterated every `status=queued` outbound_email and called
    # `graph_send_mail` directly. It fired on every Test Connection
    # click, bypassing any user-action check. Two bugs also lurked:
    # (a) `if res.get("ok")` treated `{ok:True, blocked:True}` as
    #     success and lied about status in `outbound_emails`;
    # (b) the query didn't filter `deleted_at`, so soft-deleted
    #     rows were resurrected.
    # The retry semantics move to the manual user-action Retry button
    # in the outbox UI (`POST /outbox/{email_id}/retry`). Nothing
    # automatic remains here.
    return {"ok": True, "sent_to": sender, "flushed_from_queue": 0}


async def graph_send_mail(org_id: str, *, to: List[str], cc: List[str], subject: str,
                          body_html: str, attachments: List[dict]) -> dict:
    """Send an email via Graph using app-only auth. Returns {ok: bool, error?: str}."""
    # v58.13.87 — Belt-and-braces: refuse any send that isn't
    # originating from a live authenticated HTTP request. Startup
    # tasks, workers, schedulers, and stray background tasks all get
    # blocked here BEFORE Safe Mode is even consulted. Written as a
    # one-liner refusal so a future hidden Path D can't sneak past.
    from send_context import refuse_if_no_request_context
    _refusal = refuse_if_no_request_context(
        provider="microsoft365_graph_send_mail", to=to, subject=subject,
    )
    if _refusal is not None:
        return _refusal
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
async def m365_disconnect(user: dict = Depends(require_permission("integrations", "edit"))):
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
