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


async def _collect_local_tags(org_id: str) -> tuple[list[dict], list[dict]]:
    """v58.13.132ir — Read every asset with a locally-cached `tag_label`
    (Navixy-linked or not) and return `(items, distinct_tags)` in the
    same shape as the live path. Used as fallback when Navixy is
    unreachable so admins keep tag-filter capability against the last
    known sync. Excludes retired + soft-deleted rows to stay consistent
    with the default register view."""
    items: list[dict] = []
    label_counts: dict[str, int] = {}
    async for a in db.assets.find(
        {
            "org_id": org_id,
            "deleted_at": None,
            "status": {"$ne": "retired"},
            "tag_label": {"$nin": [None, ""]},
        },
        {"_id": 0, "id": 1, "tag_label": 1, "navixy_device_id": 1},
    ):
        label = (a.get("tag_label") or "").strip()
        if not label:
            continue
        items.append({
            "vehicle_id": a["id"],
            "tag_label": label,
            "source": "navixy" if a.get("navixy_device_id") else "local",
        })
        label_counts[label] = label_counts.get(label, 0) + 1
    distinct = [
        {"label": lbl, "count": cnt}
        for lbl, cnt in sorted(label_counts.items(), key=lambda kv: kv[0].lower())
    ]
    return items, distinct


def _graceful_empty(msg: Optional[str], connected: bool,
                    items: Optional[list[dict]] = None,
                    distinct_tags: Optional[list[dict]] = None) -> dict:
    """Standard "no tags for you" response shape.
    v58.13.132ir — Accepts optional locally-derived items + distinct_tags
    so a Navixy outage still surfaces cached tags rather than an empty
    picker. When local items are present the caller SHOULD null the
    `error` field so the FE doesn't render an amber warning."""
    return {
        "items": items or [],
        "connected": connected,
        "error": msg,
        "distinct_tags": distinct_tags or [],
        # v58.13.132ir — FE renders a "Reconnect Navixy" CTA when this
        # is populated. Admins-only surface, gated client-side.
        "reconnect_hint": (
            "/app/settings/integrations/navixy"
            if msg else None
        ),
        "tag_list_source": "local_fallback" if (items or distinct_tags) else None,
    }


@router.get("/tags")
async def get_navixy_tags(user: dict = Depends(get_current_user)):
    org_id = user["org_id"]

    cached = _cache_get(org_id)
    if cached is not None:
        return cached

    cfg = await _navixy_cfg(org_id)
    if not cfg:
        # v58.13.132ir — Fall back to locally-cached tags on every asset
        # so admins keep tag-filter capability during a Navixy outage /
        # session-hash expiry. Message downgrades to null when we have
        # local tags to show, so the FE amber banner stays quiet.
        local_items, local_distinct = await _collect_local_tags(org_id)
        payload = _graceful_empty(
            None if local_items else "Navixy not connected",
            connected=False,
            items=local_items,
            distinct_tags=local_distinct,
        )
        _cache_set(org_id, payload)
        return payload

    base = (cfg.get("api_base_url") or "").rstrip("/")
    h = cfg.get("session_hash")
    if not base or not h:
        local_items, local_distinct = await _collect_local_tags(org_id)
        payload = _graceful_empty(
            None if local_items else "Navixy config incomplete",
            connected=False,
            items=local_items,
            distinct_tags=local_distinct,
        )
        _cache_set(org_id, payload)
        return payload

    # ── Live fetch: tags + trackers, split so a `/tag/list` failure
    # doesn't take down the whole endpoint. `.132dm` — the previous
    # single-await pattern meant a `/tag/list` 5xx wiped out
    # `/tracker/list` results too; we now degrade to
    # linked-only tag discovery when `/tag/list` fails but
    # `/tracker/list` succeeds.
    tag_by_id: dict[int, str] = {}
    tag_list_ok = False
    tag_data: dict = {}
    trk_data: dict = {}
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            try:
                tag_resp = await c.post(f"{base}/v2/tag/list", json={"hash": h})
                tag_data = tag_resp.json() or {}
                tag_list_ok = True
            except (httpx.HTTPError, ValueError) as exc:
                log.warning(
                    "navixy /tag/list failed for org=%s: %s — falling back "
                    "to linked-vehicle-derived tags only",
                    org_id, exc,
                )
                tag_data = {}
            trk_resp = await c.post(f"{base}/v2/tracker/list", json={"hash": h})
            trk_data = trk_resp.json() or {}
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("navixy tag fetch failed for org=%s: %s", org_id, exc)
        # v58.13.132ir — Same fallback as the pre-flight cfg check:
        # surface local `tag_label` cache when live fetch dies.
        local_items, local_distinct = await _collect_local_tags(org_id)
        payload = _graceful_empty(
            None if local_items else f"Navixy fetch failed: {exc}",
            connected=True,
            items=local_items,
            distinct_tags=local_distinct,
        )
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
    # v58.13.132dn — Exclude soft-deleted AND retired assets so the
    # sidebar counts match the DEFAULT `/fleet/register` view (which
    # filters `status: {$ne: "retired"}, deleted_at: None`). Prior
    # to this fix, a retired vehicle carrying a Navixy tag would
    # bump the sidebar count without ever appearing in the register.
    assets = [
        a async for a in db.assets.find(
            {"org_id": org_id, "navixy_device_id": {"$ne": None},
             "deleted_at": None, "status": {"$ne": "retired"}},
            {"_id": 0, "id": 1, "navixy_device_id": 1},
        )
    ]
    asset_by_tracker: dict[str, str] = {}
    for a in assets:
        tid = a.get("navixy_device_id")
        if tid is not None:
            asset_by_tracker[str(tid)] = a["id"]

    items: list[dict] = []
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
        items.append({
            "vehicle_id": vehicle_id,
            "tag_label": label,
            "source": "navixy",
        })

    # v58.13.132dn — Merge in LOCAL tags stored on `assets.tag_label`
    # for non-Navixy assets (Plant, Tool, Container, Vehicle without a
    # tracker). Navixy is authoritative for linked vehicles; local
    # tags apply only where `navixy_device_id` is null.
    local_labels_seen: set[str] = set()
    async for a in db.assets.find(
        {
            "org_id": org_id,
            "deleted_at": None,
            "status": {"$ne": "retired"},
            "navixy_device_id": None,
            "tag_label": {"$nin": [None, ""]},
        },
        {"_id": 0, "id": 1, "tag_label": 1},
    ):
        label = (a.get("tag_label") or "").strip()
        if not label:
            continue
        items.append({
            "vehicle_id": a["id"],
            "tag_label": label,
            "source": "local",
        })
        local_labels_seen.add(label)

    # v58.13.132dm/.132dn — `distinct_tags` shape is `[{label, count}]`.
    # Union of (a) every tag defined in Navixy (from `/v2/tag/list`),
    # (b) every tag observed on a linked (Navixy) vehicle, and
    # (c) every tag stored locally on `assets.tag_label`. `count` is
    # the total number of vehicles (navixy + local) carrying that
    # label. Tags defined in Navixy but not attached to anything —
    # neither a linked tracker nor a locally-tagged asset — surface
    # with `count: 0` so admins can see the full universe.
    label_counts: dict[str, int] = {}
    for it in items:
        label_counts[it["tag_label"]] = label_counts.get(it["tag_label"], 0) + 1
    all_labels: set[str] = set(label_counts.keys()) | local_labels_seen
    if tag_list_ok:
        all_labels |= set(tag_by_id.values())
    distinct_tags = [
        {"label": lbl, "count": label_counts.get(lbl, 0)}
        for lbl in sorted(all_labels, key=lambda s: s.lower())
    ]

    payload = {
        "items": items,
        "connected": True,
        "error": None,
        "distinct_tags": distinct_tags,
        "tag_list_source": "navixy_and_linked" if tag_list_ok else "linked_only",
    }
    _cache_set(org_id, payload)
    return payload
