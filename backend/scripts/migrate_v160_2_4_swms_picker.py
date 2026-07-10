"""v160.2.4 — swms_picker field wiring migration.

Idempotent. On first run snapshots `form_templates` to
`form_templates_backup_v160_2_3` (43 rows). Then inserts a `swms_picker`
field into the templates in the whitelist below, at position
`_slot_after_standard_header + 1` (i.e. after Company/Organisation
where present, else after the Standard Header block).

Every SWMS attachment field is inserted with:
  label = "Applicable SWMS"
  type  = "swms_picker"
  config = {"multi": True}   (single for Construction Heavy Equipment
                              Pre-Op — one machine, one SWMS)
  required = True for permits, False for JSEA and pre-ops
"""
from __future__ import annotations
import asyncio
import os
import sys
import uuid
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(_BACKEND_DIR / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


BACKUP_NAME = "form_templates_backup_v160_2_3"

# Whitelist: (template_name, multi, required)
TEMPLATES = [
    ("Hot Work Permit",                                       True,  True),
    ("Confined Space Entry Permit",                            True,  True),
    ("Excavation / Trench Permit",                             True,  True),
    ("Working at Heights Permit",                              True,  True),
    ("Crane Lift / Rigging Plan",                              True,  True),
    ("JSEA — Job Safety & Environmental Analysis",             True,  False),
    ("Construction Heavy Equipment Pre-Operation Checklist",   False, False),
]

FIELD_LABEL = "Applicable SWMS"


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _mk_swms(multi: bool, required: bool) -> dict:
    return {
        "id": _new_id(), "label": FIELD_LABEL, "type": "swms_picker",
        "required": required, "options": [], "placeholder": "",
        "config": {"multi": True} if multi else {},
    }


def _has_field_type(fields: list[dict], typ: str) -> bool:
    return any((f or {}).get("type") == typ for f in fields)


def _slot_after_header_or_company(fields: list[dict]) -> int:
    """Insert AFTER the last of: date, worker_picker, gps, vehicle_navixy,
    company_selector, time. That places `swms_picker` right after the
    Standard Header + Company + Time-in/out block, before the domain
    body — matching the placement rule in the v160.2.4 brief."""
    header_types = {"date", "worker_picker", "gps", "vehicle_navixy",
                    "company_selector", "time"}
    last = -1
    for i, f in enumerate(fields):
        if (f or {}).get("type") in header_types:
            last = i
    return last + 1 if last >= 0 else len(fields)


async def _snapshot(db):
    existing = await db[BACKUP_NAME].estimated_document_count()
    if existing > 0:
        print(f"[snapshot] skip — {BACKUP_NAME} already has {existing} docs")
        return 0
    rows = await db.form_templates.find({}).to_list(5000)
    if not rows:
        print("[snapshot] no templates to snapshot")
        return 0
    await db[BACKUP_NAME].insert_many(rows)
    print(f"[snapshot] copied {len(rows)} → {BACKUP_NAME}")
    return len(rows)


async def _run(db) -> dict:
    stats = {"added": 0, "already_present": 0, "missing_template": 0}
    for name, multi, required in TEMPLATES:
        tpl = await db.form_templates.find_one({"name": name})
        if not tpl:
            stats["missing_template"] += 1
            print(f"  !! missing template: {name}")
            continue
        fields = list(tpl.get("fields") or [])
        if _has_field_type(fields, "swms_picker"):
            stats["already_present"] += 1
            print(f"  ✓ {name} — swms_picker already present, skip")
            continue
        insert_at = _slot_after_header_or_company(fields)
        new_fields = fields[:insert_at] + [_mk_swms(multi, required)] + fields[insert_at:]
        await db.form_templates.update_one(
            {"id": tpl["id"]}, {"$set": {"fields": new_fields}},
        )
        stats["added"] += 1
        multi_txt = "multi" if multi else "single"
        req_txt = "required" if required else "optional"
        print(f"  ✓ {name}: +swms_picker @ pos {insert_at} ({multi_txt}, {req_txt})")
    return stats


async def main():
    url = os.environ.get("MONGO_URL")
    dbn = os.environ.get("DB_NAME")
    if not url or not dbn:
        raise RuntimeError("MONGO_URL / DB_NAME not set")
    client = AsyncIOMotorClient(url)
    db = client[dbn]
    print(f"[migration v160.2.4] db={dbn}")
    await _snapshot(db)
    stats = await _run(db)
    print()
    print("── SUMMARY ──")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    print()
    print("[migration v160.2.4] done.")


if __name__ == "__main__":
    asyncio.run(main())
