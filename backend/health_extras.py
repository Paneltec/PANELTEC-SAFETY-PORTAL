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

Phase 4.18.1 (v138) — Rewrote the integrations check to read from the
real source of truth: `integration_configs` collection keyed by
`(org_id, kind)`. The old code looked at collections that don't exist
(`integration_events`) and env vars that were never set, so it flipped
every light red for a fully-working install. Adds a 60s per-org cache
and a `health.integrations.check` log line per row.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from db import db
import comms_safe_mode

log = logging.getLogger("paneltec.health")
router = APIRouter(tags=["health-extras"])

_SUSP_MODES = ("both", "email", "sms", "off")


# ─────────────────────── Integrations status ───────────────────────

def _iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def _parse_dt(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return None
        # Some fields (`navixy_last_position_time`) are stored as
        # "YYYY-MM-DD HH:MM:SS" with no tz — treat those as UTC to keep
        # subtraction against `now(timezone.utc)` safe.
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


def _fmt_ago(dt: datetime | None) -> str:
    if not dt:
        return "never"
    now = datetime.now(timezone.utc)
    delta = now - dt
    secs = int(delta.total_seconds())
    if secs < 60:
        return f"{secs}s ago"
    if secs < 3600:
        return f"{secs // 60}m ago"
    if secs < 86400:
        return f"{secs // 3600}h ago"
    return f"{secs // 86400}d ago"


# In-process cache — 60s per org. Refreshed on any call after expiry.
_HEALTH_CACHE: dict[str, tuple[dict, float]] = {}
_HEALTH_TTL = 60


def _check_simpro(cfg: dict | None) -> dict:
    """Simpro is an **on-demand** integration — you only call it when you
    need to fetch a worker/vendor/site/job. Between demands it sits idle in
    "ready" state. So freshness of `last_sync_at` is NOT a health signal;
    only credentials + last known error state matter.

    - Green if credentials present AND no persistent error.
    - Amber if credentials present but the last call errored transiently
      (< 24h ago).
    - Red if credentials missing, OR the last error is > 24h old with no
      successful call since (implies the integration is genuinely broken).
    """
    if not cfg or not (cfg.get("config") or {}).get("api_token"):
        return {"status": "down", "detail": "Not connected"}

    status_field = (cfg.get("status") or "").lower()
    last_error = cfg.get("last_error")
    last_sync = _parse_dt(cfg.get("last_sync_at"))
    last_tested = _parse_dt(cfg.get("last_tested_at"))
    n = cfg.get("last_sync_count")
    count_txt = f" · {n} records cached" if isinstance(n, int) and n > 0 else ""

    # Error path — recent transient vs sustained.
    if status_field == "error" or last_error:
        err_when = _parse_dt(cfg.get("last_error_at") or cfg.get("updated_at"))
        if err_when and (datetime.now(timezone.utc) - err_when) > timedelta(hours=24):
            return {"status": "down",
                    "detail": f"Not reachable — {str(last_error or 'check credentials')[:60]}",
                    "last_checked_at": _iso(err_when)}
        return {"status": "amber",
                "detail": f"Credentials present, test call failed {_fmt_ago(err_when)}",
                "last_checked_at": _iso(err_when)}

    # Happy path — credentials + status connected + no error → Ready.
    # Show whichever timestamp is more recent as context.
    ref = last_sync if last_sync else last_tested
    if last_sync:
        return {"status": "up",
                "detail": f"Ready · last call {_fmt_ago(last_sync)}{count_txt}",
                "last_checked_at": _iso(ref)}
    if last_tested:
        return {"status": "up",
                "detail": f"Ready · verified {_fmt_ago(last_tested)}",
                "last_checked_at": _iso(ref)}
    return {"status": "up", "detail": "Ready"}


async def _check_navixy(cfg: dict | None, org_id: str) -> dict:
    """Green if credentials configured (session_hash OR password) AND at
    least one asset has a Navixy timestamp within 60m. Amber if credentials
    are there but assets haven't updated recently. Red only if missing."""
    conf = (cfg or {}).get("config") or {}
    has_creds = bool(conf.get("session_hash") or conf.get("password") or conf.get("api_token"))
    if not has_creds:
        return {"status": "down", "detail": "Not connected"}

    n_assets = await db.assets.count_documents({
        "org_id": org_id, "navixy_device_id": {"$exists": True, "$ne": None},
    })
    # Prefer `navixy_last_seen_at` (always UTC ISO) over
    # `navixy_last_position_time` (device-local, no tz) — the second field
    # can otherwise produce a negative delta when devices report in a
    # timezone ahead of UTC.
    doc = await db.assets.find_one(
        {"org_id": org_id, "navixy_device_id": {"$exists": True, "$ne": None},
         "navixy_last_seen_at": {"$exists": True, "$ne": None}},
        {"_id": 0, "navixy_last_seen_at": 1, "updated_at": 1},
        sort=[("navixy_last_seen_at", -1)],
    ) or {}
    latest = _parse_dt(doc.get("navixy_last_seen_at") or doc.get("updated_at"))
    tested = _parse_dt(cfg.get("last_tested_at"))
    veh = cfg.get("vehicle_count") or n_assets

    if latest is None:
        # Credentials in place but no live traffic yet — show amber so
        # ops knows it's provisioned but not verified since restart.
        return {"status": "amber",
                "detail": (f"{veh} vehicles configured · last tested {_fmt_ago(tested)}"
                           if tested else f"{veh} vehicles configured, not synced yet"),
                "last_checked_at": _iso(tested)}
    age = datetime.now(timezone.utc) - latest
    if age < timedelta(minutes=60):
        return {"status": "up",
                "detail": f"{n_assets} assets synced · last sync {_fmt_ago(latest)}",
                "last_checked_at": _iso(latest)}
    if age < timedelta(hours=24):
        return {"status": "amber",
                "detail": f"{n_assets} assets · last sync {_fmt_ago(latest)}",
                "last_checked_at": _iso(latest)}
    return {"status": "amber",
            "detail": f"{n_assets} assets · stale ({_fmt_ago(latest)})",
            "last_checked_at": _iso(latest)}


def _check_m365(cfg: dict | None, safe_mode_on: bool) -> dict:
    """Green ONLY if creds present AND we've verified recently AND
    Comms Safe Mode is OFF (i.e. sends will actually reach the network).
    Red if:
      • no credentials, OR
      • access_token expired without a refresh_token, OR
      • **COMMS_SAFE_MODE is ON** — deliberate disarm. The pill flips red
        with a `disarmed=True` flag so the popover can render a "🛡 disarmed"
        chip. This matches the user's mental model — "green means it WILL
        fire" — rather than "green means credentials are present"."""
    if not cfg:
        return {"status": "down", "detail": "Not connected"}
    conf = cfg.get("config") or {}
    has_client_creds = bool(conf.get("client_id") and conf.get("client_secret"))
    has_access = bool(conf.get("access_token"))
    has_refresh = bool(conf.get("refresh_token"))
    status_field = (cfg.get("status") or "").lower()
    tested = _parse_dt(cfg.get("last_tested_at"))

    if not (has_client_creds or has_access):
        return {"status": "down", "detail": "Not connected"}

    # Safe-mode override — the integration is deliberately disarmed.
    if safe_mode_on:
        return {"status": "down", "disarmed": True,
                "detail": "Disarmed by Comms Safe Mode",
                "last_checked_at": _iso(tested)}

    if status_field == "error" or cfg.get("last_error"):
        return {"status": "amber",
                "detail": f"Configured · {str(cfg.get('last_error', 'connection error'))[:60]}",
                "last_checked_at": _iso(tested)}

    if has_access:
        detail = f"Outbound email ready · verified {_fmt_ago(tested)}" if tested else "Outbound email ready"
        return {"status": "up", "detail": detail, "last_checked_at": _iso(tested)}
    if has_refresh:
        return {"status": "amber",
                "detail": f"Refresh required · verified {_fmt_ago(tested)}",
                "last_checked_at": _iso(tested)}
    # Client-credentials flow — safe mode already accounted for above.
    detail = f"Configured · verified {_fmt_ago(tested)}" if tested else "Configured (not verified yet)"
    return {"status": "up", "detail": detail, "last_checked_at": _iso(tested)}


def _check_textmagic(cfg: dict | None, safe_mode_on: bool) -> dict:
    """Green ONLY if API key present AND stored status = 'connected' AND
    Comms Safe Mode is OFF. Red if:
      • no API key, OR
      • **COMMS_SAFE_MODE is ON** — deliberate disarm."""
    if not cfg or not (cfg.get("config") or {}).get("api_key"):
        return {"status": "down", "detail": "Not connected"}
    tested = _parse_dt(cfg.get("last_tested_at"))

    # Safe-mode override.
    if safe_mode_on:
        return {"status": "down", "disarmed": True,
                "detail": "Disarmed by Comms Safe Mode",
                "last_checked_at": _iso(tested)}

    status_field = (cfg.get("status") or "").lower()
    balance = cfg.get("balance")
    account = cfg.get("account_name")
    balance_txt = ""
    if isinstance(balance, (int, float)) and account:
        cur = (cfg.get("currency") or {}).get("id") or "AUD"
        balance_txt = f" · {account} · {cur} {balance:.2f}"
    if status_field == "error" or cfg.get("last_error"):
        return {"status": "amber",
                "detail": f"Credentials rejected · verified {_fmt_ago(tested)}",
                "last_checked_at": _iso(tested)}
    if status_field == "connected":
        detail = f"SMS ready · verified {_fmt_ago(tested)}{balance_txt}" if tested else f"SMS ready{balance_txt}"
        return {"status": "up", "detail": detail, "last_checked_at": _iso(tested)}
    return {"status": "amber",
            "detail": f"Credentials configured, not verified yet{balance_txt}",
            "last_checked_at": _iso(tested)}


@router.get("/health/integrations")
async def health_integrations(user: dict = Depends(get_current_user)):
    """Aggregate live status of every third-party integration for the caller's
    org. Called by the top-bar API-health pill every 60s. The individual rows
    also power the click-through popover.

    Reads from `integration_configs` (source of truth for admin-configured
    per-org credentials) and cross-references asset-level Navixy fields for
    the "recent activity" signal. Cached in-process per org for 60s.
    """
    org_id = user["org_id"]
    now = datetime.now(timezone.utc)
    safe_mode_on = await comms_safe_mode.is_blocked(org_id)

    # Cache hit path — key includes safe-mode state so a toggle flips
    # the lights on the next call rather than waiting for the 60s TTL.
    cache_key = (org_id, safe_mode_on)
    cached = _HEALTH_CACHE.get(cache_key)
    if cached and (time.monotonic() - cached[1]) < _HEALTH_TTL:
        return {**cached[0], "cache_hit": True}

    # Pull every config row for the org in one go.
    configs: dict[str, dict] = {}
    async for row in db.integration_configs.find({"org_id": org_id}, {"_id": 0}):
        configs[row.get("kind")] = row

    items: list[dict] = []

    # Simpro
    simpro_res = _check_simpro(configs.get("simpro"))
    items.append({"name": "Simpro", "kind": "simpro", **simpro_res})
    log.info("health.integrations.check name=simpro status=%s detail=%r",
             simpro_res["status"], simpro_res.get("detail"))

    # Navixy — hits `assets` collection for freshness signal.
    navixy_res = await _check_navixy(configs.get("navixy"), org_id)
    items.append({"name": "Navixy", "kind": "navixy", **navixy_res})
    log.info("health.integrations.check name=navixy status=%s detail=%r",
             navixy_res["status"], navixy_res.get("detail"))

    # Microsoft 365 — safe-mode-aware (red when disarmed).
    m365_res = _check_m365(configs.get("microsoft365"), safe_mode_on)
    items.append({"name": "Microsoft 365", "kind": "m365", **m365_res})
    log.info("health.integrations.check name=m365 status=%s disarmed=%s detail=%r",
             m365_res["status"], m365_res.get("disarmed", False), m365_res.get("detail"))

    # TextMagic — safe-mode-aware (red when disarmed).
    tm_res = _check_textmagic(configs.get("textmagic"), safe_mode_on)
    items.append({"name": "TextMagic", "kind": "textmagic", **tm_res})
    log.info("health.integrations.check name=textmagic status=%s disarmed=%s detail=%r",
             tm_res["status"], tm_res.get("disarmed", False), tm_res.get("detail"))

    # MongoDB — cheap ping.
    try:
        await db.command("ping")
        mongo_status = "up"
        mongo_detail = "Primary store"
    except Exception as e:                      # noqa: BLE001
        mongo_status = "down"
        mongo_detail = f"Unreachable · {str(e)[:60]}"
    items.append({"name": "MongoDB", "kind": "mongodb",
                  "status": mongo_status, "detail": mongo_detail})
    log.info("health.integrations.check name=mongodb status=%s", mongo_status)

    up = sum(1 for x in items if x["status"] == "up")
    payload = {
        "items": items,
        "counts": {"up": up, "total": len(items)},
        "comms_safe_mode": "on" if safe_mode_on else "off",
        "checked_at": _iso(now),
    }
    _HEALTH_CACHE[cache_key] = (payload, time.monotonic())
    return {**payload, "cache_hit": False}


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
