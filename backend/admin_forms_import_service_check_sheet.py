"""v58.13.132jz — Faithful Service Check Sheet import.

Rebuild of the .132jy importer with:
  · Tick / X / N-A trinary answer widget (matches the source modal's
    `X | CHECK | NA` state machine at `ServiceCheckSheetModal.jsx`).
  · Heavy-truck section (11 sub-sections, 77 items) previously missing.
  · Per-section colour palette + zebra-striping via the `.132jk`
    field-style schema so the FormRunner (`.132jl` mobile,
    `Forms.jsx` web) surfaces the same visual grouping the modal has.

The two source-of-truth checklists live in
`backend/fleet_service_sheet_templates.py` — this module reads them
so future edits stay in one place.

Idempotent — matched by `(org_id, original_source="service_check_sheet_v121_2")`.
The old `.132jy` `service_check_sheet_v121_1` template is soft-deleted
in-place so scans stop returning duplicates.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import require_roles
from db import db
from fleet_service_sheet_templates import (
    TEMPLATE_LIGHT_VEHICLE_V121_1,
    TEMPLATE_HEAVY_TRUCK_V123_1,
)

router = APIRouter(prefix="/admin/forms", tags=["admin-forms"])

TEMPLATE_NAME = "Vehicle Service Inspection — Service Check Sheet"
TEMPLATE_SOURCE = "service_check_sheet_v121_2"
OLD_SOURCE = "service_check_sheet_v121_1"
TEMPLATE_DESCRIPTION = (
    "Full vehicle service check sheet. Mirrors the Fleet & Service "
    "Register drawer's 'Log service (Check Sheet)' flow — 18 light-"
    "vehicle checks + 77 heavy-truck checks across 11 sub-sections. "
    "Each row records a Tick / X / N-A trinary status plus notes."
)

DEFAULT_ASSET_TYPES = [
    "ute", "trailer", "tipper", "vacuum_truck", "excavator",
    "service_truck", "commercial", "compactor", "crane_truck",
    "directional_drill", "loader",
]

# ── Trinary answer options (matches ServiceCheckSheetModal.jsx marks) ──
# CHECK → "✓ Check" (emerald), X → "✗ Repair" (rose), NA → "N/A" (slate).
# Web `ColouredRadioGroup` + mobile radio detector extended in this
# ship to recognise `check`/`✓` → emerald and `repair`/`✗` → rose.
TRINARY_OPTS = ["✓ Check", "✗ Repair", "N/A"]

# ── Section palette (tailwind-50 tints from the heavy-truck accent) ──
# Maps the `accent` strings in `_HEAVY_SECTIONS` to backgroundColor +
# borderColor hex values consumable by the `.132jk` style schema.
SECTION_PALETTE = {
    "amber":   {"bg": "#FEF3C7", "border": "#F59E0B"},
    "sky":     {"bg": "#E0F2FE", "border": "#0EA5E9"},
    "cyan":    {"bg": "#CFFAFE", "border": "#06B6D4"},
    "violet":  {"bg": "#EDE9FE", "border": "#8B5CF6"},
    "emerald": {"bg": "#D1FAE5", "border": "#10B981"},
    "rose":    {"bg": "#FFE4E6", "border": "#F43F5E"},
    "indigo":  {"bg": "#E0E7FF", "border": "#6366F1"},
    "blue":    {"bg": "#DBEAFE", "border": "#3B82F6"},
    "teal":    {"bg": "#CCFBF1", "border": "#14B8A6"},
    "slate":   {"bg": "#F1F5F9", "border": "#64748B"},
}

# Alternating zebra tints for the light-vehicle rows (subtle).
LIGHT_ZEBRA = ["#F9FAFB", "#FFFFFF"]


def _new_id() -> str:
    return str(uuid.uuid4())


def _section_header_style(accent: str) -> dict:
    """Bold, tinted background — visually reads as a section banner."""
    p = SECTION_PALETTE.get(accent, SECTION_PALETTE["slate"])
    return {
        "labelBold": True,
        "labelSize": "lg",
        "backgroundColor": p["bg"],
        "borderColor": p["border"],
        "borderWidth": 2,
        "borderStyle": "solid",
        "borderRadius": 14,
        "paddingX": 12,
        "paddingY": 10,
    }


def _section_row_style(accent: str, index: int) -> dict:
    """Softer per-row tint using a lighter shade of the section colour."""
    p = SECTION_PALETTE.get(accent, SECTION_PALETTE["slate"])
    # Rows: alternate white/tint at 50% alpha to keep it subtle.
    zebra = p["bg"] if index % 2 == 0 else "#FFFFFF"
    return {
        "backgroundColor": zebra,
        "borderColor": p["border"],
        "borderWidth": 1,
        "borderStyle": "solid",
        "borderRadius": 10,
        "paddingX": 10,
        "paddingY": 8,
    }


def _light_row_style(index: int) -> dict:
    return {
        "backgroundColor": LIGHT_ZEBRA[index % 2],
        "borderColor": "#E2E8F0",
        "borderWidth": 1,
        "borderStyle": "solid",
        "borderRadius": 10,
        "paddingX": 10,
        "paddingY": 8,
    }


def _build_fields() -> list[dict]:
    fields: list[dict] = []

    # ═══ Section 0 — Vehicle Details ═══════════════════════════════════
    fields.append({
        "id": _new_id(), "type": "text",
        "label": "▪ Vehicle Details",
        "required": False, "config": {"section_header": True},
        "style": _section_header_style("slate"),
        "placeholder": "",
    })
    fields.append({
        "id": _new_id(), "type": "date", "label": "Service Date",
        "required": True, "config": {"default_today": True}, "style": {},
    })
    fields.append({
        "id": _new_id(), "type": "vehicle_navixy", "label": "Vehicle",
        "required": True, "config": {}, "style": {},
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
        "style": {},
    })
    fields.append({"id": _new_id(), "type": "text",
                   "label": "Company (if external)", "required": False,
                   "config": {}, "style": {}})
    fields.append({"id": _new_id(), "type": "number",
                   "label": "Mileage at Service (km)", "required": False,
                   "config": {"min": 0}, "style": {}})
    fields.append({"id": _new_id(), "type": "number",
                   "label": "Hours at Service", "required": False,
                   "config": {"min": 0}, "style": {}})
    fields.append({"id": _new_id(), "type": "text",
                   "label": "Make / Model", "required": False,
                   "config": {}, "style": {}})
    fields.append({"id": _new_id(), "type": "text",
                   "label": "VIN", "required": False,
                   "config": {}, "style": {}})

    # ═══ Section 1 — Service Level ════════════════════════════════════
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
        "style": _section_header_style("blue"),
    })

    # ═══ Section 2 — Light Vehicle Checklist (18 items, Tick/X/N-A) ══
    fields.append({
        "id": _new_id(), "type": "text",
        "label": "▪ Light Vehicle Service Checklist (18 items — mark each row Tick / X / N/A)",
        "required": False, "config": {"section_header": True},
        "style": _section_header_style("emerald"),
        "placeholder": "",
    })
    for i, item in enumerate(TEMPLATE_LIGHT_VEHICLE_V121_1["items"]):
        row_style = _light_row_style(i)
        fields.append({
            "id": _new_id(), "type": "radio",
            "label": f"{item}",
            "required": True,
            "config": {"options": list(TRINARY_OPTS)},
            "style": row_style,
        })
        fields.append({
            "id": _new_id(), "type": "text",
            "label": f"{item} — notes",
            "required": False, "config": {},
            "style": {**row_style, "borderWidth": 0, "paddingY": 4},
        })

    # ═══ Section 3 — Heavy Vehicle Additional Checks (77 items × 11 sub-sections) ══
    fields.append({
        "id": _new_id(), "type": "text",
        "label": (
            "▪ Heavy Vehicle Additional Checks — only fill in for heavy trucks "
            "(vacuum, tipper, service, crane, compactor). Mark each row Tick / X / N/A."
        ),
        "required": False, "config": {"section_header": True,
                                       "heavy_truck_gate": True},
        "style": _section_header_style("amber"),
        "placeholder": "",
    })
    for section in TEMPLATE_HEAVY_TRUCK_V123_1["sections"]:
        s_id = section["id"]
        s_label = section["label"]
        accent = section["accent"]
        items = section["items"]

        # Section sub-header
        fields.append({
            "id": _new_id(), "type": "text",
            "label": f"{s_id}. {s_label}",
            "required": False, "config": {"section_header": True,
                                           "sub_section": s_id},
            "style": _section_header_style(accent),
            "placeholder": "",
        })
        # De-duplicate the "Other" items with an index suffix so the
        # form fields don't collide.
        seen: dict[str, int] = {}
        for i, item in enumerate(items):
            seen[item] = seen.get(item, 0) + 1
            suffix = f" ({seen[item]})" if seen[item] > 1 else ""
            row_style = _section_row_style(accent, i)
            fields.append({
                "id": _new_id(), "type": "radio",
                "label": f"{item}{suffix}",
                "required": False,  # optional — only mandatory when heavy
                "config": {"options": list(TRINARY_OPTS),
                           "heavy_truck_only": True,
                           "sub_section": s_id},
                "style": row_style,
            })
            fields.append({
                "id": _new_id(), "type": "text",
                "label": f"{item}{suffix} — notes",
                "required": False,
                "config": {"heavy_truck_only": True,
                           "sub_section": s_id},
                "style": {**row_style, "borderWidth": 0, "paddingY": 4},
            })

    # ═══ Section 4 — Tread Depths (heavy trucks, per position) ═════════
    fields.append({
        "id": _new_id(), "type": "text",
        "label": "▪ Tread Depths (32nds — heavy trucks only)",
        "required": False, "config": {"section_header": True,
                                       "heavy_truck_gate": True},
        "style": _section_header_style("cyan"),
        "placeholder": "",
    })
    for pos in TEMPLATE_HEAVY_TRUCK_V123_1["tread_positions"]:
        fields.append({
            "id": _new_id(), "type": "number",
            "label": f"{pos['label']} — outer",
            "required": False,
            "config": {"min": 0, "heavy_truck_only": True,
                       "tread_position": pos["id"]},
            "style": _section_row_style("cyan", 0),
        })
        if pos["has_inner"]:
            fields.append({
                "id": _new_id(), "type": "number",
                "label": f"{pos['label']} — inner",
                "required": False,
                "config": {"min": 0, "heavy_truck_only": True,
                           "tread_position": pos["id"]},
                "style": _section_row_style("cyan", 1),
            })

    # ═══ Section 5 — Consumables + Next Service ════════════════════════
    fields.append({
        "id": _new_id(), "type": "text",
        "label": "▪ Consumables & Follow-Up",
        "required": False, "config": {"section_header": True},
        "style": _section_header_style("violet"),
        "placeholder": "",
    })
    fields.append({
        "id": _new_id(), "type": "textarea",
        "label": "Consumables used", "required": False,
        "config": {"heavy_truck_only": True},
        "style": {},
    })
    fields.append({
        "id": _new_id(), "type": "textarea",
        "label": "Advisory / Comments", "required": False,
        "config": {}, "style": {},
    })
    fields.append({"id": _new_id(), "type": "number",
                   "label": "Next Service Due (km)", "required": False,
                   "config": {"min": 0}, "style": {}})
    fields.append({"id": _new_id(), "type": "number",
                   "label": "Next Service Due (hours)", "required": False,
                   "config": {"min": 0}, "style": {}})
    fields.append({"id": _new_id(), "type": "date",
                   "label": "Next Service Due Date", "required": False,
                   "config": {}, "style": {}})
    fields.append({
        "id": _new_id(), "type": "date",
        "label": "Next Inspection Due Date",
        "required": False, "config": {"heavy_truck_only": True},
        "style": {},
    })

    # ═══ Section 6 — Attachments + Signatures ══════════════════════════
    fields.append({
        "id": _new_id(), "type": "text",
        "label": "▪ Attachments & Sign-Off",
        "required": False, "config": {"section_header": True},
        "style": _section_header_style("indigo"),
        "placeholder": "",
    })
    fields.append({
        "id": _new_id(), "type": "attachment",
        "label": "Attachments (invoices, receipts, defect photos)",
        "required": False,
        "config": {"multiple": True}, "style": {},
    })
    fields.append({
        "id": _new_id(), "type": "signature",
        "label": "Technician Signature", "required": True,
        "config": {}, "style": {},
    })
    fields.append({
        "id": _new_id(), "type": "signature",
        "label": "Customer Signature", "required": False,
        "config": {}, "style": {},
    })

    return fields


class ImportIn(BaseModel):
    all_orgs: bool = False


async def _retire_old_source(org_id: str, now: str) -> int:
    """Soft-delete any .132jy templates left behind so scans don't
    return duplicates. Returns count retired."""
    res = await db.form_templates.update_many(
        {"org_id": org_id, "original_source": OLD_SOURCE, "deleted_at": None},
        {"$set": {"deleted_at": now, "retired_by": "132jz",
                  "retired_reason": "Superseded by service_check_sheet_v121_2 "
                                    "(Tick/X/N-A + heavy truck section + colours)"}},
    )
    return res.modified_count


async def _import_for_org(org_id: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    retired = await _retire_old_source(org_id, now)

    existing = await db.form_templates.find_one(
        {"org_id": org_id, "original_source": TEMPLATE_SOURCE,
         "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    fields = _build_fields()
    doc = {
        "org_id": org_id,
        "name": TEMPLATE_NAME,
        "description": TEMPLATE_DESCRIPTION,
        "category": "inspection",
        "fields": fields,
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
            "seeded_by": "132jz",
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
        return {"action": "updated", "template_id": existing["id"],
                "retired_previous_source": retired,
                "field_count": len(fields)}
    doc["id"] = _new_id()
    doc["created_at"] = now
    doc["imported_at"] = now
    doc["deleted_at"] = None
    await db.form_templates.insert_one(doc)
    return {"action": "created", "template_id": doc["id"],
            "retired_previous_source": retired,
            "field_count": len(fields)}


@router.post("/import-service-check-sheet")
async def import_service_check_sheet(
    body: ImportIn,
    user: dict = Depends(require_roles("admin")),
):
    """Idempotently upsert the Service Check Sheet form template.

    v58.13.132jz — Now imports the full 11-section heavy-truck checklist
    plus the light-vehicle 18-item checklist, both using the Tick / X /
    N-A trinary answer widget. Per-section colours applied via the
    `.132jk` field-style schema. Old `.132jy` v121.1 templates are
    soft-deleted in the same pass.
    """
    if body.all_orgs:
        results = []
        async for org in db.orgs.find({}, {"_id": 0, "id": 1, "name": 1}):
            r = await _import_for_org(org["id"])
            r["org_id"] = org["id"]
            r["org_name"] = org.get("name") or org["id"]
            results.append(r)
        fc = len(_build_fields())
        return {"ok": True, "all_orgs": True, "orgs": results,
                "template_name": TEMPLATE_NAME,
                "source_version": TEMPLATE_SOURCE,
                "field_count": fc}
    r = await _import_for_org(user["org_id"])
    return {"ok": True, "org_id": user["org_id"],
            "template_name": TEMPLATE_NAME,
            "source_version": TEMPLATE_SOURCE, **r}
