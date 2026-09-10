"""Fuel price settings — v58.13.132de / v58.13.132df.

Admin-editable per-org fallback price for fuel fills that arrive
without a real SmartFill-tagged price. Replaces the hardcoded
`PROVISIONAL_RATE` constant in the backfill script.

Collections:
  · `fuel_price_settings`  — one doc per org (upserted).
  · `fuel_price_history`   — append-only audit trail (last 20
                              surfaced via GET /price-history).

Endpoints (mounted at `/api/fleet/fuel`):
  GET  /price-settings           — read, `assets.view` (falls back
                                    to default 2.25 if not seeded).
  PUT  /price-settings           — upsert, `assets.edit`; appends
                                    a history row.
  GET  /price-history            — last 20 changes, `assets.view`.

Permission choice: this file mirrors sibling `fleet_fuel.py`, which
gates every fleet endpoint on `assets.*` (the "Plant & Vehicles"
resource in `permissions.PERMISSIONS_SCHEMA`). There is no `fleet`
resource in the matrix — early drafts of this module used one and
locked out even admins because `can()` short-circuits on unknown
resources.

Retroactive / prospective pricing (.132df):
  The provisional price is applied at READ TIME by aggregations
  and summaries. When the admin edits this setting, every existing
  report immediately reflects the new price for provisional-tagged
  fills, and every future daily import inherits it the moment the
  next report page loads. Real SmartFill-tagged fills are NEVER
  overwritten — this module only re-prices rows where
  `price_source in PROVISIONAL_PRICE_SOURCES` or where
  `total_price` is missing / zero while `litres > 0`.

  Cache invalidation: on PUT, per-process TTL caches in
  `fleet_fuel.py` (`_FUEL_SUMMARY_CACHE` + `_CARD_SUMMARY_CACHE`)
  are flushed so the next asset-drawer / card-drawer load sees the
  new price without waiting for the 60s TTL.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from permissions import require_permission

router = APIRouter(prefix="/fleet/fuel", tags=["fuel-price-settings"])

DEFAULT_PROVISIONAL_PRICE = 2.25

# v58.13.132dh — Canonical override modes. `smartfill_with_fallback`
# is the pre-.132dh default (real SmartFill prices preserved,
# provisional applied only to unpriced / marker rows).
# `provisional_all` is the universal override — every row displays &
# aggregates at `litres × provisional_price`, stored `total_price`
# in Mongo untouched (reversible read-time overlay).
OverrideMode = Literal["provisional_all", "smartfill_with_fallback"]
DEFAULT_OVERRIDE_MODE: OverrideMode = "smartfill_with_fallback"


def _mode_from_bool(override_smartfill_real: bool) -> OverrideMode:
    """Bridge the .132dg boolean and the .132dh enum. Both fields are
    persisted for BC — legacy mobile / older FE bundles still PUT the
    boolean; new FE PATCHes the enum."""
    return "provisional_all" if override_smartfill_real else "smartfill_with_fallback"


def _bool_from_mode(mode: OverrideMode) -> bool:
    return mode == "provisional_all"

# v58.13.132df — Canonical set of `price_source` markers written by
# provisional backfill paths (write-time model, pre-.132df). Any row
# carrying one of these tags is re-priced at READ TIME by
# `effective_total_price()` below so that changing the admin setting
# retroactively updates every existing report.
PROVISIONAL_PRICE_SOURCES: frozenset[str] = frozenset({
    "provisional_static_2.25",
    "provisional_static_3.00",
    "provisional",
})


def effective_total_price(
    tx: dict,
    provisional_price: float,
    override_smartfill_real: bool = False,
) -> float:
    """v58.13.132df / v58.13.132dg — Compute the price to attribute
    to a single fuel transaction at read time.

    Args:
      tx                       — single fuel transaction dict.
      provisional_price        — current per-org setting.
      override_smartfill_real  — when True, ALL rows (including
                                 real SmartFill-tagged) are re-priced
                                 at `litres * provisional_price`.
                                 The stored `total_price` in Mongo
                                 is never mutated — this is a
                                 read-time calculation only.

    Rules (override OFF, default):
      · Row tagged with a provisional marker → `litres * provisional_price`.
      · Row missing `total_price` (null / 0) with `litres > 0`
        → treat as provisional and price at `litres * provisional_price`.
      · Everything else → stored `total_price` (real SmartFill-tagged
        price, never overwritten).

    Rules (override ON):
      · EVERY row with `litres > 0` → `litres * provisional_price`.
      · Stored `total_price` in DB stays untouched (read-time only).
    """
    try:
        litres = float(tx.get("litres") or 0)
    except (TypeError, ValueError):
        litres = 0.0
    try:
        stored = float(tx.get("total_price") or 0)
    except (TypeError, ValueError):
        stored = 0.0
    if override_smartfill_real:
        return round(litres * provisional_price, 2) if litres > 0 else 0.0
    src = tx.get("price_source") or ""
    if src in PROVISIONAL_PRICE_SOURCES:
        return round(litres * provisional_price, 2) if litres > 0 else 0.0
    if stored <= 0 and litres > 0:
        # No SmartFill price attached and never backfilled — treat as
        # provisional so aggregations show honest numbers.
        return round(litres * provisional_price, 2)
    return stored


def _bust_downstream_caches() -> None:
    """v58.13.132df — Flush the in-process TTL caches in `fleet_fuel.py`
    (asset drawer + card drawer summaries) so a price change is visible
    on the next request instead of after the 60s TTL. Imported lazily
    to avoid an import cycle at module load."""
    try:
        import fleet_fuel  # local import to break the cycle
        fleet_fuel._FUEL_SUMMARY_CACHE.clear()
        fleet_fuel._CARD_SUMMARY_CACHE.clear()
    except Exception:
        # Never let a cache flush break the PUT — the aggregation is
        # still correct; users just wait ≤60s for the TTL to expire.
        pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_org_provisional_price(org_id: str) -> float:
    """Helper for other modules (backfill scripts, report aggregators).
    Falls back to DEFAULT_PROVISIONAL_PRICE when the org has never
    saved a setting."""
    doc = await db.fuel_price_settings.find_one(
        {"org_id": org_id}, {"_id": 0, "provisional_price_per_litre": 1},
    )
    if not doc:
        return DEFAULT_PROVISIONAL_PRICE
    try:
        return float(doc["provisional_price_per_litre"])
    except (TypeError, ValueError, KeyError):
        return DEFAULT_PROVISIONAL_PRICE


async def get_org_override_smartfill(org_id: str) -> bool:
    """v58.13.132dg — Helper mirroring `get_org_provisional_price`.
    Returns False (safe default) when the org has never toggled the
    override or the field is missing on the doc.

    v58.13.132dh — Prefers the enum field when present; falls back
    to the legacy boolean for pre-.132dh docs.
    """
    doc = await db.fuel_price_settings.find_one(
        {"org_id": org_id},
        {"_id": 0, "override_smartfill_real": 1, "override_mode": 1},
    )
    if not doc:
        return False
    if doc.get("override_mode") in ("provisional_all", "smartfill_with_fallback"):
        return _bool_from_mode(doc["override_mode"])
    return bool(doc.get("override_smartfill_real", False))


async def get_org_price_state(org_id: str) -> tuple[float, bool]:
    """v58.13.132dg — Fetch both settings in a single Mongo round-trip.
    Used by aggregation hot paths to avoid two queries per request.

    v58.13.132dh — Prefers the enum field when present; falls back
    to the legacy boolean for pre-.132dh docs.
    """
    doc = await db.fuel_price_settings.find_one(
        {"org_id": org_id},
        {"_id": 0, "provisional_price_per_litre": 1,
         "override_smartfill_real": 1, "override_mode": 1},
    )
    if not doc:
        return DEFAULT_PROVISIONAL_PRICE, False
    try:
        price = float(doc["provisional_price_per_litre"])
    except (TypeError, ValueError, KeyError):
        price = DEFAULT_PROVISIONAL_PRICE
    if doc.get("override_mode") in ("provisional_all", "smartfill_with_fallback"):
        override = _bool_from_mode(doc["override_mode"])
    else:
        override = bool(doc.get("override_smartfill_real", False))
    return price, override


class PriceIn(BaseModel):
    # v58.13.132dh — `provisional_price_per_litre` is now optional so
    # a PATCH-style payload can flip the override toggle alone
    # without re-sending the price. The PUT handler falls back to the
    # stored value when the client omits it.
    provisional_price_per_litre: Optional[float] = Field(None, gt=0, le=10.0)
    # v58.13.132dg — Optional boolean override toggle (legacy).
    # v58.13.132dh — Optional named enum. Either is accepted; the
    # enum wins when both are present. Both are persisted for BC.
    # `None` means "don't touch the existing value" so legacy clients
    # (mobile / older FE bundles) can PUT the price without
    # accidentally clearing the toggle.
    override_smartfill_real: Optional[bool] = None
    override_mode:           Optional[OverrideMode] = None


def _out(doc: Optional[dict], org_id: str) -> dict:
    if not doc:
        return {
            "org_id":                       org_id,
            "provisional_price_per_litre":  DEFAULT_PROVISIONAL_PRICE,
            "currency":                     "AUD",
            "updated_by":                   None,
            "updated_at":                   None,
            "is_default":                   True,
            # v58.13.132dg — Default: override OFF.
            "override_smartfill_real":      False,
            # v58.13.132dh — Named enum surfaced alongside the boolean.
            "override_mode":                DEFAULT_OVERRIDE_MODE,
        }
    # v58.13.132dh — Prefer stored enum, fall back to legacy boolean
    # for docs written before .132dh landed.
    if doc.get("override_mode") in ("provisional_all", "smartfill_with_fallback"):
        mode: OverrideMode = doc["override_mode"]
        override_bool = _bool_from_mode(mode)
    else:
        override_bool = bool(doc.get("override_smartfill_real", False))
        mode = _mode_from_bool(override_bool)
    return {
        "org_id":                       doc.get("org_id"),
        "provisional_price_per_litre":  float(doc["provisional_price_per_litre"]),
        "currency":                     doc.get("currency", "AUD"),
        "updated_by":                   doc.get("updated_by"),
        "updated_by_name":              doc.get("updated_by_name"),
        "updated_at":                   doc.get("updated_at"),
        "is_default":                   False,
        "override_smartfill_real":      override_bool,
        "override_mode":                mode,
    }


@router.get("/price-settings")
async def get_price_settings(
    actor: dict = Depends(require_permission("assets", "view")),
):
    doc = await db.fuel_price_settings.find_one(
        {"org_id": actor["org_id"]}, {"_id": 0},
    )
    return _out(doc, actor["org_id"])


@router.put("/price-settings")
async def put_price_settings(
    body:  PriceIn,
    actor: dict = Depends(require_permission("assets", "edit")),
):
    now = _now_iso()
    prev = await db.fuel_price_settings.find_one(
        {"org_id": actor["org_id"]}, {"_id": 0},
    )
    old = float((prev or {}).get("provisional_price_per_litre",
                                 DEFAULT_PROVISIONAL_PRICE))
    # v58.13.132dh — price is now optional; a PATCH-style payload
    # that only flips the mode is valid.
    new = float(body.provisional_price_per_litre) if body.provisional_price_per_litre is not None else old
    # v58.13.132dh — Resolve prior mode from stored enum → legacy
    # boolean → False, in that order.
    if (prev or {}).get("override_mode") in ("provisional_all", "smartfill_with_fallback"):
        old_mode: OverrideMode = prev["override_mode"]
    else:
        old_mode = _mode_from_bool(bool((prev or {}).get("override_smartfill_real", False)))
    # v58.13.132dh — Enum wins when present; boolean is honoured for
    # legacy mobile clients; None means "don't touch".
    if body.override_mode is not None:
        new_mode: OverrideMode = body.override_mode
    elif body.override_smartfill_real is not None:
        new_mode = _mode_from_bool(bool(body.override_smartfill_real))
    else:
        new_mode = old_mode
    new_override = _bool_from_mode(new_mode)
    old_override = _bool_from_mode(old_mode)

    upd = {
        "org_id":                       actor["org_id"],
        "provisional_price_per_litre":  new,
        "currency":                     "AUD",
        "updated_by":                   actor["id"],
        "updated_by_name":              actor.get("name"),
        "updated_at":                   now,
        "override_smartfill_real":      new_override,
        # v58.13.132dh — Persist the enum alongside the boolean.
        "override_mode":                new_mode,
    }
    await db.fuel_price_settings.update_one(
        {"org_id": actor["org_id"]}, {"$set": upd}, upsert=True,
    )
    # Append to audit log only if either the price OR the override
    # toggle actually changed. Cache flush follows any real change.
    price_changed    = abs(old - new) > 1e-6
    override_changed = old_override != new_override
    if price_changed or override_changed:
        await db.fuel_price_history.insert_one({
            "id":              str(uuid.uuid4()),
            "org_id":          actor["org_id"],
            "old_price":       old,
            "new_price":       new,
            # v58.13.132dg — audit trail also records override toggle
            # transitions. Legacy rows (pre-.132dg) have these fields
            # absent — FE renders them as "—" in history.
            "old_override":    old_override,
            "new_override":    new_override,
            # v58.13.132dh — Record the enum transition too.
            "old_mode":        old_mode,
            "new_mode":        new_mode,
            "changed_by":      actor["id"],
            "changed_by_name": actor.get("name"),
            "changed_at":      now,
        })
        # v58.13.132df — Flush downstream in-process TTL caches so
        # every asset-drawer / card-drawer summary re-computes with
        # the new price on next request (no 60s wait).
        _bust_downstream_caches()
    return _out(upd, actor["org_id"])


@router.get("/price-history")
async def get_price_history(
    actor: dict = Depends(require_permission("assets", "view")),
):
    rows = []
    async for h in db.fuel_price_history.find(
        {"org_id": actor["org_id"]}, {"_id": 0},
    ).sort("changed_at", -1).limit(20):
        rows.append(h)
    return {"history": rows}


async def seed_default_price(org_id: str) -> bool:
    """Idempotent seed — inserts DEFAULT_PROVISIONAL_PRICE if the
    org has never had a setting. Returns True on insert."""
    existing = await db.fuel_price_settings.find_one({"org_id": org_id})
    if existing:
        return False
    now = _now_iso()
    await db.fuel_price_settings.insert_one({
        "org_id":                       org_id,
        "provisional_price_per_litre":  DEFAULT_PROVISIONAL_PRICE,
        "currency":                     "AUD",
        "updated_by":                   "system:v58_13_132de_seed",
        "updated_by_name":              "system",
        "updated_at":                   now,
    })
    return True
