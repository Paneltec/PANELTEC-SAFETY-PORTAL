#!/usr/bin/env python3
"""
v160.3.0-adjust-8 — Seed the "Daily Pre-Start" form template.

Idempotent, per-org, keyed on the (org_id, lowercased name) tuple.
Skips any org that already has a template named "Daily Pre-Start"
(case-insensitive).

The template mirrors the Viatec Traffic Utility Daily Pre-Start PDF
provided by the user, normalised to the Paneltec platform patterns:
  • Standard Header (date, worker_picker, gps, vehicle_navixy)
  • 10 Pass / Fail / N/A inspection radios (guidance embedded in labels)
  • Driver declaration checkbox (radio Yes/No, required Yes)
  • Odometer numeric input
  • Fault / Hazard reporting block (Yes/No + textarea + multi-photo)
  • Pre-Start complete confirmation

No cert gate — the user explicitly opted out of gating this form.

Run:
    cd /app && set -a && source backend/.env && set +a && \
        python3 backend/scripts/seed_daily_prestart_utility.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


TEMPLATE_NAME = "Daily Pre-Start"
TEMPLATE_CATEGORY = "pre_start"
TEMPLATE_DESCRIPTION = (
    "Daily pre-start inspection for utility vehicles — Pass / Fail / N/A "
    "checks across glass, tyres, panels, tools, safety kit, under-bonnet, "
    "seat belts, lights & alarms, dashboard and cab cleanliness. Includes "
    "driver fit-for-work declaration, odometer capture and fault / hazard "
    "reporting."
)

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
        "id": _new_id(),
        "label": label,
        "type": "radio",
        "required": required,
        "options": ["Pass", "Fail", "N/A"],
        "placeholder": "",
        "config": {},
    }


# NOTE: Guidance text is baked INTO the label (e.g. "Tyres — Tread & Pressure")
# because the mobile form renderer does not surface per-field helper text
# outside of `placeholder`, and `placeholder` is only rendered on text inputs.
# This matches the pattern used by the pre-existing Vehicle Pre-Use Inspection
# and Plant Pre-Start templates.
INSPECTION_ITEMS = [
    "Glass & Lenses — Windscreen, mirrors & light covers",
    "Tyres — Tread, sidewalls & air pressure",
    "Vehicle Panels, Bumper & Tray — Panels, bumper bar & tray free from damage",
    "Signs, Tools & Equipment — Speed signs, bollards, cones, weights, SSBs, all traffic control devices",
    "Fire Extinguisher & First Aid Kit — In date, on board, complete & accessible",
    "Under Bonnet Inspection — No hose wear, no oil / fluid leaks under the cab",
    "Seat Belts — Buckles, webbing, latch plate, retractor & pillar loop",
    "Globes & Alarms — Indicators, arrow boards, headlights, brake / reverse / work / flashing lights & reverse alarms",
    "Dashboard — Service KM/hrs, dashboard lights, no warning lights",
    "Cleanliness of Cab — Previous operator left cab free of rubbish",
]


def build_template_fields() -> list[dict]:
    """Construct the full field list in display order."""
    fields: list[dict] = []

    # ── 1. Standard Header ──
    fields.append({
        "id": _new_id(), "label": "Date", "type": "date",
        "required": True, "options": [], "placeholder": "",
        "config": {"default_today": True},
    })
    fields.append({
        "id": _new_id(), "label": "Operator (Name)", "type": "worker_picker",
        "required": True, "options": [], "placeholder": "",
        "config": {
            "inline_company_toggle": True,
            "company_options": COMPANY_OPTIONS,
        },
    })
    fields.append({
        "id": _new_id(), "label": "Location", "type": "gps",
        "required": True, "options": [], "placeholder": "",
        "config": {"reverse_geocode": True},
    })
    fields.append({
        "id": _new_id(), "label": "Select Vehicle", "type": "vehicle_navixy",
        "required": True, "options": [], "placeholder": "",
        "config": {},
    })

    # ── 2. Vehicle inspection (10 × Pass/Fail/N-A) ──
    for label in INSPECTION_ITEMS:
        fields.append(_radio_pfn(label, required=True))

    # ── 3. Driver declaration ──
    # No first-class "checkbox" field type. Use a required radio with a
    # single option so the operator has to positively acknowledge.
    fields.append({
        "id": _new_id(),
        "label": (
            "I confirm I am in a 'Fit and Proper' state and Compliant with "
            "all Paneltec Policies prior to entering the vehicle."
        ),
        "type": "radio",
        "required": True,
        "options": ["I confirm"],
        "placeholder": "",
        "config": {},
    })

    # ── 4. Odometer ──
    fields.append({
        "id": _new_id(),
        "label": "Odometer reading (km)",
        "type": "number",
        "required": True,
        "options": [],
        "placeholder": "e.g. 128340",
        "config": {},
    })

    # ── 5. Fault / Hazard block ──
    # Gate question. Warning text is prepended to the label so the operator
    # cannot miss it (helper text isn't rendered by the mobile form
    # renderer).
    fault_gate_id = _new_id()
    fields.append({
        "id": fault_gate_id,
        "label": (
            "Fault / Hazard — Are you submitting a Service Request or Fault "
            "Notification today? "
            "(If the fault constitutes an immediate safety hazard the plant "
            "must be removed from service and tagged out. Contact your "
            "immediate supervisor. The plant must not be used until the "
            "fault has been rectified and clearance is given.)"
        ),
        "type": "radio",
        "required": True,
        "options": ["Yes", "No"],
        "placeholder": "",
        "config": {},
    })
    fields.append({
        "id": _new_id(),
        "label": "Details of fault / hazard (fill in if Yes above)",
        "type": "textarea",
        "required": False,
        "options": [],
        "placeholder": "Describe the fault or hazard, including any tag-out actions taken.",
        # `dependsOn` recorded for forward-compat with a future
        # conditional-visibility renderer. Ignored today.
        "config": {"dependsOn": fault_gate_id},
    })
    fields.append({
        "id": _new_id(),
        "label": "Photos of defect / service sticker / odometer (fill in if Yes above)",
        "type": "photo",
        "required": False,
        "options": [],
        "placeholder": "",
        "config": {"multi": True, "dependsOn": fault_gate_id},
    })

    # ── 6. Final confirmation ──
    fields.append({
        "id": _new_id(),
        "label": "Pre-Start complete",
        "type": "radio",
        "required": True,
        "options": ["I confirm"],
        "placeholder": "",
        "config": {},
    })

    return fields


async def _grant_role_allowlist(db, org_id: str, template_id: str) -> list[str]:
    """Ensure `template_id` is in `role_form_allowlist[<role>]` for every
    non-admin role that already has an allowlist entry.

    `admin` bypasses the allowlist entirely, so touching that row would
    be misleading. Roles without an allowlist entry already see every
    template (missing entry = all-enabled), so we skip them too.
    """
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
    """Insert the Daily Pre-Start template for `org_id` if not present.
    Returns an outcome dict."""
    existing = await db.form_templates.find_one(
        {
            "org_id": org_id,
            "deleted_at": None,
            "name": {"$regex": f"^{TEMPLATE_NAME}$", "$options": "i"},
        },
        {"_id": 0, "id": 1, "name": 1},
    )
    if existing:
        # Idempotent path — always ensure the allowlist wiring is in place
        # even if the template row itself already existed from a prior run.
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
        # v160.3.0 — Ungated. User confirmed no cert requirements.
        "required_certifications": [],
        # v160.3.0-adjust-8 — Universal audience (`kinds: ["any"]`) so
        # every worker in the org sees this template in the mobile
        # Forms Library. Admins can narrow later via
        # /app/settings/form-assignments if a specific crew should own it.
        "applies_to": {
            "kinds": ["any"],
            "asset_types": [],
            "worker_ids": [],
            "roles": [],
            "companies": [],
        },
        "source": "seed_v160_3_0_adjust_8",
        "imported_at": None,
        "created_by": "system:seed_daily_prestart_utility",
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


async def backfill_applies_to(db) -> int:
    """One-off backfill for templates inserted by an earlier run of this
    script that predates the `applies_to: {kinds: ["any"]}` default.
    Idempotent: only touches rows that (a) came from this seed and (b)
    are missing `applies_to.kinds` — never overwrites an existing rule."""
    default = {
        "kinds": ["any"], "asset_types": [], "worker_ids": [],
        "roles": [], "companies": [],
    }
    q = {
        "source": "seed_v160_3_0_adjust_8",
        "$or": [
            {"applies_to": {"$exists": False}},
            {"applies_to": None},
            {"applies_to.kinds": {"$exists": False}},
            {"applies_to.kinds": []},
        ],
    }
    res = await db.form_templates.update_many(q, {"$set": {"applies_to": default}})
    return res.modified_count



async def main() -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL / DB_NAME not set in env", file=sys.stderr)
        return 2

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Discover every org. Fall back to a distinct scan on `users.org_id`
    # if the `organisations` collection isn't present.
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
    inserted = 0
    skipped = 0
    for o in orgs:
        result = await seed_for_org(db, o["id"], o["name"])
        marker = "+" if result["status"] == "inserted" else "="
        print(f" {marker} [{o['name']}] {result}")
        if result["status"] == "inserted":
            inserted += 1
        else:
            skipped += 1

    print(f"\nSUMMARY: inserted={inserted} skipped_exists={skipped} total_orgs={len(orgs)}")

    backfilled = await backfill_applies_to(db)
    print(f"BACKFILL applies_to on prior-seed rows: modified={backfilled}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
