"""v160.3.9.58.13.47 — Capture-density telemetry.

Lightweight fire-and-forget analytics endpoint. Purpose: capture what
`Compact / Comfortable / Spacious / Auto` density mode each user
lands on for each Capture list page so we can retune the current
gut-estimate auto-thresholds (12/48) from real usage on high-volume
pages (Pre-Starts 9,182 rows, CS Incidents 201).

Design constraints (per user brief)
-----------------------------------
· Auth-optional — telemetry MUST NOT block anonymous or lightly-
  authenticated preview traffic. `user_id` is captured when a
  bearer token is present; falls back to `null` otherwise.
· Server ignores unexpected fields (Pydantic `extra="ignore"`) so
  clients can evolve their payload without a schema-version
  round trip.
· 30-day TTL — the ONLY reason we're collecting this is short-term
  threshold tuning. Auto-cleanup via Mongo TTL index so nothing
  leaks into long-term storage. `ts` field is a `datetime`; Mongo's
  `expireAfterSeconds` requires a BSON date type, not an ISO string.
· No sensitive PII. Only: page key, mode string, item count, ts,
  optional session id from headers.
· Never raises. Even a validation-adjacent failure returns 200 with
  `{ok: false, reason: ...}` — analytics MUST NOT throw and break
  the client's fire-and-forget guarantee.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, ConfigDict

from auth import get_current_user_optional  # see note below
from db import db

log = logging.getLogger("paneltec.metrics")

router = APIRouter(prefix="/metrics", tags=["metrics"])

_COLLECTION = "metrics_capture_density"
_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days


class CaptureDensityPing(BaseModel):
    # Pydantic v2 `ConfigDict` — same idiom as v58.13.43's hr_employees
    # fix. `extra="ignore"` so unknown fields are dropped silently
    # (analytics tolerates dirty payloads).
    model_config = ConfigDict(extra="ignore")

    page: Optional[str] = None
    mode: Optional[str] = None
    previous_mode: Optional[str] = None
    effective_mode: Optional[str] = None
    item_count: Optional[int] = None
    ts: Optional[int] = None  # client wall-clock millis, informational
    event: Optional[str] = None  # 'setMode' | 'resolved_from_auto'


async def ensure_indexes() -> None:
    """Idempotent index setup for the metrics collection. Creates
    the TTL index on `ts` and a compound `(page, ts)` index for
    the analytics query pattern we'll actually run when consuming
    the data (per-page threshold tuning)."""
    try:
        await db[_COLLECTION].create_index(
            "ts", expireAfterSeconds=_TTL_SECONDS)
        await db[_COLLECTION].create_index([("page", 1), ("ts", -1)])
    except Exception as e:  # noqa: BLE001 — best-effort at boot
        log.warning("metrics_capture_density index setup: %s", e)


@router.post("/capture-density")
async def capture_density_ping(
    body: CaptureDensityPing,
    request: Request,
    x_session_id: Optional[str] = Header(default=None,
                                         alias="X-Session-Id"),
    user: Optional[dict] = Depends(get_current_user_optional),
) -> dict:
    """Fire-and-forget telemetry write. See module docstring for the
    guarantee: this endpoint MUST return 200 for every reasonable
    request shape. Client-side is silently swallowing failures
    already; server-side just never adds noise."""
    try:
        doc = {
            "page": body.page or "unknown",
            "mode": body.mode or "unknown",
            "previous_mode": body.previous_mode,
            "effective_mode": body.effective_mode,
            "item_count": body.item_count,
            "event": body.event or "setMode",
            "ts": datetime.now(timezone.utc),
            "client_ts_ms": body.ts,
            "user_id": (user or {}).get("id"),
            "org_id": (user or {}).get("org_id"),
            "session_id": x_session_id,
            "ip": request.client.host if request.client else None,
            "ua": request.headers.get("user-agent", "")[:200],
        }
        await db[_COLLECTION].insert_one(doc)
        return {"ok": True}
    except Exception as e:  # noqa: BLE001 — analytics never throws
        log.warning("capture-density ping failed: %s", e)
        return {"ok": False, "reason": "insert-failed"}
