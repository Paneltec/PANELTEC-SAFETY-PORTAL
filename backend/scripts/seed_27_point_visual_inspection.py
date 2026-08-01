#!/usr/bin/env python3
"""v160.3.9.23 — Seed the "27 Point Visual Inspection" form template.

Per-org idempotent, keyed on (org_id, lowercased name). Every
inspection item is a repeating triplet (status + notes + estimated
cost). The status radio reuses the v22 traffic-light option set so the
v22a coloured-pill renderer applies automatically.

Field layout:
  - Header:              16 fields (customer + vehicle + signer)
  - 27 items × 3 fields: 81 fields (status + notes + cost per item)
  - Optional signature:   1 field  (app convention; required=false)
                        ======
                         98 fields total

Run:
    cd /app && set -a && source backend/.env && set +a && \\
        python3 backend/scripts/seed_27_point_visual_inspection.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


TEMPLATE_NAME = "27 Point Visual Inspection"
TEMPLATE_CATEGORY = "inspection"
TEMPLATE_VERSION = 1
TEMPLATE_DESCRIPTION = (
    "27-point visual inspection — battery, filters, wipers, lighting, fluids, "
    "brakes, drivetrain, exhaust, belts, tyres and alignment. Each item captures "
    "a traffic-light status, notes and an estimated cost."
)

TRAFFIC_LIGHT_OPTIONS = [
    "Checked & Okay",
    "Needs Attention",
    "Requires Immediate Attention",
]

# Exact labels from the source image, 1-indexed for readability.
ITEMS_27: list[str] = [
    "Battery Cables",
    "Air Filter",
    "Wiper Blades",
    "Head Lights, Turn Signals, Brake & Turn Lights",
    "Windshield Washer Fluid Level and Operation",
    "Radiator and Heater Hoses",
    "Power Steering Fluid Level, Hoses & Leaks",
    "Automatic Transmission Fluid Level and Condition",
    "Automatic Transmission Fluid Leaks",
    "Front and Rear Shocks and Struts (Oil Leaks)",
    "Brake Fluid Level & Condition",
    "Brake fluid Leaks",
    "Front Brake Pads",
    "Rear Brake Pads/Shoes",
    "Parking Brake Operation",
    "Engine Oil Level & Condition",
    "Engine Oil Leaks",
    "Lube handles, Hinges & Latches",
    "Cooling System Levels & condition",
    "Exhaust System",
    "Engine Drive Belts",
    "Tire Balance & Rotation",
    "Tires For Proper Alignment",
    "Right Front Tire Wear",
    "Left Front Tire Wear",
    "Right Rear Tire Wear",
    "Left Rear Tire Wear",
]

# Sanity-guard: seed script MUST refuse to run if the image spec drifts.
assert len(ITEMS_27) == 27, f"Expected 27 items, got {len(ITEMS_27)}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _hdr(label: str, ftype: str, required: bool = True,
         placeholder: str = "", extra_cfg: dict | None = None) -> dict:
    cfg: dict = {"section": "Header"}
    if extra_cfg:
        cfg.update(extra_cfg)
    return {
        "id": _new_id(),
        "label": label,
        "type": ftype,
        "required": required,
        "options": [],
        "placeholder": placeholder,
        "config": cfg,
    }


def _item_fields(n: int, item_label: str) -> list[dict]:
    """Return the (status + notes + cost) triplet for inspection item `n`."""
    section = "27-Point Inspection"
    key = f"item_{n:02d}"
    return [
        {
            "id": _new_id(),
            "label": f"{n}. {item_label} — status",
            "type": "radio",
            "required": True,
            "options": list(TRAFFIC_LIGHT_OPTIONS),
            "placeholder": "",
            "config": {
                "section": section,
                "renderer": "traffic_light",
                "item_number": n,
                "item_label": item_label,
                "field_role": "status",
                "field_key": f"{key}_status",
            },
        },
        {
            "id": _new_id(),
            "label": f"{n}. {item_label} — notes",
            "type": "text",
            "required": False,
            "options": [],
            "placeholder": "Optional notes",
            "config": {
                "section": section,
                "item_number": n,
                "item_label": item_label,
                "field_role": "notes",
                "field_key": f"{key}_notes",
            },
        },
        {
            "id": _new_id(),
            "label": f"{n}. {item_label} — estimated cost",
            "type": "number",
            "required": False,
            "options": [],
            "placeholder": "$",
            "config": {
                "section": section,
                "item_number": n,
                "item_label": item_label,
                "field_role": "cost",
                "field_key": f"{key}_cost",
            },
        },
    ]


def build_template_fields() -> list[dict]:
    fields: list[dict] = []

    # 1) Header — customer + vehicle + signer
    fields.append(_hdr("Customer name",    "text",   True))
    fields.append(_hdr("Customer address", "text",   True))
    fields.append(_hdr("Customer city",    "text",   True))
    fields.append(_hdr("Customer state",   "text",   True))
    fields.append(_hdr("Customer ZIP",     "text",   True))
    fields.append(_hdr("Cell phone",       "text",   False,
                       placeholder="mobile", extra_cfg={"keyboard": "phone-pad"}))
    fields.append(_hdr("Home phone",       "text",   False,
                       placeholder="landline", extra_cfg={"keyboard": "phone-pad"}))
    fields.append(_hdr("Year",             "text",   True,  placeholder="e.g. 2021"))
    fields.append(_hdr("Model",            "text",   True))
    fields.append(_hdr("Make",             "text",   True))
    fields.append(_hdr("VIN",              "text",   True,
                       placeholder="17-character VIN",
                       extra_cfg={"uppercase": True}))
    fields.append(_hdr("Motor",            "text",   False,
                       placeholder="e.g. 2.4L I4"))
    fields.append(_hdr("Mileage",          "number", True,  placeholder="km"))
    fields.append(_hdr("License plate",    "text",   True,
                       extra_cfg={"uppercase": True}))
    fields.append(_hdr("Written by",       "worker_picker", True))
    fields.append(_hdr("Date",             "date",   True,
                       extra_cfg={"default_today": True}))

    # 2) 27 inspection items × 3 fields each
    for idx, item_label in enumerate(ITEMS_27, start=1):
        fields.extend(_item_fields(idx, item_label))

    # 3) Optional signature (app convention; not present on the source image)
    fields.append({
        "id": _new_id(),
        "label": "Technician signature",
        "type": "signature",
        "required": False,
        "options": [],
        "placeholder": "",
        "config": {"section": "Signature"},
    })

    return fields


async def _grant_role_allowlist(db, org_id: str, template_id: str) -> list[str]:
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
        "source": "seed_v160_3_9_23",
        "imported_at": None,
        "created_by": "system:seed_27_point_visual_inspection",
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
