"""v58.13.132mw — Seed a canonical SWMS `form_templates` row per org.

Fix scope
---------
Before this ship, the bulk-import classifier had a `("swms", "swms")`
keyword rule (`bulk_import_template_inference._CATEGORY_KEYWORDS:260-261`)
but `form_templates` had **zero** rows with `category: "swms"` on any
org. Result:

  1. Filename-driven SWMS classifications had no template to match
     against, so uploaded SWMS PDFs got mis-routed (into `general` or
     `pre_start`), silently invisible to the SWMS tab.
  2. The tab `swms_router` (`crud.py:854`) also lacked
     `mirror_categories` — that's fixed in the same ship — but was
     moot without (1) landing first.

This module seeds ONE canonical SWMS template per org on backend
boot. Idempotent: existing rows are detected by
`(org_id, category='swms', name matches _SWMS_NAME_RE)` and skipped.
Never clobbers a manually-edited template.

Log line shape:
    [migrate-swms-template] org=<uuid> seeded=<0|1> skipped_existing=<0|1>
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone

from db import db

log = logging.getLogger("paneltec.swms_template_seed")

# Match an existing SWMS template for this org — regardless of the
# exact label (`SWMS`, `Safe Work Method Statement`, `Site SWMS`, …).
_SWMS_NAME_RE = re.compile(r"\bswms\b|safe\s*work\s*method", re.I)

_SEEDED_NAME = "Safe Work Method Statement (SWMS)"
_SEEDED_DESCRIPTION = (
    "Canonical SWMS template. Documents the task, hazards, control "
    "measures, PPE, and sign-off signature for high-risk construction "
    "work per WHS Reg 291. Auto-seeded on boot in v58.13.132mw so "
    "PDF-import classifications with category=\"swms\" have a target "
    "to match against."
)

# Field shape mirrors `Incident Report` (id, label, type, required,
# options, placeholder, config). Field ids are stable strings so
# downstream form_submissions can carry `fields[].id` refs.
_SEEDED_FIELDS: list[dict] = [
    {"id": "task_description", "label": "Task / activity description",
     "type": "textarea", "required": True, "options": [], "placeholder": "",
     "config": {"rows": 3}},
    {"id": "site", "label": "Site / location",
     "type": "text", "required": True, "options": [], "placeholder": "",
     "config": {}},
    {"id": "date_prepared", "label": "Date prepared",
     "type": "date", "required": True, "options": [], "placeholder": "",
     "config": {"default_today": True}},
    {"id": "prepared_by", "label": "Prepared by (name)",
     "type": "text", "required": True, "options": [], "placeholder": "",
     "config": {}},
    {"id": "high_risk_categories", "label": "High-risk work categories",
     "type": "multiselect", "required": True,
     "options": [
        "Working at heights (>2m)", "Confined space", "Trenching / excavation (>1.5m)",
        "Live electrical", "Asbestos", "Powered mobile plant",
        "Structural alteration", "Hot work", "Diving", "Other",
     ],
     "placeholder": "", "config": {}},
    {"id": "hazards_identified", "label": "Hazards identified",
     "type": "textarea", "required": True, "options": [], "placeholder": "",
     "config": {"rows": 4}},
    {"id": "control_measures", "label": "Control measures / controls",
     "type": "textarea", "required": True, "options": [], "placeholder": "",
     "config": {"rows": 4}},
    {"id": "ppe_required", "label": "PPE required",
     "type": "multiselect", "required": True,
     "options": [
        "Hard hat", "Hi-vis vest", "Steel-cap boots", "Safety glasses",
        "Gloves", "Hearing protection", "Respirator", "Harness / fall arrest",
        "Face shield", "Other",
     ],
     "placeholder": "", "config": {}},
    {"id": "plant_equipment", "label": "Plant / equipment used",
     "type": "textarea", "required": False, "options": [], "placeholder": "",
     "config": {"rows": 3}},
    {"id": "training_required", "label": "Training / competencies required",
     "type": "textarea", "required": False, "options": [], "placeholder": "",
     "config": {"rows": 2}},
    {"id": "emergency_procedures", "label": "Emergency procedures",
     "type": "textarea", "required": True, "options": [], "placeholder": "",
     "config": {"rows": 3}},
    {"id": "sign_off_signature", "label": "Sign-off signature",
     "type": "signature", "required": True, "options": [], "placeholder": "",
     "config": {}},
    {"id": "sign_off_name", "label": "Sign-off name",
     "type": "text", "required": True, "options": [], "placeholder": "",
     "config": {}},
    {"id": "sign_off_date", "label": "Sign-off date",
     "type": "date", "required": True, "options": [], "placeholder": "",
     "config": {"default_today": True}},
]


async def seed_swms_template_on_startup() -> dict:
    """Idempotent per-org seed. Runs on backend boot."""
    report = {"orgs_scanned": 0, "seeded": 0, "skipped_existing": 0, "by_org": {}}

    now_iso = datetime.now(timezone.utc).isoformat()

    # v58.13.132mw — Scope by every org that already has a form_template.
    # Newly-created orgs will get the seed the next time this runs.
    orgs = await db.form_templates.distinct("org_id", {"deleted_at": None})
    for org_id in orgs:
        if not org_id:
            continue
        report["orgs_scanned"] += 1
        by_org = {"seeded": 0, "skipped_existing": 0}

        # Idempotency: any SWMS-shaped template in this org counts.
        existing = None
        cursor = db.form_templates.find(
            {"org_id": org_id, "category": "swms", "deleted_at": None},
            {"id": 1, "name": 1},
        )
        async for t in cursor:
            if _SWMS_NAME_RE.search(t.get("name") or ""):
                existing = t
                break
        if existing:
            by_org["skipped_existing"] = 1
            report["skipped_existing"] += 1
            log.info(
                "[migrate-swms-template] org=%s seeded=0 skipped_existing=1 "
                "existing_id=%s existing_name=%r",
                org_id, existing.get("id"), existing.get("name"),
            )
            report["by_org"][org_id] = by_org
            continue

        doc = {
            "id": str(uuid.uuid4()),
            "org_id": org_id,
            "name": _SEEDED_NAME,
            "category": "swms",
            "description": _SEEDED_DESCRIPTION,
            "fields": _SEEDED_FIELDS,
            "source": "v58_13_132mw_seed",
            "created_by": None,
            "created_at": now_iso,
            "updated_at": now_iso,
            "deleted_at": None,
            "applies_to": [],
            "required_certifications": [],
            "assigned_positions": [],
            "applies_to_meta": {},
            "certification_gate_enabled": False,
        }
        await db.form_templates.insert_one(doc)
        by_org["seeded"] = 1
        report["seeded"] += 1
        log.info(
            "[migrate-swms-template] org=%s seeded=1 skipped_existing=0 "
            "new_id=%s",
            org_id, doc["id"],
        )
        report["by_org"][org_id] = by_org

    return report
