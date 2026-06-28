"""Idempotent seed — 1 org, 2 workspaces, 5 users, ~46 capture records.

Run on every backend startup. Safe to call repeatedly.
"""
from __future__ import annotations
import os
import random
from datetime import datetime, timedelta, timezone

from auth import hash_password
from db import db
from models import new_id, now_iso

random.seed(42)

ORG_NAME = "Paneltec Civil Pty Ltd"
WORKSPACES = ["Sydney Metro", "Newcastle Depot"]
DEMO_PWD = os.environ.get("DEMO_PASSWORD", "demo123")

SEED_USERS = [
    {"email": "demo@paneltec.com", "name": "Demo HSEQ Lead", "role": "hseq_lead"},
    {"email": "worker@paneltec.com", "name": "Casey Worker", "role": "worker"},
    {"email": "super@paneltec.com", "name": "Sam Supervisor", "role": "supervisor"},
    {"email": "audit@paneltec.com", "name": "Avery Auditor", "role": "auditor"},
    {"email": "admin@paneltec.com", "name": "Alex Admin", "role": "admin"},
]


def _iso_days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()


def _date_days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).date().isoformat()


async def _ensure_org_and_workspaces() -> tuple[str, list[str]]:
    org = await db.orgs.find_one({"name": ORG_NAME})
    if not org:
        org = {"id": new_id(), "name": ORG_NAME, "slug": "paneltec-civil", "created_at": now_iso()}
        await db.orgs.insert_one(dict(org))
    org_id = org["id"]

    ws_ids: list[str] = []
    for name in WORKSPACES:
        ws = await db.workspaces.find_one({"org_id": org_id, "name": name})
        if not ws:
            ws = {"id": new_id(), "org_id": org_id, "name": name, "created_at": now_iso()}
            await db.workspaces.insert_one(dict(ws))
        ws_ids.append(ws["id"])
    return org_id, ws_ids


async def _ensure_users(org_id: str, ws_ids: list[str]) -> dict[str, str]:
    """Returns mapping email -> user_id. Updates password if changed."""
    out: dict[str, str] = {}
    for u in SEED_USERS:
        existing = await db.users.find_one({"email": u["email"]})
        if existing:
            # Refresh password if the env-managed demo password changed.
            await db.users.update_one(
                {"id": existing["id"]},
                {"$set": {"password_hash": hash_password(DEMO_PWD),
                          "org_id": org_id, "workspace_ids": ws_ids,
                          "role": u["role"], "name": u["name"]}},
            )
            out[u["email"]] = existing["id"]
            continue
        doc = {
            "id": new_id(),
            "email": u["email"],
            "password_hash": hash_password(DEMO_PWD),
            "name": u["name"],
            "role": u["role"],
            "org_id": org_id,
            "workspace_ids": ws_ids,
            "token_version": 0,
            "created_at": now_iso(),
        }
        await db.users.insert_one(dict(doc))
        out[u["email"]] = doc["id"]
    return out


# ---------- Capture seed data ----------

SWMS_SEED = [
    ("Excavation near services — Pit 14", "approved",
     "Hand-dig excavation around live electrical service near Pit 14 on Sydney Metro project."),
    ("Concrete pour — bridge deck section B", "approved",
     "Pump pour for 25m³ on bridge deck section B; finishing crew of 6."),
    ("Working at heights — gantry install", "submitted",
     "Install gantry beam at 6.2m using EWP. Edge protection required."),
    ("Hot works — rebar welding bay 3", "approved",
     "Mig welding of rebar cages in bay 3. Fire watch present."),
    ("Confined space entry — culvert C7", "draft",
     "Entry into culvert C7 for inspection. Atmospheric testing pre-entry."),
    ("Demolition — old transformer slab", "changes_requested",
     "Saw cut and break out old transformer slab. Risk of buried services."),
    ("Traffic management — Erskineville turnout", "approved",
     "Single-lane closure with stop/slow controllers on Erskineville Rd."),
    ("Material lift — precast panels delivery", "submitted",
     "Use of 50t crane to land precast panels onto piers 4-7."),
]

PRE_START_SAMPLES = [
    ("Crew briefed on edge protection and exclusion zone. Hi-vis confirmed.",
     "Anchor point inspection deferred to QA. All toolbox attendees signed."),
    ("Mobile plant comms checks — all radios on Channel 14.", "No issues."),
    ("Site induction refresher for 2 new sub-contractors.", "Sign-on register updated."),
    ("Reviewed yesterday's near-miss at stockpile B. Re-positioned barrier.", "Tools tagged."),
]

HAZARD_SAMPLES = [
    ("Trip hazard — cable run across walkway", "medium",
     ["Re-route cable through trunking", "Install yellow cable ramp"], "open"),
    ("Missing edge protection — slab edge level 2", "high",
     ["Install handrail kit", "Mark exclusion zone"], "in_progress"),
    ("Damaged ladder — shed", "low", ["Tag out", "Replace ladder"], "closed"),
    ("Stored materials blocking egress route", "medium",
     ["Relocate to laydown 2", "Update site plan"], "open"),
    ("Diesel spill near generator pad", "high",
     ["Apply absorbent", "Bund generator", "Report to EHS"], "in_progress"),
    ("Unguarded penetration — bay 4 floor", "critical",
     ["Cover penetration", "Add hi-vis signage", "Notify all crews"], "open"),
]

INCIDENT_SAMPLES = [
    ("Near miss — scaffold edge during material pass-up", "near_miss",
     "Worker dropped a bolt from level 2. No injury.", "open"),
    ("First aid — minor cut to forearm on flashing", "first_aid",
     "Worker treated on site, returned to duties.", "closed"),
    ("Property damage — fence panel struck by excavator", "property",
     "Panel replaced same day. No injuries.", "in_progress"),
    ("Environmental — minor hydraulic oil leak", "env",
     "Spill contained with bund and absorbent. EPA threshold not exceeded.", "closed"),
]

INSPECTION_TEMPLATES = {
    "Site walk": [
        "Emergency egress routes clear",
        "First aid kit stocked and accessible",
        "Fire extinguishers in date",
        "Edge protection in place",
        "Housekeeping in laydown areas",
        "Hi-vis worn by all on site",
        "SWMS available at work face",
        "Toolbox talk record complete",
    ],
    "Plant inspection": [
        "Operator licence sighted",
        "Pre-start log completed",
        "Hydraulic leaks — none",
        "Mirrors and cameras clean",
        "Reversing alarm operational",
        "Fire extinguisher on board",
        "Tyres / tracks in good condition",
        "Service log up to date",
    ],
    "Working at height": [
        "EWP pre-start completed",
        "Anchor points certified",
        "Harnesses inspected and in date",
        "Rescue plan documented",
        "Exclusion zone established",
        "Tools tethered",
        "Weather conditions acceptable",
        "Permit issued",
    ],
}

SITE_DIARY_SAMPLES = [
    "Concrete pour started 0600, finished 1115. 25m³ delivered. Two delays — pump primer (15 min), inspector arrived late. Visitors: SafeWork inspector at 1330. Light rain after lunch.",
    "Crane lift sequence for piers 4-7 completed. No interruptions. Toolbox at 0700 covered exclusion zones. Delivery from BlueScope at 1430.",
    "Working at heights crew on gantry install. Anchor inspection certs filed. EHS visited site at 1000. Hot and dry conditions.",
    "Demolition saw cuts on transformer slab. Dust suppression intermittent due to water tanker delay. Visitors: client rep, geotech consultant.",
]


async def _seed_capture(org_id: str, ws_ids: list[str], user_ids: dict[str, str]) -> None:
    creator = user_ids.get("demo@paneltec.com")
    if not creator:
        return

    # SWMS
    if await db.swms.count_documents({"org_id": org_id}) == 0:
        docs = []
        for i, (title, status, desc) in enumerate(SWMS_SEED):
            ws_id = ws_ids[i % len(ws_ids)]
            docs.append({
                "id": new_id(), "org_id": org_id, "workspace_id": ws_id, "title": title,
                "job_description": desc, "status": status, "version": 1,
                "tasks": [{"step": str(j + 1), "description": f"Step {j + 1} for {title}"} for j in range(4)],
                "hazards": [{"label": "Manual handling", "risk": "medium"},
                            {"label": "Trip and slip", "risk": "low"}],
                "controls": [{"label": "Toolbox briefing", "method": "administrative"},
                             {"label": "Edge protection", "method": "engineering"}],
                "ppe": ["Hard hat", "Hi-vis", "Steel cap boots", "Safety glasses"],
                "created_by": creator, "created_at": _iso_days_ago(20 - i),
                "updated_at": _iso_days_ago(20 - i), "deleted_at": None,
            })
        await db.swms.insert_many(docs)

    # Pre-starts
    if await db.pre_starts.count_documents({"org_id": org_id}) == 0:
        docs = []
        for i in range(12):
            ws_id = ws_ids[i % len(ws_ids)]
            summary, notes = PRE_START_SAMPLES[i % len(PRE_START_SAMPLES)]
            docs.append({
                "id": new_id(), "org_id": org_id, "workspace_id": ws_id,
                "date": _date_days_ago(11 - i),
                "crew_lead": random.choice(["Jordan T.", "Priya S.", "Mick R.", "Sasha L."]),
                "work_summary": summary,
                "linked_swms_ids": [], "linked_permits": [],
                "hazards_discussed": "Edge work, manual handling, plant interaction",
                "sign_ons": [
                    {"name": "Casey W.", "role": "Labourer", "signature_ts": _iso_days_ago(11 - i)},
                    {"name": "Sam S.", "role": "Supervisor", "signature_ts": _iso_days_ago(11 - i)},
                ],
                "notes": notes,
                "created_by": creator, "created_at": _iso_days_ago(11 - i),
                "updated_at": _iso_days_ago(11 - i), "deleted_at": None,
            })
        await db.pre_starts.insert_many(docs)

    # Site diary
    if await db.site_diary_entries.count_documents({"org_id": org_id}) == 0:
        docs = []
        for i in range(10):
            ws_id = ws_ids[i % len(ws_ids)]
            raw = SITE_DIARY_SAMPLES[i % len(SITE_DIARY_SAMPLES)]
            docs.append({
                "id": new_id(), "org_id": org_id, "workspace_id": ws_id,
                "date": _date_days_ago(9 - i),
                "raw_notes": raw,
                "structured_log": {
                    "activities": ["Concrete pour", "Crane lift"],
                    "delays": ["Pump primer 15 min"],
                    "deliveries": ["BlueScope steel 1430"],
                    "visitors": ["SafeWork inspector"],
                    "weather": "Light rain after lunch",
                    "safety_observations": ["Hi-vis compliance 100%"],
                },
                "created_by": creator, "created_at": _iso_days_ago(9 - i),
                "updated_at": _iso_days_ago(9 - i), "deleted_at": None,
            })
        await db.site_diary_entries.insert_many(docs)

    # Hazards
    if await db.hazards.count_documents({"org_id": org_id}) == 0:
        docs = []
        for i, (title, sev, controls, status) in enumerate(HAZARD_SAMPLES):
            ws_id = ws_ids[i % len(ws_ids)]
            docs.append({
                "id": new_id(), "org_id": org_id, "workspace_id": ws_id,
                "title": title, "description": f"Detected on site walk on day -{6 - i}.",
                "photo_url": None, "location": random.choice(["Bay 3", "Level 2", "Laydown 1", "Pit 14"]),
                "severity": sev, "controls": controls, "status": status,
                "ai_analysis": None, "created_by": creator,
                "created_at": _iso_days_ago(6 - i), "updated_at": _iso_days_ago(6 - i),
                "deleted_at": None,
            })
        await db.hazards.insert_many(docs)

    # Incidents
    if await db.incidents.count_documents({"org_id": org_id}) == 0:
        docs = []
        for i, (title, cat, desc, status) in enumerate(INCIDENT_SAMPLES):
            ws_id = ws_ids[i % len(ws_ids)]
            docs.append({
                "id": new_id(), "org_id": org_id, "workspace_id": ws_id,
                "title": title, "occurred_at": _iso_days_ago(5 - i),
                "location": random.choice(["Level 2", "Laydown 2", "Bay 4", "Pit 14"]),
                "category": cat, "description": desc,
                "immediate_actions": "Area isolated, supervisor notified, photographs taken.",
                "evidence_photos": [], "follow_up_actions": [],
                "follow_up_status": status,
                "created_by": creator, "created_at": _iso_days_ago(5 - i),
                "updated_at": _iso_days_ago(5 - i), "deleted_at": None,
            })
        await db.incidents.insert_many(docs)

    # Inspections
    if await db.inspections.count_documents({"org_id": org_id}) == 0:
        docs = []
        templates = list(INSPECTION_TEMPLATES.items())
        for i in range(6):
            tpl_name, items = templates[i % len(templates)]
            ws_id = ws_ids[i % len(ws_ids)]
            checklist = []
            for label in items:
                resp = random.choices(["pass", "fail", "na"], weights=[7, 1, 2])[0]
                checklist.append({"label": label, "response": resp, "notes": None, "photo_url": None})
            docs.append({
                "id": new_id(), "org_id": org_id, "workspace_id": ws_id,
                "template_name": tpl_name, "date": _date_days_ago(7 - i),
                "checklist_items": checklist, "corrective_actions": [],
                "notes": None, "created_by": creator,
                "created_at": _iso_days_ago(7 - i), "updated_at": _iso_days_ago(7 - i),
                "deleted_at": None,
            })
        await db.inspections.insert_many(docs)


async def seed_all() -> dict:
    org_id, ws_ids = await _ensure_org_and_workspaces()
    user_ids = await _ensure_users(org_id, ws_ids)
    await _seed_capture(org_id, ws_ids, user_ids)
    from seed_phase3 import seed_phase3
    phase3 = await seed_phase3(org_id, ws_ids, user_ids)
    # Contractor seed wipe — soft-delete the seeded company rows so the
    # legacy Contractors view shows them as gone. Idempotent via _seed_marks.
    # Only touches rows created by the seed (identified by created_by ==
    # admin/hseq seeded users); leaves user-created contractors alone.
    mark = await db["seed_marks"].find_one({"key": "contractor_wipe_v1", "org_id": org_id})
    if not mark:
        seed_user_ids = [uid for uid in user_ids.values() if uid]
        await db.contractors.update_many(
            {"org_id": org_id, "deleted_at": None,
             "created_by": {"$in": seed_user_ids}},
            {"$set": {"deleted_at": now_iso(), "updated_at": now_iso()}},
        )
        await db["seed_marks"].insert_one({
            "key": "contractor_wipe_v1", "org_id": org_id,
            "applied_at": now_iso(),
        })
    # Phase 5 — one override on auditor + 5 sample outbox emails (idempotent)
    auditor_id = user_ids.get("audit@paneltec.com")
    if auditor_id and not await db.user_permissions.find_one({"user_id": auditor_id}):
        await db.user_permissions.insert_one({
            "user_id": auditor_id, "org_id": org_id,
            "overrides": {"audit_exports": {"edit": True}},
            "updated_at": now_iso(),
            "updated_by": user_ids.get("admin@paneltec.com") or auditor_id,
        })
    if await db.outbound_emails.count_documents({"org_id": org_id}) == 0:
        admin = user_ids.get("admin@paneltec.com") or auditor_id
        samples = [
            ("queued",    "Daily Pre-Start: today",          ["site@client.com"], "pre_starts"),
            ("sent",      "SWMS for Review: Excavation v2",  ["hseq@client.com"], "swms"),
            ("queued",    "Hazard Report: Trip on cable",    ["super@client.com"], "hazards"),
            ("failed",    "Incident Summary: Near miss",     ["insurance@client.com"], "incidents"),
            ("cancelled", "Audit Export: Q2 pack",           ["audit@client.com"], "audit_exports"),
        ]
        docs = []
        for status, subject, to_list, kind in samples:
            docs.append({
                "id": new_id(), "org_id": org_id, "to": to_list, "cc": [],
                "subject": subject,
                "body_html": f"<p>Auto-seeded sample for {kind}.</p>",
                "attachments": [], "related_record_type": kind,
                "related_record_id": None, "resource_kind": kind,
                "status": status,
                "provider": "microsoft365" if status == "sent" else None,
                "sent_at": now_iso() if status == "sent" else None,
                "error": "Auth token rejected" if status == "failed" else None,
                "created_by": admin, "created_at": now_iso(), "updated_at": now_iso(),
            })
        await db.outbound_emails.insert_many(docs)
    counts = {
        "users": await db.users.count_documents({"org_id": org_id}),
        "workspaces": len(ws_ids),
        "swms": await db.swms.count_documents({"org_id": org_id, "deleted_at": None}),
        "pre_starts": await db.pre_starts.count_documents({"org_id": org_id, "deleted_at": None}),
        "site_diary": await db.site_diary_entries.count_documents({"org_id": org_id, "deleted_at": None}),
        "hazards": await db.hazards.count_documents({"org_id": org_id, "deleted_at": None}),
        "incidents": await db.incidents.count_documents({"org_id": org_id, "deleted_at": None}),
        "inspections": await db.inspections.count_documents({"org_id": org_id, "deleted_at": None}),
        **phase3,
    }
    return {"org_id": org_id, "workspace_ids": ws_ids, "counts": counts}


async def ensure_indexes() -> None:
    await db.users.create_index("email", unique=True)
    for c in ("swms", "pre_starts", "site_diary_entries", "hazards", "incidents", "inspections"):
        await db[c].create_index([("org_id", 1), ("workspace_id", 1), ("created_at", -1)])
    # Asset register indexes (Phase 1).
    await db.assets.create_index("scan_token", unique=True)
    await db.assets.create_index([("org_id", 1), ("kind", 1)])
    await db.assets.create_index("navixy_device_id", sparse=True)
    await db.assets.create_index("nfc_uid", sparse=True)
    await db.asset_service_schedules.create_index("asset_id")
    await db.asset_service_schedules.create_index([("org_id", 1), ("status", 1)])
    await db.asset_service_schedules.create_index("next_due_at", sparse=True)
    await db.asset_service_records.create_index([("asset_id", 1), ("performed_at", -1)])
    await db.asset_service_records.create_index("linked_hazard_id", sparse=True)
    await db.asset_reminders_sent.create_index([("schedule_id", 1), ("sent_at", -1)])
