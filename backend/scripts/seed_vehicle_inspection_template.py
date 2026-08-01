#!/usr/bin/env python3
"""v160.3.9.22 — Seed the "Vehicle Inspection Report" form template.

Per-org idempotent, keyed on (org_id, lowercased name). Skips any org
that already has a `Vehicle Inspection Report` template. Every checklist
item is a traffic-light radio (`Checked & Okay` / `Needs Attention` /
`Requires Immediate Attention`) — the form renderer colour-codes those
option strings on the frontend (green / amber / rose).

Sections and item counts (matches the spec verbatim):
  - Header:                       6 fields
  - Brake & Tire:                 4 traffic-light radios
  - Exterior:                    10 traffic-light radios
  - Interior:                     9 traffic-light radios
  - Under the Hood:               6 traffic-light radios
  - Under the Vehicle:            8 traffic-light radios
  - Battery Performance:          2 traffic-light radios
  - Battery Cold Cranking Amps:   2 numeric fields (factory + actual)
  - Comments:                     1 optional textarea
  - Signature:                    1 required signature
                                 =====
                                 49 fields total

Run:
    cd /app && set -a && source backend/.env && set +a && \\
        python3 backend/scripts/seed_vehicle_inspection_template.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


TEMPLATE_NAME = "Vehicle Inspection Report"
TEMPLATE_CATEGORY = "inspection"
TEMPLATE_VERSION = 1
TEMPLATE_DESCRIPTION = (
    "Full vehicle inspection — brake & tyre, exterior, interior, under the "
    "hood, under the vehicle, and battery performance. Each check uses a "
    "traffic-light radio: Green (Checked & Okay), Amber (Needs Attention), "
    "Red (Requires Immediate Attention)."
)

TRAFFIC_LIGHT_OPTIONS = [
    "Checked & Okay",
    "Needs Attention",
    "Requires Immediate Attention",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _tl(section: str, label: str, required: bool = True) -> dict:
    """Traffic-light radio — the shared 3-option set with section metadata."""
    return {
        "id": _new_id(),
        "label": label,
        "type": "radio",
        "required": required,
        "options": list(TRAFFIC_LIGHT_OPTIONS),
        "placeholder": "",
        "config": {
            "section": section,
            "renderer": "traffic_light",   # frontend hint
        },
    }


SECTIONS: dict[str, list[str]] = {
    "Brake & Tire": [
        "Left front — brake lining, tire wear & tire pressure",
        "Right front — brake lining, tire wear & tire pressure",
        "Left rear — brake lining, tire wear & tire pressure",
        "Right rear — brake lining, tire wear & tire pressure",
    ],
    "Exterior": [
        "Tires (all four) — tread depth, sidewalls, wear pattern",
        "Spare tire — presence, inflation, condition",
        "Wheel condition — rims, hub caps, lug nuts",
        "Headlights — low beam & high beam",
        "Turn signals — front & rear",
        "Brake / tail lights",
        "Windshield — chips, cracks, wiper contact area",
        "Wipers & washers — blades and fluid spray",
        "Mirrors — glass, base & adjustment",
        "Body — dents, panel gaps, rust",
    ],
    "Interior": [
        "Seatbelts — all seating positions",
        "Airbags & warning lights",
        "Horn",
        "HVAC — AC, heat & defrost",
        "Audio / navigation system",
        "Pedals — brake, gas & clutch feel",
        "Emergency brake — hold & release",
        "Instrument panel — gauges & warning lights",
        "Interior condition — seats, trim, carpet, headliner",
    ],
    "Under the Hood": [
        "Fluid levels — oil, coolant, brake, power steering, transmission, washer",
        "Engine belts & hoses",
        "Drive belt — condition & tension adjustment",
        "Cooling system — radiator, cap & overall condition",
        "Battery — terminals, corrosion & cables",
        "Air filter & cabin filter",
    ],
    "Under the Vehicle": [
        "Shock absorbers, suspension & struts",
        "Steering — tie rods, ball joints & boots",
        "Muffler, exhaust & catalytic converter",
        "Engine oil / transmission leaks",
        "CV boots, joints & parking brake cables",
        "Drive shafts & constant velocity joints",
        "Fluid lines & connections",
        "Suspension / frame / body mounts",
    ],
    "Battery Performance": [
        "Battery starter — cables & windings",
        "Battery clamps — condition & cold cranking test",
    ],
}


def build_template_fields() -> list[dict]:
    """Construct the full field list in display order."""
    fields: list[dict] = []

    # 1) Header ─────────────────────────────────────────────────
    hdr = "Header"
    fields.append({
        "id": _new_id(), "label": "Technician", "type": "worker_picker",
        "required": True, "options": [], "placeholder": "",
        "config": {"section": hdr},
    })
    fields.append({
        "id": _new_id(), "label": "Date", "type": "date",
        "required": True, "options": [], "placeholder": "",
        "config": {"section": hdr, "default_today": True},
    })
    fields.append({
        "id": _new_id(), "label": "Customer name", "type": "text",
        "required": True, "options": [], "placeholder": "",
        "config": {"section": hdr},
    })
    fields.append({
        "id": _new_id(), "label": "Year / Make / Model", "type": "text",
        "required": True, "options": [], "placeholder": "e.g. 2021 Toyota Hilux",
        "config": {"section": hdr},
    })
    fields.append({
        "id": _new_id(), "label": "VIN", "type": "text",
        "required": True, "options": [], "placeholder": "17-character VIN",
        "config": {"section": hdr},
    })
    fields.append({
        "id": _new_id(), "label": "Mileage", "type": "number",
        "required": True, "options": [], "placeholder": "km",
        "config": {"section": hdr},
    })

    # 2) Traffic-light checklists ────────────────────────────────
    for section, items in SECTIONS.items():
        for label in items:
            fields.append(_tl(section, label, required=True))

    # 3) Battery Cold Cranking Amps ─────────────────────────────
    fields.append({
        "id": _new_id(), "label": "Factory-spec CCA (Cold Cranking Amps)",
        "type": "number", "required": False, "options": [], "placeholder": "amps",
        "config": {"section": "Battery Cold Cranking Amps"},
    })
    fields.append({
        "id": _new_id(), "label": "Actual CCA (measured)",
        "type": "number", "required": False, "options": [], "placeholder": "amps",
        "config": {"section": "Battery Cold Cranking Amps"},
    })

    # 4) Comments + Signature ───────────────────────────────────
    fields.append({
        "id": _new_id(), "label": "Comments", "type": "textarea",
        "required": False, "options": [], "placeholder": "Optional notes",
        "config": {"section": "Comments"},
    })
    fields.append({
        "id": _new_id(), "label": "Technician signature", "type": "signature",
        "required": True, "options": [], "placeholder": "",
        "config": {"section": "Signature"},
    })

    return fields


async def _grant_role_allowlist(db, org_id: str, template_id: str) -> list[str]:
    """Same pattern as seed_daily_prestart_utility: ensure the new
    template is visible to every non-admin role that already has an
    allowlist entry. Roles with no allowlist entry see everything anyway."""
    org = await db.orgs.find_one({"id": org_id}, {"_id": 0, "role_form_allowlist": 1}) or {}
    matrix: dict = org.get("role_form_allowlist") or {}
    updated: list[str] = []
    for role, allowlist in matrix.items():
        if role == "admin":
            continue
        if not isinstance(allowlist, list):
            continue
        if template_id in allowlist:
            continue
        await db.orgs.update_one(
            {"id": org_id},
            {"$addToSet": {f"role_form_allowlist.{role}": template_id}},
        )
        updated.append(role)
    return updated


async def seed_for_org(db, org_id: str, org_name: str) -> dict:
    existing = await db.form_templates.find_one(
        {
            "org_id": org_id,
            "deleted_at": None,
            "name": {"$regex": f"^{TEMPLATE_NAME}$", "$options": "i"},
        },
        {"_id": 0, "id": 1, "name": 1},
    )
    if existing:
        granted = await _grant_role_allowlist(db, org_id, existing.get("id"))
        return {
            "org_id": org_id, "org_name": org_name,
            "status": "skipped_exists",
            "existing_id": existing.get("id"),
            "existing_name": existing.get("name"),
            "allowlist_roles_granted": granted,
        }

    doc = {
        "id": _new_id(),
        "org_id": org_id,
        "name": TEMPLATE_NAME,
        "category": TEMPLATE_CATEGORY,
        "description": TEMPLATE_DESCRIPTION,
        "fields": build_template_fields(),
        "required_certifications": [],
        "applies_to": {
            "kinds": ["any"],
            "asset_types": [],
            "worker_ids": [],
            "roles": [],
            "companies": [],
        },
        "template_version": TEMPLATE_VERSION,
        "source": "seed_v160_3_9_22",
        "imported_at": None,
        "created_by": "system:seed_vehicle_inspection_template",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "deleted_at": None,
    }
    await db.form_templates.insert_one(doc)
    granted = await _grant_role_allowlist(db, org_id, doc["id"])
    return {
        "org_id": org_id, "org_name": org_name,
        "status": "inserted",
        "template_id": doc["id"],
        "field_count": len(doc["fields"]),
        "allowlist_roles_granted": granted,
    }


async def main() -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL / DB_NAME not set in env", file=sys.stderr)
        return 2
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    orgs: list[dict] = []
    async for o in db.organisations.find({}, {"_id": 0, "id": 1, "name": 1}):
        orgs.append({"id": o.get("id"), "name": o.get("name") or "(unnamed)"})
    if not orgs:
        seen: set[str] = set()
        async for u in db.users.find({}, {"_id": 0, "org_id": 1}):
            oid = u.get("org_id")
            if oid and oid not in seen:
                seen.add(oid)
                orgs.append({"id": oid, "name": "(from users)"})

    print(f"Seeding '{TEMPLATE_NAME}' template across {len(orgs)} orgs …")
    inserted = skipped = 0
    for o in orgs:
        result = await seed_for_org(db, o["id"], o["name"])
        marker = "+" if result["status"] == "inserted" else "="
        print(f"  {marker} [{o['name']}] {result}")
        if result["status"] == "inserted":
            inserted += 1
        else:
            skipped += 1
    print(f"\nSUMMARY: inserted={inserted} skipped_exists={skipped} total_orgs={len(orgs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
