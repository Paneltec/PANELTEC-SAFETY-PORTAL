"""Phase 3.7 — one-shot idempotent migration that rewires legacy `text`,
`textarea` and empty `select` fields on form_templates to the new dynamic
picker types (`worker_picker` / `job_picker` / `site_picker` /
`customer_picker`).

Runs once at startup; sets `app_state.pickers_migrated_at` so subsequent
restarts are no-ops. Delete that document in Mongo to force a re-run.
"""
from __future__ import annotations
import logging
import re

from db import db
from models import now_iso

log = logging.getLogger("paneltec.forms.pickers_migration")

FLAG_KEY = "pickers_migrated_at"
FLAG_VEHICLE_KEY = "pickers_vehicle_migrated_at"
ELIGIBLE_TYPES = {"text", "textarea", "select"}


def _norm(s: str) -> str:
    n = re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())
    return re.sub(r"\s+", " ", n).strip()


def _classify(label: str) -> str | None:
    n = _norm(label)
    if not n:
        return None
    # SITE first — "Job Site / Location" etc. must beat "job".
    if re.search(r"\b(job\s*site|site\s*name|site\s*address|scaffold\s*location|"
                 r"work\s*location|excavation\s*location|confined\s*space\s*description|"
                 r"site\s*\/?\s*location|location\s*of\s*acm|location\s*\/?\s*area|"
                 r"project\s*\/?\s*site\s*name)\b", n):
        return "site_picker"
    if re.fullmatch(r"location", n):
        return "site_picker"
    # WORKER (humans / supervisors / inspectors / operators)
    if re.search(r"\b(worker(?:s)?(?:\s+full)?\s*name|"
                 r"inspector(?:\s+name)?|"
                 r"operator(?:\s+name)?|"
                 r"supervisor(?:\s+\w+)?|"
                 r"presenter\s*\/?\s*supervisor|"
                 r"tradesperson|"
                 r"crew\s+name|"
                 r"completed\s+by|submitted\s+by|assigned\s+to|attended\s+by|"
                 r"person\s+responsible|"
                 r"lift\s+supervisor\s+name|crane\s+operator\s+name)\b", n):
        return "worker_picker"
    if re.fullmatch(r"worker(\s+name)?", n):
        return "worker_picker"
    # CUSTOMER / CLIENT / COMPANY (when used as a free-text identity field)
    if re.fullmatch(r"customer(\s+name)?|client(\s+name)?|company(\s+name)?", n):
        return "customer_picker"
    # JOB (excluding job site already handled above)
    if re.search(r"\b(job\s+number|job\s+no|job\s+ref|work\s+order|"
                 r"job\s+name|project\s+name)\b", n):
        return "job_picker"
    if re.fullmatch(r"job|project", n):
        return "job_picker"
    return None


def _convert_field(f: dict, target: str) -> dict:
    nf = dict(f)
    nf["type"] = target
    nf.pop("options", None)
    nf["placeholder"] = ""
    return nf


async def _augment_daily_site_inspection(conversions: dict) -> int:
    """Inject Inspector (worker_picker) + Site (site_picker) at the top of
    `Daily Site Inspection` template(s) if not already present. Returns the
    number of fields added (0 if already done)."""
    added = 0
    async for tpl in db.form_templates.find(
        {"deleted_at": None, "name": "Daily Site Inspection"}, {"_id": 0},
    ):
        fields = list(tpl.get("fields") or [])
        existing_types = {f.get("type") for f in fields}
        insertions = []
        if "worker_picker" not in existing_types:
            insertions.append({
                "id": "fi_worker", "label": "Inspector",
                "type": "worker_picker", "required": True,
                "options": [], "placeholder": "", "config": {},
            })
        if "site_picker" not in existing_types:
            insertions.append({
                "id": "fi_site", "label": "Job Site / Location",
                "type": "site_picker", "required": True,
                "options": [], "placeholder": "",
                "config": {"dependsOn": "fi_customer"},
            })
        if not insertions:
            continue
        new_fields = insertions + fields
        await db.form_templates.update_one(
            {"id": tpl["id"]},
            {"$set": {"fields": new_fields, "updated_at": now_iso()}},
        )
        for ins in insertions:
            t = ins["type"]
            conversions.setdefault(t, {})[ins["label"]] = conversions.setdefault(t, {}).get(ins["label"], 0) + 1
        added += len(insertions)
    return added


async def migrate_form_pickers() -> dict:
    """Idempotent — sets flag, only runs once per environment."""
    flag = await db.app_state.find_one({"key": FLAG_KEY})
    if flag and flag.get("value"):
        log.info("pickers migration: already_done at %s", flag.get("value"))
        veh = await migrate_vehicle_navixy()
        return {"already_done": True, "at": flag.get("value"), "vehicle_pass": veh}

    templates_seen = 0
    templates_changed = 0
    fields_changed = 0
    conversions: dict[str, dict] = {}

    async for tpl in db.form_templates.find({"deleted_at": None}, {"_id": 0}):
        templates_seen += 1
        fields = tpl.get("fields") or []
        changed = False
        new_fields = []
        for f in fields:
            ftype = f.get("type")
            label = (f.get("label") or "").strip()
            if ftype in ELIGIBLE_TYPES and label:
                # Don't blow away a `select` that has real options unless its
                # label is unambiguously about a worker/site/job/customer
                # IDENTITY (selects with options are typically enum data like
                # "Weather Conditions" — skip those).
                if ftype == "select" and f.get("options"):
                    new_fields.append(f)
                    continue
                target = _classify(label)
                if target:
                    fields_changed += 1
                    changed = True
                    bucket = conversions.setdefault(target, {})
                    bucket[label] = bucket.get(label, 0) + 1
                    new_fields.append(_convert_field(f, target))
                    continue
            new_fields.append(f)
        if changed:
            templates_changed += 1
            await db.form_templates.update_one(
                {"id": tpl["id"]},
                {"$set": {"fields": new_fields, "updated_at": now_iso()}},
            )

    # Augment Daily Site Inspection (brief calls this template out explicitly).
    augmented = await _augment_daily_site_inspection(conversions)

    await db.app_state.update_one(
        {"key": FLAG_KEY},
        {"$set": {"key": FLAG_KEY, "value": now_iso(),
                  "templates_changed": templates_changed,
                  "fields_changed": fields_changed,
                  "augmented_added": augmented,
                  "conversions": conversions}},
        upsert=True,
    )
    log.info(
        "pickers_migration: rewrote %d fields across %d templates (+%d augmented) "
        "→ %s",
        fields_changed, templates_changed, augmented,
        {k: sum(v.values()) for k, v in conversions.items()},
    )
    # Run the vehicle/plant pass after pickers — idempotent on its own flag.
    veh = await migrate_vehicle_navixy()
    return {"templates_seen": templates_seen,
            "templates_changed": templates_changed,
            "fields_changed": fields_changed,
            "augmented_added": augmented,
            "conversions": conversions,
            "vehicle_pass": veh}


# ───────────────────── Vehicle / plant migration (v2) ─────────────────────

VEHICLE_RX_SELECT = re.compile(r"vehicle|truck|ute|tipper|excavator", re.I)
VEHICLE_RX_TEXT_PREFIX = re.compile(r"^(vehicle|truck|plant)\b", re.I)


async def migrate_vehicle_navixy() -> dict:
    """Convert vehicle/truck/plant-labelled fields to live Navixy / asset-scan.

    - `select` with vehicle-flavoured label + empty options → `vehicle_navixy`.
    - `text` whose label STARTS with Vehicle/Truck/Plant → `vehicle_navixy`
      UNLESS the same template already has an `asset_scan` field (skip to
      avoid duplicate fleet pickers).
    Idempotent — gated by `app_state.pickers_vehicle_migrated_at`.
    """
    flag = await db.app_state.find_one({"key": FLAG_VEHICLE_KEY})
    if flag and flag.get("value"):
        log.info("vehicle migration: already_done at %s", flag.get("value"))
        return {"already_done": True, "at": flag.get("value")}

    templates_changed = 0
    fields_changed = 0
    by_type: dict[str, int] = {"vehicle_navixy": 0, "asset_scan": 0}

    async for tpl in db.form_templates.find({"deleted_at": None}, {"_id": 0}):
        fields = tpl.get("fields") or []
        has_asset_scan = any(f.get("type") == "asset_scan" for f in fields)
        has_vehicle_navixy = any(f.get("type") == "vehicle_navixy" for f in fields)
        changed = False
        new_fields = []
        for f in fields:
            ftype = f.get("type")
            label = (f.get("label") or "").strip()
            convert_to = None
            if ftype == "select" and not f.get("options") and VEHICLE_RX_SELECT.search(label):
                convert_to = "asset_scan" if has_asset_scan else "vehicle_navixy"
            elif ftype == "text" and VEHICLE_RX_TEXT_PREFIX.match(label):
                if has_vehicle_navixy or has_asset_scan:
                    # Don't add a second fleet picker to a template that
                    # already has one — leave the text field alone.
                    pass
                else:
                    convert_to = "vehicle_navixy"
            if convert_to:
                nf = dict(f)
                nf["type"] = convert_to
                nf.pop("options", None)
                new_fields.append(nf)
                fields_changed += 1
                by_type[convert_to] = by_type.get(convert_to, 0) + 1
                changed = True
                if convert_to == "vehicle_navixy":
                    has_vehicle_navixy = True
                continue
            new_fields.append(f)
        if changed:
            templates_changed += 1
            await db.form_templates.update_one(
                {"id": tpl["id"]},
                {"$set": {"fields": new_fields, "updated_at": now_iso()}},
            )

    await db.app_state.update_one(
        {"key": FLAG_VEHICLE_KEY},
        {"$set": {"key": FLAG_VEHICLE_KEY, "value": now_iso(),
                  "templates_changed": templates_changed,
                  "fields_changed": fields_changed,
                  "by_type": by_type}},
        upsert=True,
    )
    log.info(
        "vehicle migration: rewrote %d fields across %d templates → %s",
        fields_changed, templates_changed, by_type,
    )
    return {"templates_changed": templates_changed,
            "fields_changed": fields_changed,
            "by_type": by_type}
