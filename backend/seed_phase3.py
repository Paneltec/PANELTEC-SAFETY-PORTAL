"""Phase 3 seed data — contractors, renewal links, sample audit exports."""
from __future__ import annotations
import hashlib
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from db import db
from models import new_id, now_iso

EXPORTS_DIR = Path(__file__).parent / "uploads" / "exports"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)


def _days(n: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=n)).date().isoformat()


def _iso(n: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=n)).isoformat()


CONTRACTORS = [
    ("Apex Scaffolding Pty Ltd", "Scaffolding", "active",
     [("public_liability", _days(60)), ("workers_comp", _days(120)),
      ("white_card", _days(700)), ("sw_license", _days(200))]),
    ("BlueRock Concrete", "Concrete", "active",
     [("public_liability", _days(15)), ("workers_comp", _days(180)),
      ("white_card", _days(400))]),
    ("Civic Earthworks", "Earthworks", "active",
     [("public_liability", _days(-10)), ("workers_comp", _days(45))]),
    ("Delta Crane Hire", "Crane / Lifting", "active",
     [("public_liability", _days(220)), ("workers_comp", _days(300)),
      ("sw_license", _days(20))]),
    ("Epoch Electrical", "Electrical", "suspended",
     [("public_liability", _days(-40)), ("workers_comp", _days(-5))]),
    ("FreshAir Ventilation", "HVAC", "active",
     [("public_liability", _days(80)), ("workers_comp", _days(200))]),
    ("Granite Demolition Pty Ltd", "Demolition", "inactive",
     [("public_liability", _days(500)), ("workers_comp", _days(500))]),
    ("Harbour Steel Erectors", "Steel erection", "active",
     [("public_liability", _days(25)), ("workers_comp", _days(180)),
      ("white_card", _days(250)), ("sw_license", _days(330))]),
]


async def seed_phase3(org_id: str, ws_ids: list[str], user_ids: dict[str, str]) -> dict:
    creator = user_ids.get("demo@paneltec.com")

    # Contractors
    if await db.contractors.count_documents({"org_id": org_id, "deleted_at": None}) == 0 and creator:
        contractors = []
        for name, trade, status, docs in CONTRACTORS:
            documents = []
            for kind, expiry in docs:
                today = datetime.now(timezone.utc).date()
                try:
                    exp = datetime.fromisoformat(expiry).date()
                except Exception:
                    exp = today
                if exp < today:
                    dstatus = "expired"
                elif (exp - today).days <= 30:
                    dstatus = "expiring_soon"
                else:
                    dstatus = "valid"
                documents.append({
                    "id": new_id(), "type": kind,
                    "file_url": f"/api/files/contractor_docs/sample_{kind}.pdf",
                    "expiry_date": expiry, "status": dstatus,
                    "uploaded_at": now_iso(),
                })
            contractors.append({
                "id": new_id(), "org_id": org_id, "name": name, "abn": "11 222 333 444",
                "contact_name": f"{name.split()[0]} Lead", "contact_email": f"contact@{name.split()[0].lower()}.com.au",
                "contact_phone": "+61 2 9000 0000", "trade": trade, "status": status,
                "documents": documents, "created_by": creator,
                "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
            })
        await db.contractors.insert_many(contractors)

    # Renewal links — pending, used, expired examples
    if await db.renewal_links.count_documents({"org_id": org_id}) == 0:
        sample_contractors = await db.contractors.find({"org_id": org_id, "deleted_at": None}, {"_id": 0}).to_list(3)
        if sample_contractors and creator:
            links = []
            for c, status, exp_offset in zip(sample_contractors[:3],
                                              ["pending", "used", "expired"],
                                              [+14, -3, -10]):
                links.append({
                    "id": new_id(), "org_id": org_id, "contractor_id": c["id"],
                    "contractor_name": c["name"],
                    "doc_types_requested": ["public_liability", "workers_comp"],
                    "token": uuid.uuid4().hex,
                    "expires_at": _iso(exp_offset), "status": status,
                    "created_by": creator, "created_at": now_iso(),
                    "used_at": now_iso() if status == "used" else None,
                    "submitted_files": [],
                })
            await db.renewal_links.insert_many(links)

    # Audit exports — write 2 sample JSON files + records
    if await db.audit_exports.count_documents({"org_id": org_id}) == 0 and creator:
        records = []
        for offset, fmt in ((20, "json"), (5, "json")):
            export_id = new_id()
            filename = f"{export_id}.{fmt}"
            payload = json.dumps({
                "meta": {"export_id": export_id, "scope": "Org-wide", "generated_at": _iso(-offset)},
                "data": {"summary": f"Sample seed export {offset} days ago"},
            }).encode("utf-8")
            (EXPORTS_DIR / filename).write_bytes(payload)
            sha = hashlib.sha256(payload).hexdigest()
            records.append({
                "id": export_id, "org_id": org_id, "workspace_id": None,
                "title": f"Quarterly Compliance Pack — sample {offset}d ago",
                "date_from": _days(-90 - offset), "date_to": _days(-offset),
                "include": ["swms", "pre_starts", "site_diary", "hazards", "incidents", "inspections", "contractors"],
                "format": fmt, "filename": filename,
                "file_url": f"/api/files/exports/{filename}",
                "sha256": sha, "size_bytes": len(payload), "counts": {},
                "scope": "All workspaces", "generated_at": _iso(-offset),
                "generated_by": "demo@paneltec.com", "created_at": _iso(-offset),
            })
        await db.audit_exports.insert_many(records)

    return {
        "contractors": await db.contractors.count_documents({"org_id": org_id, "deleted_at": None}),
        "renewal_links": await db.renewal_links.count_documents({"org_id": org_id}),
        "audit_exports": await db.audit_exports.count_documents({"org_id": org_id}),
    }
