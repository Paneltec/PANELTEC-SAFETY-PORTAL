#!/usr/bin/env python3
"""v58.13.132ia — Merge Hazard Reports INTO Incidents.

Promotes every row in `db.hazards` (deleted_at=None) into `db.incidents`
with `category = "hazard"` and an audit trail (`_migrated_from_hazard_id`,
`_migrated_at`). Idempotent — a second run skips rows already promoted.

Usage:
    python migrations/merge_hazards_into_incidents_v58_13_132ia.py           # dry-run
    python migrations/merge_hazards_into_incidents_v58_13_132ia.py --commit  # apply

Post-ship posture:
    · Original hazards rows are left in place with `_promoted_to_incident_id`
      + `_promoted_at` fields so the read-only alias on `/api/hazards`
      still resolves for one release cycle.
    · Follow-up ship `.132ib` will 410 the write endpoints on /hazards.
"""
from __future__ import annotations
import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
load_dotenv()

from pymongo import MongoClient

CLIENT = MongoClient(os.environ["MONGO_URL"])
DB = CLIENT[os.environ["DB_NAME"]]

# Hazard.category → Incident.category mapping. Every legacy hazard
# lands as `hazard` unless the row explicitly self-classifies as a
# near-miss, in which case we preserve that.
_CAT_MAP = {
    "near_miss": "near_miss",
    "hazard":    "hazard",
    "":          "hazard",
    None:        "hazard",
}


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true",
                    help="Apply writes. Default is dry-run.")
    args = ap.parse_args()

    cursor = DB.hazards.find({"deleted_at": None,
                              "_promoted_to_incident_id": {"$exists": False}})
    to_promote = list(cursor)
    print(f"[v58.13.132ia] hazards eligible: {len(to_promote)}")
    if not to_promote:
        print("Nothing to do.")
        return 0

    inserts = []
    updates = []
    for h in to_promote:
        new_id = f"incident-{h['id']}"  # deterministic so re-runs are no-ops
        if DB.incidents.find_one({"id": new_id}, {"id": 1}):
            print(f"  · already promoted: {h['id']} → {new_id}")
            continue
        cat = _CAT_MAP.get(h.get("category"), "hazard")
        inc_doc = {
            "id": new_id,
            "org_id":       h.get("org_id"),
            "workspace_id": h.get("workspace_id") or "default",
            "title":        h.get("title") or (h.get("description") or "Hazard")[:80],
            "occurred_at":  h.get("occurred_at") or h.get("date") or _ts(),
            "location":     h.get("location"),
            "category":     cat,
            "description":  h.get("description") or "",
            "immediate_actions": h.get("immediate_actions") or "",
            "evidence_photos": h.get("photo_urls") or ([h["photo_url"]] if h.get("photo_url") else []),
            "follow_up_actions": h.get("follow_up_actions") or [],
            "follow_up_status": h.get("follow_up_status") or "open",
            "reported_by":  h.get("reported_by"),
            "gps_latitude": h.get("gps_latitude"),
            "gps_longitude": h.get("gps_longitude"),
            "gps_accuracy": h.get("gps_accuracy"),
            "gps_street":   h.get("gps_street"),
            "gps_suburb":   h.get("gps_suburb"),
            "created_at":   h.get("created_at") or _ts(),
            "updated_at":   _ts(),
            "deleted_at":   None,
            "created_by":   h.get("created_by"),
            # v58.13.132ia — Audit trail.
            "_migrated_from_hazard_id": h["id"],
            "_migrated_at": _ts(),
            "_migration_ship": "v58_13_132ia",
        }
        inserts.append(inc_doc)
        updates.append((h["id"], new_id))

    print(f"[v58.13.132ia] will insert {len(inserts)} incidents + stamp {len(updates)} hazards")
    if inserts[:3]:
        for i in inserts[:3]:
            print(f"  · sample: {i['id']} | {i['title'][:50]} | {i['category']}")

    if not args.commit:
        print("\nDRY-RUN complete — pass --commit to apply.")
        return 0

    if inserts:
        DB.incidents.insert_many(inserts)
        for hid, iid in updates:
            DB.hazards.update_one({"id": hid}, {"$set": {
                "_promoted_to_incident_id": iid,
                "_promoted_at": _ts(),
                "_promotion_ship": "v58_13_132ia",
            }})
    print(f"\nDone. Promoted {len(inserts)} hazards.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
