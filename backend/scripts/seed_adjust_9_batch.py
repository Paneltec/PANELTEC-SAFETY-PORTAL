#!/usr/bin/env python3
"""
v160.3.0-adjust-9 — Seed 4 more form templates from the user's PDFs.

Templates seeded (idempotent, per-org, case-insensitive name key):
  • CVT Daily Pre-Start           (category: pre_start)
  • Weekly Pre-Start              (category: pre_start — see routing note)
  • Tip Truck Daily Pre-Start     (category: pre_start)
  • Construction & Excavation SSRA (category: inspection — see routing note)

Routing notes (flagged in ship report):
  - `weekly_pre_start` and `ssra` are NOT existing platform categories.
    Adding either would ripple across ALLOWED_CATEGORIES, crud.py mirror
    routing, sidebar nav, and mobile category tiles. Deferred.
  - Weekly Pre-Start therefore rides on `pre_start` (same capture tab).
  - SSRA rides on `inspection` (closest structural analogue).

Shared defaults (locked by user in adjust-8):
  - Standard Header (date, worker_picker, gps, vehicle_navixy)
  - Pass / Fail / N/A radio for every inspection item
  - No cert gate
  - applies_to.kinds = ["any"]  → universal audience per org
  - Added to `role_form_allowlist` for every non-admin role with an entry

Run:
    cd /app && set -a && source backend/.env && set +a && \
        python3 backend/scripts/seed_adjust_9_batch.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


COMPANY_OPTIONS = [
    {"label": "Paneltec Civil", "simpro_id": "2"},
    {"label": "Viatec",         "simpro_id": "3"},
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _radio_pfn(label: str, required: bool = True) -> dict:
    """Pass / Fail / N/A radio field."""
    return {
        "id": _new_id(), "label": label, "type": "radio",
        "required": required, "options": ["Pass", "Fail", "N/A"],
        "placeholder": "", "config": {},
    }


def _radio_yn(label: str, required: bool = True) -> dict:
    """Yes / No radio field."""
    return {
        "id": _new_id(), "label": label, "type": "radio",
        "required": required, "options": ["Yes", "No"],
        "placeholder": "", "config": {},
    }


def _confirm(label: str) -> dict:
    """Single 'I confirm' declaration checkbox (implemented as a required
    radio with a single option — same pattern as adjust-8)."""
    return {
        "id": _new_id(), "label": label, "type": "radio",
        "required": True, "options": ["I confirm"],
        "placeholder": "", "config": {},
    }


def _standard_header(vehicle_required: bool = True) -> list[dict]:
    return [
        {"id": _new_id(), "label": "Date", "type": "date",
         "required": True, "options": [], "placeholder": "",
         "config": {"default_today": True}},
        {"id": _new_id(), "label": "Operator (Name)", "type": "worker_picker",
         "required": True, "options": [], "placeholder": "",
         "config": {"inline_company_toggle": True, "company_options": COMPANY_OPTIONS}},
        {"id": _new_id(), "label": "Location", "type": "gps",
         "required": True, "options": [], "placeholder": "",
         "config": {"reverse_geocode": True}},
        {"id": _new_id(), "label": "Select Vehicle", "type": "vehicle_navixy",
         "required": vehicle_required, "options": [], "placeholder": "",
         "config": {}},
    ]


def _fault_block(vehicle_word: str = "vehicle") -> list[dict]:
    """Standard fault/hazard trio + final Pre-Start complete."""
    gate_id = _new_id()
    return [
        {"id": gate_id,
         "label": (
             f"Fault / Hazard — Are you submitting a Service Request or "
             f"Fault Notification today? (If the fault constitutes an "
             f"immediate safety hazard the plant must be removed from "
             f"service and tagged out. Contact your immediate supervisor. "
             f"The plant must not be used until the fault has been "
             f"rectified and clearance is given.)"
         ),
         "type": "radio", "required": True, "options": ["Yes", "No"],
         "placeholder": "", "config": {}},
        {"id": _new_id(),
         "label": "Details of fault / hazard (fill in if Yes above)",
         "type": "textarea", "required": False, "options": [],
         "placeholder": "Describe the fault or hazard, including any tag-out actions taken.",
         "config": {"dependsOn": gate_id}},
        {"id": _new_id(),
         "label": "Photos of defect / service sticker / odometer (fill in if Yes above)",
         "type": "photo", "required": False, "options": [],
         "placeholder": "", "config": {"multi": True, "dependsOn": gate_id}},
        {"id": _new_id(), "label": "Pre-Start complete",
         "type": "radio", "required": True, "options": ["I confirm"],
         "placeholder": "", "config": {}},
    ]


# ────────────────────────────────────────────────────────────────────────
# Template 2 — CVT Daily Pre-Start
# ────────────────────────────────────────────────────────────────────────
CVT_INSPECTION = [
    "Glass & Lenses — Windscreen, mirrors & light covers",
    "Tyres — Tread, walls & air pressure",
    "Panels & Guards — All truck panels, rotating equipment guards and pumps",
    "Signs, Tools & Equipment — Lances, jetting signs, speed signs, spray shields, shovel, crowbar, broom & jetting attachments",
    "Jetting System — Free of leaks and defects",
    "High Pressure Jetting Hose — Visual check for signs of potential failure",
    "Fire Extinguisher, Spill Kit & First Aid Kit — In date, on board, complete & accessible",
    "Air Tanks & All Fluids — Air tanks drained & correct levels of fuel, oil, coolant/water",
    "Under Cab Inspection — No signs of hose wear or oil/fluid leaks",
    "Seat Belts — Buckles, webbing, latch plate, retractor, pillar loop",
    "Globes & Alarms — Indicators, headlights, brake / reverse / work lights, reverse alarms, door open alarms, hand brake alarms",
    "Dashboard — Service KM/hrs, dashboard lights, no warning lights",
    "Cleanliness of Cab — Previous operator left cab free of rubbish",
    "SWT Level — Seal Water Tank on Vacuum System",
    "Vacuum System — Leaks or misaligned components",
]


def cvt_fields() -> list[dict]:
    f = _standard_header()
    for lbl in CVT_INSPECTION:
        f.append(_radio_pfn(lbl))
    f.append({"id": _new_id(), "label": "Odometer (km)", "type": "number",
              "required": True, "options": [], "placeholder": "e.g. 158420", "config": {}})
    f.append({"id": _new_id(), "label": "PTO Engagement Hours", "type": "number",
              "required": True, "options": [], "placeholder": "e.g. 2340", "config": {}})
    f.append(_confirm(
        "I confirm I am in a 'Fit and Proper' state and Compliant with all "
        "Paneltec Policies prior to entering the truck."
    ))
    f.extend(_fault_block("truck"))
    return f


# ────────────────────────────────────────────────────────────────────────
# Template 3 — Weekly Pre-Start (Civil Utility)
# ────────────────────────────────────────────────────────────────────────
WEEKLY_INSPECTION = [
    "Glass & Lenses — Windscreen, mirrors & light covers",
    "Tyres — Tread, walls & air pressure",
    "Panels & Guards — All truck panels, rotating equipment guards and pumps",
    "Signs, Tools & Equipment — Speed signs, shovel, crowbar, broom & all necessary keys & tools",
    "Fire Extinguisher, Spill Kit & First Aid Kit — In date, on board, complete & accessible",
    "Under Bonnet Inspection — No signs of hose wear or oil/fluid leaks under the cab (weekly detailed check)",
    "Seat Belts — Buckles, webbing, latch plate, retractor & pillar loop",
    "Globes & Alarms — Indicators, headlights, brake / reverse / work / flashing lights & reverse alarms",
    "Dashboard — Service KM/hrs, dashboard lights, no warning lights",
    "Cleanliness of Cab — Previous operator left cab free of rubbish",
]


def weekly_fields() -> list[dict]:
    f = _standard_header()
    for lbl in WEEKLY_INSPECTION:
        f.append(_radio_pfn(lbl))
    f.append({"id": _new_id(), "label": "Odometer (km)", "type": "number",
              "required": True, "options": [], "placeholder": "e.g. 128340", "config": {}})
    f.append(_confirm(
        "I confirm I am in a 'Fit and Proper' state and Compliant with all "
        "Paneltec Policies prior to entering the vehicle."
    ))
    f.extend(_fault_block("vehicle"))
    return f


# ────────────────────────────────────────────────────────────────────────
# Template 4 — Tip Truck Daily Pre-Start
# ────────────────────────────────────────────────────────────────────────
TIP_TRUCK_INSPECTION = [
    "Glass & Lenses — Windscreen, mirrors & light covers",
    "Tyres — Tread, walls & air pressure",
    "Panels & Guards — All truck panels, bumper bar, tray & tipping mechanism",
    "Signs, Tools & Equipment — Speed signs, traffic cones, chocks, shovel, load securing devices",
    "Fire Extinguisher, Spill Kit & First Aid Kit — In date, on board, complete & accessible",
    "Air Tanks & All Fluids — Air tanks drained & correct levels of fuel, oil, coolant/water",
    "Under Cab Inspection — No signs of hose wear or oil/fluid leaks",
    "Seat Belts — Buckles, webbing, latch plate, retractor & pillar loop",
    "Globes & Alarms — Indicators, headlights, brake / reverse / work lights, reverse alarms, door open alarms, hand brake alarms",
    "Dashboard — Service KM/hrs, dashboard lights, no warning lights",
    "Cleanliness of Cab — Previous operator left cab free of rubbish",
]


def tip_truck_fields() -> list[dict]:
    f = _standard_header()
    for lbl in TIP_TRUCK_INSPECTION:
        f.append(_radio_pfn(lbl))
    f.append({"id": _new_id(), "label": "Odometer (km)", "type": "number",
              "required": True, "options": [], "placeholder": "e.g. 82500", "config": {}})
    f.append(_confirm(
        "I confirm I am in a 'Fit and Proper' state and Compliant with all "
        "Paneltec Policies prior to entering the truck."
    ))
    f.extend(_fault_block("truck"))
    return f


# ────────────────────────────────────────────────────────────────────────
# Template 5 — Construction & Excavation SSRA
# ────────────────────────────────────────────────────────────────────────
# Compressed to fit the existing platform capabilities. Limitations
# flagged in the ship report:
#   • No multi-select field type → PPE + control measures rendered as
#     one-radio-per-option (each Yes/No/N-A). Full multi-select is a
#     platform-level feature request.
#   • No conditional-visibility renderer → follow-up fields are labelled
#     "(fill in if Yes above)" so the operator still knows what to do.
#   • No `swms_catalogue` collection yet → SWMS list embedded as a
#     textarea helper. First-class catalogue is a future cycle.
#   • No repeatable signature blocks → 3 fixed signature slots (worker
#     picker + signature). Extend by editing the template later.

SSRA_TAILGATE = [
    "Discuss scope of works",
    "Discuss placement of vehicles and plant",
    "Discuss proposed movement of vehicles and plant",
    "Discuss proposed lunch break time / potential for site closure / relief of Traffic Controllers",
    "Designate two-way radio channel",
    "Review BYDA enquiry with excavation team and spotter",
    "Identify No-Go Areas / Hazardous Areas",
    "Confirm no one is exceeding 14hr in a 24hr period",
]

SSRA_RISK_Q = [
    "Have all vehicles and equipment been parked to reduce likelihood of incidents/injuries?",
    "Have all slips/trips/falls been identified, made safe, and communicated?",
    "Have all other trades/traffic controllers on site been informed of scope & plant movement?",
    "Has an assessment been made for potential falling objects?",
    "Has an assessment been made for workers/pedestrians being hit by moving plant?",
    "Has the risk of injury from open trenches/excavations been assessed?",
    "Has an overhead electrical wire assessment been conducted? (3m clearance from HV per WHS Proc 17)",
]

SSRA_PPE = [
    "Hard Hat",
    "Safety Glasses",
    "Steel Toed Safety Boots",
    "Highly Visible Clothing with Retro-Reflective Striping",
    "Construction Gloves on or Clipped",
]

SSRA_EXCAVATION_CONTROLS = [
    "Short-term pothole cones (<600mm depth)",
    "Tiger-tailed sticks (>600mm depth)",
    "Manhole guards",
    "Mesh fencing",
    "Temporary fencing",
]

SSRA_OVERHEAD_CONTROLS = [
    "Cover boards", "Spotter", "Physical exclusion zone",
    "De-energised", "Other",
]

SWMS_CATALOGUE_HELPER = (
    "Tick applicable SWMS in the field below (comma-separated slugs). Common: "
    "skidsteer_safe_op, general_excavation_trenching, traffic_management, "
    "working_at_heights, vacuum_truck, mobile_plant, chainsaw, "
    "confined_space_entry, hot_work, manual_handling, ppe_use, "
    "electrical_safety, working_near_water, lifting_operations."
)


def ssra_fields() -> list[dict]:
    f = _standard_header(vehicle_required=False)

    # B. Site details
    f.append({"id": _new_id(), "label": "Site Address (nearest house number if in Road Reserve, include town if outside Launceston)",
              "type": "text", "required": True, "options": [], "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "Site Start Time", "type": "time",
              "required": True, "options": [], "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "Customer / Asset Owner (PCBU)",
              "type": "text", "required": True, "options": [],
              "placeholder": "e.g. TasWater", "config": {}})
    f.append({"id": _new_id(), "label": "Worksite Diary Number",
              "type": "text", "required": False, "options": [], "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "Rest of Civil Team on site",
              "type": "worker_picker", "required": False, "options": [], "placeholder": "",
              "config": {"inline_company_toggle": True,
                         "company_options": COMPANY_OPTIONS, "multi": True}})
    f.append({"id": _new_id(), "label": "Work Description",
              "type": "select", "required": True,
              "options": ["Vacuum Excavation Only", "Construction", "Trenching",
                          "Directional Drilling", "Other"],
              "placeholder": "", "config": {}})

    # C. Tailgate meeting
    for item in SSRA_TAILGATE:
        f.append(_confirm(f"TAILGATE — {item}"))
    f.append({"id": _new_id(), "label": "Emergency Assembly Point (100m upwind of site)",
              "type": "text", "required": True, "options": [], "placeholder": "", "config": {}})

    # D. Document check
    f.append({"id": _new_id(),
              "label": "BYDA Enquiry Number (must be within last 28 days)",
              "type": "text", "required": True, "options": [],
              "placeholder": "Write N/A if excavation is not taking place",
              "config": {}})
    tgs_gate = _new_id()
    f.append({"id": tgs_gate, "label": "Traffic Guidance Scheme (TGS) in use",
              "type": "select", "required": True,
              "options": ["Customer is Supplying Traffic Control",
                          "TGS# (enter below)", "N/A"],
              "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "TGS Number (fill in if 'TGS# (enter below)' above)",
              "type": "text", "required": False, "options": [], "placeholder": "",
              "config": {"dependsOn": tgs_gate}})

    # E. Applicable SWMS — compressed to textarea helper (multi-select field
    # type not available on the platform yet).
    f.append({"id": _new_id(), "label": "Applicable SWMS (comma-separated slugs)",
              "type": "textarea", "required": True, "options": [],
              "placeholder": SWMS_CATALOGUE_HELPER, "config": {}})

    # F. Risk assessment
    for q in SSRA_RISK_Q:
        f.append(_radio_yn(q))
    # Excavation controls (multi-radio one-per-option — platform lacks multi-check)
    for c in SSRA_EXCAVATION_CONTROLS:
        f.append({"id": _new_id(),
                  "label": f"Excavation control — {c} (used?)",
                  "type": "radio", "required": False,
                  "options": ["Used", "Not used", "N/A"],
                  "placeholder": "", "config": {}})
    for c in SSRA_OVERHEAD_CONTROLS:
        f.append({"id": _new_id(),
                  "label": f"Overhead wire control — {c} (used?)",
                  "type": "radio", "required": False,
                  "options": ["Used", "Not used", "N/A"],
                  "placeholder": "", "config": {}})
    f.append({"id": _new_id(),
              "label": "Closest TasNetworks Pole Number (for emergency reference)",
              "type": "text", "required": False, "options": [], "placeholder": "", "config": {}})
    f.append({"id": _new_id(),
              "label": "Detail rectification of hazards or control measures introduced",
              "type": "textarea", "required": False, "options": [],
              "placeholder": "Include photos below.", "config": {}})
    f.append({"id": _new_id(), "label": "Hazard rectification photos",
              "type": "photo", "required": False, "options": [], "placeholder": "",
              "config": {"multi": True}})

    # G. PPE
    for ppe in SSRA_PPE:
        f.append(_confirm(f"PPE — {ppe}"))

    # H. Site photos
    for lbl in [
        "Photo of site entry (First 40km/Worker sign, showing plant/equipment behind it)",
        "Photo of excavation/project area (jetting signs, spray shields, control measures in place)",
        "Photo of second site entry (Last 40km/Worker sign, showing plant/equipment behind it)",
    ]:
        f.append({"id": _new_id(), "label": lbl, "type": "photo",
                  "required": True, "options": [], "placeholder": "",
                  "config": {"multi": True}})

    # I. Declarations & signatures
    f.append(_confirm(
        "I am aware Emergency Procedures are located in Lucidity Management System — WHS-05"
    ))
    f.append({"id": _new_id(), "label": "SSRA Author signature", "type": "signature",
              "required": True, "options": [], "placeholder": "", "config": {}})
    # 3 fixed worker sign-on slots (platform lacks repeatable field groups)
    for i in range(1, 4):
        f.append({"id": _new_id(),
                  "label": f"Employee {i} on site — Name (optional)",
                  "type": "worker_picker", "required": False, "options": [], "placeholder": "",
                  "config": {"inline_company_toggle": True,
                             "company_options": COMPANY_OPTIONS}})
        f.append({"id": _new_id(),
                  "label": f"Employee {i} signature (optional)",
                  "type": "signature", "required": False, "options": [], "placeholder": "",
                  "config": {}})

    # J. Final
    f.append(_confirm("SSRA Complete"))
    return f


# ────────────────────────────────────────────────────────────────────────
# Registry + seeding logic
# ────────────────────────────────────────────────────────────────────────
TEMPLATES = [
    {
        "name": "CVT Daily Pre-Start",
        "category": "pre_start",
        "description": (
            "Combination Vacuum Truck daily pre-start — Pass / Fail / N/A "
            "checks including jetting system, hose, SWT and vacuum system, "
            "PTO hours, driver fit-for-work declaration and fault reporting."
        ),
        "fields_fn": cvt_fields,
        "source_slug": "seed_v160_3_0_adjust_9_cvt",
    },
    {
        "name": "Weekly Pre-Start",
        "category": "pre_start",
        # Routing note: `weekly_pre_start` is not an existing platform
        # category. Using `pre_start` so the record shows on the existing
        # Daily Pre-Starts capture tab. Rename when a dedicated weekly
        # bucket ships.
        "description": (
            "Weekly civil utility pre-start — deeper 10-item Pass / Fail / "
            "N/A inspection covering under-bonnet checks, plus odometer, "
            "driver declaration and fault reporting."
        ),
        "fields_fn": weekly_fields,
        "source_slug": "seed_v160_3_0_adjust_9_weekly",
    },
    {
        "name": "Tip Truck Daily Pre-Start",
        "category": "pre_start",
        "description": (
            "Tip truck daily pre-start — Pass / Fail / N/A checks including "
            "panels & guards, air tanks, load securing devices, plus "
            "odometer, driver declaration and fault reporting."
        ),
        "fields_fn": tip_truck_fields,
        "source_slug": "seed_v160_3_0_adjust_9_tip_truck",
    },
    {
        "name": "Construction & Excavation SSRA",
        "category": "inspection",
        # Routing note: `ssra` is not an existing platform category.
        # Using `inspection` so the record surfaces on the Inspection
        # Reports capture tab. Rename when a dedicated Site Assessments
        # bucket ships.
        "description": (
            "Site Specific Risk Assessment for construction & excavation "
            "works — site details, tailgate meeting, BYDA / TGS document "
            "check, SWMS coverage, risk assessment (7 areas), PPE "
            "confirmation, site photos, sign-on. "
            "Ref cover flow-chart: https://static.prod-images.emergentagent.com"
            "/jobs/0c9906de-6ffd-455a-a70f-30deae4985ea/images/"
            "aa34d7185d5bf59962d33901fc390c7738161c5f66ffaca1eb4372d00f883f7b.png"
        ),
        "fields_fn": ssra_fields,
        "source_slug": "seed_v160_3_0_adjust_9_ssra",
    },
]


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


async def seed_template(db, org_id: str, tpl_spec: dict) -> dict:
    name = tpl_spec["name"]
    existing = await db.form_templates.find_one(
        {"org_id": org_id, "deleted_at": None,
         "name": {"$regex": f"^{name}$", "$options": "i"}},
        {"_id": 0, "id": 1, "name": 1},
    )
    if existing:
        granted = await _grant_role_allowlist(db, org_id, existing["id"])
        return {"name": name, "status": "skipped_exists",
                "existing_id": existing["id"], "allowlist_granted": granted}

    doc = {
        "id": _new_id(),
        "org_id": org_id,
        "name": name,
        "category": tpl_spec["category"],
        "description": tpl_spec["description"],
        "fields": tpl_spec["fields_fn"](),
        "required_certifications": [],
        "applies_to": {"kinds": ["any"], "asset_types": [],
                       "worker_ids": [], "roles": [], "companies": []},
        "source": tpl_spec["source_slug"],
        "imported_at": None,
        "created_by": "system:seed_adjust_9_batch",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "deleted_at": None,
    }
    await db.form_templates.insert_one(doc)
    granted = await _grant_role_allowlist(db, org_id, doc["id"])
    return {"name": name, "status": "inserted",
            "template_id": doc["id"], "field_count": len(doc["fields"]),
            "allowlist_granted": granted}


async def main() -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL / DB_NAME not set", file=sys.stderr)
        return 2
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    orgs: list[str] = []
    async for o in db.organisations.find({}, {"_id": 0, "id": 1}):
        orgs.append(o["id"])
    if not orgs:
        seen: set[str] = set()
        async for u in db.users.find({}, {"_id": 0, "org_id": 1}):
            oid = u.get("org_id")
            if oid and oid not in seen:
                seen.add(oid)
                orgs.append(oid)

    print(f"Seeding {len(TEMPLATES)} templates across {len(orgs)} orgs …")
    totals = {"inserted": 0, "skipped_exists": 0}
    for oid in orgs:
        for tpl in TEMPLATES:
            r = await seed_template(db, oid, tpl)
            totals[r["status"]] = totals.get(r["status"], 0) + 1
            marker = "+" if r["status"] == "inserted" else "="
            print(f" {marker} [{oid[:8]}…] {tpl['name']:<35} {r}")
    print(f"\nSUMMARY: {totals}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
