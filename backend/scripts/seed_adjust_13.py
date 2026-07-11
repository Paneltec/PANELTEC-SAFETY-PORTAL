#!/usr/bin/env python3
"""
v160.3.0-adjust-13 — Two data tasks:

  Task A: Recategorize existing Paneltec templates.
    - Construction & Excavation SSRA        → category: hazard
    - VTS Tight Site Audit                  → category: site_diary
    - TTM Risk Assessment & Treatment       → category: risk_assessment

  Task B: Seed 2 new Paneltec templates (idempotent, per-org, name-keyed):
    - Vacuum Truck (VT) Daily Pre-Start     → category: pre_start
    - Viatec Traffic Solutions SSRA         → category: hazard
      (per user's SSRA routing rule — SSRA lives in the Hazard Reports bucket)

Both new templates use `source: "paneltec"` so the orange Paneltec
maker's-mark pill renders automatically on the Forms tab (adjust-10).

Run:
    cd /app && set -a && source backend/.env && set +a && \
        python3 backend/scripts/seed_adjust_13.py
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


def _now_iso() -> str: return datetime.now(timezone.utc).isoformat()
def _new_id() -> str: return str(uuid.uuid4())


def _radio_pfn(label, required=True):
    return {"id": _new_id(), "label": label, "type": "radio",
            "required": required, "options": ["Pass", "Fail", "N/A"],
            "placeholder": "", "config": {}}


def _radio_yn(label, required=True):
    return {"id": _new_id(), "label": label, "type": "radio",
            "required": required, "options": ["Yes", "No"],
            "placeholder": "", "config": {}}


def _confirm(label):
    return {"id": _new_id(), "label": label, "type": "radio",
            "required": True, "options": ["I confirm"],
            "placeholder": "", "config": {}}


def _standard_header(vehicle_required=True):
    return [
        {"id": _new_id(), "label": "Date", "type": "date",
         "required": True, "options": [], "placeholder": "",
         "config": {"default_today": True}},
        {"id": _new_id(), "label": "Operator (Name)", "type": "worker_picker",
         "required": True, "options": [], "placeholder": "",
         "config": {"inline_company_toggle": True,
                    "company_options": COMPANY_OPTIONS}},
        {"id": _new_id(), "label": "Location", "type": "gps",
         "required": True, "options": [], "placeholder": "",
         "config": {"reverse_geocode": True}},
        {"id": _new_id(), "label": "Select Vehicle", "type": "vehicle_navixy",
         "required": vehicle_required, "options": [], "placeholder": "",
         "config": {}},
    ]


def _fault_block(vehicle_word="truck"):
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
         "placeholder": "", "config": {"dependsOn": gate_id}},
        {"id": _new_id(),
         "label": "Photos of defect / service sticker / odometer (fill in if Yes above)",
         "type": "photo", "required": False, "options": [], "placeholder": "",
         "config": {"multi": True, "dependsOn": gate_id}},
        {"id": _new_id(), "label": "Pre-Start complete",
         "type": "radio", "required": True, "options": ["I confirm"],
         "placeholder": "", "config": {}},
    ]


# ────────────────────────────────────────────────────────────────────
# B1: Vacuum Truck (VT) Daily Pre-Start
# ────────────────────────────────────────────────────────────────────
# Extracted from record #28221 (page-1 + page-2 inspection list).
#
# Diff vs CVT Daily Pre-Start (adjust-9, id d9008c00-…):
#   • VT has "High Pressure Whip Hose"  (CVT: "High Pressure Jetting Hose")
#   • VT has "Type A Jetting System"    (CVT: generic "Jetting System")
#   • VT drops "SWT Level" (CVT-only — Seal Water Tank is CVT plumbing)
#   • VT keeps: Vacuum System (positioned before odometer/hour meter,
#     per the source PDF's ordering)
#   • VT keeps PTO / hour meter alongside odometer (same as CVT)
#   • Everything else identical to the CVT template.

VT_INSPECTION = [
    "Glass & Lenses — Windscreen, mirrors & light covers",
    "Tyres — Tread, walls & air pressure",
    "Panels & Guards — All truck panels, rotating equipment guards and pumps",
    "Signs, Tools & Equipment — Lances, jetting signs, speed signs, spray shields, shovel, crowbar, broom & jetting attachments",
    "Type A Jetting System — Free of leaks and defects",
    "High Pressure Whip Hose — Visual check for signs of potential failure",
    "Fire Extinguisher, Spill Kit & First Aid Kit — In date, on board, complete & accessible",
    "Air Tanks & All Fluids — Air tanks drained & correct levels of fuel, oil, coolant/water",
    "Under Cab Inspection — No signs of hose wear or oil/fluid leaks",
    "Seat Belts — Buckles, webbing, latch plate, retractor, pillar loop",
    "Globes & Alarms — Indicators, headlights, brake / reverse / work lights, reverse alarms, door open alarms, hand brake alarms",
    "Dashboard — Service KM/hrs, dashboard lights, no warning lights",
    "Cleanliness of Cab — Previous operator left cab free of rubbish",
    "Vacuum System — Leaks or misaligned components",
]


def vt_fields():
    f = _standard_header()
    for lbl in VT_INSPECTION:
        f.append(_radio_pfn(lbl))
    f.append({"id": _new_id(), "label": "Odometer (km)", "type": "number",
              "required": True, "options": [], "placeholder": "e.g. 158420", "config": {}})
    f.append({"id": _new_id(), "label": "Hour Meter (PTO Engagement Hours)",
              "type": "number", "required": True, "options": [],
              "placeholder": "e.g. 2340", "config": {}})
    f.append(_confirm(
        "I confirm I am in a 'Fit and Proper' state and Compliant with all "
        "Paneltec Policies prior to entering the truck."
    ))
    f.extend(_fault_block("truck"))
    return f


# ────────────────────────────────────────────────────────────────────
# B2: Viatec Traffic Solutions SSRA
# ────────────────────────────────────────────────────────────────────
# Extracted from record #28222.
#
# Diff vs Construction & Excavation SSRA (adjust-9, id dc28f66a-…):
#   • VTS is traffic-management-focused (not excavation).
#   • Adds site contact name/phone, VTS-team roster, ute rego list.
#   • TGS type selector (A/B/C) with plan-number capture.
#   • Drops BYDA number, trench-guard multi-choices, tiger-tailed sticks.
#   • Risk questions rewritten for road-user + moving-plant emphasis.
#   • Uses the same 8-item Tailgate meeting + PPE checklist + signatures.

VTS_TAILGATE = [
    "Discuss The Scope of Works",
    "Discuss The Placement of Vehicles and Plant",
    "Discuss The Proposed Movement of Vehicles and Plant",
    "Discuss Proposed Lunch Break Time & Potential for Site Closure or Relief of Traffic Controllers",
    "Designate Two Way Radio Channel",
    "Identify any No Go Areas or Hazardous Areas",
    "Confirm no one is exceeding 14hr in a 24hr period",
]

VTS_RISK_Q = [
    "Have all vehicles and equipment been parked on site in an area that will reduce the likelihood of incidents/injuries?",
    "Have all potential slips/trips/falls been identified, made safe and communicated?",
    "Have all other trades/civil teams on site been communicated with regarding the scope of works?",
    "Has an assessment been made for potential falling objects on site?",
    "Has an assessment been made for workers or pedestrians being hit by moving plant or vehicles in your allocated work zone?",
    "Has the risk of injury been assessed from any impaling hazards present in your work area?",
    "Has an overhead electrical wire assessment been conducted? (3m clearance from HV per WHS Proc 17)",
]

VTS_PPE = [
    "Hard Hat", "Safety Glasses", "Steel Toed Safety Boots",
    "Highly Visible Clothing with Retro-Reflective Striping",
    "Construction Gloves on or Clipped",
]

VTS_SWMS_HINT = (
    "Common: SWMS-24 Manual Handling, SWMS-48 Traffic Management, "
    "SWMS-14 Working near Traffic, SWMS-11 Signage Deployment. "
    "Enter comma-separated SWMS codes onsite."
)


def vts_ssra_fields():
    f = _standard_header(vehicle_required=False)

    # Site details
    f.append({"id": _new_id(), "label": "Site Address",
              "type": "text", "required": True, "options": [],
              "placeholder": "Nearest house number, road reserve, town if outside Launceston",
              "config": {}})
    f.append({"id": _new_id(), "label": "Customer (PCBU)",
              "type": "text", "required": True, "options": [],
              "placeholder": "e.g. TasWater, Council, Contractor",
              "config": {}})
    f.append({"id": _new_id(), "label": "Customer name if 'Other'",
              "type": "text", "required": False, "options": [],
              "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "Site Contact Name",
              "type": "text", "required": True, "options": [],
              "placeholder": "Do NOT enter N/A", "config": {}})
    f.append({"id": _new_id(), "label": "Site Contact Phone Number",
              "type": "text", "required": True, "options": [],
              "placeholder": "Do NOT enter N/A", "config": {}})
    f.append({"id": _new_id(),
              "label": "Rest of Traffic Management Team on site",
              "type": "worker_picker", "required": False, "options": [],
              "placeholder": "",
              "config": {"inline_company_toggle": True,
                         "company_options": COMPANY_OPTIONS, "multi": True}})
    f.append({"id": _new_id(),
              "label": "Registration numbers of all Traffic Utes on site",
              "type": "textarea", "required": True, "options": [],
              "placeholder": "One rego per line", "config": {}})
    f.append({"id": _new_id(),
              "label": "Worksite Diary Number (sent to Customer)",
              "type": "text", "required": True, "options": [],
              "placeholder": "", "config": {}})

    # Tailgate meeting
    for item in VTS_TAILGATE:
        f.append(_confirm(f"TAILGATE — {item}"))
    f.append({"id": _new_id(),
              "label": "Emergency Assembly Point (100m upwind of site)",
              "type": "text", "required": True, "options": [],
              "placeholder": "e.g. Letterbox 42 Elizabeth St", "config": {}})

    # Document check
    f.append({"id": _new_id(),
              "label": "Applicable SWMS onsite (comma-separated codes)",
              "type": "textarea", "required": True, "options": [],
              "placeholder": VTS_SWMS_HINT, "config": {}})
    f.append({"id": _new_id(),
              "label": "Do any changes need to be made to the SWMS "
                       "due to variable / hazardous site conditions? "
                       "(N/A if none)",
              "type": "textarea", "required": False, "options": [],
              "placeholder": "", "config": {}})
    tgs_gate = _new_id()
    f.append({"id": tgs_gate, "label": "TGS Type in use",
              "type": "select", "required": True,
              "options": ["A — Site Specific TGS",
                          "B — Customer supplied TGS",
                          "C — Viatec Generic TGS"],
              "placeholder": "", "config": {}})
    f.append({"id": _new_id(),
              "label": "TGS / Plan Number (fill in if A or B above)",
              "type": "text", "required": False, "options": [],
              "placeholder": "e.g. TGS-1234", "config": {"dependsOn": tgs_gate}})
    f.append({"id": _new_id(),
              "label": "If Viatec Generic TGS, identify the scheme",
              "type": "text", "required": False, "options": [],
              "placeholder": "e.g. TGS # 1 - ST - R - 40 - 80KM/H",
              "config": {"dependsOn": tgs_gate}})
    f.append({"id": _new_id(),
              "label": "Photo of TGS plan / customer permit",
              "type": "photo", "required": False, "options": [], "placeholder": "",
              "config": {"multi": True}})
    f.append(_radio_yn(
        "Have all existing speed signs within the site been covered up "
        "with a traffic cone placed below them?"
    ))
    f.append(_radio_yn(
        "Have all Vehicle Daily Pre-Starts been completed for this crew?"
    ))

    # Risk assessment
    for q in VTS_RISK_Q:
        f.append(_radio_yn(q))
    f.append({"id": _new_id(),
              "label": "Detail rectification of hazards or control measures "
                       "introduced (optional)",
              "type": "textarea", "required": False, "options": [],
              "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "Hazard rectification photos",
              "type": "photo", "required": False, "options": [], "placeholder": "",
              "config": {"multi": True}})

    # PPE
    for ppe in VTS_PPE:
        f.append(_confirm(f"PPE — {ppe}"))

    # Site photos
    for lbl in [
        "Photo of site entry (First 40km/Worker sign, showing plant/equipment behind it)",
        "Photo of work zone (cones, extendable barriers, signage in place)",
        "Photo of second site entry (Last 40km/Worker sign)",
    ]:
        f.append({"id": _new_id(), "label": lbl, "type": "photo",
                  "required": True, "options": [], "placeholder": "",
                  "config": {"multi": True}})

    # Declaration & signature
    f.append(_confirm(
        "I am aware Emergency Procedures are located in Lucidity Management "
        "System — WHS-05"
    ))
    f.append({"id": _new_id(), "label": "SSRA Author signature",
              "type": "signature", "required": True, "options": [],
              "placeholder": "", "config": {}})
    for i in range(1, 4):
        f.append({"id": _new_id(),
                  "label": f"Employee {i} on site — Name (optional)",
                  "type": "worker_picker", "required": False, "options": [],
                  "placeholder": "",
                  "config": {"inline_company_toggle": True,
                             "company_options": COMPANY_OPTIONS}})
        f.append({"id": _new_id(),
                  "label": f"Employee {i} signature (optional)",
                  "type": "signature", "required": False, "options": [],
                  "placeholder": "", "config": {}})

    f.append(_confirm("SSRA Complete"))
    return f


NEW_TEMPLATES = [
    {
        "name": "Vacuum Truck (VT) Daily Pre-Start",
        "category": "pre_start",
        "description": (
            "Plain vacuum-truck (VT) daily pre-start — Pass / Fail / N/A "
            "checks including Type A jetting system, whip hose, vacuum "
            "system, odometer, hour meter (PTO), driver fit-for-work "
            "declaration and fault reporting."
        ),
        "fields_fn": vt_fields,
    },
    {
        "name": "Viatec Traffic Solutions SSRA",
        "category": "hazard",
        "description": (
            "Viatec Traffic Solutions Site Specific Risk Assessment — "
            "traffic-management focused SSRA covering site contact, VTS "
            "team roster, ute registrations, SWMS coverage, TGS type "
            "(A/B/C) with plan-number capture, road-user + moving-plant "
            "risk questions, PPE confirmation, site photos and sign-on."
        ),
        "fields_fn": vts_ssra_fields,
    },
]


# ────────────────────────────────────────────────────────────────────
# Task A: recategorize existing Paneltec templates
# ────────────────────────────────────────────────────────────────────
RECATEGORIZE = [
    # (name pattern (regex-safe exact), new_category)
    ("Construction & Excavation SSRA",             "hazard"),
    ("VTS Tight Site Audit",                       "site_diary"),
    ("TTM Risk Assessment & Treatment Register",   "risk_assessment"),
]


async def _grant_role_allowlist(db, org_id, template_id) -> list[str]:
    org = await db.orgs.find_one({"id": org_id}, {"_id": 0, "role_form_allowlist": 1}) or {}
    matrix = org.get("role_form_allowlist") or {}
    updated = []
    for role, allowlist in matrix.items():
        if role == "admin" or not isinstance(allowlist, list):
            continue
        if template_id in allowlist:
            continue
        await db.orgs.update_one(
            {"id": org_id},
            {"$addToSet": {f"role_form_allowlist.{role}": template_id}},
        )
        updated.append(role)
    return updated


async def seed_template(db, org_id, spec):
    existing = await db.form_templates.find_one(
        {"org_id": org_id, "deleted_at": None,
         "name": {"$regex": f"^{spec['name']}$", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    if existing:
        granted = await _grant_role_allowlist(db, org_id, existing["id"])
        return {"name": spec["name"], "status": "skipped_exists",
                "id": existing["id"], "allowlist_granted": granted}

    doc = {
        "id": _new_id(),
        "org_id": org_id,
        "name": spec["name"],
        "category": spec["category"],
        "description": spec["description"],
        "fields": spec["fields_fn"](),
        "required_certifications": [],
        "applies_to": {"kinds": ["any"], "asset_types": [],
                       "worker_ids": [], "roles": [], "companies": []},
        "source": "paneltec",
        "imported_at": None,
        "created_by": "system:seed_adjust_13",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "deleted_at": None,
    }
    await db.form_templates.insert_one(doc)
    granted = await _grant_role_allowlist(db, org_id, doc["id"])
    return {"name": spec["name"], "status": "inserted",
            "id": doc["id"], "field_count": len(doc["fields"]),
            "allowlist_granted": granted}


async def recategorize(db) -> dict:
    """Update `category` on existing Paneltec templates (all orgs)."""
    per_template = {}
    for name, new_cat in RECATEGORIZE:
        r = await db.form_templates.update_many(
            {"source": "paneltec", "deleted_at": None,
             "name": {"$regex": f"^{name}$", "$options": "i"}},
            {"$set": {"category": new_cat, "updated_at": _now_iso()}},
        )
        per_template[name] = {"new_category": new_cat, "modified": r.modified_count}
    return per_template


async def main() -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL / DB_NAME not set", file=sys.stderr)
        return 2
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    print("── Task A: recategorize existing Paneltec templates ──")
    recat = await recategorize(db)
    for name, r in recat.items():
        print(f"  {name:44s} → category={r['new_category']:16s} (modified {r['modified']} rows)")

    orgs = []
    async for o in db.organisations.find({}, {"_id": 0, "id": 1}):
        orgs.append(o["id"])
    if not orgs:
        seen = set()
        async for u in db.users.find({}, {"_id": 0, "org_id": 1}):
            oid = u.get("org_id")
            if oid and oid not in seen:
                seen.add(oid); orgs.append(oid)

    print(f"\n── Task B: seed {len(NEW_TEMPLATES)} new templates across {len(orgs)} orgs ──")
    totals = {"inserted": 0, "skipped_exists": 0}
    ids_by_template = {t["name"]: [] for t in NEW_TEMPLATES}
    for oid in orgs:
        for spec in NEW_TEMPLATES:
            r = await seed_template(db, oid, spec)
            totals[r["status"]] = totals.get(r["status"], 0) + 1
            marker = "+" if r["status"] == "inserted" else "="
            print(f" {marker} [{oid[:8]}…] {spec['name']:<40} {r}")
            ids_by_template[spec["name"]].append({"org": oid[:8], "id": r["id"]})
    print(f"\nSUMMARY B: {totals}")
    print("\nInsertion IDs per template:")
    for name, ids in ids_by_template.items():
        print(f"  {name}:")
        for r in ids: print(f"    {r['org']}…  {r['id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
