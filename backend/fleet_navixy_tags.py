"""v58.13.132dj — Live Navixy tag lookup for the Fleet Service Register.

Endpoint:
  GET /api/fleet/navixy/tags → {
      "items":     [{"vehicle_id": <asset.id>, "tag_label": <str>}],
      "connected": <bool>,
      "error":     <str | None>,
      "distinct_tags": [<str>, ...],
  }

Design notes
------------
* No local cache table. This is a read-only mirror fetched on demand;
  every register page load hits Navixy through this module (60s in-
  process TTL to keep repeated FE refreshes cheap, mirroring
  `asset_navixy_dashboards`).
* Graceful degradation: any failure (Navixy not connected, 5xx,
  network error, timeout) returns HTTP 200 with an empty `items`
  list and an `error` string. Admins see a small warning banner;
  the register itself keeps rendering.
* Read-only. NEVER writes back to Navixy or mutates
  `db.assets`.
* Assumes exactly one tag per vehicle. If Navixy returns multiple
  tag bindings on the same tracker, we take the first and log a
  warning with the vehicle id + full tag list.
* Linkage: `assets.navixy_device_id` → `tracker.id` on the Navixy
  side. Any asset without `navixy_device_id`, or whose tracker has
  no tag bindings, is omitted from `items`.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from db import db

log = logging.getLogger("paneltec.navixy.tags")
router = APIRouter(prefix="/fleet/navixy", tags=["fleet-navixy-tags"])

# (org_id) → {payload, ts}. 60s TTL is plenty for a FE that refreshes
# on every register page load; matches `asset_navixy_dashboards`.
_CACHE: dict[str, dict] = {}
_CACHE_TTL = 60


def _cache_get(org_id: str) -> Optional[dict]:
    row = _CACHE.get(org_id)
    if row and (time.time() - row["ts"]) < _CACHE_TTL:
        return row["payload"]
    return None


def _cache_set(org_id: str, payload: dict) -> None:
    _CACHE[org_id] = {"payload": payload, "ts": time.time()}


async def _navixy_cfg(org_id: str) -> Optional[dict]:
    """Match `asset_navixy_dashboards._navixy_cfg` but return None
    instead of raising when Navixy isn't connected — this endpoint
    degrades gracefully."""
    doc = await db.integration_configs.find_one(
        {"org_id": org_id, "kind": "navixy"},
    )
    if not doc or doc.get("status") != "connected":
        return None
    from integrations import hydrate_integration_config
    return hydrate_integration_config(doc)


def _graceful_empty(msg: Optional[str], connected: bool) -> dict:
    """Standard "no tags for you" response shape."""
    return {
        "items": [],
        "connected": connected,
        "error": msg,
        "distinct_tags": [],
    }


@router.get("/tags")
async def get_navixy_tags(user: dict = Depends(get_current_user)):
    org_id = user["org_id"]

    cached = _cache_get(org_id)
    if cached is not None:
        return cached

    cfg = await _navixy_cfg(org_id)
    if not cfg:
        payload = _graceful_empty("Navixy not connected", connected=False)
        _cache_set(org_id, payload)
        return payload

    base = (cfg.get("api_base_url") or "").rstrip("/")
    h = cfg.get("session_hash")
    if not base or not h:
        payload = _graceful_empty("Navixy config incomplete", connected=False)
        _cache_set(org_id, payload)
        return payload

    # ── Live fetch: tags + trackers in parallel ─────────────────────
    tag_by_id: dict[int, str] = {}
    trackers: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            tag_resp = await c.post(f"{base}/v2/tag/list", json={"hash": h})
            trk_resp = await c.post(f"{base}/v2/tracker/list", json={"hash": h})
            tag_data = tag_resp.json() or {}
            trk_data = trk_resp.json() or {}
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("navixy tag fetch failed for org=%s: %s", org_id, exc)
        payload = _graceful_empty(f"Navixy fetch failed: {exc}", connected=True)
        _cache_set(org_id, payload)
        return payload

    # v58.13.132dj — Navixy `/v2/tag/list` returns either a top-level
    # `list` array or a nested `tags` field on some plans. Accept both.
    tag_rows = (
        tag_data.get("list")
        or tag_data.get("tags")
        or (tag_data if isinstance(tag_data, list) else [])
    )
    for row in tag_rows or []:
        if not isinstance(row, dict):
            continue
        rid = row.get("id")
        rname = row.get("name") or row.get("label")
        if rid is not None and rname:
            try:
                tag_by_id[int(rid)] = str(rname)
            except (TypeError, ValueError):
                continue

    trackers = [t for t in (trk_data.get("list") or []) if isinstance(t, dict)]

    # ── Cross-reference with our assets ────────────────────────────
    assets = [
        a async for a in db.assets.find(
            {"org_id": org_id, "navixy_device_id": {"$ne": None}},
            {"_id": 0, "id": 1, "navixy_device_id": 1},
        )
    ]
    asset_by_tracker: dict[str, str] = {}
    for a in assets:
        tid = a.get("navixy_device_id")
        if tid is not None:
            asset_by_tracker[str(tid)] = a["id"]

    items: list[dict] = []
    seen_labels: set[str] = set()
    for tr in trackers:
        tid = tr.get("id")
        if tid is None:
            continue
        vehicle_id = asset_by_tracker.get(str(tid))
        if not vehicle_id:
            continue
        bindings = (
            tr.get("tag_bindings")
            or tr.get("tags")
            or tr.get("tag_ids")
            or []
        )
        # Bindings can be [{tag_id, ...}, ...] OR [tag_id, ...].
        tag_ids: list[int] = []
        for b in bindings:
            if isinstance(b, dict):
                tid_ = b.get("tag_id") or b.get("id")
            else:
                tid_ = b
            try:
                if tid_ is not None:
                    tag_ids.append(int(tid_))
            except (TypeError, ValueError):
                continue
        if not tag_ids:
            continue
        if len(tag_ids) > 1:
            log.warning(
                "navixy tracker=%s vehicle=%s has multiple tags %s;"
                " taking first per .132dj spec",
                tid, vehicle_id, tag_ids,
            )
        label = tag_by_id.get(tag_ids[0])
        if not label:
            # Tag was deleted from Navixy but the binding lingered.
            continue
        items.append({"vehicle_id": vehicle_id, "tag_label": label})
        seen_labels.add(label)

    payload = {
        "items": items,
        "connected": True,
        "error": None,
        "distinct_tags": sorted(seen_labels, key=lambda s: s.lower()),
    }
    _cache_set(org_id, payload)
    return payload
