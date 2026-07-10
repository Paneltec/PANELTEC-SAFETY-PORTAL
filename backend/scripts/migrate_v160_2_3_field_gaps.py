"""v160.2.3 — Field-gap fill migration.

Idempotent. Safe to re-run. Snapshots `form_templates` to
`form_templates_backup_v160_2_2` on first run only.

Goals:
  1. Add missing `worker_picker` (Operator/Reporter) to templates that
     don't have one but should (Task 1 in the v160.2.3 brief).
  2. Add missing `vehicle_navixy` to Excavation / Trench Permit.
  3. Add standalone `company_selector` dropdown to permits, JSEA, SWMS
     Sign-On, Incident + Near Miss reports and Equipment Pre-Use.
  4. Add `time` fields:
       - Convert existing plain-text "Permit Valid From/To (time)" on
         Hot Work + Confined Space to the new `time` type.
       - Add Time In / Time Out to Toolbox Talk, Toolbox Talk
         Attendance, Site Sign-In, Site Induction, Excavation +
         Working at Heights permits.

Placement rule (per Standard Header — see backend/forms.py docstring):
   0. date         (default_today)
   1. worker_picker (Operator/Attendees/Reporter · inline_company_toggle)
   2. gps          (Location · reverse_geocode)
   3. vehicle_navixy (if applicable)
   → new company_selector: injected AFTER the vehicle slot (position 4)
   → new time fields:      injected right after company_selector

Skipped as out-of-scope test / seed templates:
   BuilderTest renamed, Test AssetScan Template, Test Hot Work Permit,
   v160.0.12 test template, site-safety-checklist.
"""
from __future__ import annotations
import asyncio
import os
import sys
import uuid
from pathlib import Path

# Allow `python scripts/migrate_v160_2_3_field_gaps.py` from any cwd.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(_BACKEND_DIR / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


BACKUP_NAME = "form_templates_backup_v160_2_2"

COMPANY_OPTIONS = [
    {"label": "Paneltec Civil", "simpro_id": "2"},
    {"label": "Viatec", "simpro_id": "3"},
]


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _mk_worker_picker(label: str, multi: bool, required: bool = True) -> dict:
    return {
        "id": _new_id(), "label": label, "type": "worker_picker",
        "required": required, "options": [], "placeholder": "",
        "config": {
            "inline_company_toggle": True,
            "company_options": COMPANY_OPTIONS,
            **({"multi": True} if multi else {}),
        },
    }


def _mk_vehicle(label: str = "Select Vehicle / Plant", required: bool = True) -> dict:
    return {
        "id": _new_id(), "label": label, "type": "vehicle_navixy",
        "required": required, "options": [], "placeholder": "", "config": {},
    }


def _mk_company_selector(label: str = "Company / Organisation",
                        required: bool = True) -> dict:
    return {
        "id": _new_id(), "label": label, "type": "company_selector",
        "required": required, "options": [], "placeholder": "", "config": {},
    }


def _mk_time(label: str, required: bool = True) -> dict:
    return {
        "id": _new_id(), "label": label, "type": "time",
        "required": required, "options": [], "placeholder": "", "config": {},
    }


def _has_field_type(fields: list[dict], typ: str) -> bool:
    return any((f or {}).get("type") == typ for f in fields)


def _has_label(fields: list[dict], label: str) -> bool:
    lbl_l = label.lower().strip()
    return any((f or {}).get("label", "").lower().strip() == lbl_l for f in fields)


def _find_index(fields: list[dict], predicate) -> int:
    for i, f in enumerate(fields):
        if predicate(f):
            return i
    return -1


def _insert_after(fields: list[dict], after_type: str, new_field: dict) -> list[dict]:
    """Insert `new_field` right after the last field of `after_type`. If
    no such field exists, append at the end. Idempotent — caller checks
    for duplicates first."""
    last = -1
    for i, f in enumerate(fields):
        if (f or {}).get("type") == after_type:
            last = i
    if last == -1:
        return fields + [new_field]
    return fields[:last + 1] + [new_field] + fields[last + 1:]


def _slot_after_standard_header(fields: list[dict]) -> int:
    """Return the index just after the last of the standard-header fields
    (date, worker_picker, gps, vehicle_navixy). Falls back to len(fields)
    when no header slot exists."""
    header_types = {"date", "worker_picker", "gps", "vehicle_navixy"}
    last = -1
    for i, f in enumerate(fields):
        if (f or {}).get("type") in header_types:
            last = i
    return last + 1 if last >= 0 else len(fields)


def _insert_at(fields: list[dict], idx: int, new_field: dict) -> list[dict]:
    return fields[:idx] + [new_field] + fields[idx:]


# ─── Template-specific migrations ────────────────────────────────────────

SKIP_NAMES = {
    "BuilderTest renamed",
    "Test AssetScan Template",
    "Test Hot Work Permit",
    "v160.0.12 test template",
    "site-safety-checklist",
}


# Task 1: templates that need a NEW worker_picker added.
# (name, label, multi)
ADD_WORKER = [
    ("Equipment Pre-Use Checklist", "Operator (Name)", False),
    ("Incident Report",             "Reporter (Name)", False),
    ("Incident Report Form",        "Reporter (Name)", False),
    ("Near Miss Report",            "Reporter (Name)", False),
    ("Toolbox Talk",                "Attendees",       True),
]

# Task 2: templates that need a NEW vehicle_navixy.
ADD_VEHICLE = [
    ("Excavation / Trench Permit", "Select Plant / Excavator"),
]

# Task 3: templates that need a company_selector.
ADD_COMPANY_SELECTOR = [
    "Hot Work Permit",
    "Confined Space Entry Permit",
    "Excavation / Trench Permit",
    "Working at Heights Permit",
    "JSEA — Job Safety & Environmental Analysis",
    "SWMS Sign-On",
    "Incident Report",
    "Incident Report Form",
    "Near Miss Report",
    "Equipment Pre-Use Checklist",
]

# Task 4: templates that need Time In / Time Out (add BOTH).
# (name, in_label, out_label)
ADD_TIME_IN_OUT = [
    ("Toolbox Talk",                    "Start Time",     "End Time"),
    ("Toolbox Talk Attendance",         "Start Time",     "End Time"),
    ("Site Sign-In / Visitor Register", "Time In",        "Time Out"),
    ("Site Induction Checklist",        "Start Time",     "End Time"),
    ("Excavation / Trench Permit",      "Permit Time In", "Permit Time Out"),
    ("Working at Heights Permit",       "Permit Time In", "Permit Time Out"),
]

# Task 4 (part 2): CONVERT existing plain-text "(time)" fields to `time` type.
CONVERT_TEXT_TO_TIME = [
    ("Hot Work Permit",                  ["Permit Valid From (time)", "Permit Valid To (time)"]),
    ("Confined Space Entry Permit",      ["Permit Valid From (time)", "Permit Valid To (time)"]),
    # v160.2.3 — Site Sign-In already had Time In / Time Out as plain
    # text fields (pre-migration). Convert them so the mobile time
    # picker opens instead of a raw keyboard.
    ("Site Sign-In / Visitor Register",  ["Time In", "Time Out"]),
]

# Task 3 (part 2): CONVERT existing plain-text "Company / Organisation"
# fields to the new `company_selector` type where they already exist as
# free-text.
CONVERT_TEXT_TO_COMPANY_SELECTOR = [
    ("Site Sign-In / Visitor Register", ["Company / Organisation"]),
]


async def _snapshot(db):
    """One-shot snapshot on first run. Safe to re-run — the copy is
    skipped if the backup collection already exists with rows."""
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


async def _run_migration(db) -> dict:
    stats = {
        "workers_added": 0, "vehicles_added": 0,
        "company_selectors_added": 0, "time_fields_added": 0,
        "time_conversions": 0, "templates_touched": 0,
        "skipped_test_templates": 0,
    }

    # Fetch all live templates.
    all_tpls = await db.form_templates.find({}).to_list(5000)
    print(f"[migration] scanning {len(all_tpls)} templates…")

    for tpl in all_tpls:
        name = (tpl.get("name") or "").strip()
        if name in SKIP_NAMES:
            stats["skipped_test_templates"] += 1
            continue

        fields = list(tpl.get("fields") or [])
        original_len = len(fields)
        original_snapshot = [dict(f) for f in fields]
        touched = False

        # Task 1 — add worker_picker if missing (per whitelist).
        for tn, label, multi in ADD_WORKER:
            if name == tn and not _has_field_type(fields, "worker_picker"):
                # Insert at position 1 (after the date slot if present, else pos 0).
                date_idx = _find_index(fields, lambda f: f.get("type") == "date")
                insert_at = (date_idx + 1) if date_idx >= 0 else 0
                fields = _insert_at(fields, insert_at, _mk_worker_picker(label, multi))
                stats["workers_added"] += 1
                touched = True

        # Task 2 — add vehicle_navixy if missing.
        for tn, label in ADD_VEHICLE:
            if name == tn and not _has_field_type(fields, "vehicle_navixy"):
                gps_idx = _find_index(fields, lambda f: f.get("type") == "gps")
                insert_at = (gps_idx + 1) if gps_idx >= 0 else len(fields)
                fields = _insert_at(fields, insert_at, _mk_vehicle(label))
                stats["vehicles_added"] += 1
                touched = True

        # Task 3 — add company_selector if missing.
        if name in ADD_COMPANY_SELECTOR and not _has_field_type(fields, "company_selector"):
            insert_at = _slot_after_standard_header(fields)
            fields = _insert_at(fields, insert_at, _mk_company_selector())
            stats["company_selectors_added"] += 1
            touched = True

        # Task 4a — CONVERT existing text (time) fields to `time` type.
        for tn, labels_to_convert in CONVERT_TEXT_TO_TIME:
            if name == tn:
                for lbl in labels_to_convert:
                    for i, f in enumerate(fields):
                        if (f.get("label", "").strip() == lbl
                                and f.get("type") == "text"):
                            new_lbl = lbl.replace(" (time)", "").strip()
                            fields[i] = {**f, "type": "time", "label": new_lbl}
                            stats["time_conversions"] += 1
                            touched = True

        # Task 3b — CONVERT existing text company fields to company_selector.
        for tn, labels_to_convert in CONVERT_TEXT_TO_COMPANY_SELECTOR:
            if name == tn:
                for lbl in labels_to_convert:
                    for i, f in enumerate(fields):
                        if (f.get("label", "").strip() == lbl
                                and f.get("type") == "text"):
                            fields[i] = {
                                **f, "type": "company_selector",
                                "config": (f.get("config") or {}),
                            }
                            stats["company_selectors_added"] += 1
                            touched = True

        # Task 4b — ADD Time In / Time Out where missing.
        for tn, in_label, out_label in ADD_TIME_IN_OUT:
            if name == tn:
                if not _has_label(fields, in_label):
                    insert_at = _slot_after_standard_header(fields)
                    # Position AFTER company_selector if we just added one.
                    cs_idx = _find_index(fields, lambda f: f.get("type") == "company_selector")
                    if cs_idx >= 0:
                        insert_at = cs_idx + 1
                    fields = _insert_at(fields, insert_at, _mk_time(in_label, required=False))
                    stats["time_fields_added"] += 1
                    touched = True
                if not _has_label(fields, out_label):
                    # Right after the just-inserted Time In (or end of header).
                    in_idx = _find_index(fields, lambda f: f.get("label") == in_label)
                    insert_at = (in_idx + 1) if in_idx >= 0 else _slot_after_standard_header(fields)
                    fields = _insert_at(fields, insert_at, _mk_time(out_label, required=False))
                    stats["time_fields_added"] += 1
                    touched = True

        if touched:
            stats["templates_touched"] += 1
            await db.form_templates.update_one(
                {"id": tpl["id"]},
                {"$set": {"fields": fields}},
            )
            print(f"  ✓ {name}: {original_len} → {len(fields)} fields")

    return stats


async def main():
    url = os.environ.get("MONGO_URL")
    dbn = os.environ.get("DB_NAME")
    if not url or not dbn:
        raise RuntimeError("MONGO_URL / DB_NAME not set")
    client = AsyncIOMotorClient(url)
    db = client[dbn]
    print(f"[migration v160.2.3] db={dbn}")
    await _snapshot(db)
    stats = await _run_migration(db)
    print()
    print("── SUMMARY ──")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    print()
    print("[migration v160.2.3] done.")


if __name__ == "__main__":
    asyncio.run(main())
