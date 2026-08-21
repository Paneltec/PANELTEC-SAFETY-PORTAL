#!/usr/bin/env python3
"""v58.12.0 — Idempotent seed for the BYDA / Utility Awareness template.

Content is copied verbatim from the user's brief (5 sections). Section
banding: Gas + Water get `header_style: "highlighted"`; the rest render
plain. Attachment field allows the standard document mimes locked
in v58.12.0 (see forms.py ATTACHMENT_ALLOWED_MIMES). Actions field
consumes /api/workers/directory at fill-time (v58.11.2 endpoint).

Re-runs are safe: the upsert is keyed on `(org_id, name)` and reports
`skipped` when the template already exists.

Usage:
  python backend/scripts/seed_byda_utility_awareness_v58_12.py [--org-id <id>]
    → prints the resulting template id + skipped count.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

_env_path = Path(__file__).resolve().parents[1] / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

TEMPLATE_NAME = "BYDA / Utility Awareness"

MATRIX_ROWS = [
    # Section 0 — Gas (highlighted)
    {"section": "Gas", "asset": "Strategic Natural Gas Main",
     "condition": "Where an excavation is to occur within 25m of a Strategic Gas Main",
     "requirement": "Enwave (Tas Gas) must be notified to obtain a permit, which outlines specific conditions for the excavation method"},
    {"section": "Gas", "asset": "Non-Strategic Natural Gas Main/Service",
     "condition": "Where an excavation is used to establish the location of a non-strategic service within 5m of its supposed BYDA location",
     "requirement": "Excavation method to be non-destructive (Vac truck) or hand digging and at least one crew member to have completed the \"Gas Awareness Training\" in the past 2 years. Water jetting must not exceed 2000psi/135bar"},
    {"section": "Gas", "asset": "Non-Strategic Natural Gas Main/Service",
     "condition": "Where an excavation is to occur within 1m of a non-strategic gas main/service",
     "requirement": "Excavation method to be non-destructive (Vac truck) or hand digging and at least one crew member to have completed the \"Gas Awareness Training\" in the past 2 years. Water jetting must not exceed 2000psi/135bar"},
    {"section": "Gas", "asset": "Non-Strategic Natural Gas Main/Service",
     "condition": "Where an excavation is to occur within 5m and no closer that 1m using destructive plant",
     "requirement": "Both the operator AND spotter MUST hold current gas awareness cards/Enwave ID cards"},
    {"section": "Gas", "asset": "Non-Strategic Natural Gas Main/Service",
     "condition": "Where works include directional drilling or other non-destructive techniques that plan to cross over or under gas assets",
     "requirement": "Gas assets must be exposed using NDD methods. Driller or Tas Gas stand over must site the drill head or tool being used crossing under the asset with the required separation"},
    # Section 1 — Old Town Gas
    {"section": "Old Town Gas", "asset": "Redundant Town Gas Pipes",
     "condition": "Where either the main or affected surrounding soil/material is uncovered",
     "requirement": "Continued gas monitoring for VOC's and Hydrogen Cyanide is required"},
    # Section 2 — Water (highlighted)
    {"section": "Water", "asset": "Non-Strategic TasWater Assets",
     "condition": "Any excavation within 1m of any asset",
     "requirement": "Excavation method must be non-destructive (Vac truck/Hand digging), site owner must be informed"},
    {"section": "Water", "asset": "Strategic & Bulk TasWater Assets in Proximity, but not associated with works undertaken",
     "condition": "Excavation within 2m of - A water main 200mm in diameter or greater. OR - A Sewer gravity main 400mm in diameter or greater",
     "requirement": "Excavation method shall be NDD (Vac truck or hand digging), site owner must be informed"},
    {"section": "Water", "asset": "TasWater Dams and Associated Structures (Including weirs, sediment basins, sewerage lagoons, and outlet works)",
     "condition": "Excavations within 20m of any of these assets",
     "requirement": "Advice and approval must be obtained from the TasWater Dam Safety Team"},
    # Section 3 — Communications
    {"section": "Communications", "asset": "NBN Co/Telstra/Optus etc",
     "condition": "Where an excavation is to occur within 1m of any communications assets",
     "requirement": "Excavation method to be non-destructive only (Vac truck, hand digging)"},
    # Section 4 — Stormwater
    {"section": "Stormwater", "asset": "Stormwater",
     "condition": "Where an excavation is to occur within 1m of any stormwater assets",
     "requirement": "Excavation method to be non-destructive only (Vac truck, hand digging)"},
]

SECTIONS = [
    {"title": "Gas", "header_style": "highlighted"},
    {"title": "Old Town Gas", "header_style": "plain"},
    {"title": "Water", "header_style": "highlighted"},
    {"title": "Communications", "header_style": "plain"},
    {"title": "Stormwater", "header_style": "plain"},
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _template_fields() -> list:
    return [
        {
            "id": "byda_reference_matrix",
            "label": "Utility Awareness Reference Matrix",
            "type": "reference_matrix",
            "required": False,
            "options": [], "placeholder": "",
            "config": {
                "columns": [
                    {"key": "asset", "label": "Asset"},
                    {"key": "condition", "label": "Condition"},
                    {"key": "requirement", "label": "Requirement"},
                ],
                "rows": MATRIX_ROWS,
                "sections": SECTIONS,
            },
        },
        {
            "id": "byda_attachments",
            "label": "Supporting documents",
            "type": "attachment",
            "required": False,
            "options": [], "placeholder": "",
            "config": {
                "allow_multiple": True,
                "max_bytes": 25 * 1024 * 1024,
                "allowed_mimes": [
                    "application/pdf", "image/png", "image/jpeg", "image/webp",
                    "application/msword",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/vnd.ms-excel",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "text/csv", "text/plain",
                ],
            },
        },
        {
            "id": "byda_actions",
            "label": "Follow-up actions",
            "type": "actions",
            "required": False,
            "options": [], "placeholder": "",
            "config": {
                "columns": [
                    {"key": "first_name",   "label": "First name",   "type": "text"},
                    {"key": "last_name",    "label": "Last name",    "type": "text"},
                    {"key": "actionee_id",  "label": "Actionee",     "type": "worker_directory"},
                    {"key": "due_date",     "label": "Due date",     "type": "date"},
                    {"key": "date_closed",  "label": "Date closed",  "type": "date"},
                    {"key": "description",  "label": "Action",       "type": "textarea"},
                    {"key": "status",       "label": "Status",       "type": "select",
                     "options": ["Open", "In Progress", "Closed", "On Hold"]},
                    {"key": "last_comment", "label": "Last comment", "type": "text"},
                ],
            },
        },
    ]


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--org-id", default=None,
                    help="Org to seed for. Defaults to stephen's org.")
    args = ap.parse_args()
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    org_id = args.org_id
    if not org_id:
        stephen = await db.users.find_one({"email": "stephen@paneltec.com.au"}, {"_id": 0, "org_id": 1})
        if not stephen:
            print("No org_id supplied and stephen not found. Aborting.")
            return 2
        org_id = stephen["org_id"]

    existing = await db.form_templates.find_one(
        {"org_id": org_id, "name": TEMPLATE_NAME, "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    if existing:
        print(f"skipped (already exists): id={existing['id']}")
        return 0

    doc = {
        "id": str(uuid.uuid4()),
        "org_id": org_id,
        "name": TEMPLATE_NAME,
        "category": "general",
        "description": "BYDA / Utility Awareness reference matrix + follow-up actions.",
        "fields": _template_fields(),
        "required_certifications": [],
        "source": "seed_v58_12_0", "imported_at": None,
        "created_by": None,
        "created_at": _now(), "updated_at": _now(), "deleted_at": None,
    }
    await db.form_templates.insert_one(doc)
    print(f"inserted: id={doc['id']}  org_id={org_id}")
    print(f"  matrix rows: {len(MATRIX_ROWS)}  sections: {len(SECTIONS)}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
