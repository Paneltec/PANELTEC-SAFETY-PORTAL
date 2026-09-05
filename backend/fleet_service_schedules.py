"""v58.13.122 — Fleet Service Schedule engine.

Canonical PM (preventative maintenance) schedule for the Fleet
Register. Implements the "Whichever Comes First" principle across
kilometres and engine hours.

Design decisions (green-lit in the .122 investigation report):
  · Config storage: hardcoded constants (Option A). Future `.122a`
    can seed a MongoDB collection from `SCHEDULE_TABLE`.
  · Thresholds: AMBER at 85% of interval, RED at 100%+ (overdue).
  · Grey when asset has no counter data (never falsely-green).
  · In-memory 5-min cache per asset id; invalidated by
    `invalidate_cache(asset_id)` after pm insert.

Public surface:
  · `SCHEDULE_TABLE` — const dict, level -> intervals
  · `SUB_TYPE_METRIC_MAP` — const dict, kind/sub_type -> "km" | "hours" | "date"
  · `compute_next_due(asset, last_pm=None)` -> dict
  · `invalidate_cache(asset_id)`
  · `LEVEL_ORDER = ["minor", "intermediate", "major", "heavy_overhaul"]`
  · `AMBER_THRESHOLD = 0.85`
"""
from __future__ import annotations
import time
from typing import Optional

# ── Canonical schedule (source-of-truth) ──────────────────────────
LEVEL_ORDER = ["minor", "intermediate", "major", "heavy_overhaul"]
AMBER_THRESHOLD = 0.85
CACHE_TTL_SECONDS = 300

SCHEDULE_TABLE: dict[str, dict] = {
    "minor": {
        "label": "Minor / Basic",
        "km_min": 5_000, "km_max": 10_000,
        "hours": 250,
        "tasks": ["Engine Oil", "Oil Filter"],
        "hints": {
            "Tyres": "Tyre pressure + safety inspection",
            "Lights": "Function check",
            "Wipers": "Blade condition",
        },
    },
    "intermediate": {
        "label": "Intermediate",
        "km_min": 15_000, "km_max": 20_000,
        "hours": 500,
        "tasks": ["Engine Oil", "Oil Filter", "Cabin Filter", "Air Filter",
                   "Brakes", "Battery Condition"],
        "hints": {
            "Tyres": "Rotate",
        },
    },
    "major": {
        "label": "Major",
        "km_min": 30_000, "km_max": 45_000,
        "hours": 1_000,
        "tasks": ["Engine Oil", "Oil Filter", "Cabin Filter", "Air Filter",
                   "Brakes", "Battery Condition", "Fuel Filter", "Coolant",
                   "Brake Fluid", "Power Steering Fluid", "Suspension",
                   "Steering"],
        "hints": {
            "Tyres": "Rotate",
        },
    },
    "heavy_overhaul": {
        "label": "Heavy Overhaul",
        "km_min": 90_000, "km_max": 100_000,
        "hours": 2_000,
        "tasks": ["Engine Oil", "Oil Filter", "Cabin Filter", "Air Filter",
                   "Fuel Filter", "Coolant", "Brake Fluid",
                   "Power Steering Fluid", "Windscreen Washer Fluid",
                   "Auxiliary Belt", "Battery Condition", "Tyres", "Brakes",
                   "Suspension", "Steering", "Exhaust", "Lights", "Wipers"],
        "hints": {
            "Auxiliary Belt": "Timing belt/chain — 100k service replace",
            "Suspension": "Inspect bushings for wear",
            "Steering": "Valve adjustment / drivetrain overhaul check",
        },
    },
}


# ── kind / sub_type → primary metric ─────────────────────────────
# All comparisons are case-insensitive on the raw sub_type value so
# post-Navixy-drift rows still resolve correctly (belt-and-braces
# alongside the frontend `displaySubtype()` mask).
_KIND_DEFAULT = {"vehicle": "km", "plant": "hours", "trailer": "date"}
SUB_TYPE_METRIC_MAP: dict[str, str] = {
    # Vehicle sub-types (already km-primary by kind default; listed
    # explicitly so an admin scanning the module can confirm coverage).
    "ute": "km", "commercial": "km", "vacuum truck": "km",
    "vac truck": "km", "vacuum_truck": "km", "tipper": "km",
    "service truck": "km", "service_truck": "km", "crane truck": "km",
    "crane_truck": "km", "passenger": "km", "other": "km",
    # Plant sub-types.
    "excavator": "hours", "compactor": "hours", "telehandler": "hours",
    "directional drill": "hours", "road roller": "hours",
    "vehicle": "hours",  # legacy Navixy "vehicle" sub_type on plant kind
    # Trailer.
    "trailer": "date",
}


def primary_metric_for(asset: dict) -> str:
    """Return "km" | "hours" | "date" for the given asset row."""
    st = (asset.get("asset_type") or asset.get("sub_type") or "").strip().lower()
    if st in SUB_TYPE_METRIC_MAP:
        return SUB_TYPE_METRIC_MAP[st]
    return _KIND_DEFAULT.get(asset.get("kind"), "km")


# ── Cache ────────────────────────────────────────────────────────
_CACHE: dict[str, tuple[float, dict]] = {}


def invalidate_cache(asset_id: str) -> None:
    """Drop cached compute for a single asset. Called after a pm
    row is inserted so the next status read reflects the fresh
    baseline. Safe to call for a missing key."""
    _CACHE.pop(asset_id, None)


def _pick_status(ratio: Optional[float]) -> str:
    """Colour from ratio. None → 'grey'."""
    if ratio is None:
        return "grey"
    if ratio >= 1.0:
        return "red"
    if ratio >= AMBER_THRESHOLD:
        return "amber"
    return "green"


def _last_reading(asset: dict, last_pm: Optional[dict], key: str) -> Optional[float]:
    """Return the last-service reading for `key` in {'km', 'hours'}.

    Priority:
      1. `last_pm.mileage_at_service` / `hours_at_service` (`.121` shape).
      2. None (historic pre-.121 rows would need `.122b` back-fill —
         intentionally NOT read here per the ship scope).
    """
    if not last_pm:
        return None
    if key == "km":
        v = last_pm.get("mileage_at_service")
    else:
        v = last_pm.get("hours_at_service")
    return float(v) if isinstance(v, (int, float)) else None


def compute_next_due(asset: dict, last_pm: Optional[dict] = None) -> dict:
    """Compute the next-due block for an asset.

    Returns:
      {
        primary_metric: "km" | "hours" | "date",
        level: "minor" | "intermediate" | "major" | "heavy_overhaul" | None,
        status: "green" | "amber" | "red" | "grey",
        ratio: float | None,             # worst of km/hours ratios
        km_ratio: float | None,
        hours_ratio: float | None,
        due_in_km: float | None,         # km remaining to next Minor
        due_in_hours: float | None,      # hrs remaining to next Minor
        next_service_due_km: float | None,   # absolute odo reading at due
        next_service_due_hours: float | None,
        hint: str,                        # human-readable tooltip
      }
    """
    asset_id = asset.get("id")
    # Cache hit?
    if asset_id and asset_id in _CACHE:
        ts, data = _CACHE[asset_id]
        if time.time() - ts < CACHE_TTL_SECONDS:
            return data

    metric = primary_metric_for(asset)
    minor = SCHEDULE_TABLE["minor"]

    if metric == "date":
        # Trailer — schedule anchored on rego/inspection anniversary
        # date. Compute is out of scope for `.122` (needs a per-org
        # anchor field). Return grey.
        result = {
            "primary_metric": "date",
            "level": None, "status": "grey", "ratio": None,
            "km_ratio": None, "hours_ratio": None,
            "due_in_km": None, "due_in_hours": None,
            "next_service_due_km": None, "next_service_due_hours": None,
            "hint": "Trailer — date-based schedule (registration/inspection anniversary). Not tracked in .122.",
        }
    else:
        odo = asset.get("odo_km")
        hrs = asset.get("hours_meter")
        has_km = isinstance(odo, (int, float)) and odo > 0
        has_hrs = isinstance(hrs, (int, float)) and hrs > 0
        if not (has_km or has_hrs):
            result = {
                "primary_metric": metric, "level": None, "status": "grey",
                "ratio": None, "km_ratio": None, "hours_ratio": None,
                "due_in_km": None, "due_in_hours": None,
                "next_service_due_km": None, "next_service_due_hours": None,
                "hint": "No counter data — enter reading via Service Check Sheet to enable schedule tracking.",
            }
        else:
            last_km = _last_reading(asset, last_pm, "km")
            last_hrs = _last_reading(asset, last_pm, "hours")
            # Vs baseline 0 if no last-service reading.
            km_since = (float(odo) - (last_km or 0.0)) if has_km else None
            hrs_since = (float(hrs) - (last_hrs or 0.0)) if has_hrs else None

            # Ratios against the Minor interval floor.
            km_ratio = (km_since / minor["km_min"]) if km_since is not None else None
            hours_ratio = (hrs_since / minor["hours"]) if hrs_since is not None else None
            # Whichever comes first: worst wins.
            candidates = [r for r in (km_ratio, hours_ratio) if r is not None]
            ratio = max(candidates) if candidates else None

            # Determine which milestone bucket the current usage falls in.
            def _level_for(km_since: Optional[float], hrs_since: Optional[float]) -> Optional[str]:
                # Walk levels from heaviest → lightest; the first
                # whose thresholds have already been passed is the
                # level about to become due next.
                for lv in reversed(LEVEL_ORDER):
                    spec = SCHEDULE_TABLE[lv]
                    if metric == "km" and km_since is not None:
                        if km_since >= spec["km_min"] * AMBER_THRESHOLD:
                            return lv
                    if metric == "hours" and hrs_since is not None:
                        if hrs_since >= spec["hours"] * AMBER_THRESHOLD:
                            return lv
                return "minor"

            level = _level_for(km_since, hrs_since)

            due_in_km = (minor["km_min"] - (km_since or 0)) if has_km else None
            due_in_hours = (minor["hours"] - (hrs_since or 0)) if has_hrs else None

            next_km_abs = (float(odo) + due_in_km) if (has_km and due_in_km is not None) else None
            next_hrs_abs = (float(hrs) + due_in_hours) if (has_hrs and due_in_hours is not None) else None

            hint_parts: list[str] = []
            if metric == "km" and due_in_km is not None:
                if due_in_km > 0:
                    hint_parts.append(f"Next {SCHEDULE_TABLE[level]['label']} due in {int(due_in_km):,} km")
                else:
                    hint_parts.append(f"{SCHEDULE_TABLE[level]['label']} service overdue by {abs(int(due_in_km)):,} km")
            elif metric == "hours" and due_in_hours is not None:
                if due_in_hours > 0:
                    hint_parts.append(f"Next {SCHEDULE_TABLE[level]['label']} due in {int(due_in_hours):,} hrs")
                else:
                    hint_parts.append(f"{SCHEDULE_TABLE[level]['label']} service overdue by {abs(int(due_in_hours)):,} hrs")
            if metric == "km" and due_in_hours is not None:
                hint_parts.append(f"secondary hours: {int(due_in_hours):,} hrs")
            if metric == "hours" and due_in_km is not None:
                hint_parts.append(f"secondary km: {int(due_in_km):,} km")

            result = {
                "primary_metric": metric,
                "level": level,
                "status": _pick_status(ratio),
                "ratio": ratio,
                "km_ratio": km_ratio,
                "hours_ratio": hours_ratio,
                "due_in_km": due_in_km,
                "due_in_hours": due_in_hours,
                "next_service_due_km": next_km_abs,
                "next_service_due_hours": next_hrs_abs,
                "hint": " · ".join(hint_parts) if hint_parts else "Schedule computed.",
            }

    if asset_id:
        _CACHE[asset_id] = (time.time(), result)
    return result
