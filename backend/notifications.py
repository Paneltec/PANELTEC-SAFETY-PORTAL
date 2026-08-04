"""v160.3.9.57 — Notifications API for the header bell.

Aggregates unread compliance signals from four sources:

  1. Expiring certifications      → `worker_certifications`
  2. Overdue / expired renewals   → `renewal_links`
  3. Failed integration syncs     → `integration_configs`
  4. Pending approvals            → `swms` (status: awaiting_approval / draft)

Each source is gated by a granular permission token — a caller who
lacks a token for a category silently sees zero items from that
category (rather than a 403 for the whole endpoint).

Item ID scheme
--------------
`sha1(f"{category}:{source_id}")[:16]` — stable across polls so the
`notifications_read` collection can idempotently track what a given
user has already dismissed. Read state is per-user; another user
opening the panel still sees the same item as unread.

Read tracking
-------------
Collection `notifications_read` with a compound key
`(user_id, notification_id)`. Writes are idempotent via `$setOnInsert`
so a mark-read that fires twice is a no-op the second time.

The endpoint is intentionally chatty (recomputes on every call) rather
than caching — the queries are small and the panel polls every 60 s,
so caching would just add stale-read complexity for no real win.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from db import db
from permissions import can as user_can


router = APIRouter(prefix="/notifications", tags=["notifications"])


# ── Config knobs ──────────────────────────────────────────────────────
EXPIRING_WINDOW_DAYS = 30           # cert expiry lookahead
INTEGRATION_STALE_HOURS = 24        # sync-error signal is "recent" if last_tested_at < this
MAX_ITEMS_PER_CATEGORY = 25         # cap so a runaway category can't blow up the panel

# ── Response shapes ───────────────────────────────────────────────────
class NotificationItem(BaseModel):
    id: str
    category: str
    title: str
    subtitle: str | None = None
    severity: str  # "info" | "warning" | "danger"
    created_at: str
    link: str | None = None
    read: bool = False


class NotificationsResponse(BaseModel):
    items: list[NotificationItem]
    unread_count: int


# ── Helpers ───────────────────────────────────────────────────────────
def _sig(category: str, source_id: str) -> str:
    return hashlib.sha1(f"{category}:{source_id}".encode()).hexdigest()[:16]


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse_maybe_date(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str):
        return None
    try:
        # Accept both `YYYY-MM-DD` (cert.expiry_date shape) and full ISO.
        if len(value) == 10:
            return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


async def _read_ids_for_user(user_id: str) -> set[str]:
    cur = db.notifications_read.find({"user_id": user_id}, {"_id": 0, "notification_id": 1})
    return {r["notification_id"] async for r in cur}


# ── Category builders ────────────────────────────────────────────────
async def _cat_expiring_certs(now: datetime) -> list[NotificationItem]:
    """Certs with expiry_date within EXPIRING_WINDOW_DAYS or already expired."""
    horizon = now + timedelta(days=EXPIRING_WINDOW_DAYS)
    horizon_str = horizon.strftime("%Y-%m-%d")
    now_str = now.strftime("%Y-%m-%d")
    cur = db.worker_certifications.find(
        {
            "deleted_at": {"$in": [None, ""]},
            "expiry_date": {"$lte": horizon_str, "$ne": None, "$ne": ""},
        },
        {
            "_id": 0, "id": 1, "worker_id": 1, "name": 1, "expiry_date": 1,
        },
    ).sort("expiry_date", 1).limit(MAX_ITEMS_PER_CATEGORY)
    out: list[NotificationItem] = []
    async for c in cur:
        expiry = _parse_maybe_date(c.get("expiry_date"))
        if not expiry:
            continue
        expired = expiry < now
        title = f"{c.get('name') or 'Certification'} — {'EXPIRED' if expired else 'expires soon'}"
        subtitle = (
            f"Worker cert · {'expired' if expired else 'expires'} "
            f"{c.get('expiry_date')}"
        )
        out.append(NotificationItem(
            id=_sig("expiring_cert", c["id"]),
            category="expiring_certs",
            title=title,
            subtitle=subtitle,
            severity="danger" if expired else "warning",
            created_at=_iso(expiry),
            link="/app/settings/certifications",
        ))
    return out


async def _cat_overdue_renewals(now: datetime) -> list[NotificationItem]:
    """Renewal links that have expired but weren't submitted."""
    cur = db.renewal_links.find(
        {
            "deleted_at": {"$in": [None, ""]},
            "status": {"$in": ["pending", "sent"]},
            "used_at": None,
            "expires_at": {"$lt": _iso(now)},
        },
        {
            "_id": 0, "id": 1, "contractor_name": 1, "doc_types_requested": 1,
            "expires_at": 1,
        },
    ).sort("expires_at", 1).limit(MAX_ITEMS_PER_CATEGORY)
    out: list[NotificationItem] = []
    async for r in cur:
        expires_at = _parse_maybe_date(r.get("expires_at")) or now
        doc_types = r.get("doc_types_requested") or []
        subtitle = (
            f"{', '.join(doc_types[:3])} · overdue since "
            f"{expires_at.strftime('%d %b %Y')}"
        )
        out.append(NotificationItem(
            id=_sig("overdue_renewal", r["id"]),
            category="overdue_renewals",
            title=f"{r.get('contractor_name') or 'Contractor'} — renewal overdue",
            subtitle=subtitle,
            severity="danger",
            created_at=_iso(expires_at),
            link="/app/renewals",
        ))
    return out


async def _cat_failed_integrations(now: datetime) -> list[NotificationItem]:
    """Integrations whose last observed status is not `connected` OR that
    logged a `last_error` recently."""
    cur = db.integration_configs.find(
        {
            "$or": [
                {"status": {"$nin": [None, "connected", "ok"]}},
                {"last_error": {"$nin": [None, ""]}},
            ],
        },
        {"_id": 0, "id": 1, "kind": 1, "status": 1, "last_error": 1, "last_tested_at": 1},
    ).limit(MAX_ITEMS_PER_CATEGORY)
    out: list[NotificationItem] = []
    async for i in cur:
        last_err = i.get("last_error")
        last_tested = _parse_maybe_date(i.get("last_tested_at")) or now
        # Only surface as a notification if the failure is recent.
        if now - last_tested > timedelta(hours=INTEGRATION_STALE_HOURS) and not last_err:
            continue
        kind = (i.get("kind") or "unknown").title()
        subtitle = (last_err or f"Status: {i.get('status')}")[:160]
        out.append(NotificationItem(
            id=_sig("failed_integration", i["id"]),
            category="failed_integrations",
            title=f"{kind} — sync failure",
            subtitle=subtitle,
            severity="danger",
            created_at=_iso(last_tested),
            link=f"/app/settings/integrations/{(i.get('kind') or '').lower()}",
        ))
    return out


async def _cat_pending_approvals(now: datetime) -> list[NotificationItem]:
    """SWMS awaiting approval by the caller's role."""
    cur = db.swms.find(
        {
            "deleted_at": {"$in": [None, ""]},
            "status": {"$in": ["awaiting_approval", "in_review", "draft"]},
        },
        {"_id": 0, "id": 1, "title": 1, "status": 1, "updated_at": 1},
    ).sort("updated_at", -1).limit(MAX_ITEMS_PER_CATEGORY)
    out: list[NotificationItem] = []
    async for s in cur:
        updated = _parse_maybe_date(s.get("updated_at")) or now
        out.append(NotificationItem(
            id=_sig("pending_approval", s["id"]),
            category="pending_approvals",
            title=f"SWMS awaiting review: {s.get('title') or 'Untitled'}",
            subtitle=f"Status: {s.get('status')}",
            severity="info",
            created_at=_iso(updated),
            link=f"/app/swms/{s['id']}",
        ))
    return out


# ── Endpoints ─────────────────────────────────────────────────────────
@router.get("", response_model=NotificationsResponse)
async def list_notifications(user: dict = Depends(get_current_user)) -> NotificationsResponse:
    """List every unread signal the caller is entitled to see, plus a
    handful of recently-read items so the panel doesn't feel empty
    immediately after every dismiss. Read items are marked
    `read: true` and NOT counted in `unread_count`."""
    now = datetime.now(timezone.utc)
    items: list[NotificationItem] = []

    # Each category runs only if the caller has the corresponding token.
    if await user_can(user, "certifications", "view"):
        items.extend(await _cat_expiring_certs(now))
    if await user_can(user, "renewals", "view"):
        items.extend(await _cat_overdue_renewals(now))
    if await user_can(user, "settings", "view"):
        items.extend(await _cat_failed_integrations(now))
    if await user_can(user, "swms", "approve") or await user_can(user, "swms", "edit"):
        items.extend(await _cat_pending_approvals(now))

    # Apply read state.
    read_ids = await _read_ids_for_user(user["id"])
    for it in items:
        if it.id in read_ids:
            it.read = True

    # Sort: unread first, then by created_at desc.
    items.sort(key=lambda x: (x.read, x.created_at), reverse=False)
    items.reverse()
    items.sort(key=lambda x: (x.read,))  # unread bucket first

    unread_count = sum(1 for x in items if not x.read)
    return NotificationsResponse(items=items, unread_count=unread_count)


class MarkReadBody(BaseModel):
    pass


@router.post("/{notification_id}/read")
async def mark_read(notification_id: str, user: dict = Depends(get_current_user)) -> dict:
    """Idempotent mark-read. Uses `$setOnInsert` so a second click on
    the same item is a cheap no-op."""
    now = datetime.now(timezone.utc)
    await db.notifications_read.update_one(
        {"user_id": user["id"], "notification_id": notification_id},
        {"$setOnInsert": {
            "user_id": user["id"],
            "notification_id": notification_id,
            "read_at": _iso(now),
        }},
        upsert=True,
    )
    return {"ok": True, "notification_id": notification_id}


@router.post("/mark-all-read")
async def mark_all_read(user: dict = Depends(get_current_user)) -> dict:
    """Convenience wrapper: fetch the current list and mark every
    unread item as read in one round-trip."""
    resp = await list_notifications(user=user)
    now = datetime.now(timezone.utc)
    to_write = [x.id for x in resp.items if not x.read]
    if not to_write:
        return {"ok": True, "marked": 0}
    ops: list[dict] = [
        {"user_id": user["id"], "notification_id": nid, "read_at": _iso(now)}
        for nid in to_write
    ]
    # bulk upsert one by one — the ids per user are bounded (<=100).
    for op in ops:
        await db.notifications_read.update_one(
            {"user_id": op["user_id"], "notification_id": op["notification_id"]},
            {"$setOnInsert": op},
            upsert=True,
        )
    return {"ok": True, "marked": len(ops)}
