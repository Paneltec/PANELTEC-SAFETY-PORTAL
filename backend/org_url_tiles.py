"""v58.13.132eo — Admin-managed URL tiles (Quick Links) per org.

Small bookmark-style CRUD surface on Org Settings. Each tile is a
URL + label + optional icon/emoji + optional description + order.
Admins can add / edit / delete / reorder; tiles open in a new tab
(rel="noopener noreferrer").

v58.13.132ep — Auto-fetch remote icon via `POST /fetch-icon`.
New optional `remote_icon_url` field on every tile — populated by
the admin when saving from the FE editor; falls back to the emoji
`icon` field on the client when null or when the remote image
fails to render.

Collection shape (`org_url_tiles`):
    id, org_id, url, label, icon, description, order,
    remote_icon_url,  # v58.13.132ep
    created_at, created_by, updated_at, updated_by

Endpoints (all admin-only, 403 for non-admin):
    GET    /api/org/url-tiles                → list (sorted by `order`)
    POST   /api/org/url-tiles                → create
    PATCH  /api/org/url-tiles/{tile_id}      → update fields
    DELETE /api/org/url-tiles/{tile_id}      → hard delete
    POST   /api/org/url-tiles/reorder        → bulk order update
    POST   /api/org/url-tiles/fetch-icon     → auto-detect brand icon  (v58.13.132ep)

URL validation: MUST parse as http:// or https:// only. Rejects
`javascript:`, `file:`, `data:`, `about:`, empty schemes, etc.
"""
from __future__ import annotations

import ipaddress
import logging
import re
import socket
import time
from typing import List, Optional
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import new_id, now_iso

log = logging.getLogger("paneltec.org_url_tiles")

router = APIRouter(prefix="/org/url-tiles", tags=["org-url-tiles"])

_ALLOWED_SCHEMES = {"http", "https"}

# v58.13.132ep — Icon-fetch SSRF + DoS safeguards.
_FETCH_TIMEOUT_SECONDS = 5.0
_FETCH_MAX_BYTES = 10 * 1024 * 1024  # 10 MB body cap
_FETCH_USER_AGENT = "PaneltecCivil-QuickLinks/1.0 (+https://paneltec.com.au)"
_ICON_CACHE_TTL_SECONDS = 24 * 60 * 60  # 24 h
_ICON_CACHE: dict[str, tuple[float, dict]] = {}


def _admin(user: dict) -> None:
    if (user.get("role") or user.get("role_id")) != "admin":
        raise HTTPException(status_code=403,
                            detail="Tile management is admin-only.")


def _sanitize_url(raw: str) -> str:
    """Strict http/https-only URL sanitiser. Rejects javascript:,
    file:, data:, about:, mailto:, protocol-relative, empty, and any
    other non-standard scheme."""
    if not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="URL must be a string")
    url = raw.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    try:
        parsed = urlparse(url)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="URL is malformed")
    scheme = (parsed.scheme or "").lower()
    if scheme not in _ALLOWED_SCHEMES:
        raise HTTPException(
            status_code=400,
            detail=f"URL scheme must be http or https (got '{scheme or 'none'}')",
        )
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="URL must include a host")
    # Reject embedded credentials — a bookmark should never carry them.
    if "@" in parsed.netloc:
        raise HTTPException(status_code=400,
                            detail="URL must not contain embedded credentials")
    # Normalise scheme casing but preserve the rest verbatim.
    return parsed._replace(scheme=scheme).geturl()


def _strip_label(v: Optional[str], *, field: str, required: bool = False,
                  max_len: int = 120) -> str:
    s = (v or "").strip()
    if required and not s:
        raise HTTPException(status_code=400, detail=f"{field} is required")
    if len(s) > max_len:
        raise HTTPException(status_code=400,
                            detail=f"{field} must be at most {max_len} chars")
    return s


class TileIn(BaseModel):
    url: str
    label: str
    icon: Optional[str] = None
    description: Optional[str] = None
    order: Optional[int] = Field(default=None, ge=0, le=9999)
    remote_icon_url: Optional[str] = None  # v58.13.132ep
    enabled: Optional[bool] = None  # v58.13.132er
    color: Optional[str] = None  # v58.13.132er — hex accent
    # v58.13.132ey — Per-tile ACL. `None`/`[]` → public (every user in
    # the org sees the tile). Non-empty → only listed `users.id`
    # values see the tile. Strict admin rule: admins are NOT bypassed;
    # they must be on the list to see the tile.
    allowed_user_ids: Optional[list[str]] = None
    # v58.13.132ff — Explicit `access_mode`. See TilePatch below.
    access_mode: Optional[str] = None
    # v58.13.132g1 — When true, every click on the tile body (any
    # role, including admin) must pass a 4-digit PIN gate before the
    # URL is opened. Per-click, not per-session.
    pin_protected: Optional[bool] = None
    # v58.13.132g9 — Org-wide hide (was per-user sessionStorage).
    # When true, the tile is filtered out of GET /api/org/url-tiles
    # for every user; admins can pass ?include_hidden=true to see it.
    hidden: Optional[bool] = None


class TilePatch(BaseModel):
    url: Optional[str] = None
    label: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    order: Optional[int] = Field(default=None, ge=0, le=9999)
    remote_icon_url: Optional[str] = None  # v58.13.132ep
    enabled: Optional[bool] = None  # v58.13.132er
    color: Optional[str] = None  # v58.13.132er
    allowed_user_ids: Optional[list[str]] = None  # v58.13.132ey
    # v58.13.132ff — Explicit access mode. `"public"` or
    # `"private"`. Missing on read → inferred from ACL emptiness.
    access_mode: Optional[str] = None
    # v58.13.132g1 — Toggle the per-tile PIN gate.
    pin_protected: Optional[bool] = None
    # v58.13.132g9 — Toggle org-wide hide.
    hidden: Optional[bool] = None


class ReorderRow(BaseModel):
    tile_id: str
    order: int = Field(ge=0, le=9999)


class ReorderIn(BaseModel):
    tiles: list[ReorderRow]


class ReorderIdsIn(BaseModel):
    """v58.13.132g1 — Ordered-list reorder shape.

    Simpler contract than `ReorderIn` for the Apps Directory drag-and-
    drop UX: caller sends the tile ids in the target order and the
    server writes `order = 0, 1, 2, …` in one pass. Coexists with
    `POST /reorder` (which still accepts explicit per-tile order
    integers) — that endpoint is still used by other flows.
    """
    tile_ids: list[str]


_HEX_COLOR_RE = re.compile(r"^#([0-9a-fA-F]{6})$")
_DEFAULT_TILE_COLOR = "#1d6fb8"  # v58.13.132er — Apps Directory blue.

# v58.13.132ew — Auto-assign a distinct accent colour per tile based
# on a stable hash of the tile's label (fallback: `id`). Palette holds
# 12 visually distinct hexes so a busy hub reads at a glance. The
# sentinel `_DEFAULT_TILE_COLOR` is DELIBERATELY absent from the
# palette — that value is treated as "unset / auto" by `_out()` and
# gets swapped for the hash-picked colour on the return path. Admin
# picks anything else in the palette (or off-palette) and their
# choice wins. Existing rows written with the default blue get
# auto-backfilled on read; no migration script required.
_AUTO_PALETTE: tuple[str, ...] = (
    "#3b82f6",  # blue-500  (distinct from _DEFAULT_TILE_COLOR)
    "#ef4444",  # red-500
    "#22c55e",  # green-500
    "#7c3aed",  # violet-600
    "#14b8a6",  # teal-500
    "#f97316",  # orange-500
    "#ec4899",  # pink-500
    "#6366f1",  # indigo-500
    "#f59e0b",  # amber-500
    "#06b6d4",  # cyan-500
    "#f43f5e",  # rose-500
    "#10b981",  # emerald-500
)


def _auto_color_for(seed: str) -> str:
    """Deterministic palette pick from a seed string. Idempotent —
    the same seed always yields the same hex. Simple `sum(ord(c))`
    hash so the JS mirror in `QuickLinksSection.jsx` can compute an
    identical preview swatch without pulling in a hash library."""
    s = (seed or "").strip().lower()
    if not s:
        return _AUTO_PALETTE[0]
    total = 0
    for ch in s:
        total += ord(ch)
    return _AUTO_PALETTE[total % len(_AUTO_PALETTE)]


async def _sanitize_allowed_user_ids(raw: Optional[list[str]],
                                       org_id: str) -> list[str]:
    """v58.13.132ey — Coerce, dedupe and validate an ACL list.

    Invalid or cross-org IDs are **silently dropped** (not 400). This
    is deliberate: admins may hold on to a stale ID after a user is
    soft-deleted; failing the whole save just because one entry is
    stale would be brittle. Deleted users are excluded from the
    intersection so a soft-delete effectively revokes access. Order
    is preserved from the input for a stable UX in the picker.
    """
    if not raw:
        return []
    seen: set[str] = set()
    ordered: list[str] = []
    for uid in raw:
        if not isinstance(uid, str):
            continue
        uid = uid.strip()
        if not uid or uid in seen:
            continue
        seen.add(uid)
        ordered.append(uid)
    if not ordered:
        return []
    cur = db.users.find({
        "id": {"$in": ordered},
        "org_id": org_id,
        "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}],
    }, {"_id": 0, "id": 1})
    valid: set[str] = set()
    async for u in cur:
        valid.add(u["id"])
    return [uid for uid in ordered if uid in valid]


def _sanitize_color(raw: Optional[str]) -> Optional[str]:
    """Accept `None` / empty (→ None) or a `#rrggbb` hex code.
    Rejects malformed input with HTTP 400."""
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    if not _HEX_COLOR_RE.match(s):
        raise HTTPException(status_code=400,
                            detail="Color must be a `#rrggbb` hex code")
    return s.lower()


def _out(doc: dict, viewer_id: str = "", *, redact_url: bool = False,
         pin_unlocked: bool = True) -> dict:
    """Strip Mongo `_id` + expose the stable API shape.

    v58.13.132ez — Adds `approved_for_me` per-viewer flag + optional
    URL redaction. Un-approved viewers see the tile in the response
    with the `url` blanked out so nothing leaks about the private
    destination. Admins going through the Manage view (or the
    editor) pass `redact_url=False` so they always see full detail.
    Public tiles (empty ACL) are approved for everyone."""
    # v58.13.132ew — Auto-colour swap. When the stored color is empty
    # OR equals the legacy default sentinel (`_DEFAULT_TILE_COLOR`),
    # substitute a hash-picked palette colour so tiles read as a
    # rainbow rather than a wall of blue. Manual picks (any other
    # hex) pass through untouched. Idempotent: same label → same hex.
    stored_color = doc.get("color")
    if not stored_color or stored_color == _DEFAULT_TILE_COLOR:
        display_color = _auto_color_for(doc.get("label") or doc.get("id") or "")
    else:
        display_color = stored_color
    allowed = list(doc.get("allowed_user_ids") or [])
    # v58.13.132ff — access_mode is now authoritative. Missing on
    # pre-.132ff rows → infer: non-empty ACL means private,
    # empty means public (backwards-compat).
    stored_mode = doc.get("access_mode")
    if stored_mode not in ("public", "private"):
        stored_mode = "private" if allowed else "public"
    approved = (stored_mode == "public") or (viewer_id in allowed)
    return {
        "id": doc.get("id"),
        "org_id": doc.get("org_id"),
        # v58.13.132ez — Redact URL for un-approved viewers when
        # `redact_url=True`. Admin editor / Manage view pass False
        # so they see full detail regardless of personal approval.
        # PIN-protected tiles also withhold the link in the launcher
        # list until the viewer has entered their PIN (tile_unlock.py).
        "url": (doc.get("url")
                if ((approved or not redact_url)
                    and (not redact_url or pin_unlocked
                         or not doc.get("pin_protected")))
                else ""),
        "label": doc.get("label"),
        "icon": doc.get("icon") or "",
        "description": doc.get("description") or "",
        "order": int(doc.get("order") or 0),
        "remote_icon_url": doc.get("remote_icon_url"),  # v58.13.132ep
        # v58.13.132er — Idempotent defaults for pre-.132er rows:
        # `enabled` reads true when absent, `color` reads the Apps
        # Directory blue. No migration needed.
        "enabled": bool(doc.get("enabled", True)),
        "color": display_color,
        # v58.13.132ey — Missing / null / non-list stored ACL coerces
        # to `[]` so any pre-.132ey rows behave as public tiles.
        "allowed_user_ids": allowed,
        "access_mode": stored_mode,
        # v58.13.132ez — Per-viewer approval flag drives the greyed-out
        # tile UI. `true` means the viewer can click / launch / reveal
        # credentials; `false` means the tile is visible but disabled.
        "approved_for_me": approved,
        # v58.13.132g1 — Per-tile PIN gate flag. When true, every
        # click (any role) must pass a 4-digit PIN before the URL
        # opens; the tile-body renders greyed with a lock overlay
        # in the frontend.
        "pin_protected": bool(doc.get("pin_protected", False)),
        # v58.13.132g9 — Org-wide hide flag; regular reads filter
        # hidden tiles out, admins can surface them via
        # ?include_hidden=true.
        "hidden": bool(doc.get("hidden", False)),
        "created_at": doc.get("created_at"),
        "created_by": doc.get("created_by"),
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
    }


@router.get("")
async def list_tiles(include_disabled: bool = False,
                      include_hidden: bool = False,
                      user: dict = Depends(get_current_user)):
    # v58.13.132eq — Read is open to ANY authenticated user in the
    # caller's org so the read-only Quick Links page (sidebar entry
    # visible to all users) can render the tile grid. Management
    # (POST/PATCH/DELETE/reorder + fetch-icon) stays admin-only.
    #
    # v58.13.132er — `include_disabled` (management-only view) surfaces
    # tiles hidden via the ON/OFF pill. Non-admins can pass the flag
    # but they should never see hidden tiles in production; we gate
    # the flag admin-only to prevent staff from bypassing the
    # organisation's curated tile visibility.
    #
    # v58.13.132g9 — `include_hidden` (management + PIN-gated
    # "Show hidden" toggle) surfaces org-wide-hidden tiles. Same
    # admin-only clamp as include_disabled: without it a curious
    # staff member could hand-craft the query and un-hide tiles.
    org_id = user["org_id"]
    role = (user.get("role") or user.get("role_id"))
    if include_disabled and role != "admin":
        include_disabled = False
    if include_hidden and role != "admin":
        include_hidden = False
    query: dict = {"org_id": org_id}
    if not include_disabled:
        query["$or"] = [{"enabled": {"$ne": False}}, {"enabled": {"$exists": False}}]
    if not include_hidden:
        # Rows pre-dating .132g9 lack the `hidden` field — treat as
        # visible.
        query["$and"] = [
            {"$or": [{"hidden": {"$ne": True}}, {"hidden": {"$exists": False}}]},
        ]
    from tile_unlock import is_unlocked
    pin_unlocked = await is_unlocked(user["id"])
    tiles = []
    cur = db.org_url_tiles.find(query).sort([("order", 1),
                                                          ("created_at", 1)])
    async for t in cur:
        # v58.13.132ez — REPLACES the .132ey hide-filter with a
        # visible-but-greyed-out UX. Every authenticated user in the
        # org sees every tile; the `_out()` payload carries
        # `approved_for_me` so the FE can grey unapproved tiles and
        # `url` is redacted (empty string) for those viewers so
        # nothing leaks about the private destination. The admin
        # Manage view (`include_disabled=true`) opts out of URL
        # redaction so admins can always edit tiles they aren't
        # personally approved for.
        tiles.append(_out(t, user["id"],
                            redact_url=not include_disabled,
                            pin_unlocked=pin_unlocked))
    return {"tiles": tiles}


# v58.13.132ey — Admin-only picker feed for the tile-editor ACL
# section. Returns active, non-test users in the caller's org so the
# admin can tick who should see a restricted tile.
@router.get("/eligible-users")
async def list_eligible_users(user: dict = Depends(get_current_user)):
    _admin(user)
    org_id = user["org_id"]
    q = {
        "org_id": org_id,
        "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}],
    }
    # Deliberately DO NOT filter test users out — the picker is a
    # tenant-scoped list of every real member the admin might grant
    # access to. Real orgs have zero test rows; test orgs need them.
    cur = db.users.find(q, {"_id": 0, "id": 1, "name": 1,
                              "email": 1, "role_id": 1, "role": 1})
    out: list[dict] = []
    async for u in cur:
        role = u.get("role_id") or u.get("role") or ""
        out.append({
            "id": u.get("id"),
            "name": (u.get("name") or "").strip() or (u.get("email") or ""),
            "email": u.get("email") or "",
            "is_admin": role == "admin",
        })
    out.sort(key=lambda r: (r["name"].lower(), r["email"].lower()))
    return {"users": out}


# v58.13.132ez — Per-user approvals batch surface for the
# Permissions page. Mirrors the tile-side "Restrict access" editor
# from `.132ey` but pivots on the user instead of the tile.


class UserApprovalsPatchIn(BaseModel):
    user_id: str
    approved_tile_ids: list[str] = Field(default_factory=list)


@router.get("/user-approvals")
async def get_user_approvals(user_id: str,
                              user: dict = Depends(get_current_user)):
    """Return the tile approval status for a specific user.

    `approved_tile_ids` — restricted tiles the user is listed on.
    `public_tile_ids`   — tiles with no ACL (visible to everyone).
    The Permissions page renders public tiles as checked-and-disabled
    with a "Public — everyone" hint."""
    _admin(user)
    org_id = user["org_id"]
    # Validate the target user exists and is active in the caller's
    # org — otherwise the payload is meaningless.
    target = await db.users.find_one({
        "id": user_id, "org_id": org_id,
        "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}],
    }, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404,
                            detail="User not found in this org.")
    approved: list[str] = []
    public: list[str] = []
    cur = db.org_url_tiles.find({"org_id": org_id})
    async for t in cur:
        allowed = t.get("allowed_user_ids") or []
        tid = t.get("id")
        if not allowed:
            public.append(tid)
        elif user_id in allowed:
            approved.append(tid)
    return {"user_id": user_id,
            "approved_tile_ids": approved,
            "public_tile_ids": public}


@router.patch("/user-approvals")
async def patch_user_approvals(body: UserApprovalsPatchIn,
                                user: dict = Depends(get_current_user)):
    """Edit ONE user's approvals across every restricted tile in the
    org.

    Semantics (per Stephen's spec):
      · Public tiles → no-op (batch never turns a public tile into a
        restricted one — that would be a surprising side-effect).
      · Restricted tile in `approved_tile_ids` → ensure `user_id` is
        in the ACL (add if missing).
      · Restricted tile NOT in `approved_tile_ids` → ensure `user_id`
        is NOT in the ACL (remove if present).

    Returns a summary of the resulting per-tile ACLs so the FE can
    reconcile without a follow-up round-trip."""
    _admin(user)
    org_id = user["org_id"]
    # Validate the target user exists in this org.
    target = await db.users.find_one({
        "id": body.user_id, "org_id": org_id,
        "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}],
    }, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404,
                            detail="User not found in this org.")
    approved_set: set[str] = set(body.approved_tile_ids or [])
    summary: list[dict] = []
    now = now_iso()
    cur = db.org_url_tiles.find({"org_id": org_id})
    async for t in cur:
        tid = t.get("id")
        allowed = list(t.get("allowed_user_ids") or [])
        should_be_on = tid in approved_set
        was_public = not allowed
        was_on = body.user_id in allowed
        new_allowed = allowed
        if was_public:
            # Public tile: batch never restricts a public tile — a
            # public tile listed in `approved_tile_ids` is already
            # visible to the user (no change needed).
            pass
        elif should_be_on and not was_on:
            new_allowed = allowed + [body.user_id]
        elif (not should_be_on) and was_on:
            new_allowed = [u for u in allowed if u != body.user_id]
        if new_allowed != allowed:
            await db.org_url_tiles.update_one(
                {"id": tid, "org_id": org_id},
                {"$set": {"allowed_user_ids": new_allowed,
                          "updated_at": now,
                          "updated_by": user["id"]}})
        summary.append({"tile_id": tid,
                        "label": t.get("label"),
                        "allowed_user_ids": new_allowed,
                        "is_public": not new_allowed,
                        "user_is_approved":
                            (not new_allowed)
                            or (body.user_id in new_allowed)})
    log.info("org_url_tiles.user_approvals.patch org=%s user=%s",
             org_id, body.user_id)
    return {"user_id": body.user_id, "tiles": summary}


@router.post("")
async def create_tile(body: TileIn, user: dict = Depends(get_current_user)):
    _admin(user)
    org_id = user["org_id"]
    url = _sanitize_url(body.url)
    label = _strip_label(body.label, field="Label", required=True, max_len=80)
    icon = _strip_label(body.icon, field="Icon", max_len=8)
    description = _strip_label(body.description, field="Description",
                                max_len=280)
    # Order defaults to end-of-list if unspecified.
    if body.order is None:
        last = await db.org_url_tiles.find_one({"org_id": org_id},
                                                sort=[("order", -1)])
        order = int((last or {}).get("order") or 0) + 1 if last else 0
    else:
        order = int(body.order)
    now = now_iso()
    doc = {
        "id": new_id(), "org_id": org_id,
        "url": url, "label": label, "icon": icon, "description": description,
        "order": order,
        "remote_icon_url": _sanitize_optional_icon_url(body.remote_icon_url),
        # v58.13.132er — Apps Directory fields.
        "enabled": True if body.enabled is None else bool(body.enabled),
        "color": _sanitize_color(body.color) or _DEFAULT_TILE_COLOR,
        # v58.13.132ey — Per-tile ACL. Sanitised + intersected with
        # the org's active user list so stale IDs are dropped.
        "allowed_user_ids": await _sanitize_allowed_user_ids(
            body.allowed_user_ids, org_id),
        # v58.13.132ff — Explicit access_mode. Fallback: infer from
        # ACL if the client didn't set it.
        "access_mode": (body.access_mode
                          if body.access_mode in ("public", "private")
                          else ("private" if body.allowed_user_ids else "public")),
        # v58.13.132g1 — Per-tile PIN gate. Defaults to off.
        "pin_protected": bool(body.pin_protected) if body.pin_protected is not None else False,
        # v58.13.132g9 — new tiles default to visible.
        "hidden": bool(body.hidden) if body.hidden is not None else False,
        "created_at": now, "created_by": user["id"],
        "updated_at": now, "updated_by": user["id"],
    }
    await db.org_url_tiles.insert_one(doc)
    log.info("org_url_tiles.create org=%s tile=%s label=%r",
             org_id, doc["id"], label)
    # v58.13.132ez — Admin editor return path: never redact. The
    # admin should always see the URL of the tile they just created,
    # even if they aren't on the ACL themselves.
    return _out(doc, user["id"], redact_url=False)



# v58.13.132fl — Bulk lockdown / unlock.

class BulkAccessIn(BaseModel):
    tile_ids: List[str] = Field(default_factory=list)
    access_mode: str = "private"
    allowed_user_ids: List[str] = Field(default_factory=list)


@router.patch("/bulk-access")
async def bulk_access(body: BulkAccessIn,
                       user: dict = Depends(get_current_user)):
    """Set access_mode + allowed_user_ids on many tiles in one call.
    Admin-only. Returns { updated: N, tiles: [<summary>...] }."""
    _admin(user)
    if body.access_mode not in ("public", "private"):
        raise HTTPException(400, "access_mode must be 'public' or 'private'")
    org_id = user["org_id"]
    ids = [t for t in (body.tile_ids or []) if isinstance(t, str) and t]
    if not ids:
        return {"updated": 0, "tiles": []}
    if body.access_mode == "private":
        allowed = await _sanitize_allowed_user_ids(body.allowed_user_ids, org_id)
    else:
        allowed = []
    now = now_iso()
    result = await db.org_url_tiles.update_many(
        {"id": {"$in": ids}, "org_id": org_id},
        {"$set": {
            "access_mode": body.access_mode,
            "allowed_user_ids": allowed,
            "updated_at": now,
            "updated_by": user["id"],
        }},
    )
    fresh = await db.org_url_tiles.find(
        {"id": {"$in": ids}, "org_id": org_id}).to_list(len(ids))
    log.info("org_url_tiles.bulk_access org=%s n=%d mode=%s",
             org_id, result.modified_count, body.access_mode)
    return {"updated": result.modified_count,
            "tiles": [_out(t, user["id"], redact_url=False) for t in fresh]}


@router.patch("/reorder")
async def reorder_tiles_by_ids(body: ReorderIdsIn,
                                 user: dict = Depends(get_current_user)):
    """v58.13.132g1 — Apps Directory drag-and-drop reorder.

    Admin sends the target ordering as a flat list of tile ids; server
    writes `order = 0, 1, 2, …` on each row (scoped to caller's org,
    ids from other orgs silently skip). Idempotent — a repeat call with
    the same list is a no-op behaviourally.

    Kept as a PATCH sibling to the existing `POST /reorder` (explicit
    per-tile order integers) so the two flows can coexist. This route
    MUST sit above `PATCH /{tile_id}` — otherwise the parameterised
    route swallows `/reorder` first.
    """
    _admin(user)
    org_id = user["org_id"]
    if not body.tile_ids:
        return {"ok": True, "updated": 0}
    now = now_iso()
    updated = 0
    for position, tile_id in enumerate(body.tile_ids):
        res = await db.org_url_tiles.update_one(
            {"id": tile_id, "org_id": org_id},
            {"$set": {"order": position,
                       "updated_at": now,
                       "updated_by": user["id"]}},
        )
        updated += res.modified_count
    log.info("org_url_tiles.reorder_by_ids org=%s rows=%d updated=%d",
             org_id, len(body.tile_ids), updated)
    return {"ok": True, "updated": updated}


@router.patch("/{tile_id}")
async def update_tile(tile_id: str, body: TilePatch,
                       user: dict = Depends(get_current_user)):
    _admin(user)
    org_id = user["org_id"]
    existing = await db.org_url_tiles.find_one({"id": tile_id,
                                                 "org_id": org_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Tile not found")
    updates: dict = {}
    if body.url is not None:
        updates["url"] = _sanitize_url(body.url)
    if body.label is not None:
        updates["label"] = _strip_label(body.label, field="Label",
                                         required=True, max_len=80)
    if body.icon is not None:
        updates["icon"] = _strip_label(body.icon, field="Icon", max_len=8)
    if body.description is not None:
        updates["description"] = _strip_label(body.description,
                                                field="Description",
                                                max_len=280)
    if body.order is not None:
        updates["order"] = int(body.order)
    if body.remote_icon_url is not None:
        updates["remote_icon_url"] = _sanitize_optional_icon_url(
            body.remote_icon_url)
    if body.enabled is not None:
        updates["enabled"] = bool(body.enabled)
    if body.color is not None:
        # Empty string clears back to the default blue on the client
        # side. Store the sanitised value (or the default) either way.
        updates["color"] = _sanitize_color(body.color) or _DEFAULT_TILE_COLOR
    if body.allowed_user_ids is not None:
        # v58.13.132ey — Whole-list replace. Sanitise + drop stale IDs.
        updates["allowed_user_ids"] = await _sanitize_allowed_user_ids(
            body.allowed_user_ids, org_id)
    if body.access_mode is not None:
        # v58.13.132ff — Accept only the two enum values; anything
        # else falls back to inference from the resulting ACL.
        if body.access_mode in ("public", "private"):
            updates["access_mode"] = body.access_mode
    if body.pin_protected is not None:
        # v58.13.132g1 — Toggle per-tile PIN gate.
        updates["pin_protected"] = bool(body.pin_protected)
    if body.hidden is not None:
        # v58.13.132g9 — Toggle org-wide hide.
        updates["hidden"] = bool(body.hidden)
    if not updates:
        return _out(existing, user["id"], redact_url=False)
    updates["updated_at"] = now_iso()
    updates["updated_by"] = user["id"]
    await db.org_url_tiles.update_one({"id": tile_id, "org_id": org_id},
                                       {"$set": updates})
    doc = await db.org_url_tiles.find_one({"id": tile_id, "org_id": org_id})
    log.info("org_url_tiles.update org=%s tile=%s fields=%s",
             org_id, tile_id, sorted(updates.keys()))
    # v58.13.132ga — Audit trail for org-wide visibility changes.
    # Fires only when `hidden` was in the patch AND the value
    # actually flipped (idempotent PATCHes must NOT spam the audit
    # log). Best-effort — a failed audit does not block the PATCH.
    if "hidden" in updates:
        prev_hidden = bool(existing.get("hidden", False))
        new_hidden = bool(updates["hidden"])
        if prev_hidden != new_hidden:
            from archive_audit_helpers import record_tile_visibility_audit
            await record_tile_visibility_audit(
                tile_id=tile_id,
                tile_name=doc.get("label"),
                action="tile_hidden" if new_hidden else "tile_restored",
                user=user,
            )
    # v58.13.132ez — Admin editor return path: never redact.
    return _out(doc, user["id"], redact_url=False)



@router.delete("/{tile_id}")
async def delete_tile(tile_id: str, user: dict = Depends(get_current_user)):
    _admin(user)
    org_id = user["org_id"]
    res = await db.org_url_tiles.delete_one({"id": tile_id, "org_id": org_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Tile not found")
    log.info("org_url_tiles.delete org=%s tile=%s", org_id, tile_id)
    return {"ok": True, "deleted": tile_id}


class TilePinVerifyIn(BaseModel):
    pin: str = Field(..., min_length=4, max_length=4)


@router.get("/unlock-status")
async def unlock_status(user: dict = Depends(get_current_user)):
    """Is the caller's PIN unlock window open, and until when."""
    from tile_unlock import unlocked_until, UNLOCK_MINUTES
    return {"unlocked_until": await unlocked_until(user["id"]),
            "window_minutes": UNLOCK_MINUTES}


@router.post("/lock-now")
async def lock_now(user: dict = Depends(get_current_user)):
    """Close the caller's PIN unlock window straight away."""
    from tile_unlock import revoke, log_access
    await revoke(user["id"])
    await log_access(user, None, "locked")
    return {"ok": True}


@router.get("/activity")
async def tile_activity(limit: int = 200, user: dict = Depends(get_current_user)):
    """Admin-only, PIN-unlocked: who unlocked, opened or used saved logins."""
    from tile_unlock import require_unlocked
    _admin(user)
    await require_unlocked(user["id"])
    limit = max(1, min(int(limit), 500))
    rows = await db.tile_access_log.find(
        {"org_id": user["org_id"]}, {"_id": 0}).sort([("at", -1)]).to_list(limit)
    return {"items": rows}


@router.post("/{tile_id}/verify-pin")
async def verify_tile_pin(tile_id: str, body: TilePinVerifyIn,
                            user: dict = Depends(get_current_user)):
    """v58.13.132g1 — Per-click PIN gate on a `pin_protected` tile.

    Verifies the submitted 4-digit PIN against the caller's stored
    `users.admin_console_pin_hash` (the same PIN the header
    admin-console lock uses — Stephen deliberately wants one PIN per
    person). Returns the tile URL on success so the frontend can open
    it without a second GET round-trip.

    Rate-limiting reuses the shared `admin_console_pin_attempts`
    lockout tiers (3/30s + 6/15min) so this endpoint can't be used to
    end-run the header lock's throttling.

    Response codes:
      · 200 → `{ok: true, url: <tile url>}`
      · 400 → tile is not pin_protected (nothing to unlock)
      · 401 → wrong PIN
      · 403 → user has no admin PIN configured
      · 404 → tile not found in caller's org
      · 429 → locked out
    """
    # Deferred import — the pin helpers live in a peer router module
    # and importing at file scope would risk load-order weirdness.
    import re as _re
    from admin_console_pin import (
        _check_lockout, _record_failure, _reset_attempts,
        verify_password,
    )
    org_id = user["org_id"]
    tile = await db.org_url_tiles.find_one(
        {"id": tile_id, "org_id": org_id},
        {"_id": 0, "id": 1, "url": 1, "pin_protected": 1,
         "allowed_user_ids": 1, "access_mode": 1},
    )
    if not tile:
        raise HTTPException(status_code=404, detail="Tile not found")
    # v58.13.132g6 — PIN is now the gate for the 3-dots menu on
    # every tile (not just pin_protected ones), so we no longer 400
    # when a caller wants to verify against a public tile. The
    # per-tile `pin_protected` flag still drives the URL-launch
    # gate and the greyed / lock-overlay UI; this endpoint just
    # verifies the caller's admin PIN against a valid tile id.
    if not _re.match(r"^\d{4}$", body.pin):
        raise HTTPException(status_code=400,
                            detail="PIN must be exactly 4 digits.")
    # Approval gate — if the tile is private and the caller isn't on
    # its ACL, they cannot unlock it. Prevents a non-approved user
    # from using their own PIN to bypass tile visibility.
    allowed = list(tile.get("allowed_user_ids") or [])
    mode = tile.get("access_mode") or ("private" if allowed else "public")
    if mode == "private" and user["id"] not in allowed:
        raise HTTPException(status_code=403,
                            detail="Not approved for this tile.")

    # Rate-limit BEFORE we touch bcrypt.
    await _check_lockout(user["id"])

    doc = await db.users.find_one(
        {"id": user["id"]},
        {"admin_console_pin_hash": 1},
    )
    existing_hash = (doc or {}).get("admin_console_pin_hash")
    if not existing_hash:
        raise HTTPException(
            status_code=403,
            detail="No admin PIN set. Configure one in your profile first.",
        )
    from tile_unlock import grant, log_access
    if not verify_password(body.pin, existing_hash):
        await log_access(user, tile_id, "pin_wrong")
        recorded = await _record_failure(user["id"])
        lu = recorded.get("locked_until")
        if lu:
            from datetime import datetime as _dt, timezone as _tz
            remaining = int((lu - _dt.now(_tz.utc)).total_seconds())
            raise HTTPException(
                status_code=429,
                detail=f"Too many wrong PINs. Try again in {remaining}s.",
                headers={"Retry-After": str(remaining)},
            )
        raise HTTPException(status_code=401, detail="Wrong PIN.")
    await _reset_attempts(user["id"])
    unlocked_until = await grant(user["id"])
    await log_access(user, tile_id, "pin_ok")
    log.info("org_url_tiles.verify_pin org=%s tile=%s actor=%s",
             org_id, tile_id, user["id"])
    return {"ok": True, "url": tile.get("url") or "",
            "unlocked_until": unlocked_until}


@router.post("/reorder")
async def reorder_tiles(body: ReorderIn,
                         user: dict = Depends(get_current_user)):
    _admin(user)
    org_id = user["org_id"]
    if not body.tiles:
        return {"ok": True, "updated": 0}
    # Bulk update in a single pass. Rows scoped to the caller's org
    # (tile_ids from other orgs silently skip).
    now = now_iso()
    updated = 0
    for row in body.tiles:
        res = await db.org_url_tiles.update_one(
            {"id": row.tile_id, "org_id": org_id},
            {"$set": {"order": int(row.order),
                       "updated_at": now,
                       "updated_by": user["id"]}},
        )
        updated += res.modified_count
    log.info("org_url_tiles.reorder org=%s rows=%d updated=%d",
             org_id, len(body.tiles), updated)
    return {"ok": True, "updated": updated}


# ── v58.13.132ep — Icon fetcher ────────────────────────────────────
#
# `POST /api/org/url-tiles/fetch-icon` — admin-only server-side scrape
# that returns the "best" branded icon for a target URL. Priority:
#   1. `<link rel="apple-touch-icon">`   (highest quality, 180×180+)
#   2. `<link rel="icon">` sizes attr    (pick largest)
#   3. Open Graph `og:image`
#   4. `/favicon.ico` at the origin      (last-ditch fallback)
#
# SSRF hardening:
#   · http/https scheme only (via `_sanitize_url`).
#   · Reject hosts that resolve to loopback / link-local / private
#     RFC1918 / RFC4193 addresses (`_reject_private_host`).
#   · 5 s total timeout on the outbound httpx call.
#   · Streamed body read capped at `_FETCH_MAX_BYTES` (10 MB) to
#     prevent memory exhaustion on hostile responses.
#   · Custom User-Agent so target servers can identify the caller.
#
# Caching: per-URL in-process cache with 24 h TTL to avoid hammering
# a target during rapid FE edits. Cache key is the sanitised URL.


class IconFetchIn(BaseModel):
    url: str


def _sanitize_optional_icon_url(raw: Optional[str]) -> Optional[str]:
    """Store-side icon URL guard. Accepts None / empty (→ None) OR a
    proper http/https URL. Rejects anything else with HTTP 400."""
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    return _sanitize_url(s)


def _reject_private_host(host: str) -> None:
    """SSRF guard — refuse hostnames that resolve to loopback, private
    or link-local IPs. Public DNS names pass through; short-circuits
    when DNS resolution fails."""
    if not host:
        raise HTTPException(status_code=400, detail="URL must include a host")
    normalised = host.split(":", 1)[0].strip().lower()
    if normalised in ("localhost", "localhost.localdomain"):
        raise HTTPException(status_code=400,
                            detail="Refusing to fetch localhost")
    try:
        infos = socket.getaddrinfo(normalised, None)
    except socket.gaierror:
        # Public hostname that doesn't currently resolve — let httpx
        # surface the connection error rather than 400 here.
        return
    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved):
            raise HTTPException(
                status_code=400,
                detail=f"Refusing to fetch host resolving to {ip_str}",
            )


def _pick_largest_icon(candidates: list[tuple[int, str]]) -> Optional[str]:
    """Given a list of `(px_size_hint, href)` pairs, return the href
    with the largest hint. Ties broken by first-seen (list order)."""
    if not candidates:
        return None
    return max(candidates, key=lambda t: (t[0], -candidates.index(t)))[1]


_LINK_TAG_RE = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
_META_TAG_RE = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
_ATTR_RE = re.compile(r'([a-zA-Z:-]+)\s*=\s*"([^"]*)"')


def _parse_head_icons(html: str, base_url: str) -> list[tuple[str, str]]:
    """Extract candidate icons from an HTML head. Returns a list of
    `(source_label, absolute_url)` in the FE priority order:
    apple-touch-icon → icon → og:image. Each entry has already been
    resolved against `base_url`."""
    out: list[tuple[str, str]] = []
    apple: list[tuple[int, str]] = []
    generic: list[tuple[int, str]] = []
    for match in _LINK_TAG_RE.finditer(html):
        attrs = dict(_ATTR_RE.findall(match.group(0)))
        rel = (attrs.get("rel") or "").lower()
        href = attrs.get("href")
        if not href:
            continue
        sizes = attrs.get("sizes") or ""
        size_hint = 0
        m = re.match(r"(\d+)\s*[xX]\s*(\d+)", sizes)
        if m:
            size_hint = int(m.group(1))
        elif sizes == "any":
            size_hint = 999  # SVG wins on `sizes=any`
        absolute = urljoin(base_url, href)
        if "apple-touch-icon" in rel:
            apple.append((size_hint or 180, absolute))
        elif "icon" in rel and "mask-icon" not in rel:
            generic.append((size_hint, absolute))
    apple_pick = _pick_largest_icon(apple)
    if apple_pick:
        out.append(("apple-touch-icon", apple_pick))
    generic_pick = _pick_largest_icon(generic)
    if generic_pick:
        out.append(("icon", generic_pick))
    for match in _META_TAG_RE.finditer(html):
        attrs = dict(_ATTR_RE.findall(match.group(0)))
        prop = (attrs.get("property") or attrs.get("name") or "").lower()
        content = attrs.get("content")
        if prop == "og:image" and content:
            out.append(("og:image", urljoin(base_url, content)))
            break
    return out


async def _http_get_capped(client: httpx.AsyncClient, url: str) -> httpx.Response:
    """GET with the 10 MB streamed body cap. Raises 400 if the target
    exceeds the cap partway through."""
    async with client.stream("GET", url) as resp:
        chunks: list[bytes] = []
        total = 0
        async for chunk in resp.aiter_bytes():
            total += len(chunk)
            if total > _FETCH_MAX_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Response body exceeds {_FETCH_MAX_BYTES} bytes",
                )
            chunks.append(chunk)
        resp._content = b"".join(chunks)
        return resp


async def _fetch_icon(url: str) -> dict:
    """Resolve the best icon URL for `url`. Returns
    `{icon_url, source}` or `{icon_url: None}` on total failure."""
    parsed = urlparse(url)
    _reject_private_host(parsed.hostname or "")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    headers = {"User-Agent": _FETCH_USER_AGENT,
               "Accept": "text/html,*/*;q=0.5"}
    timeout = httpx.Timeout(_FETCH_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout,
                                    headers=headers) as client:
        # Step 1: fetch the target HTML, parse head.
        try:
            resp = await _http_get_capped(client, url)
            if resp.status_code < 400 and resp.text:
                candidates = _parse_head_icons(resp.text, str(resp.url))
                for source, icon_url in candidates:
                    return {"icon_url": icon_url, "source": source}
        except HTTPException:
            raise
        except (httpx.HTTPError, httpx.TimeoutException):
            log.info("fetch_icon: html fetch failed for %s", url)
        # Step 2: /favicon.ico fallback.
        favicon = urljoin(origin + "/", "/favicon.ico")
        try:
            fav_resp = await client.head(favicon)
            if fav_resp.status_code < 400:
                return {"icon_url": favicon, "source": "favicon"}
            # Some hosts 405 HEAD but 200 GET.
            fav_resp = await client.get(favicon)
            if fav_resp.status_code < 400:
                return {"icon_url": favicon, "source": "favicon"}
        except (httpx.HTTPError, httpx.TimeoutException):
            log.info("fetch_icon: favicon fallback failed for %s", url)
    return {"icon_url": None}


@router.post("/fetch-icon")
async def fetch_icon(body: IconFetchIn,
                      user: dict = Depends(get_current_user)):
    _admin(user)
    url = _sanitize_url(body.url)
    # Cache check.
    now = time.time()
    cached = _ICON_CACHE.get(url)
    if cached and now - cached[0] < _ICON_CACHE_TTL_SECONDS:
        return {**cached[1], "cached": True}
    try:
        result = await _fetch_icon(url)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — belt-and-braces
        log.warning("fetch_icon: unexpected error for %s: %s", url, exc)
        result = {"icon_url": None}
    _ICON_CACHE[url] = (now, result)
    log.info("fetch_icon: url=%s icon_url=%s source=%s",
             url, result.get("icon_url"), result.get("source"))
    return {**result, "cached": False}

