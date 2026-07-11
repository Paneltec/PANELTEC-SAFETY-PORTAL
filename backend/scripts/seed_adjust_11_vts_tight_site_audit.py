#!/usr/bin/env python3
"""
v160.3.0-adjust-11 — Seed the "VTS Tight Site Audit" template.

Idempotent, per-org, name-keyed. Structural parity with the
Vehicle Pre-Use Inspection golden source. `source: "paneltec"` so the
orange PANELTEC pill renders automatically on the Forms tab.

Run:
    cd /app && set -a && source backend/.env && set +a && \
        python3 backend/scripts/seed_adjust_11_vts_tight_site_audit.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


TEMPLATE_NAME = "VTS Tight Site Audit"
TEMPLATE_CATEGORY = "inspection"
TEMPLATE_DESCRIPTION = (
    "Viatec Traffic Services (VTS) tight-site audit — verifies SSRA/JSEA, "
    "vehicle pre-starts, TGS plan compliance, signage, pedestrian and "
    "UHF-radio controls, PPE compliance and audit review with team-leader "
    "and auditor sign-off."
)

COMPANY_OPTIONS = [
    {"label": "Paneltec Civil", "simpro_id": "2"},
    {"label": "Viatec",         "simpro_id": "3"},
]
WEATHER_OPTIONS = ["Fine", "Overcast", "Rain", "Wind", "Fog", "Snow", "Other"]


def _now_iso() -> str: return datetime.now(timezone.utc).isoformat()
def _new_id() -> str: return str(uuid.uuid4())


def _yn(label: str, required: bool = True) -> dict:
    return {"id": _new_id(), "label": label, "type": "radio",
            "required": required, "options": ["Yes", "No"],
            "placeholder": "", "config": {}}


def _yn_na(label: str, required: bool = True) -> dict:
    return {"id": _new_id(), "label": label, "type": "radio",
            "required": required, "options": ["Yes", "No", "N/A"],
            "placeholder": "", "config": {}}


def _confirm(label: str) -> dict:
    return {"id": _new_id(), "label": label, "type": "radio",
            "required": True, "options": ["I confirm"],
            "placeholder": "", "config": {}}


def _photo(label: str, required: bool = True, multi: bool = False) -> dict:
    return {"id": _new_id(), "label": label, "type": "photo",
            "required": required, "options": [], "placeholder": "",
            "config": ({"multi": True} if multi else {})}


def build_fields() -> list[dict]:
    f: list[dict] = []

    # A. Standard Header
    f.append({"id": _new_id(), "label": "Date", "type": "date",
              "required": True, "options": [], "placeholder": "",
              "config": {"default_today": True}})
    f.append({"id": _new_id(), "label": "Auditor (Name)",
              "type": "worker_picker", "required": True, "options": [],
              "placeholder": "",
              "config": {"inline_company_toggle": True,
                         "company_options": COMPANY_OPTIONS}})
    f.append({"id": _new_id(), "label": "Location", "type": "gps",
              "required": True, "options": [], "placeholder": "",
              "config": {"reverse_geocode": True}})
    f.append({"id": _new_id(), "label": "Select Vehicle (optional)",
              "type": "vehicle_navixy", "required": False, "options": [],
              "placeholder": "", "config": {}})

    # B. Site Details
    f.append({"id": _new_id(), "label": "Audit Time", "type": "time",
              "required": True, "options": [], "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "Site Address", "type": "text",
              "required": True, "options": [], "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "Weather at time of Audit",
              "type": "select", "required": True, "options": WEATHER_OPTIONS,
              "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "Customer",
              "type": "text", "required": True, "options": [],
              "placeholder": "e.g. TasWater, Council, Paneltec Own Job, Other",
              "config": {}})
    f.append({"id": _new_id(), "label": "Customer name if 'Other'",
              "type": "text", "required": False, "options": [],
              "placeholder": "", "config": {}})

    # C. Induction & Documents
    f.append(_yn("Has an SSRA-JSEA been completed for the site?"))
    f.append({"id": _new_id(), "label": "Team Leader (Name)",
              "type": "worker_picker", "required": True, "options": [],
              "placeholder": "",
              "config": {"inline_company_toggle": True,
                         "company_options": COMPANY_OPTIONS}})
    f.append({"id": _new_id(),
              "label": "Reason if SSRA-JSEA NOT completed (leave blank if sited)",
              "type": "textarea", "required": False, "options": [],
              "placeholder": "", "config": {}})
    f.append(_yn(
        "Has a vehicle pre-start been completed for all VTS vehicles on site?"
    ))
    f.append({"id": _new_id(), "label": "List all Viatec personnel on site",
              "type": "worker_picker", "required": True, "options": [],
              "placeholder": "",
              "config": {"inline_company_toggle": True,
                         "company_options": COMPANY_OPTIONS, "multi": True}})

    # D. Work Site Audit
    f.append(_yn(
        "Has the correct TGS plan been selected in accordance with the site?"
    ))
    f.append({"id": _new_id(), "label": "TGS Plan #",
              "type": "text", "required": True, "options": [],
              "placeholder": "e.g. TGS-1234", "config": {}})
    f.append(_photo("Photo of the TGS plan / cover", required=False))
    f.append(_yn("Is all signage in a compliant location to the TGS?"))
    f.append(_yn_na(
        "If additional / modified signage locations implemented, has Team "
        "Leader noted, signed and dated in the SSRA?"
    ))
    f.append(_yn(
        "Has all signage been flagged, and return speeds in ERW signage?"
    ))
    f.append(_yn(
        "Have pedestrians been catered for in a safe manner, with correct "
        "signage?"
    ))
    f.append(_yn("Are UHF radios being used on site?"))
    f.append(_yn_na(
        "If UHF radios are being used, are they being used correctly?"
    ))

    # E. Photo Documentation
    f.append(_photo("Signage at the start of the work site"))
    f.append(_photo("From first sign looking towards work site"))
    f.append(_photo(
        "Work site setup (cones, extendable barriers, work vehicles)",
        multi=True,
    ))
    f.append(_photo(
        "Traffic Controllers operating a SSB (if active)", required=False,
    ))
    f.append(_photo("Signage exiting work site"))
    f.append(_photo(
        "Any non-compliant work zone delineations (add only if non-"
        "compliance found)", required=False, multi=True,
    ))

    # F. PPE Checklist
    for lbl in [
        "All workers wearing a Hard Hat (within 2 years of issue date)",
        "All workers wearing Safety Glasses within worksite",
        "All workers have suitable Hearing Protection (if required)",
        "All workers wearing Safety Boots (laced & zipped up)",
        "All workers in Uniform in Highly Visible condition",
    ]:
        f.append(_yn(f"PPE — {lbl}"))
    f.append({"id": _new_id(),
              "label": (
                  "Names of any non-compliant workers not wearing PPE per "
                  "PIPE policy (leave blank if all compliant)"
              ),
              "type": "textarea", "required": False, "options": [],
              "placeholder": "", "config": {}})

    # G. Comments & Review
    f.append({"id": _new_id(), "label": "Comments & Review of Audit",
              "type": "textarea", "required": True, "options": [],
              "placeholder": "", "config": {}})
    f.append({"id": _new_id(),
              "label": "Team Leader signature (acknowledges audit result)",
              "type": "signature", "required": True, "options": [],
              "placeholder": "", "config": {}})
    f.append(_confirm(
        "I confirm the audit above is a true and accurate representation of "
        "this worksite at the time and date aforementioned."
    ))
    f.append({"id": _new_id(), "label": "Auditor signature",
              "type": "signature", "required": True, "options": [],
              "placeholder": "", "config": {}})
    f.append(_yn("Did Traffic Control crew pass audit?"))
    f.append({"id": _new_id(),
              "label": (
                  "Reason for failed audit / opportunities for improvement "
                  "discussed with the team"
              ),
              "type": "textarea", "required": False, "options": [],
              "placeholder": "", "config": {}})

    # H. Final
    f.append(_confirm("Audit Complete"))
    return f


async def _grant_role_allowlist(db, org_id: str, template_id: str) -> list[str]:
    org = await db.orgs.find_one({"id": org_id}, {"_id": 0, "role_form_allowlist": 1}) or {}
    matrix: dict = org.get("role_form_allowlist") or {}
    updated: list[str] = []
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


async def seed_for_org(db, org_id: str) -> dict:
    existing = await db.form_templates.find_one(
        {"org_id": org_id, "deleted_at": None,
         "name": {"$regex": f"^{TEMPLATE_NAME}$", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    if existing:
        granted = await _grant_role_allowlist(db, org_id, existing["id"])
        return {"status": "skipped_exists", "id": existing["id"],
                "allowlist_granted": granted}

    doc = {
        "id": _new_id(),
        "org_id": org_id,
        "name": TEMPLATE_NAME,
        "category": TEMPLATE_CATEGORY,
        "description": TEMPLATE_DESCRIPTION,
        "fields": build_fields(),
        "required_certifications": [],
        "applies_to": {"kinds": ["any"], "asset_types": [],
                       "worker_ids": [], "roles": [], "companies": []},
        "source": "paneltec",
        "imported_at": None,
        "created_by": "system:seed_adjust_11_vts_tight_site_audit",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "deleted_at": None,
    }
    await db.form_templates.insert_one(doc)
    granted = await _grant_role_allowlist(db, org_id, doc["id"])
    return {"status": "inserted", "id": doc["id"],
            "field_count": len(doc["fields"]),
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
        seen = set()
        async for u in db.users.find({}, {"_id": 0, "org_id": 1}):
            oid = u.get("org_id")
            if oid and oid not in seen:
                seen.add(oid); orgs.append(oid)

    print(f"── Seeding '{TEMPLATE_NAME}' across {len(orgs)} orgs ──")
    inserted = skipped = 0
    for oid in orgs:
        r = await seed_for_org(db, oid)
        marker = "+" if r["status"] == "inserted" else "="
        print(f" {marker} [{oid[:8]}…] {r}")
        if r["status"] == "inserted": inserted += 1
        else: skipped += 1
    print(f"\nSUMMARY: inserted={inserted} skipped_exists={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
