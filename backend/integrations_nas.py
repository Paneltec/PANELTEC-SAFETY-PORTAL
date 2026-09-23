"""v58.13.132lf — NAS integration health endpoint + admin surface.

    GET  /api/nas/health           (admin)  — connect + capacity + probe
    POST /api/nas/probe            (admin)  — force a ping round-trip

Health endpoint aggregates:
  · Agent's last poll time (from bk_agents.last_seen_at) → agent_connected.
  · Agent-reported disk_usage → nas_free_gb / nas_used_gb.
  · One-shot ping op through the tunnel → last_bidirectional_probe_ms.
  · Presence of `NAS_AGENT_SHARED_SECRET` → hmac_secret_present.

Never logs or echoes the shared secret. Admin-gated via the same
`.132kt` gate as the Dropbox surface.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from db import db

log = logging.getLogger("paneltec.nas.health")
router = APIRouter(prefix="/nas", tags=["nas"])


# ── admin gate (.132kt parity) ─────────────────────────────────
_ADMIN_LEGACY_ROLES = {"admin", "hseq_lead", "supervisor", "manager"}
_ADMIN_ROLE_IDS = {
    "admin", "hseq_manager", "hseq_manager_2", "hseq_manager_readonly",
    "hseq_manager_creator", "responsible_manager", "report_emailing_admin",
}


def _is_admin(user: dict) -> bool:
    if not user:
        return False
    rid = (user.get("role_id") or "").strip()
    if rid in _ADMIN_ROLE_IDS:
        return True
    legacy = (user.get("role") or "").strip().lower()
    return legacy in _ADMIN_LEGACY_ROLES


def _require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


# ── helpers ────────────────────────────────────────────────────
def _seconds_ago(iso: str) -> float:
    if not iso:
        return float("inf")
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).total_seconds()
    except Exception:
        return float("inf")


async def _load_agent() -> Dict[str, Any]:
    doc = await db.bk_agents.find_one(
        {}, {"_id": 0}, sort=[("last_seen_at", -1)],
    )
    return doc or {}


# ── /health ────────────────────────────────────────────────────
@router.get("/health")
async def nas_health(user: dict = Depends(_require_admin)) -> Dict[str, Any]:
    agent = await _load_agent()
    last_seen = agent.get("last_seen_at")
    stale_s = _seconds_ago(last_seen)
    # Agent is "connected" if it polled within 3× its configured
    # poll interval (default 60 → 180s tolerance). We don't know the
    # agent's actual poll interval from the DB, so use 180s.
    connected = stale_s < 180
    du = agent.get("disk_usage") or {}
    payload: Dict[str, Any] = {
        "agent_registered": bool(agent),
        "agent_connected": connected,
        "agent_id": agent.get("id"),
        "agent_name": agent.get("name"),
        "agent_version": agent.get("version") or agent.get("agent_version"),
        "agent_last_seen_at": last_seen,
        "agent_stale_seconds": None if stale_s == float("inf") else round(stale_s, 1),
        "nas_free_gb": du.get("free_gb"),
        "nas_used_gb": du.get("used_gb"),
        "nas_total_gb": du.get("total_gb"),
        "nas_disk_usage_at": agent.get("disk_usage_at"),
        "hmac_secret_present": bool(os.environ.get("NAS_AGENT_SHARED_SECRET", "").strip()),
        "last_bidirectional_probe_ms": None,
        "last_bidirectional_probe_status": "not-run",
        "diagnostic": None,
    }
    if not agent:
        payload["diagnostic"] = (
            "No agent registered. Install the LAN agent via "
            "Settings → Backups → Register agent."
        )
        return payload
    if not connected:
        payload["diagnostic"] = (
            f"Agent last polled {round(stale_s, 0)}s ago (>180s stale). "
            f"Check the docker-compose logs on the UGREEN NAS."
        )
    if not payload["hmac_secret_present"]:
        payload["diagnostic"] = (
            (payload["diagnostic"] + " ") if payload["diagnostic"] else ""
        ) + (
            "NAS_AGENT_SHARED_SECRET missing from backend/.env. "
            "Bi-directional file ops cannot be signed until it's set."
        )

    # Fire a fresh ping op (non-blocking-ish — we bounded-wait 5s so a
    # dead agent doesn't hang the health endpoint. Longer probes go
    # through POST /nas/probe.
    if connected and payload["hmac_secret_present"]:
        try:
            import nas_client
            probe = await _bounded_ping(timeout_s=5.0)
            if probe:
                payload["last_bidirectional_probe_ms"] = probe.get("roundtrip_ms")
                payload["last_bidirectional_probe_status"] = "ok"
                if probe.get("nas_free_gb") is not None:
                    payload["nas_free_gb"] = probe["nas_free_gb"]
                    payload["nas_used_gb"] = probe.get("nas_used_gb")
                    payload["nas_total_gb"] = probe.get("nas_total_gb")
            else:
                payload["last_bidirectional_probe_status"] = "timeout"
        except Exception as e:  # noqa: BLE001
            log.warning("nas probe failed: %s", e)
            payload["last_bidirectional_probe_status"] = f"error: {type(e).__name__}"
    return payload


async def _bounded_ping(timeout_s: float = 5.0):
    """Fire a `ping` op and only wait `timeout_s`. Returns None if
    the agent hasn't answered within the bound."""
    import asyncio
    from nas_ops_service import enqueue_op, wait_for_result
    row = await enqueue_op("ping", "/")
    settled = await wait_for_result(row["id"],
                                       timeout_s=timeout_s,
                                       poll_interval_s=0.25)
    if settled.get("status") == "done":
        return settled.get("result") or {}
    return None


@router.post("/probe")
async def nas_probe(user: dict = Depends(_require_admin)) -> Dict[str, Any]:
    """Force a full-timeout ping. Waits up to 30s. Returns
    `{ok, roundtrip_ms, nas_free_gb, error}`."""
    try:
        import nas_client
        result = await nas_client.ping()
        return {"ok": True, **result}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:400]}
