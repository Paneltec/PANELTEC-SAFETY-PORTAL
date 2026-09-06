"""v58.13.131i — Shared Navixy odometer enrichment helper.

Populates `odometer_km`, `engine_hours`, `odometer_source`, and
`_enrichment_confidence` on a fuel transaction using the best available
Navixy signal at the fill's timestamp. Consumed by both the `.131h`
migration script (for retro-enrichment) and `fleet_fuel._import_csv`
(for import-time enrichment — closes .131h Gap #7).

Signal tiers (highest to lowest):
    1. `navixy_live`        — Nearest `asset_meter_history` snapshot on or
                              before the fill date, within 7 days. Uses the
                              schema field names actually persisted by the
                              daily cron: `odometer_km_total` and
                              `engine_hours_total`.
    2. `navixy_snapshot` (fresh) — Current `assets.odo_km` counter, updated
                                    in the last 24h.
    3. `navixy_snapshot` (stale) — Current `assets.odo_km` counter, updated
                                    > 24h ago (`_enrichment_confidence = "stale"`).
    4. `unknown`            — No Navixy data at all (no device, or all
                              signals empty). R5 (`missing_odometer`) will
                              fire on this row.

The `.131h` migration erroneously checked `asset_meter_history.odometer_km`
which is not a real field on that collection. The correct field is
`odometer_km_total`. This module uses the correct name.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional


STALE_HOURS = 24
LIVE_MAX_DAYS_LOOKBACK = 7  # `navixy_live` only if within this window


def _parse_ts(s):
    """Parse Navixy 'YYYY-MM-DD HH:MM:SS' (naive UTC) or ISO strings.
    Returns UTC-aware datetime or None."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace(" ", "T")).replace(
            tzinfo=timezone.utc
        ) if "+" not in str(s) and "Z" not in str(s) else datetime.fromisoformat(
            str(s).replace("Z", "+00:00")
        )
    except Exception:
        return None


async def load_asset_snapshots(db) -> dict:
    """Preload the current-counter snapshot for every Navixy-linked asset.

    Returns `{asset_id: {device_id, odo_km, odo_updated, hours,
    hours_updated}}`. Callers should call this ONCE per import batch or
    migration run to avoid N+1 queries.
    """
    out = {}
    async for a in db.assets.find(
        {"navixy_device_id": {"$ne": None}},
        {
            "id": 1,
            "navixy_device_id": 1,
            "odo_km": 1,
            "hours_meter": 1,
            "odo_km_updated_at": 1,
            "hours_meter_updated_at": 1,
        },
    ):
        out[a["id"]] = {
            "device_id": a.get("navixy_device_id"),
            "odo_km": a.get("odo_km"),
            "odo_updated": _parse_ts(a.get("odo_km_updated_at")),
            "hours": a.get("hours_meter"),
            "hours_updated": _parse_ts(a.get("hours_meter_updated_at")),
        }
    return out


async def load_history_for_asset(db, asset_id: str, date_iso: str) -> Optional[dict]:
    """Return the most recent `asset_meter_history` row on or before
    `date_iso` for `asset_id` that has a non-null `odometer_km_total`.

    Returns `{snapshot_date, odometer_km_total, engine_hours_total}` or
    None. Includes rows up to `LIVE_MAX_DAYS_LOOKBACK` days older than
    `date_iso`; older matches are ignored so we don't attach a stale
    snapshot to a fresh fill.
    """
    if not asset_id or not date_iso:
        return None
    cutoff = (
        datetime.fromisoformat(date_iso) - timedelta(days=LIVE_MAX_DAYS_LOOKBACK)
    ).date().isoformat()
    doc = None
    cursor = db.asset_meter_history.find(
        {
            "asset_id": asset_id,
            "snapshot_date": {"$lte": date_iso, "$gte": cutoff},
            "odometer_km_total": {"$ne": None},
        },
        {
            "_id": 0,
            "snapshot_date": 1,
            "odometer_km_total": 1,
            "engine_hours_total": 1,
        },
    ).sort("snapshot_date", -1).limit(1)
    async for d in cursor:
        doc = d
        break
    return doc


async def enrich_fill(
    db,
    *,
    asset_id: Optional[str],
    date_iso: Optional[str],
    csv_odo: Optional[float],
    csv_hours: Optional[float],
    snapshots: dict,
    now: Optional[datetime] = None,
) -> dict:
    """Determine odometer/hours + source for a single fuel row.

    Precedence:
      * If `csv_odo > 0` — CSV wins. `odometer_source = "csv"`.
      * Else consult `asset_meter_history` for `navixy_live` (per-day).
      * Else consult `assets.odo_km` snapshot for `navixy_snapshot`.
      * Else `unknown`.

    Returns `{odometer_km, engine_hours, odometer_source,
    engine_hours_source, _enrichment_confidence,
    odometer_snapshot_at}`. Fields absent from the winning tier are
    omitted so callers can `$set` the dict directly.
    """
    now = now or datetime.now(timezone.utc)
    out: dict = {}

    if csv_odo and csv_odo > 0:
        out["odometer_km"] = int(csv_odo)
        out["odometer_source"] = "csv"
        if csv_hours:
            out["engine_hours"] = float(csv_hours)
            out["engine_hours_source"] = "csv"
        return out

    if not asset_id:
        out["odometer_source"] = "unknown"
        out["engine_hours_source"] = "unknown"
        return out

    # Tier 1: per-day history (`navixy_live`).
    if date_iso:
        hist = await load_history_for_asset(db, asset_id, date_iso)
        if hist and hist.get("odometer_km_total") is not None:
            out["odometer_km"] = int(round(hist["odometer_km_total"]))
            out["odometer_source"] = "navixy_live"
            out["_enrichment_confidence"] = "high"
            out["odometer_snapshot_at"] = hist["snapshot_date"]
            eh = hist.get("engine_hours_total")
            if eh is not None:
                out["engine_hours"] = float(eh)
                out["engine_hours_source"] = "navixy_live"
            return out

    # Tier 2/3: current snapshot (`navixy_snapshot` fresh/stale).
    snap = snapshots.get(asset_id)
    if snap and snap.get("odo_km") and snap["odo_km"] > 0:
        out["odometer_km"] = int(round(snap["odo_km"]))
        out["odometer_source"] = "navixy_snapshot"
        confidence = "fresh"
        if snap.get("odo_updated") and (now - snap["odo_updated"]) > timedelta(
            hours=STALE_HOURS
        ):
            confidence = "stale"
        out["_enrichment_confidence"] = confidence
        out["odometer_snapshot_at"] = (
            snap["odo_updated"].isoformat() if snap.get("odo_updated") else None
        )
        if snap.get("hours"):
            out["engine_hours"] = float(snap["hours"])
            out["engine_hours_source"] = "navixy_snapshot"
        return out

    # Tier 4: unknown.
    out["odometer_source"] = "unknown"
    out["engine_hours_source"] = "unknown"
    return out


# ─────────────────────────────────────────────────────────────────────
# L/100km sanity guards
# ─────────────────────────────────────────────────────────────────────
#
# The `.131h` migration computes `litres_per_100km` per-asset by sorting
# fills chronologically and dividing litres by the km delta. `.131i`
# tightens the guards so garbage snapshots don't leak into the dataset.

L100_MIN_DELTA_KM = 0.1
L100_MAX_RESULT = 500.0
L100_MAX_GAP_DAYS = 30  # skip if the previous fill is > 30d ago


def compute_lp100(
    *,
    prev_odo: Optional[float],
    prev_ts_iso: Optional[str],
    prev_confidence: Optional[str],
    curr_odo: Optional[float],
    curr_ts_iso: Optional[str],
    curr_confidence: Optional[str],
    curr_litres: Optional[float],
) -> tuple[Optional[float], Optional[str]]:
    """Return `(lp100, skip_reason)`. Only one of them is non-None.

    Guards (ordered — first failing guard wins):
      * previous or current confidence is `stale` → garbage-in-garbage-out
      * previous fill timestamp is > 30 days older than current
      * delta km ≤ 0.1 (snapshot repetition — the .131h reason it wrote 0 rows)
      * computed lp100 > 500 L/100km (physically implausible)
    """
    if prev_odo is None or curr_odo is None:
        return (None, "missing_odo")
    if not curr_litres or curr_litres <= 0:
        return (None, "no_litres")

    if prev_confidence == "stale" or curr_confidence == "stale":
        return (None, "stale_confidence")

    if prev_ts_iso and curr_ts_iso:
        try:
            a = datetime.fromisoformat(prev_ts_iso.replace("Z", "+00:00"))
            b = datetime.fromisoformat(curr_ts_iso.replace("Z", "+00:00"))
            gap = (b - a).total_seconds() / 86400.0
            if gap > L100_MAX_GAP_DAYS:
                return (None, f"gap_over_{L100_MAX_GAP_DAYS}d")
        except (ValueError, TypeError):
            pass

    delta = curr_odo - prev_odo
    if delta <= L100_MIN_DELTA_KM:
        return (None, "delta_too_small_or_odd")

    lp100 = 100.0 * curr_litres / delta
    if lp100 > L100_MAX_RESULT:
        return (None, "computed_over_500")

    return (round(lp100, 2), None)
