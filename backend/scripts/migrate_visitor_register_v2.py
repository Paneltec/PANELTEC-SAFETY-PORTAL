"""v160.3.9.4 — Migrate the "Site Sign-In / Visitor Register" form template
from its original worker-picker-heavy schema to a public-visitor-friendly
schema of plain text / select / radio / signature / photo fields.

Idempotent: on re-run, the script hashes the current template.fields against
the expected new fields and no-ops when they already match.

Historical form_submissions rows are NOT touched — they retain the old field
ids (f1..f13) and are still rendered gracefully by the submission viewer
(job_picker + site_picker both handled in Forms.jsx renderValue()).

Run:
    cd /app/backend && python -m scripts.migrate_visitor_register_v2

Env: reads MONGO_URL + DB_NAME from backend/.env (same as server.py).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Load backend .env explicitly so this script works from any cwd.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

TEMPLATE_NAME = "Site Sign-In / Visitor Register"
TARGET_TEMPLATE_VERSION = 2

NEW_FIELDS = [
    {"id": "site",                     "label": "Which site are you visiting?",
     "type": "site_picker",  "required": True},
    {"id": "visitor_name",             "label": "Full name",
     "type": "text",         "required": True},
    {"id": "visitor_company",          "label": "Company / Organisation (leave blank if none)",
     "type": "text",         "required": False},
    {"id": "visitor_phone",            "label": "Contact number",
     "type": "text",         "required": True,
     "config": {"keyboard": "phone-pad"}},
    {"id": "vehicle_rego",             "label": "Vehicle registration (leave blank if walk-in)",
     "type": "text",         "required": False,
     "config": {"uppercase": True}},
    {"id": "vehicle_type",             "label": "Vehicle type",
     "type": "select",       "required": False,
     "options": ["Car", "Ute", "Van", "Truck", "Motorbike", "Walk-in"]},
    {"id": "purpose",                  "label": "Purpose of visit",
     "type": "select",       "required": True,
     "options": ["Delivery", "Client meeting", "Contractor", "Inspector", "Other"]},
    {"id": "purpose_other",            "label": "If Other, describe purpose",
     "type": "text",         "required": False,
     "placeholder": "Only fill in if 'Other' was selected above"},
    {"id": "host_name",                "label": "Who are you here to see?",
     "type": "text",         "required": True},
    {"id": "ppe_briefed",              "label": "I confirm I have been briefed on site PPE requirements",
     "type": "radio",        "required": True,
     "options": ["Yes", "No"]},
    {"id": "id_sighted",               "label": "ID has been sighted by site supervisor",
     "type": "radio",        "required": False,
     "options": ["Yes", "No"]},
    {"id": "emergency_contact_name",   "label": "Emergency contact name",
     "type": "text",         "required": False},
    {"id": "emergency_contact_phone",  "label": "Emergency contact phone",
     "type": "text",         "required": False,
     "config": {"keyboard": "phone-pad"}},
    {"id": "time_in",                  "label": "Time in",
     "type": "time",         "required": True,
     "config": {"default_now": True}},
    {"id": "signature",                "label": "Visitor signature",
     "type": "signature",    "required": True},
    {"id": "photo",                    "label": "Photo of visitor (optional)",
     "type": "photo",        "required": False},
]


def _hash_fields(fields: list) -> str:
    """Stable hash of a fields array — used only for idempotency check."""
    canon = json.dumps(fields, sort_keys=True, default=str)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


async def main() -> int:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    doc = await db.form_templates.find_one({"name": TEMPLATE_NAME, "deleted_at": None})
    if not doc:
        print(f"[migrate_visitor_register_v2] No live template named {TEMPLATE_NAME!r} found. Nothing to do.")
        return 0

    tid = doc.get("id")
    current_fields = doc.get("fields") or []
    current_version = doc.get("template_version")

    expected_hash = _hash_fields(NEW_FIELDS)
    current_hash = _hash_fields(current_fields)

    if current_hash == expected_hash and current_version == TARGET_TEMPLATE_VERSION:
        print(f"[migrate_visitor_register_v2] Template {tid!r} already at v{TARGET_TEMPLATE_VERSION}. No change.")
        return 0

    print(f"[migrate_visitor_register_v2] Migrating template id={tid!r}")
    print(f"  from: {len(current_fields)} fields, template_version={current_version!r}")
    print(f"  to:   {len(NEW_FIELDS)} fields, template_version={TARGET_TEMPLATE_VERSION}")

    now = datetime.now(timezone.utc).isoformat()
    result = await db.form_templates.update_one(
        {"id": tid},
        {"$set": {
            "fields": NEW_FIELDS,
            "template_version": TARGET_TEMPLATE_VERSION,
            "updated_at": now,
        }},
    )
    print(f"[migrate_visitor_register_v2] matched={result.matched_count} modified={result.modified_count}")
    print(f"[migrate_visitor_register_v2] Done.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
