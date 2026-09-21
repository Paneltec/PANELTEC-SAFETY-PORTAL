"""v58.13.132jy — Import Service Check Sheet as a proper Form Template.

The web fleet drawer has a "Log service (Check Sheet)" button in
`components/ServiceCheckSheetModal.jsx` (v58.13.121) that opens a
hardcoded 18-item vehicle service inspection sheet. This module
mirrors that sheet as a canonical `form_templates` document so the
same checklist can be filled from the mobile app + surfaces in the
Forms Capture grid + is discoverable via `/api/scan/{token}/forms`
for anyone scanning a vehicle QR sticker.

The endpoint is idempotent — safe to re-run. It matches by
`(org_id, name, original_source="service_check_sheet_v121_1")` and
upserts.

USER PAIN (verbatim, Stephen):
  "the Service Log tab has a violet 'Log service (Check Sheet)'
   button — want the same 18-item checklist available as a normal
   Form Template so my mechanics can fill it from mobile too."
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import require_roles
from db import db

router = APIRouter(prefix="/admin/forms", tags=["admin-forms"])


# ── Frozen field list (mirrors CHECKLIST_V121_1 in ServiceCheckSheetModal.jsx) ─
CHECKLIST_V121_1 = [
    "Engine Oil", "Oil Filter", "Air Filter", "Cabin Filter", "Fuel Filter",
    "Coolant", "Brake Fluid", "Power Steering Fluid", "Windscreen Washer Fluid",
    "Auxiliary Belt", "Battery Condition", "Tyres", "Brakes", "Suspension",
    "Steering", "Exhaust", "Lights", "Wipers",
]

TEMPLATE_NAME = "Vehicle Service Inspection — Service Check Sheet"
TEMPLATE_SOURCE = "service_check_sheet_v121_1"
TEMPLATE_DESCRIPTION = (
    "Full 18-item vehicle service check sheet. Mirrors the web Fleet & "
    "Service Register drawer's 'Log service (Check Sheet)' flow. Each "
    "checklist row records Checked / Replaced status plus optional notes."
)

# Full vehicle & plant coverage — service applies to every asset type.
DEFAULT_ASSET_TYPES = [
    "ute", "trailer", "tipper", "vacuum_truck", "excavator",
    "service_truck", "commercial", "compactor", "crane_truck",
    "directional_drill", "loader",
]


def _new_id() -> str:
    return str(uuid.uuid4())


def _build_fields() -> list[dict]:
    """Build the field list once per import. IDs are stable per import
    invocation but not stable across imports — the upsert replaces the
    fields array wholesale so submissions from earlier versions aren't
    broken (they carry their own frozen field IDs)."""
    fields: list[dict] = []

    # ── Vehicle Details section ─────────────────────────────────────
    fields.append({
        "id": _new_id(), "type": "date", "label": "Service Date",
        "required": True, "config": {"default_today": True},
    })
    fields.append({
        "id": _new_id(), "type": "vehicle_navixy", "label": "Vehicle",
        "required": True, "config": {},
    })
    fields.append({
        "id": _new_id(), "type": "worker_picker", "label": "Technician",
        "required": True,
        "config": {
            "inline_company_toggle": True,
            "company_options": [
                {"label": "Paneltec Civil", "simpro_id": "2"},
                {"label": "Viatec", "simpro_id": "3"},
            ],
        },
    })
    fields.append({
        "id": _new_id(), "type": "text", "label": "Company (if external)",
        "required": False, "config": {},
    })
    fields.append({
        "id": _new_id(), "type": "number", "label": "Mileage at Service (km)",
        "required": False, "config": {"min": 0},
    })
    fields.append({
        "id": _new_id(), "type": "number", "label": "Hours at Service",
        "required": False, "config": {"min": 0},
    })
    fields.append({
        "id": _new_id(), "type": "text", "label": "Make / Model",
        "required": False, "config": {},
    })
    fields.append({
        "id": _new_id(), "type": "text", "label": "VIN",
        "required": False, "config": {},
    })

    # ── Service Level selector ──────────────────────────────────────
    fields.append({
        "id": _new_id(), "type": "select", "label": "Service Level",
        "required": True,
        "config": {"options": [
            "Custom (free-form)",
            "Minor · 5–10 000 km / 250 hrs",
            "Intermediate · 15–20 000 km / 500 hrs",
            "Major · 30–45 000 km / 1 000 hrs",
            "Heavy Overhaul · 90–100 000+ km / 2 000+ hrs",
        ]},
    })

    # ── 18-item checklist ───────────────────────────────────────────
    # Per item: 1 radio (Checked / Replaced / Not applicable) + 1 text notes.
    for item in CHECKLIST_V121_1:
        fields.append({
            "id": _new_id(), "type": "radio",
            "label": f"{item} — status",
            "required": True,
            "config": {"options": ["Checked", "Replaced", "Not applicable"]},
        })
        fields.append({
            "id": _new_id(), "type": "text",
            "label": f"{item} — notes",
            "required": False, "config": {},
        })

    # ── Advisory / Comments ─────────────────────────────────────────
    fields.append({
        "id": _new_id(), "type": "textarea", "label": "Advisory / Comments",
        "required": False, "config": {},
    })

    # ── Next Service Due ────────────────────────────────────────────
    fields.append({
        "id": _new_id(), "type": "number", "label": "Next Service Due (km)",
        "required": False, "config": {"min": 0},
    })
    fields.append({
        "id": _new_id(), "type": "number", "label": "Next Service Due (hours)",
        "required": False, "config": {"min": 0},
    })
    fields.append({
        "id": _new_id(), "type": "date", "label": "Next Service Due Date",
        "required": False, "config": {},
    })

    # ── Attachments (invoice / receipt / defect photos) ─────────────
    fields.append({
        "id": _new_id(), "type": "attachment", "label": "Attachments",
        "required": False,
        "config": {"multiple": True,
                   "hint": "Attach invoices, receipts, defect photos, etc."},
    })

    # ── Signatures ──────────────────────────────────────────────────
    fields.append({
        "id": _new_id(), "type": "signature", "label": "Technician Signature",
        "required": True, "config": {},
    })
    fields.append({
        "id": _new_id(), "type": "signature", "label": "Customer Signature",
        "required": False, "config": {},
    })

    return fields


class ImportIn(BaseModel):
    all_orgs: bool = False


async def _import_for_org(org_id: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.form_templates.find_one(
        {"org_id": org_id, "original_source": TEMPLATE_SOURCE,
         "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    doc = {
        "org_id": org_id,
        "name": TEMPLATE_NAME,
        "description": TEMPLATE_DESCRIPTION,
        "category": "inspection",
        "fields": _build_fields(),
        "applies_to": {
            "kinds": [],
            "asset_types": list(DEFAULT_ASSET_TYPES),
            "worker_ids": [],
            "roles": [],
            "companies": [],
        },
        "applies_to_meta": {
            "manual": False,
            "auto_seeded_at": now,
            "seeded_by": "132jy",
        },
        "assigned_positions": [],
        "required_certifications": [],
        "source": "seed",
        "original_source": TEMPLATE_SOURCE,
        "updated_at": now,
    }
    if existing:
        await db.form_templates.update_one(
            {"id": existing["id"], "org_id": org_id, "deleted_at": None},
            {"$set": doc},
        )
        return {"action": "updated", "template_id": existing["id"]}
    doc["id"] = _new_id()
    doc["created_at"] = now
    doc["imported_at"] = now
    doc["deleted_at"] = None
    await db.form_templates.insert_one(doc)
    return {"action": "created", "template_id": doc["id"]}


@router.post("/import-service-check-sheet")
async def import_service_check_sheet(
    body: ImportIn,
    user: dict = Depends(require_roles("admin")),
):
    """Idempotently upsert the 'Vehicle Service Inspection — Service
    Check Sheet' template for one org (default) or every org in the
    pod (`all_orgs=true`).

    Match key: `(org_id, original_source="service_check_sheet_v121_1")`.
    """
    if body.all_orgs:
        results = []
        async for org in db.orgs.find({}, {"_id": 0, "id": 1, "name": 1}):
            r = await _import_for_org(org["id"])
            r["org_id"] = org["id"]
            r["org_name"] = org.get("name") or org["id"]
            results.append(r)
        return {"ok": True, "all_orgs": True, "orgs": results,
                "template_name": TEMPLATE_NAME,
                "field_count": len(_build_fields())}
    r = await _import_for_org(user["org_id"])
    return {"ok": True, "org_id": user["org_id"],
            "template_name": TEMPLATE_NAME,
            "field_count": len(_build_fields()), **r}
