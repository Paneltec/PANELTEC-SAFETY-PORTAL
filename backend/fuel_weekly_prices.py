"""Immutable weekly diesel benchmarks from FuelCheck TAS public trend data.

Retail benchmark estimates, not supplier invoice prices. Monday-Sunday Hobart
weeks use the seven daily DL averages from the preceding completed week.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError
from db import db
from permissions import require_permission

router = APIRouter(prefix="/fleet/fuel", tags=["weekly-diesel-prices"])
SOURCE = "https://www.fuelcheck.tas.gov.au/app/FuelPrice/Trend?fuelTypeCode=DL"
ENDPOINT = "https://www.fuelcheck.tas.gov.au/fuel/api/v1/fuel/prices/trends"
TZ = ZoneInfo("Australia/Hobart")
log = logging.getLogger(__name__)


def week_start(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if isinstance(value, datetime):
        # Legacy naive timestamps are UTC, like the importer.
        value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
        value = value.astimezone(TZ).date()
    return value - timedelta(days=value.weekday())


def build_weeks(payload, today):
    """Only complete calendar weeks; reject bad/conflicting daily observations."""
    days = {}
    for row in payload.get("AveragePrices", []):
        if row.get("Code") != "DL" or row.get("Period") != "Month":
            continue
        day = date.fromisoformat(row["Captured"])
        price = Decimal(str(row["Price"]))
        if not price.is_finite() or not Decimal("0") < price <= Decimal("1000"):
            raise ValueError("Invalid FuelCheck diesel price")
        if day in days and days[day] != price:
            raise ValueError("Conflicting FuelCheck daily averages")
        days[day] = price
    result = []
    for source_start in sorted({week_start(d) for d in days}):
        applicable = source_start + timedelta(days=7)
        dates = [source_start + timedelta(days=i) for i in range(7)]
        if applicable > today or not all(d in days for d in dates):
            continue
        rate = (sum(days[d] for d in dates) / Decimal(700)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        result.append({
            "_id": "fuelcheck-tas-dl:" + applicable.isoformat(),
            "week_start": applicable.isoformat(),
            "week_end": (applicable + timedelta(days=6)).isoformat(),
            "source_week_start": source_start.isoformat(),
            "source_week_end": dates[-1].isoformat(),
            "price_per_litre": float(rate), "currency": "AUD", "fuel_type": "DL",
            "source_url": SOURCE, "timezone": "Australia/Hobart",
            "daily_prices_cents": [{"date": d.isoformat(), "price": float(days[d])} for d in dates],
            "locked_at": datetime.now(timezone.utc).isoformat(),
        })
    return result


async def refresh_prices():
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(ENDPOINT, json={"fueltypes": [{"code": "DL"}], "location": {"latitude": -42.8666632, "longitude": 147.3166654}})
        response.raise_for_status()
        weeks = build_weeks(response.json(), datetime.now(TZ).date())
    for snapshot in weeks:
        # Immutable _id + setOnInsert prevents later feeds or concurrent workers
        # changing an already published week. No overwrite/delete endpoint.
        try:
            await db.fuel_weekly_prices.update_one({"_id": snapshot["_id"]}, {"$setOnInsert": snapshot}, upsert=True)
        except DuplicateKeyError:
            # Another worker published this immutable week first.
            if not await db.fuel_weekly_prices.find_one({"_id": snapshot["_id"]}):
                raise
    return weeks


async def weekly_snapshot(week):
    return await db.fuel_weekly_prices.find_one({"_id": "fuelcheck-tas-dl:" + week.isoformat()})


async def freeze_for_import(tx, config, fallback_price, override, setting_id, cache):
    from fuel_price_settings import freeze_price_snapshot
    # Explicit non-diesel records retain their ordinary pricing policy.
    fuel = str(tx.get("fuel_type") or "").strip().lower()
    diesel = not fuel or fuel in {"dl", "diesel", "distillate"}
    week = week_start(tx["timestamp"])
    enabled = config.get("weekly_diesel_enabled") and week.isoformat() >= config.get("weekly_diesel_start", "9999")
    if not enabled or not diesel:
        return freeze_price_snapshot(tx, fallback_price, override, setting_id)
    key = week.isoformat()
    if key not in cache:
        cache[key] = await weekly_snapshot(week)
        if not cache[key] and not cache.get("_refreshed"):
            cache["_refreshed"] = True
            await refresh_prices()
            cache[key] = await weekly_snapshot(week)
    snapshot = cache[key]
    if not snapshot:
        raise ValueError(f"Diesel price for week {key} is pending; retry this import after FuelCheck refresh. No substitute price used.")
    rate = snapshot["price_per_litre"]
    frozen = freeze_price_snapshot(tx, rate, True, snapshot["_id"])
    frozen.update({"frozen_price_per_litre": rate, "frozen_price_source": "fuelcheck_weekly_diesel", "frozen_price_week": key,
                   "frozen_price_source_week": snapshot["source_week_start"], "frozen_price_source_url": SOURCE})
    return frozen


class WeeklyMode(BaseModel):
    enabled: bool


async def status_for(org_id):
    config = await db.fuel_price_settings.find_one({"org_id": org_id}) or {}
    current = await weekly_snapshot(week_start(datetime.now(TZ)))
    history = [r async for r in db.fuel_weekly_prices.find({}, {"_id": 0}).sort("week_start", -1).limit(52)]
    if current:
        current.pop("_id", None)
    return {"enabled": bool(config.get("weekly_diesel_enabled")), "starts_on": config.get("weekly_diesel_start"),
            "current": current, "history": history, "source_url": SOURCE}


@router.get("/weekly-diesel")
async def get_weekly(actor=Depends(require_permission("assets", "view"))):
    return await status_for(actor["org_id"])


@router.post("/weekly-diesel/refresh")
async def refresh_weekly(actor=Depends(require_permission("assets", "edit"))):
    try:
        await refresh_prices()
    except Exception as exc:
        log.warning("FuelCheck refresh failed: %s", type(exc).__name__)
        raise HTTPException(503, "FuelCheck is unavailable or returned incomplete data. Locked prices are unchanged.") from exc
    return await status_for(actor["org_id"])


@router.put("/weekly-diesel")
async def set_weekly(body: WeeklyMode, actor=Depends(require_permission("assets", "edit"))):
    current_week = week_start(datetime.now(TZ))
    if body.enabled:
        if not await weekly_snapshot(current_week):
            await refresh_weekly(actor)
        if not await weekly_snapshot(current_week):
            raise HTTPException(409, "Seven daily prices for last week are not available yet. Weekly pricing has not been enabled.")
    from fuel_price_settings import seed_default_price
    await seed_default_price(actor["org_id"])
    await db.fuel_price_settings.update_one({"org_id": actor["org_id"]}, {"$set": {
        "weekly_diesel_enabled": body.enabled, "weekly_diesel_start": current_week.isoformat(),
        "weekly_diesel_updated_by": actor["id"], "weekly_diesel_updated_at": datetime.now(timezone.utc).isoformat()}})
    return await status_for(actor["org_id"])


async def refresh_if_enabled():
    if await db.fuel_price_settings.find_one({"weekly_diesel_enabled": True}):
        try:
            await refresh_prices()
        except Exception:
            log.exception("Weekly diesel refresh failed; existing locked prices retained")
