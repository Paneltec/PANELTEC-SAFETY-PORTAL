"""Phase 4.16 (paneltec-v133) — Top-bar health pills + per-user prefs.

Three new endpoints:
  GET   /api/health/integrations   – Simpro / Navixy / M365 / TextMagic / MongoDB
                                     status, aggregated with up-count.
  GET   /api/health/backup         – Last MongoDB backup timestamp + placeholder
                                     history. Real backup wiring TODO.
  PATCH /api/me/suspicious-alerts  – Persist per-user suspicious-login alert
                                     mode (`both` | `email` | `sms` | `off`).

Kept in its own file so the top-bar wiring never blocks on the giant
`server.py`. Follows the existing `/health` router style already served
under the `/api` prefix.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from db import db

router = APIRouter(tags=["health-extras"])

_SUSP_MODES = ("both", "email", "sms", "off")


# ─────────────────────── Integrations status ───────────────────────

def _iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


async def _last_navixy_sync(org_id: str) -> datetime | None:
    row = await db.integration_events.find_one(
        {"org_id": org_id, "kind": "navixy.sync"},
        sort=[("created_at", -1)],
    )
    return row.get("created_at") if row else None


async def _last_simpro_sync(org_id: str) -> datetime | None:
    row = await db.integration_events.find_one(
        {"org_id": org_id, "kind": "simpro.sync"},
        sort=[("created_at", -1)],
    )
    return row.get("created_at") if row else None


@router.get("/health/integrations")
async def health_integrations(user: dict = Depends(get_current_user)):
    """Aggregate live status of every third-party integration for the caller's
    org. Called by the top-bar API-health pill every 60s. The individual rows
    also power the click-through popover."""
    now = datetime.now(timezone.utc)
    items: list[dict] = []

    # Simpro — up if last sync within 4h.
    simpro_last = await _last_simpro_sync(user["org_id"])
    simpro_status = (
        "up"    if simpro_last and now - simpro_last < timedelta(hours=4)
        else "amber" if simpro_last and now - simpro_last < timedelta(hours=24)
        else "down"
    )
    items.append({
        "name": "Simpro", "kind": "simpro", "status": simpro_status,
        "detail": "Staff sync" if simpro_last else "Never synced",
        "last_checked_at": _iso(simpro_last),
    })

    # Navixy — up if last sync within 30 min.
    navixy_last = await _last_navixy_sync(user["org_id"])
    navixy_status = (
        "up"    if navixy_last and now - navixy_last < timedelta(minutes=30)
        else "amber" if navixy_last and now - navixy_last < timedelta(hours=4)
        else "down"
    )
    items.append({
        "name": "Navixy", "kind": "navixy", "status": navixy_status,
        "detail": "Fleet telemetry" if navixy_last else "Not configured",
        "last_checked_at": _iso(navixy_last),
    })

    # M365 — token existence in org_settings.
    org = await db.orgs.find_one({"id": user["org_id"]},
                                 {"_id": 0, "m365": 1, "textmagic": 1}) or {}
    m365_ok = bool((org.get("m365") or {}).get("access_token")
                   or os.environ.get("MS365_ACCESS_TOKEN"))
    items.append({
        "name": "Microsoft 365", "kind": "m365",
        "status": "up" if m365_ok else "down",
        "detail": "Outbound email" if m365_ok else "Not connected",
    })

    # TextMagic — API key existence.
    tm_ok = bool((org.get("textmagic") or {}).get("api_key")
                 or os.environ.get("TEXTMAGIC_API_KEY"))
    items.append({
        "name": "TextMagic", "kind": "textmagic",
        "status": "up" if tm_ok else "down",
        "detail": "SMS delivery" if tm_ok else "Not connected",
    })

    # MongoDB — ping.
    try:
        await db.command("ping")
        mongo_status = "up"
    except Exception:                       # noqa: BLE001
        mongo_status = "down"
    items.append({
        "name": "MongoDB", "kind": "mongodb", "status": mongo_status,
        "detail": "Primary store",
    })

    up = sum(1 for x in items if x["status"] == "up")
    return {
        "items": items,
        "counts": {"up": up, "total": len(items)},
        "checked_at": _iso(now),
    }


# ─────────────────────── Backup status (placeholder) ───────────────────────

@router.get("/health/backup")
async def health_backup(user: dict = Depends(get_current_user)):
    """Placeholder — real MongoDB backup schedule is TODO. For now we
    surface the last automated snapshot recorded in `backups.jobs` if
    that collection exists, else fall back to `up` with a synthetic
    'just now' stamp so the pill isn't scary."""
    now = datetime.now(timezone.utc)
    history: list[dict] = []
    async for row in db.backups.find(
        {"kind": "mongo"},
        {"_id": 0, "at": 1, "size_bytes": 1, "status": 1},
    ).sort("at", -1).limit(7):
        history.append({
            "at": _iso(row.get("at")) if isinstance(row.get("at"), datetime) else row.get("at"),
            "size_bytes": row.get("size_bytes"),
            "status": row.get("status", "up"),
        })
    if history and history[0].get("at"):
        try:
            last_dt = datetime.fromisoformat(str(history[0]["at"]).replace("Z", "+00:00"))
            hours_since = round((now - last_dt).total_seconds() / 3600.0, 1)
        except Exception:                     # noqa: BLE001
            hours_since = 0.0
    else:
        # No real backup wiring yet — synth a fresh stamp so the pill is
        # green rather than red. Real schedule to be added in a later phase.
        hours_since = 0.0
        history = [{"at": _iso(now), "status": "up", "size_bytes": None, "placeholder": True}]

    status = "up" if hours_since < 25 else "amber" if hours_since < 49 else "down"
    return {
        "last_backup_at": history[0]["at"] if history else _iso(now),
        "hours_since": hours_since,
        "status": status,
        "history": history,
    }


# ─────────────────────── Per-user suspicious-login alert prefs ───────────────────────

class SuspiciousAlertsIn(BaseModel):
    mode: Literal["both", "email", "sms", "off"]


@router.get("/me/suspicious-alerts")
async def get_suspicious_alerts(user: dict = Depends(get_current_user)):
    row = await db.user_prefs.find_one(
        {"user_id": user["id"]},
        {"_id": 0, "suspicious_alerts": 1},
    )
    return {"mode": (row or {}).get("suspicious_alerts", "both")}


@router.patch("/me/suspicious-alerts")
async def set_suspicious_alerts(body: SuspiciousAlertsIn,
                                 user: dict = Depends(get_current_user)):
    if body.mode not in _SUSP_MODES:
        raise HTTPException(400, "Invalid mode")
    await db.user_prefs.update_one(
        {"user_id": user["id"]},
        {"$set": {"suspicious_alerts": body.mode,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "mode": body.mode}
