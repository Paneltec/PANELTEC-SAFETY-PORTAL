"""Email send + outbox. M365 isn't wired yet — everything queues into
`outbound_emails` with a clear `Pending M365 connection` note.

v160.3.9.40 (SEC-002) — Stored HTML bodies are now server-side
sanitised via `bleach` before they hit Mongo. Allowlist below permits
just the tags/attributes needed for normal email formatting:
`p, br, strong, em, u, ul, ol, li, a, h1-h4, blockquote, hr, span,
img, table, thead, tbody, tr, td, th`. Anything with an event handler
(`on*`), a `<script>` block, an `<iframe>`, or a `javascript:` /
`data:` URL that isn't a PNG/JPEG is stripped. `dangerouslySetInnerHTML`
on the Outbox page renders the SERVER-sanitised value only; there is
no client-side sanitizer because the server is authoritative.
"""
from __future__ import annotations
import logging
from typing import List, Literal, Optional

import bleach
from bleach.css_sanitizer import CSSSanitizer

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field

from auth import get_current_user, require_roles
from db import db
from models import new_id, now_iso
from permissions import PERMISSIONS_SCHEMA, RESOURCES, require_permission
from permissions_scope import scope_filter, can_access_record  # v160.3.9.28

log = logging.getLogger("paneltec.email")
router = APIRouter(prefix="/email", tags=["email"])

# ─────────────────────────────────────────────────────────
# v160.3.9.40 (SEC-002) — Bleach allowlist for `body_html`.
# Tag/attribute set matches the "normal formatting" spec approved
# with the security wave. Attribute allowlist is strict — `<a>` only
# allows `href` and `title`, `<img>` only allows `src, alt, title,
# width, height`. URL protocols allowed: `http, https, mailto` for
# hyperlinks; `http, https` plus `data:` for images (data-URLs are
# additionally filtered by `_data_url_ok` below so only base64 PNG
# and JPEG survive).
# ─────────────────────────────────────────────────────────
_ALLOWED_TAGS: set[str] = {
    "p", "br", "strong", "em", "u", "ul", "ol", "li",
    "a", "h1", "h2", "h3", "h4",
    "blockquote", "hr", "span",
    "img",
    "table", "thead", "tbody", "tr", "td", "th",
}
_ALLOWED_ATTRIBUTES: dict[str, list[str]] = {
    "a":     ["href", "title"],
    "img":   ["src", "alt", "title", "width", "height"],
    "span":  ["style"],
    "table": ["border", "cellpadding", "cellspacing"],
    "td":    ["colspan", "rowspan"],
    "th":    ["colspan", "rowspan"],
}
_ALLOWED_ANCHOR_PROTOCOLS: list[str] = ["http", "https", "mailto"]
_ALLOWED_IMG_PROTOCOLS: list[str] = ["http", "https", "data"]

# Bleach's CSS sanitizer restricts inline `style` attribute to the
# properties we allow — colour and weight only. Anything else (e.g.
# `expression(...)`, `position: fixed`, `background-image: url(...)`)
# is dropped before render.
_CSS_SANITIZER = CSSSanitizer(allowed_css_properties=[
    "color", "font-weight",
])


def _data_url_ok(url: str) -> bool:
    """`data:` URLs are dangerous by default. Accept ONLY inline
    base64 PNG or JPEG so a legitimate embedded image (e.g. a signature
    thumbnail) still works but `data:text/html,...` XSS vectors do not.
    """
    if not url.startswith("data:"):
        return False
    lower = url[:64].lower()
    return (lower.startswith("data:image/png;base64,")
            or lower.startswith("data:image/jpeg;base64,")
            or lower.startswith("data:image/jpg;base64,"))


def _attribute_filter(tag: str, name: str, value: str) -> bool:
    """Per-attribute value validator. Runs AFTER the tag/attribute
    allowlist. Blocks event handlers, `javascript:` URLs, and any
    `data:` URL that isn't a PNG/JPEG base64 payload."""
    if not value:
        return True
    v = value.strip().lower()
    if name.startswith("on"):
        # Belt: `on*` handlers already blocked by attribute allowlist,
        # but keep this here so future allowlist changes don't reopen
        # the hole.
        return False
    if name == "href":
        # Bleach's built-in protocol filter already runs on `href`,
        # but data-URLs on anchors are always trouble.
        if v.startswith("data:"):
            return False
        if v.startswith("javascript:"):
            return False
        return True
    if name == "src":
        if v.startswith("data:"):
            return _data_url_ok(value)
        if v.startswith("javascript:"):
            return False
        # Allow http(s) src only.
        return v.startswith("http://") or v.startswith("https://")
    return True


import re as _re

# `<script>...</script>` and `<style>...</style>` sanitisation needs
# CONTENT stripped as well as the tags. Bleach's `strip=True` only
# removes the outer tag but preserves the inner text (which for
# `<script>` is executable JS text — safe once no <script> wrapper
# survives, but still messy). Pre-remove these entire blocks with a
# non-greedy regex so the visible output is clean.
_KILLBLOCK_RE = _re.compile(
    r"<\s*(script|style|iframe|object|embed|noscript|template)\b[^>]*>.*?"
    r"<\s*/\s*\1\s*>",
    flags=_re.IGNORECASE | _re.DOTALL,
)
# Self-closing / stray hostile tag removals (e.g. `<script/>`).
_KILL_SELFCLOSE_RE = _re.compile(
    r"<\s*(script|style|iframe|object|embed|noscript)\b[^>]*/?\s*>",
    flags=_re.IGNORECASE,
)


def sanitize_email_body_html(raw: str) -> str:
    """Server-side, authoritative sanitizer for `body_html`. Idempotent
    (re-running on already-sanitised HTML is a no-op modulo whitespace).
    Returns an empty string on empty / non-string input."""
    if not raw or not isinstance(raw, str):
        return ""
    # 1) Pre-strip whole `<script>` / `<style>` blocks INCLUDING their
    #    inner text — a plain `strip=True` in bleach would preserve
    #    `alert(1)` as visible text.
    pre = _KILLBLOCK_RE.sub("", raw)
    pre = _KILL_SELFCLOSE_RE.sub("", pre)
    # 2) Standard bleach sweep for everything else. We temporarily
    #    combine anchor + img protocol allowlists (bleach applies the
    #    protocols list to every URL-carrying attribute); `data:` is
    #    only safe on `<img src>` because `_attribute_filter` below
    #    additionally requires PNG/JPEG base64.
    protocols = list(set(_ALLOWED_ANCHOR_PROTOCOLS) | set(_ALLOWED_IMG_PROTOCOLS))
    # Use the callable-attribute form so `_attribute_filter` actually
    # runs. Signature: (tag: str, name: str, value: str) -> bool.
    def _attrs_filter(tag: str, name: str, value: str) -> bool:
        # First check tag-level allowlist
        allowed = _ALLOWED_ATTRIBUTES.get(tag, []) + _ALLOWED_ATTRIBUTES.get("*", [])
        if name not in allowed:
            return False
        # Then per-value guard
        return _attribute_filter(tag, name, value)

    return bleach.clean(
        pre,
        tags=_ALLOWED_TAGS,
        attributes=_attrs_filter,
        protocols=protocols,
        css_sanitizer=_CSS_SANITIZER,
        strip=True,           # strip disallowed tags (content already
                              # scrubbed for <script>/<style> above)
        strip_comments=True,
    )

# ---- PDF attachment helper ----
from pdf_renderer import RENDERERS, persist_pdf, filename_for  # noqa: E402

async def _pdf_attachment_for(record: dict, resource: str) -> Optional[dict]:
    """Render record PDF, persist to /uploads/pdfs/, return attachment dict."""
    try:
        renderer, _coll = RENDERERS[resource]
        pdf_bytes = renderer(record)
        name_hint = filename_for(record, resource).removesuffix(".pdf")
        file_url, fname = persist_pdf(name_hint, pdf_bytes)
        return {"file_url": file_url, "filename": fname,
                "label": f"{resource.replace('_', ' ').title()} PDF"}
    except Exception as e:
        log.warning("PDF gen failed for %s/%s: %s", resource, record.get("id"), e)
        return None

EmailStatus = Literal["queued", "sent", "failed", "cancelled"]


class EmailAttachment(BaseModel):
    file_url: str
    filename: str


class EmailSendIn(BaseModel):
    to: List[EmailStr] = Field(min_length=1)
    cc: List[EmailStr] = Field(default_factory=list)
    subject: str = Field(min_length=1)
    body_html: str = Field(min_length=1)
    attachments: List[EmailAttachment] = Field(default_factory=list)
    related_record_type: Optional[str] = None
    related_record_id: Optional[str] = None
    resource_kind: str = Field(..., description="permission scope key, e.g. 'hazards'")


async def _m365_connected(org_id: str) -> bool:
    doc = await db.integration_configs.find_one(
        {"org_id": org_id, "kind": "microsoft365"},
        {"status": 1},
    )
    return bool(doc and doc.get("status") == "connected")


async def queue_email_doc(
    *, org_id: str, to: List[str], subject: str, body_html: str,
    attachments: List[dict] | None = None, cc: List[str] | None = None,
    related_record_type: Optional[str] = None, related_record_id: Optional[str] = None,
    created_by: str, resource_kind: str,
    bypass_provider_attempt: bool = False,
) -> dict:
    """Persist + (if M365 connected) mark as sent. Used by /email/send AND by
    convenience routes + user-invite flow.

    v58.13.86 — Gate order (simplified after the auto_comms revert):
      1. IS_PROD env gate — non-prod + system source → skip.
      2. Comms Safe Mode — queue to blocked outbox if ON.
      3. Graph SendMail dispatch.
    Source classification is inferred from `created_by`: values
    prefixed with "system" (or empty) are treated as system-sourced;
    everything else is a real user id → user-action.
    """
    # v160.3.9.40 (SEC-002) — Every write path funnels through this
    # helper. Sanitize `body_html` HERE so no caller can accidentally
    # bypass it, and so the internal convenience routes (record-scoped
    # send helpers below) are protected too — not just POST /send.
    body_html = sanitize_email_body_html(body_html)

    # v58.13.85 — IS_PROD env gate. On preview / dev / test
    # (IS_PROD != "true"), system-originated sends (cron reminders,
    # form_assignment_notifier, seed tasks, test runs) skip entirely
    # — no queue to outbound_emails, no comms_outbox_blocked row, no
    # log noise. User-initiated sends (real user id in `created_by`,
    # e.g. an admin clicking "Send invite") STILL flow through so
    # Safe Mode's audit trail keeps them visible.
    import os as _os
    is_prod = (_os.environ.get("IS_PROD", "false").strip().lower() == "true")
    pytest_running = bool(_os.environ.get("PYTEST_CURRENT_TEST"))
    is_system_source = (
        (created_by or "").startswith("system")
        or (created_by or "") == ""
        or pytest_running
    )
    if (not is_prod) and is_system_source:
        log.info(
            "email_outbox.system_source_skipped env=non_prod created_by=%r "
            "subject=%r to_n=%d resource=%r reason=%s",
            created_by, (subject or "")[:80], len(to or []),
            resource_kind, "pytest" if pytest_running else "cron/system",
        )
        return {
            "id": new_id(), "org_id": org_id, "to": list(to),
            "subject": subject, "status": "skipped_non_prod",
            "provider": "env_gate", "created_by": created_by,
            "created_at": now_iso(),
        }
    # Phase 4.7.3 — Comms Safe Mode kill switch. Intercepts at the boundary so
    # neither Graph API nor the queued-then-cron flow can fire while safe mode
    # is on. We still persist the row in `outbound_emails` (status="blocked")
    # AND in `comms_outbox_blocked` for admin audit.
    from comms_safe_mode import is_blocked as _safe_blocked, record_blocked as _record_blocked
    safe_blocked = await _safe_blocked(org_id)
    connected = (not bypass_provider_attempt) and await _m365_connected(org_id)
    doc = {
        "id": new_id(), "org_id": org_id,
        "to": list(to), "cc": list(cc or []),
        "subject": subject, "body_html": body_html,
        "attachments": list(attachments or []),
        "related_record_type": related_record_type,
        "related_record_id": related_record_id,
        "resource_kind": resource_kind,
        "status": "queued",
        "provider": None,
        "sent_at": None,
        "error": None,
        "created_by": created_by,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    if safe_blocked:
        # Block-and-record. The caller (invite flow / reset flow) still gets
        # back a doc dict that looks successful from its POV — the row in
        # outbound_emails is marked status="blocked" so admins can see what
        # we held back.
        doc["status"] = "blocked"
        doc["provider"] = "safe_mode"
        doc["sent_at"] = None
        doc["error"] = "comms_safe_mode_on"
        await _record_blocked(
            channel="email", org_id=org_id, to=doc["to"],
            subject=subject, body=body_html,
            triggered_by_endpoint="queue_email_doc",
            actor_user_id=created_by if created_by != "system" else None,
            extra={"resource_kind": resource_kind,
                   "related_record_type": related_record_type,
                   "related_record_id": related_record_id,
                   "cc": doc["cc"]},
        )
        await db.outbound_emails.insert_one(dict(doc))
        return doc
    if connected:
        # Try real send via Microsoft Graph. If it fails, fall back to queued.
        try:
            from integrations_m365 import graph_send_mail  # local to avoid cycle
            res = await graph_send_mail(
                org_id,
                to=doc["to"], cc=doc["cc"],
                subject=doc["subject"], body_html=doc["body_html"],
                attachments=doc["attachments"],
            )
            if res.get("ok"):
                doc["status"] = "sent"
                doc["provider"] = "microsoft365"
                doc["sent_at"] = now_iso()
            else:
                doc["status"] = "queued"
                doc["error"] = res.get("error", "graph_send_failed")
        except Exception as e:
            doc["status"] = "queued"
            doc["error"] = f"graph_send_exception: {e}"
    await db.outbound_emails.insert_one(dict(doc))
    return doc


def _strip(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


@router.post("/send", status_code=201)
async def send_email(body: EmailSendIn, user: dict = Depends(get_current_user)):
    if body.resource_kind not in RESOURCES:
        raise HTTPException(400, "Unknown resource_kind")
    if not PERMISSIONS_SCHEMA[body.resource_kind]["email_supported"]:
        raise HTTPException(400, f"Resource '{body.resource_kind}' does not support email")
    # Per-resource permission check.
    from permissions import can
    if not await can(user, body.resource_kind, "email"):
        raise HTTPException(403, f"Permission denied: {body.resource_kind}.email")
    doc = await queue_email_doc(
        org_id=user["org_id"], to=body.to, cc=body.cc, subject=body.subject,
        body_html=body.body_html, attachments=[a.model_dump() for a in body.attachments],
        related_record_type=body.related_record_type, related_record_id=body.related_record_id,
        created_by=user["id"], resource_kind=body.resource_kind,
                               # a real user clicking Send in the outbox
                               # composer.
    )
    note = "Sent via Microsoft 365" if doc["status"] == "sent" \
        else "Microsoft 365 not connected — message stored in outbox"
    return {**doc, "note": note}


@router.get("/outbox")
async def list_outbox(
    status: Optional[EmailStatus] = Query(None),
    related_record_type: Optional[str] = Query(None),
    scope: Optional[str] = Query(None, description="v160.0 — `me` narrows to caller's own outbox"),
    limit: int = Query(200, ge=1, le=500),
    user: dict = Depends(get_current_user),
):
    q: dict = {"org_id": user["org_id"], "deleted_at": {"$exists": False}}
    # v160.3.9.28 — scoping delegated to permissions_scope.
    # Privileged (admin/hseq/supervisor/hseq_manager*) → scope_filter
    # returns {} → org-wide list. General user → returns
    # {"$or": [{created_by: uid}, {to: email}]} → auto-clamped to own.
    privileged = (user.get("role") or "").lower() in {"admin", "hseq_lead", "supervisor"}
    if scope == "team":
        if not privileged:
            raise HTTPException(403, "Permission denied: outbox.team_view")
    else:
        _scope = scope_filter(user, "notifications") if (scope == "me" or not privileged) else {}
        if _scope.get("__scope_no_match__"):
            return {"items": [], "m365_connected": await _m365_connected(user["org_id"]), "count": 0}
        if _scope:
            q.update(_scope)
    if status:
        q["status"] = status
    if related_record_type:
        q["related_record_type"] = related_record_type
    docs = await db.outbound_emails.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    connected = await _m365_connected(user["org_id"])
    return {"items": docs, "m365_connected": connected, "count": len(docs)}


@router.get("/outbox/{email_id}")
async def get_outbox(email_id: str, user: dict = Depends(get_current_user)):
    doc = await db.outbound_emails.find_one({"id": email_id, "org_id": user["org_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    # v160.3.9.28 — deep-link protection via permissions_scope.
    # Privileged callers pass through; general users must own the record
    # (created_by or in `to` list) or a 403 with scope detail is raised.
    if not can_access_record(user, "notifications", doc):
        raise HTTPException(403, "Permission denied: notifications.scope")
    return doc


@router.post("/outbox/{email_id}/retry")
async def retry_outbox(email_id: str, user: dict = Depends(get_current_user)):
    doc = await db.outbound_emails.find_one({"id": email_id, "org_id": user["org_id"]})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] not in ("queued", "failed"):
        raise HTTPException(400, f"Cannot retry status={doc['status']}")
    connected = await _m365_connected(user["org_id"])
    update: dict = {"updated_at": now_iso()}
    if not connected:
        update.update({"status": "queued", "error": "Microsoft 365 not connected"})
        await db.outbound_emails.update_one({"id": email_id}, {"$set": update})
        saved = await db.outbound_emails.find_one({"id": email_id}, {"_id": 0})
        return {**saved, "note": "Still queued — Microsoft 365 not connected"}

    # v58.13.87 — Actually attempt the send via Graph. Previously
    # this optimistically wrote `status=sent, provider=microsoft365`
    # without calling Graph at all — a bookkeeping lie identical
    # to the m365_test flush bug fixed in the same ship. Honest
    # branches now:
    #   · Safe Mode ON → graph_send_mail returns {ok:True, blocked:True}
    #                    → row status becomes "blocked", audit row is
    #                    written to `comms_outbox_blocked`.
    #   · Graph 2xx    → status "sent", provider "microsoft365".
    #   · Graph error  → status "failed", error captured.
    from integrations_m365 import graph_send_mail
    res = await graph_send_mail(
        user["org_id"],
        to=doc.get("to", []), cc=doc.get("cc", []),
        subject=doc.get("subject", ""), body_html=doc.get("body_html", ""),
        attachments=doc.get("attachments", []),
    )
    if res.get("blocked"):
        update.update({
            "status": "blocked",
            "provider": res.get("provider") or "safe_mode",
            "sent_at": None,
            "error": res.get("error"),
        })
        note = "Blocked by Comms Safe Mode — audit row logged"
    elif res.get("ok"):
        update.update({
            "status": "sent",
            "provider": "microsoft365",
            "sent_at": now_iso(),
            "error": None,
        })
        note = "Sent via Microsoft 365"
    else:
        update.update({
            "status": "failed",
            "error": res.get("error") or "unknown_graph_error",
        })
        note = f"Send failed: {update['error']}"
    await db.outbound_emails.update_one({"id": email_id}, {"$set": update})
    saved = await db.outbound_emails.find_one({"id": email_id}, {"_id": 0})
    return {**saved, "note": note}


@router.post("/outbox/{email_id}/cancel")
async def cancel_outbox(email_id: str, user: dict = Depends(get_current_user)):
    doc = await db.outbound_emails.find_one({"id": email_id, "org_id": user["org_id"]})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] != "queued":
        raise HTTPException(400, f"Cannot cancel status={doc['status']}")
    await db.outbound_emails.update_one(
        {"id": email_id},
        {"$set": {"status": "cancelled", "updated_at": now_iso()}},
    )
    saved = await db.outbound_emails.find_one({"id": email_id}, {"_id": 0})
    return _strip(saved)


@router.delete("/outbox/{email_id}")
async def delete_outbox(email_id: str, user: dict = Depends(get_current_user)):
    """Soft-delete an outbox email. Admins can delete any in their org;
    everyone else can only delete the ones they themselves created."""
    doc = await db.outbound_emails.find_one(
        {"id": email_id, "org_id": user["org_id"], "deleted_at": {"$exists": False}}
    )
    if not doc:
        raise HTTPException(404, "Not found")
    # v160.3.9.28 — This endpoint intentionally allows admin OR owner
    # (not a plain `require_permission("notifications","delete")` dep,
    # because hseq_lead/supervisor also need to delete their own
    # outbound emails). Retain the inline mixed check as the correct
    # shape for owner-scoped delete. Bulk-delete (line ~285) is the
    # admin-only variant and uses the require_permission dep.
    if user.get("role") != "admin" and doc.get("created_by") != user["id"]:
        raise HTTPException(403, "Only the sender or an admin can delete this email")
    await db.outbound_emails.update_one(
        {"id": email_id},
        {"$set": {"deleted_at": now_iso(), "updated_at": now_iso()}},
    )
    return {"ok": True, "status": "deleted"}


class BulkDeleteFilter(BaseModel):
    status: Optional[EmailStatus] = None


class BulkDeleteIn(BaseModel):
    ids: Optional[List[str]] = None
    filter: Optional[BulkDeleteFilter] = None


@router.post("/outbox/bulk-delete")
async def bulk_delete_outbox(body: BulkDeleteIn,
                             user: dict = Depends(require_permission("notifications", "delete"))):
    """Admin-only bulk soft-delete. Either `ids` or `filter.status` must be set.
    Never auto-deletes queued items via filter — they may still send. To delete
    a queued item, pass it explicitly by id (or cancel it first).

    v160.3.9.27 — guard migrated from `require_roles("admin")` to
    `require_permission("notifications", "delete")`. Admin still has
    `notifications.delete=True` in ROLE_DEFAULTS, so behaviour is unchanged.
    """
    q: dict = {"org_id": user["org_id"], "deleted_at": {"$exists": False}}
    if body.ids:
        q["id"] = {"$in": body.ids}
    elif body.filter and body.filter.status:
        if body.filter.status == "queued":
            raise HTTPException(400, "Queued emails cannot be bulk-deleted by filter — cancel them first or delete by id.")
        q["status"] = body.filter.status
    else:
        # No ids and no filter => delete every non-queued email (clear all).
        q["status"] = {"$ne": "queued"}
    res = await db.outbound_emails.update_many(
        q, {"$set": {"deleted_at": now_iso(), "updated_at": now_iso()}},
    )
    return {"deleted": res.modified_count}


# ---------- Convenience email endpoints ----------
# Each one prepares subject/body for a specific record then calls queue_email_doc.

class RecordEmailIn(BaseModel):
    to: List[EmailStr] = Field(min_length=1)
    cc: List[EmailStr] = Field(default_factory=list)
    message: Optional[str] = None


def _wrap_body(message: Optional[str], summary_html: str, link_path: str) -> str:
    msg_html = f"<p>{message}</p>" if message else ""
    return (
        f"{msg_html}"
        f"<div style='border-left:3px solid #2C6BFF;padding-left:12px;margin:16px 0'>{summary_html}</div>"
        f"<p><a href='{link_path}'>Open in Paneltec Civil</a></p>"
    )


async def _record_or_404(collection: str, record_id: str, org_id: str) -> dict:
    doc = await db[collection].find_one({"id": record_id, "org_id": org_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        # try without deleted_at filter for collections that don't have it
        doc = await db[collection].find_one({"id": record_id, "org_id": org_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, f"{collection} record not found")
    return doc


# v58.13.65 — `_make_email_route` factory removed. It had zero call
# sites in the entire codebase and its final line referenced
# `record_id` from the *inner* `_impl` closure at *registration
# time* (outer scope), which is a NameError waiting to happen. All
# live email-send endpoints are plain `async def` handlers wired
# individually below (see `_swms_email`, `_prestart_email`, etc.).


# SWMS for review
async def _swms_email(record_id: str, body: RecordEmailIn,
                      user: dict = Depends(require_permission("swms", "email"))):
    rec = await _record_or_404("swms", record_id, user["org_id"])
    subject = f"SWMS for Review: {rec.get('title', 'Untitled')} v{rec.get('version', 1)}"
    summary = (
        f"<p><strong>Title:</strong> {rec.get('title')}</p>"
        f"<p><strong>Status:</strong> {rec.get('status')}</p>"
        f"<p><strong>Description:</strong> {rec.get('job_description', '')}</p>"
        f"<p><strong>Hazards:</strong> {len(rec.get('hazards', []))} listed</p>"
    )
    link = f"/app/swms/{record_id}"
    # MOCKED: real PDF generation pending
    atts = [{"file_url": f"/api/swms/{record_id}/pdf", "filename": f"swms-{record_id[:8]}.pdf"}]
    doc = await queue_email_doc(
        org_id=user["org_id"], to=body.to, cc=body.cc, subject=subject,
        body_html=_wrap_body(body.message, summary, link), attachments=atts,
        related_record_type="swms", related_record_id=record_id,
        created_by=user["id"], resource_kind="swms",
    )
    return {**doc, "note": "Sent via Microsoft 365" if doc["status"] == "sent" else "Queued — Microsoft 365 not connected"}


# A second router with no shared prefix — mounted at the api root so we get
# /api/swms/{id}/email-for-review etc. without polluting the entity CRUD routers.
record_router = APIRouter(tags=["email"])


# ---------- Convenience implementations (used by both old + new wiring) ----------

async def email_swms_for_review(record_id: str, body: RecordEmailIn, user: dict):
    rec = await _record_or_404("swms", record_id, user["org_id"])
    subject = f"SWMS for Review: {rec.get('title', 'Untitled')} v{rec.get('version', 1)}"
    summary = (
        f"<p><strong>Title:</strong> {rec.get('title')}</p>"
        f"<p><strong>Status:</strong> {rec.get('status')}</p>"
        f"<p><strong>Description:</strong> {rec.get('job_description', '')}</p>"
        f"<p><strong>Hazards:</strong> {len(rec.get('hazards', []))} listed</p>"
    )
    link = f"/app/swms/{record_id}"
    atts = [{"file_url": f"/api/swms/{record_id}/pdf", "filename": f"swms-{record_id[:8]}.pdf"}]
    pdf_att = await _pdf_attachment_for(rec, "swms")
    if pdf_att:
        atts = [pdf_att]
    return await queue_email_doc(
        org_id=user["org_id"], to=body.to, cc=body.cc, subject=subject,
        body_html=_wrap_body(body.message, summary, link), attachments=atts,
        related_record_type="swms", related_record_id=record_id,
        created_by=user["id"], resource_kind="swms",
    )


async def email_prestart(record_id, body, user):
    rec = await _record_or_404("pre_starts", record_id, user["org_id"])
    subject = f"Daily Pre-Start: {rec.get('date')} — {rec.get('crew_lead', '')}"
    summary = (
        f"<p><strong>Date:</strong> {rec.get('date')}</p>"
        f"<p><strong>Crew lead:</strong> {rec.get('crew_lead')}</p>"
        f"<p><strong>Work:</strong> {rec.get('work_summary', '')}</p>"
        f"<p><strong>Sign-ons:</strong> {len(rec.get('sign_ons', []))}</p>"
    )
    pdf_att = await _pdf_attachment_for(rec, "pre_starts")
    return await queue_email_doc(
        org_id=user["org_id"], to=body.to, cc=body.cc, subject=subject,
        body_html=_wrap_body(body.message, summary, f"/app/pre-starts"),
        attachments=[pdf_att] if pdf_att else [],
        related_record_type="pre_starts", related_record_id=record_id,
        created_by=user["id"], resource_kind="pre_starts",
    )


async def email_site_diary(record_id, body, user):
    rec = await _record_or_404("site_diary_entries", record_id, user["org_id"])
    subject = f"Site Diary: {rec.get('date')}"
    summary = f"<p><strong>Date:</strong> {rec.get('date')}</p><p>{rec.get('raw_notes', '')[:400]}</p>"
    pdf_att = await _pdf_attachment_for(rec, "site_diary")
    return await queue_email_doc(
        org_id=user["org_id"], to=body.to, cc=body.cc, subject=subject,
        body_html=_wrap_body(body.message, summary, f"/app/site-diary"),
        attachments=[pdf_att] if pdf_att else [],
        related_record_type="site_diary", related_record_id=record_id,
        created_by=user["id"], resource_kind="site_diary",
    )


async def email_hazard(record_id, body, user):
    rec = await _record_or_404("hazards", record_id, user["org_id"])
    subject = f"Hazard Report: {rec.get('title', 'Untitled')} ({rec.get('severity')})"
    summary = (
        f"<p><strong>Severity:</strong> {rec.get('severity')}</p>"
        f"<p><strong>Status:</strong> {rec.get('status')}</p>"
        f"<p>{rec.get('description', '')}</p>"
    )
    atts = []
    if rec.get("photo_url"):
        atts.append({"file_url": rec["photo_url"], "filename": "hazard-photo.jpg"})
    pdf_att = await _pdf_attachment_for(rec, "hazards")
    if pdf_att:
        atts.append(pdf_att)
    return await queue_email_doc(
        org_id=user["org_id"], to=body.to, cc=body.cc, subject=subject,
        body_html=_wrap_body(body.message, summary, f"/app/hazards"),
        attachments=atts, related_record_type="hazards", related_record_id=record_id,
        created_by=user["id"], resource_kind="hazards",
    )


async def email_incident(record_id, body, user):
    rec = await _record_or_404("incidents", record_id, user["org_id"])
    subject = f"Incident Summary: {rec.get('title', 'Untitled')} ({rec.get('category')})"
    summary = (
        f"<p><strong>Category:</strong> {rec.get('category')}</p>"
        f"<p><strong>Occurred at:</strong> {rec.get('occurred_at')}</p>"
        f"<p>{rec.get('description', '')}</p>"
        f"<p><strong>Immediate actions:</strong> {rec.get('immediate_actions', '')}</p>"
    )
    return await queue_email_doc(
        org_id=user["org_id"], to=body.to, cc=body.cc, subject=subject,
        body_html=_wrap_body(body.message, summary, f"/app/incidents"),
        attachments=[], related_record_type="incidents", related_record_id=record_id,
        created_by=user["id"], resource_kind="incidents",
    )


async def email_inspection(record_id, body, user):
    rec = await _record_or_404("inspections", record_id, user["org_id"])
    items = rec.get("checklist_items", [])
    fails = sum(1 for it in items if it.get("response") == "fail")
    subject = f"Inspection Report: {rec.get('template_name')} — {rec.get('date')}"
    summary = (
        f"<p><strong>Template:</strong> {rec.get('template_name')}</p>"
        f"<p><strong>Date:</strong> {rec.get('date')}</p>"
        f"<p><strong>Checklist:</strong> {len(items)} items, {fails} fails</p>"
    )
    pdf_att = await _pdf_attachment_for(rec, "inspections")
    return await queue_email_doc(
        org_id=user["org_id"], to=body.to, cc=body.cc, subject=subject,
        body_html=_wrap_body(body.message, summary, f"/app/inspections"),
        attachments=[pdf_att] if pdf_att else [],
        related_record_type="inspections", related_record_id=record_id,
        created_by=user["id"], resource_kind="inspections",
    )


async def email_contractor(record_id, body, user):
    rec = await _record_or_404("contractors", record_id, user["org_id"])
    subject = f"Contractor Status: {rec.get('legal_name', rec.get('name', 'Contractor'))}"
    summary = (
        f"<p><strong>Name:</strong> {rec.get('legal_name', rec.get('name', ''))}</p>"
        f"<p><strong>Trade:</strong> {rec.get('trade', '')}</p>"
        f"<p><strong>Status:</strong> {rec.get('compliance_status', rec.get('status', ''))}</p>"
    )
    return await queue_email_doc(
        org_id=user["org_id"], to=body.to, cc=body.cc, subject=subject,
        body_html=_wrap_body(body.message, summary, f"/app/contractors/{record_id}"),
        attachments=[], related_record_type="contractors", related_record_id=record_id,
        created_by=user["id"], resource_kind="contractors",
    )


async def email_renewal(record_id, body, user):
    rec = await _record_or_404("renewal_links", record_id, user["org_id"])
    token = rec.get("token") or record_id
    public_link = f"/renew/{token}"
    subject = f"Document Renewal Required — {rec.get('document_type', 'Document')}"
    summary = (
        f"<p>Please re-submit the required document via the secure link below.</p>"
        f"<p><strong>Type:</strong> {rec.get('document_type', '')}</p>"
        f"<p><strong>Expires:</strong> {rec.get('expires_at', '')}</p>"
    )
    return await queue_email_doc(
        org_id=user["org_id"], to=body.to, cc=body.cc, subject=subject,
        body_html=_wrap_body(body.message, summary, public_link),
        attachments=[], related_record_type="renewals", related_record_id=record_id,
        created_by=user["id"], resource_kind="renewals",
    )


async def email_audit_export(record_id, body, user):
    rec = await _record_or_404("audit_exports", record_id, user["org_id"])
    subject = f"Audit Export: {rec.get('label', record_id[:8])}"
    summary = (
        f"<p><strong>Label:</strong> {rec.get('label', '')}</p>"
        f"<p><strong>Period:</strong> {rec.get('period_from', '')} → {rec.get('period_to', '')}</p>"
        f"<p><strong>Format:</strong> {rec.get('format', '')}</p>"
    )
    atts = []
    if rec.get("file_url"):
        atts.append({"file_url": rec["file_url"], "filename": rec.get("file_name", "audit-export")})
    return await queue_email_doc(
        org_id=user["org_id"], to=body.to, cc=body.cc, subject=subject,
        body_html=_wrap_body(body.message, summary, f"/app/audit-exports"),
        attachments=atts, related_record_type="audit_exports", related_record_id=record_id,
        created_by=user["id"], resource_kind="audit_exports",
    )


# ---------- Direct record-email routes mounted at /api root ----------

def _bind(impl, resource: str):
    async def _wrap(record_id: str, body: RecordEmailIn,
                    user: dict = Depends(require_permission(resource, "email"))):
        doc = await impl(record_id, body, user)
        note = "Sent via Microsoft 365" if doc["status"] == "sent" \
            else "Queued — Microsoft 365 not connected"
        return {**doc, "note": note}
    return _wrap


record_router.add_api_route("/swms/{record_id}/email-for-review",
                            _bind(email_swms_for_review, "swms"),
                            methods=["POST"], status_code=201, name="email-swms")
record_router.add_api_route("/pre-starts/{record_id}/email",
                            _bind(email_prestart, "pre_starts"),
                            methods=["POST"], status_code=201, name="email-prestart")
record_router.add_api_route("/site-diary/{record_id}/email-daily",
                            _bind(email_site_diary, "site_diary"),
                            methods=["POST"], status_code=201, name="email-site-diary")
record_router.add_api_route("/hazards/{record_id}/email",
                            _bind(email_hazard, "hazards"),
                            methods=["POST"], status_code=201, name="email-hazard")
record_router.add_api_route("/incidents/{record_id}/email-summary",
                            _bind(email_incident, "incidents"),
                            methods=["POST"], status_code=201, name="email-incident")
record_router.add_api_route("/inspections/{record_id}/email",
                            _bind(email_inspection, "inspections"),
                            methods=["POST"], status_code=201, name="email-inspection")
record_router.add_api_route("/contractors/{record_id}/email",
                            _bind(email_contractor, "contractors"),
                            methods=["POST"], status_code=201, name="email-contractor")
record_router.add_api_route("/renewals/{record_id}/email-link",
                            _bind(email_renewal, "renewals"),
                            methods=["POST"], status_code=201, name="email-renewal")
record_router.add_api_route("/audit-exports/{record_id}/email",
                            _bind(email_audit_export, "audit_exports"),
                            methods=["POST"], status_code=201, name="email-audit-export")
