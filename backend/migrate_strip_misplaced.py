"""Phase 3.7 v3 — strip misplaced site/job/vehicle pickers from HR-style
templates (Drug & Alcohol, Fatigue, Leave, Behavioural, Fitness for Work).

Idempotent: gated by `app_state.misplaced_pickers_v3_at`.
"""
import logging
from db import db
from models import now_iso

log = logging.getLogger("paneltec.forms.misplaced_pickers")
FLAG = "misplaced_pickers_v3_at"
HR_KEYWORDS = ("drug", "alcohol", "fatigue", "leave", "behaviou", "fitness")
MISPLACED = {"job_picker", "site_picker", "vehicle_navixy", "asset_scan", "customer_picker"}


async def migrate_strip_misplaced_pickers():
    flag = await db.app_state.find_one({"key": FLAG})
    if flag and flag.get("value"):
        log.info("misplaced_pickers_v3: already_done at %s", flag["value"])
        return {"already_done": True, "at": flag["value"]}
    fields_stripped = 0
    templates_changed = 0
    async for t in db.form_templates.find({"deleted_at": None}, {"_id": 0, "id": 1, "name": 1, "fields": 1}):
        name_lower = (t.get("name") or "").lower()
        if not any(k in name_lower for k in HR_KEYWORDS):
            continue
        old_fields = t.get("fields") or []
        new_fields = [f for f in old_fields if f.get("type") not in MISPLACED]
        if len(new_fields) != len(old_fields):
            await db.form_templates.update_one(
                {"id": t["id"]},
                {"$set": {"fields": new_fields, "updated_at": now_iso()}},
            )
            fields_stripped += len(old_fields) - len(new_fields)
            templates_changed += 1
    await db.app_state.update_one(
        {"key": FLAG},
        {"$set": {"key": FLAG, "value": now_iso(),
                  "fields_stripped": fields_stripped,
                  "templates_changed": templates_changed}},
        upsert=True,
    )
    log.info("misplaced_pickers_v3: stripped %d fields across %d templates",
             fields_stripped, templates_changed)
    return {"fields_stripped": fields_stripped, "templates_changed": templates_changed}
