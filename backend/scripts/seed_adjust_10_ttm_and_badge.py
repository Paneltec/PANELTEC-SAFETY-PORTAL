#!/usr/bin/env python3
"""
v160.3.0-adjust-10 — Two things:
  1. Seed the "TTM Risk Assessment & Treatment Register" template
     across every org (idempotent, name-keyed, adds to worker allowlist).
  2. Backfill `source: "paneltec"` on the 5 templates seeded by
     adjust-8 + adjust-9 so the Forms tab can render the maker's-mark
     pill next to them.

Run:
    cd /app && set -a && source backend/.env && set +a && \
        python3 backend/scripts/seed_adjust_10_ttm_and_badge.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


TEMPLATE_NAME = "TTM Risk Assessment & Treatment Register"
TEMPLATE_CATEGORY = "inspection"
TEMPLATE_DESCRIPTION = (
    "Traffic and Traffic Management Risk Assessment & Treatment Register "
    "— site details, weather, traffic count, vulnerable road users, path "
    "users, traffic impacts, times of operation, environmental risks, "
    "site access, hazard photos and assessor declaration. Feeds the TMP / "
    "TGS produced for the worksite."
)

COMPANY_OPTIONS = [
    {"label": "Paneltec Civil", "simpro_id": "2"},
    {"label": "Viatec",         "simpro_id": "3"},
]

WEATHER_OPTIONS = ["Fine", "Overcast", "Rain", "Wind", "Fog", "Snow", "Other"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _yn(label: str, required: bool = True) -> dict:
    return {"id": _new_id(), "label": label, "type": "radio",
            "required": required, "options": ["Yes", "No"],
            "placeholder": "", "config": {}}


def _confirm(label: str) -> dict:
    return {"id": _new_id(), "label": label, "type": "radio",
            "required": True, "options": ["I confirm"],
            "placeholder": "", "config": {}}


def build_fields() -> list[dict]:
    f: list[dict] = []

    # ── A. Standard Header ──
    f.append({"id": _new_id(), "label": "Date", "type": "date",
              "required": True, "options": [], "placeholder": "",
              "config": {"default_today": True}})
    f.append({"id": _new_id(), "label": "Assessor (Name)", "type": "worker_picker",
              "required": True, "options": [], "placeholder": "",
              "config": {"inline_company_toggle": True,
                         "company_options": COMPANY_OPTIONS}})
    f.append({"id": _new_id(), "label": "Location", "type": "gps",
              "required": True, "options": [], "placeholder": "",
              "config": {"reverse_geocode": True}})
    f.append({"id": _new_id(), "label": "Select Vehicle (optional)",
              "type": "vehicle_navixy", "required": False, "options": [],
              "placeholder": "", "config": {}})

    # ── B. Site Details ──
    f.append({"id": _new_id(), "label": "Assessment Time", "type": "time",
              "required": True, "options": [], "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "Site Location details",
              "type": "textarea", "required": True, "options": [],
              "placeholder": "Nearest house number, cross-street, road reserve details.",
              "config": {}})
    f.append({"id": _new_id(), "label": "Traffic Management Designer (TMD)",
              "type": "text", "required": True, "options": [],
              "placeholder": "Name of TMD", "config": {}})
    f.append({"id": _new_id(), "label": "Weather at time of Assessment",
              "type": "select", "required": True, "options": WEATHER_OPTIONS,
              "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "Customer",
              "type": "text", "required": True, "options": [],
              "placeholder": "e.g. TasWater, Council, Contractor, Other",
              "config": {}})
    f.append({"id": _new_id(), "label": "Customer name if 'Other'",
              "type": "text", "required": False, "options": [],
              "placeholder": "", "config": {}})

    # ── C. Work Details ──
    f.append({"id": _new_id(), "label": "Type of works to be conducted",
              "type": "textarea", "required": True, "options": [],
              "placeholder": "", "config": {}})
    f.append({"id": _new_id(), "label": "Estimated distance of work zone (length x width)",
              "type": "text", "required": True, "options": [],
              "placeholder": "e.g. 40m x 3m", "config": {}})
    f.append({"id": _new_id(), "label": "Estimated lane width per lane",
              "type": "text", "required": True, "options": [],
              "placeholder": "e.g. 3.2m", "config": {}})

    # ── D. Traffic Assessment ──
    f.append({"id": _new_id(), "label": "Vehicle count over 5 minutes",
              "type": "number", "required": True, "options": [],
              "placeholder": "count", "config": {}})
    f.append({"id": _new_id(),
              "label": "Estimated vehicles per hour (auto: count × 12 — enter final figure)",
              "type": "number", "required": True, "options": [],
              "placeholder": "vehicles/hr", "config": {}})
    f.append({"id": _new_id(),
              "label": "Pedestrians / cyclists present during count? (or N/A)",
              "type": "text", "required": True, "options": [],
              "placeholder": "N/A if none", "config": {}})
    f.append({"id": _new_id(), "label": "Posted speed limit (km/h)",
              "type": "number", "required": True, "options": [],
              "placeholder": "km/h", "config": {}})

    # ── E. Vulnerable Road Users ──
    for lbl in [
        "Pedestrians present?",
        "Cyclists present?",
        "Children present?",
        "Motorcyclists present?",
        "Elderly / mobility-impaired present?",
    ]:
        f.append(_yn(f"Vulnerable Road Users — {lbl}"))

    # ── F. Path Users ──
    for lbl in [
        "Unclear direction for path users",
        "Path obstructed by works",
        "Path closed / diversion required",
    ]:
        f.append(_yn(f"Path Users — {lbl}"))

    # ── G. Site Location / Traffic Impacts ──
    for lbl in [
        "Narrow or restricted access",
        "Vehicle or plant thoroughfare",
        "Traffic queues & delays",
        "Available lane width restricted",
        "Intersections / turning lanes affected",
        "Blind corners / limited sight distance",
    ]:
        f.append(_yn(f"Traffic Impacts — {lbl}"))

    # ── H. Times of Operation ──
    for lbl in [
        "TMP required for > 14 hrs in single shift",
        "Peak hours AM / PM (arterial road)",
        "Night works",
        "Weekend works",
    ]:
        f.append(_yn(f"Times of Operation — {lbl}"))

    # ── I. Environmental Risk ──
    for lbl in [
        "Existing infrastructure conflict",
        "Shadowing / fog / glare",
        "Wet weather / surface conditions",
        "Wind exposure",
        "Noise / vibration sensitive receivers",
    ]:
        f.append(_yn(f"Environmental Risk — {lbl}"))

    # ── J. Site Access ──
    for lbl in [
        "Emergency vehicle access maintained",
        "Work traffic entering & exiting live traffic stream",
        "Combination trucks (semi-trailers) accessing site",
        "Public property access affected",
        "Property driveways affected",
    ]:
        f.append(_yn(f"Site Access — {lbl}"))

    # ── K. Unforeseen Hazards & Photos ──
    f.append({"id": _new_id(),
              "label": "List any unforeseen hazards / issues identified during assessment",
              "type": "textarea", "required": False, "options": [],
              "placeholder": "", "config": {}})
    for i in range(1, 5):
        f.append({"id": _new_id(), "label": f"Hazard photo {i}",
                  "type": "photo", "required": False, "options": [],
                  "placeholder": "", "config": {}})

    # ── L. Declaration & Signature ──
    f.append(_confirm(
        "I confirm the above Risk Assessment is a true and accurate "
        "representation of this worksite at the time and date of "
        "assessment. Site hazards and associated risks identified have "
        "been logged and their treatment / mitigation will be detailed "
        "in the following Traffic Management Plan (TMP) and / or "
        "Traffic Guidance Schemes (TGS)."
    ))
    f.append({"id": _new_id(), "label": "Assessor signature",
              "type": "signature", "required": True, "options": [],
              "placeholder": "", "config": {}})

    # ── M. Final ──
    f.append(_confirm("Assessment Complete"))
    return f


async def _grant_role_allowlist(db, org_id: str, template_id: str) -> list[str]:
    org = await db.orgs.find_one({"id": org_id}, {"_id": 0, "role_form_allowlist": 1}) or {}
    matrix: dict = org.get("role_form_allowlist") or {}
    updated: list[str] = []
    for role, allowlist in matrix.items():
        if role == "admin":
            continue
        if not isinstance(allowlist, list):
            continue
        if template_id in allowlist:
            continue
        await db.orgs.update_one(
            {"id": org_id},
            {"$addToSet": {f"role_form_allowlist.{role}": template_id}},
        )
        updated.append(role)
    return updated


async def seed_ttm_for_org(db, org_id: str) -> dict:
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
        "created_by": "system:seed_adjust_10_ttm",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "deleted_at": None,
    }
    await db.form_templates.insert_one(doc)
    granted = await _grant_role_allowlist(db, org_id, doc["id"])
    return {"status": "inserted", "id": doc["id"],
            "field_count": len(doc["fields"]),
            "allowlist_granted": granted}


async def backfill_paneltec_badge(db) -> dict:
    """Set `source: "paneltec"` on the 5 templates seeded by adjust-8 and
    adjust-9. Idempotent — never touches rows already at "paneltec"."""
    legacy_sources = [
        "seed_v160_3_0_adjust_8",
        "seed_v160_3_0_adjust_9_cvt",
        "seed_v160_3_0_adjust_9_weekly",
        "seed_v160_3_0_adjust_9_tip_truck",
        "seed_v160_3_0_adjust_9_ssra",
    ]
    per_source: dict = {}
    for src in legacy_sources:
        r = await db.form_templates.update_many(
            {"source": src},
            {"$set": {"source": "paneltec",
                      "original_source": src,
                      "updated_at": _now_iso()}},
        )
        per_source[src] = r.modified_count
    return per_source


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

    print(f"── Task A: seed '{TEMPLATE_NAME}' across {len(orgs)} orgs ──")
    inserted = 0; skipped = 0
    for oid in orgs:
        r = await seed_ttm_for_org(db, oid)
        marker = "+" if r["status"] == "inserted" else "="
        print(f" {marker} [{oid[:8]}…] {r}")
        if r["status"] == "inserted": inserted += 1
        else: skipped += 1
    print(f"SUMMARY A: inserted={inserted} skipped_exists={skipped}\n")

    print("── Task B: backfill source='paneltec' on adjust-8/9 templates ──")
    per = await backfill_paneltec_badge(db)
    total = sum(per.values())
    for src, n in per.items():
        print(f"  {src:40s} → {n} rows updated")
    print(f"SUMMARY B: {total} template rows now marked source='paneltec'")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
