"""v58.13.132eb — Harmonise CS-migrated incidents to the native
`IncidentIn` field shape.

Background
----------
The `.132dz` migration copied 254 `cs_incident_issues` docs into
`incidents` verbatim, and `.132ea` back-filled their org_id so
Stephen can see them. But the CS schema is alien to the native
Incident Reports UI: `issue_number` / `business_unit` /
`incident_categories` / `location_2` / three separate
`immediate_action_*` fields / etc. — none of which the native
list + detail views know how to render.

This script maps every `migrated_from=cs_incidents` row's CS
fields onto the native equivalents while preserving originals
as `_cs_*` audit copies (rollback-safe). Idempotent via
`_harmonised_at_v58_13_132eb`.

Field mapping
-------------
| CS field                    | Native field         | Transform                                   |
|-----------------------------|----------------------|---------------------------------------------|
| `description`               | `description`       | already native; leave as-is                 |
| `location_2`                | `location`          | copy verbatim if native missing             |
| `date_of_issue`             | `occurred_at`       | already ISO; copy verbatim if native missing|
| `incident_categories`       | `category`          | map free-text ↔ enum (see `_CATEGORY_MAP`)  |
| `status`                    | `follow_up_status`  | map "Closed"→"closed"; else "open"          |
| `immediate_action_2` + `_3` | `immediate_actions` | join non-blank into one string              |
| `employee_reporting`        | `person_involved`   | copy verbatim                               |
| —                           | `title`             | synthesize `f"CS-{issue_number}: {issue_type}"`|
| —                           | `evidence_photos`   | default `[]`                                |
| —                           | `follow_up_actions` | default `[]`                                |

Every CS-side field that gets read is also copied to a
`_cs_<field>` audit key on the doc (rollback safety).

Usage
-----
    python -m backend.scripts.harmonise_cs_incident_fields_v58_13_132eb --dry-run
    python -m backend.scripts.harmonise_cs_incident_fields_v58_13_132eb --commit
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).resolve()
_BACKEND = _HERE.parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(_BACKEND / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


STAMP_FIELD = "_harmonised_at_v58_13_132eb"

# ── Maps ──────────────────────────────────────────────────────

# `IncidentCategory` valid values from `backend/models.py`:
#   ["near_miss", "first_aid", "medical", "ltc", "env", "property"]
_CATEGORY_MAP = {
    "near miss": "near_miss",
    "near-miss": "near_miss",
    "environmental near miss": "env",
    "environmental": "env",
    "injury near miss": "near_miss",
    "first aid": "first_aid",
    "medical": "medical",
    "lost time": "ltc",
    "ltc": "ltc",
    "property": "property",
    "plant": "property",
    "other": "near_miss",
}

# `IncidentStatus` valid values from `backend/models.py`:
#   ["open", "in_progress", "closed"]
_STATUS_MAP = {
    "closed": "closed",
    "complete": "closed",
    "completed": "closed",
    "resolved": "closed",
    "open": "open",
    "in progress": "in_progress",
    "in-progress": "in_progress",
    "in_progress": "in_progress",
}

# Every CS field a caller might want to preserve — copied to
# `_cs_<field>` on the harmonised doc if not already prefixed.
_CS_AUDIT_FIELDS = [
    "issue_number", "issue_type", "business_unit",
    "employee_reporting", "closeout_manager", "responsible_manager",
    "entered_by", "date_of_issue", "date_of_entry", "date_reported",
    "date_closed", "time_of_issue", "location_2",
    "incident_categories", "actual_incident_category",
    "potential_incident_category", "status", "primary_hazard",
    "sources_of_hazard", "work_activity_performed",
    "near_miss_description",
    "immediate_action_2", "immediate_action_3",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _map_category(cs_val: str | None) -> str:
    if not cs_val:
        return "near_miss"
    v = str(cs_val).strip().lower()
    return _CATEGORY_MAP.get(v, "near_miss")


def _map_status(cs_val: str | None) -> str:
    if not cs_val:
        return "open"
    v = str(cs_val).strip().lower()
    return _STATUS_MAP.get(v, "open")


def _synthesize_title(doc: dict) -> str:
    issue_num = doc.get("issue_number") or "?"
    issue_type = doc.get("issue_type") or "Incident"
    # Include first line of description for context; cap at 80 chars.
    desc = (doc.get("description") or "").strip().split("\n")[0][:80]
    tail = f" — {desc}" if desc else ""
    return f"CS-{issue_num}: {issue_type}{tail}"


def _join_actions(doc: dict) -> str:
    parts = [doc.get("immediate_action_2"), doc.get("immediate_action_3")]
    lines = [str(p).strip() for p in parts if p and str(p).strip()]
    return "\n".join(lines)


def _harmonise_doc(doc: dict) -> dict:
    """Return the `$set` payload to apply. Preserves the native fields
    a caller may already have populated (never overwrites)."""
    out: dict = {}

    # `title` — synthesize when missing.
    if not doc.get("title"):
        out["title"] = _synthesize_title(doc)

    # `occurred_at` — the native field the list + detail views read.
    # CS docs may carry the primary date on any of a few fields; we
    # cascade through them in order of semantic proximity so an
    # incident always surfaces SOME date on the FE.
    if not doc.get("occurred_at"):
        for cs_key in ("date_of_issue", "date_reported",
                       "date_of_entry", "imported_at", "created_at"):
            v = doc.get(cs_key)
            if v:
                out["occurred_at"] = v
                break

    # `location` from `location_2`.
    if not doc.get("location") and doc.get("location_2"):
        out["location"] = doc["location_2"]

    # `category` from `incident_categories`.
    if not doc.get("category"):
        out["category"] = _map_category(doc.get("incident_categories"))

    # `follow_up_status` from `status`.
    if not doc.get("follow_up_status"):
        out["follow_up_status"] = _map_status(doc.get("status"))

    # `immediate_actions` from `immediate_action_2` + `_3`.
    if not doc.get("immediate_actions"):
        joined = _join_actions(doc)
        if joined:
            out["immediate_actions"] = joined

    # `person_involved` from `employee_reporting`.
    if not doc.get("person_involved") and doc.get("employee_reporting"):
        out["person_involved"] = doc["employee_reporting"]

    # Native array-typed fields — default empty when missing.
    if "evidence_photos" not in doc:
        out["evidence_photos"] = []
    if "follow_up_actions" not in doc:
        out["follow_up_actions"] = []

    # Audit copies of every CS field we may have read.
    for f in _CS_AUDIT_FIELDS:
        cs_key = f"_cs_{f}"
        if cs_key not in doc and f in doc:
            out[cs_key] = doc[f]

    out[STAMP_FIELD] = _now_iso()
    return out


async def run(commit: bool) -> int:
    db = _db()
    mode = "COMMIT" if commit else "DRY-RUN"
    print(f"v58.13.132eb CS-field harmonisation — mode={mode}")

    q = {"migrated_from": "cs_incidents",
         STAMP_FIELD: {"$exists": False}}
    total_migrated = await db.incidents.count_documents(
        {"migrated_from": "cs_incidents"}
    )
    to_do = await db.incidents.count_documents(q)
    already = total_migrated - to_do

    print(f"  incidents.migrated_from=cs_incidents total: {total_migrated}")
    print(f"  · already harmonised:                       {already}")
    print(f"  · to harmonise this run:                    {to_do}")

    if to_do == 0:
        print("  Nothing to do.")
        return 0

    sample_ids: list[str] = []
    sample_diffs: list[dict] = []
    touched = 0
    async for doc in db.incidents.find(q):
        payload = _harmonise_doc(doc)
        if not payload:
            continue
        touched += 1
        if len(sample_ids) < 5:
            sample_ids.append(doc.get("id"))
            sample_diffs.append({
                "id": doc.get("id"),
                "before": {k: doc.get(k) for k in (
                    "title", "occurred_at", "location", "category",
                    "follow_up_status", "immediate_actions",
                    "person_involved", "evidence_photos",
                    "follow_up_actions")},
                "after_set_keys": sorted(payload.keys()),
            })
        if commit:
            await db.incidents.update_one({"id": doc["id"]},
                                          {"$set": payload})

    print(f"  {'WOULD harmonise' if not commit else 'harmonised'} {touched} rows")
    print(f"  sample ids: {sample_ids}")
    if sample_diffs:
        print(f"  sample transform for {sample_diffs[0]['id']}:")
        print(f"    · before: {sample_diffs[0]['before']}")
        print(f"    · $set keys ({len(sample_diffs[0]['after_set_keys'])}): "
              f"{sample_diffs[0]['after_set_keys']}")

    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    commit = bool(args.commit) and not args.dry_run
    return asyncio.run(run(commit))


if __name__ == "__main__":
    sys.exit(main())
