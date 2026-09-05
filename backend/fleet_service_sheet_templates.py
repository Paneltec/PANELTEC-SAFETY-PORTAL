"""v58.13.123 — Fleet Service Sheet template registry.

Two templates live here:
  · `TEMPLATE_LIGHT_VEHICLE_V121_1` — original 18-item 2-checkbox
    template shipped in `.121`.
  · `TEMPLATE_HEAVY_TRUCK_V123_1` — 11-section 77-item tri-state
    template. Marks are `"X"` (repair/adjust required), `"CHECK"`
    (OK, ticked), `"NA"` (not applicable), or `"UNSET"` (default).

Public surface:
  · `get_template(version_string) -> dict`
  · `pick_default_template(asset) -> version_string`
"""
from __future__ import annotations
from typing import Optional


TEMPLATE_LIGHT_VEHICLE_V121_1 = {
    "version": "v121.1",
    "label": "Light Vehicle — Service Check Sheet",
    "kind": "light",
    "items": [
        "Engine Oil", "Oil Filter", "Air Filter", "Cabin Filter",
        "Fuel Filter", "Coolant", "Brake Fluid", "Power Steering Fluid",
        "Windscreen Washer Fluid", "Auxiliary Belt", "Battery Condition",
        "Tyres", "Brakes", "Suspension", "Steering", "Exhaust", "Lights",
        "Wipers",
    ],
}


_HEAVY_SECTIONS = [
    ("A", "Engine", "amber", [
        "Oil changed", "Oil filter changed", "Coolant filter changed",
        "Coolant level checked",
        "Fuel filter changed & system checked", "Air cleaner checked",
        "Service battery",
        "Engine inspected for coolant or oil leaks", "Hoses inspected",
        "Belts inspected", "Fan and hub inspected", "All wiring inspected",
        "Positive air shutdown lubricated & operational",
        "Automatic air shutdown system",
        "Test system operation with engine running",
        "Lubricate air cut off valve", "Other",
    ]),
    ("B", "Steering", "sky", [
        "Fluid levels", "Hose inspection", "Linkage inspection",
        "Linkage greased", "Wheel hubs inspected",
        "Wheel oil levels & bearing adjustment checked",
        "Steering box mounting inspected", "Other",
    ]),
    ("C", "Tires and Wheels", "cyan", [
        "Tire pressure", "Wheels inspected for cracks",
        "Wheel seals inspected for leaks", "Studs & nuts inspected",
        "Tire wear (record tread depth below)", "Retorque wheels",
    ]),
    ("D", "Clutch and Transmission", "violet", [
        "Throw out bearing inspected", "Throw out bearing greased",
        "Check oil levels", "Clutch through shaft greased",
        "Check clutch adjustment",
    ]),
    ("E", "Safety Equipment", "emerald", [
        "Inspect fire extinguisher", "Inspect first aid kit",
        "Inspect flares & flags", "Personal protective equipment",
    ]),
    ("F", "Brakes", "rose", [
        "Brakes in working order", "Inspect & grease linkage",
        "Inspect all lines for wear & leaks", "Check brake adjustment",
        "Parking brake in working order",
    ]),
    ("G", "Driveline and Differentials", "indigo", [
        "Inspect & grease U joints", "Inspect steady bearings for wear",
        "Inspect mountings for wear", "Check differential fluid levels",
    ]),
    ("H", "Electrical, Cab & Accessories", "blue", [
        "Exterior lights", "Interior lights", "All switches",
        "Windshield/windows/mirrors", "Wipers/washers", "Horn",
        "Turn signals & flashers", "All gauges", "Heater/defroster",
        "Back up alarm", "Low air warning signals", "Cab condition",
    ]),
    ("I", "Auxiliary Equipment", "teal", [
        "Power take off leaks", "Driveline U joints", "Pumps & hoses",
        "Hydraulic fluid levels", "Cam lock fittings", "Product hose",
        "Quarterly visual inspection", "Annual hydrostatic test",
        "Other", "Other",
    ]),
    ("J", "Frame and Suspension", "slate", [
        "Air bags/springs", "Air lines & valves",
        "Cracks & loose bolts", "Lubrication",
    ]),
    ("K", "Hitches", "amber", [
        "5th wheel inspect/lube/adjust", "Pintle hitch",
    ]),
]

TREAD_POSITIONS = [
    ("right_front",         "Right Front",        False),  # False = OUT only
    ("right_front_tandem",  "Right Front Tandem", True),
    ("right_middle_tandem", "Right Middle Tandem", True),
    ("right_rear_tandem",   "Right Rear Tandem",  True),
    ("left_front",          "Left Front",         False),
    ("left_front_tandem",   "Left Front Tandem",  True),
    ("left_middle_tandem",  "Left Middle Tandem", True),
    ("left_rear_tandem",    "Left Rear Tandem",   True),
]

TEMPLATE_HEAVY_TRUCK_V123_1 = {
    "version": "v123.1",
    "label": "Heavy Truck — Preventative Maintenance Checklist",
    "kind": "heavy",
    "sections": [
        {"id": s_id, "label": label, "accent": accent, "items": items}
        for (s_id, label, accent, items) in _HEAVY_SECTIONS
    ],
    "tread_positions": [
        {"id": pid, "label": lbl, "has_inner": has_inner}
        for (pid, lbl, has_inner) in TREAD_POSITIONS
    ],
    "section_notes": {
        "C": "NSC tread limits apply — record depth in 32nds below.",
        "F": "NSC travel/wear limits apply — check adjustment.",
    },
}

_REGISTRY = {
    "v121.1": TEMPLATE_LIGHT_VEHICLE_V121_1,
    "v123.1": TEMPLATE_HEAVY_TRUCK_V123_1,
}


def get_template(version: str) -> Optional[dict]:
    return _REGISTRY.get(version)


def all_templates() -> dict:
    return dict(_REGISTRY)


# Auto-select heuristic — matches the green-lit spec.
_HEAVY_SUBTYPES = {
    "vacuum truck", "vac truck", "vacuum_truck",
    "tipper", "service truck", "service_truck",
    "crane truck", "crane_truck", "commercial",
}


def pick_default_template(asset: dict) -> str:
    st = (asset.get("asset_type") or asset.get("sub_type") or "").strip().lower()
    if st in _HEAVY_SUBTYPES:
        return "v123.1"
    if asset.get("kind") == "plant":
        return "v123.1"
    hrs = asset.get("hours_meter")
    if asset.get("kind") == "vehicle" and isinstance(hrs, (int, float)) and hrs >= 500:
        return "v123.1"
    return "v121.1"
