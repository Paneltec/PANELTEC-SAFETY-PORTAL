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
from typing import Optional
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


class TilePatch(BaseModel):
    url: Optional[str] = None
    label: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    order: Optional[int] = Field(default=None, ge=0, le=9999)
    remote_icon_url: Optional[str] = None  # v58.13.132ep
    enabled: Optional[bool] = None  # v58.13.132er
    color: Optional[str] = None  # v58.13.132er


class ReorderRow(BaseModel):
    tile_id: str
    order: int = Field(ge=0, le=9999)


class ReorderIn(BaseModel):
    tiles: list[ReorderRow]


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


def _out(doc: dict) -> dict:
    """Strip Mongo `_id` + expose the stable API shape."""
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
    return {
        "id": doc.get("id"),
        "org_id": doc.get("org_id"),
        "url": doc.get("url"),
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
        "created_at": doc.get("created_at"),
        "created_by": doc.get("created_by"),
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
    }


@router.get("")
async def list_tiles(include_disabled: bool = False,
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
    org_id = user["org_id"]
    if include_disabled and (user.get("role") or user.get("role_id")) != "admin":
        include_disabled = False
    query: dict = {"org_id": org_id}
    if not include_disabled:
        # Rows written before .132er lack the `enabled` field; treat
        # them as enabled by default (i.e. include them in the list).
        query["$or"] = [{"enabled": {"$ne": False}}, {"enabled": {"$exists": False}}]
    tiles = []
    cur = db.org_url_tiles.find(query).sort([("order", 1),
                                                          ("created_at", 1)])
    async for t in cur:
        tiles.append(_out(t))
    return {"tiles": tiles}


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
        "created_at": now, "created_by": user["id"],
        "updated_at": now, "updated_by": user["id"],
    }
    await db.org_url_tiles.insert_one(doc)
    log.info("org_url_tiles.create org=%s tile=%s label=%r",
             org_id, doc["id"], label)
    return _out(doc)


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
    if not updates:
        return _out(existing)
    updates["updated_at"] = now_iso()
    updates["updated_by"] = user["id"]
    await db.org_url_tiles.update_one({"id": tile_id, "org_id": org_id},
                                       {"$set": updates})
    doc = await db.org_url_tiles.find_one({"id": tile_id, "org_id": org_id})
    log.info("org_url_tiles.update org=%s tile=%s fields=%s",
             org_id, tile_id, sorted(updates.keys()))
    return _out(doc)


@router.delete("/{tile_id}")
async def delete_tile(tile_id: str, user: dict = Depends(get_current_user)):
    _admin(user)
    org_id = user["org_id"]
    res = await db.org_url_tiles.delete_one({"id": tile_id, "org_id": org_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Tile not found")
    log.info("org_url_tiles.delete org=%s tile=%s", org_id, tile_id)
    return {"ok": True, "deleted": tile_id}


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

