"""v58.13.132n7a — one-shot trial-job seed (rev 2 per user brief).

Populates a `daily_job_assignments` doc for `worker_stephen@paneltec.com.au`
(resolves to both users AND workers rows if either exists) with the
verbatim SMS shape from the officer's screenshot, so the mobile
Today's Assignment tile renders on Stephen's real phone / phone-
preview session.

SMS SHAPE (from officer's screenshot):
  Hi DANIEL BUTLER, you have been allocated to the following job.
  Truck: Cappellotto 2 - Volvo - XT48AK
  Date: 15-09-26
  Site: 78 Corin Street West Launceston
  Address: 78 Corin Street West Launceston
  Customer: Shaw
  Staff on this job: DANIEL BUTLER, JARROD TARGETT, JASON DONNELLAN
  Notes: Kroll to site to expose main, ring Jason to complete tapping
  when exposed Tap 50mm connection to Main, all fittings to be
  supplied, after site visit

Paneltec has no supervisors — no `supervisor_*` keys are written.

Idempotency: re-running deletes any prior `.132n7a_trial_seed`-tagged
row for the same worker+date before inserting, so the officer can call
it again after edits.

The doc's `date` field is set to **2026-09-15** (matches the SMS).
The mobile `GET /api/mobile/daily-jobs/today` endpoint has been
extended in `.132n7a` to fall through to the most-recent-unaccepted
job when there's no exact-today match — so this past-dated seed
still surfaces on the Home tile until Stephen accepts/declines it.
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

SYDNEY_TZ = ZoneInfo("Australia/Sydney")

TRIAL_MARKER = "132n7a_trial_seed"
TARGET_EMAIL = "worker_stephen@paneltec.com.au"

# Verbatim SMS shape.
SMS = {
    "date":         "2026-09-15",
    "issued_at":    datetime(2026, 9, 15, 7, 7, 0, tzinfo=SYDNEY_TZ).isoformat(),
    "truck_name":   "Cappellotto 2 - Volvo",
    "truck_reg":    "XT48AK",
    "site_name":    "78 Corin Street West Launceston",
    "site_address": "78 Corin Street West Launceston, TAS 7250",
    "customer":     "Shaw",
    "staff_names":  ["DANIEL BUTLER", "JARROD TARGETT", "JASON DONNELLAN"],
    "notes": (
        "Kroll to site to expose main, ring Jason to complete tapping "
        "when exposed Tap 50mm connection to Main, all fittings to be "
        "supplied, after site visit"
    ),
    "task":   None,
    "status": "issued",   # matches the SMS phrasing "you have been allocated to"
}


async def main() -> int:
    from db import db  # imported after sys.path prepend

    now_utc = datetime.now(timezone.utc).isoformat()
    job_batch_id = str(uuid.uuid4())

    # Resolve BOTH identities for the target email.
    targets: list[dict] = []
    u = await db.users.find_one(
        {"email": TARGET_EMAIL},
        {"_id": 0, "id": 1, "org_id": 1, "email": 1, "name": 1,
         "first_name": 1, "last_name": 1, "role_id": 1,
         "mobile": 1, "phone": 1},
    )
    if u:
        first = (u.get("first_name") or "").strip()
        last = (u.get("last_name") or "").strip()
        full = (u.get("name") or f"{first} {last}").strip() or TARGET_EMAIL
        targets.append({
            "kind": "user",
            "id": u["id"],
            "org_id": u["org_id"],
            "worker_name": full,
            "worker_phone": u.get("mobile") or u.get("phone"),
            "worker_role_id": u.get("role_id"),
        })
    w = await db.workers.find_one(
        {"email": TARGET_EMAIL, "deleted_at": None},
        {"_id": 0, "id": 1, "org_id": 1, "email": 1,
         "first_name": 1, "last_name": 1, "mobile": 1, "phone": 1},
    )
    if w:
        first = (w.get("first_name") or "").strip()
        last = (w.get("last_name") or "").strip()
        full = f"{first} {last}".strip() or TARGET_EMAIL
        targets.append({
            "kind": "worker",
            "id": w["id"],
            "org_id": w["org_id"],
            "worker_name": full,
            "worker_phone": w.get("mobile") or w.get("phone"),
            "worker_role_id": None,
        })

    if not targets:
        print(f"[trial-seed] No identity found for {TARGET_EMAIL!r}. Aborting.")
        return 1

    print(f"[trial-seed] Found {len(targets)} identity match(es) for {TARGET_EMAIL!r}:")
    for t in targets:
        print(f"  · {t['kind']:6s} id={t['id']}  name={t['worker_name']!r}")

    # Idempotency: purge any prior trial seeds tagged 132n7a_trial_seed
    # for THESE identities (all dates).
    ids = [t["id"] for t in targets]
    orgs = list({t["org_id"] for t in targets})
    r = await db.daily_job_assignments.delete_many({
        "worker_id": {"$in": ids},
        "org_id": {"$in": orgs},
        "meta.trial_marker": TRIAL_MARKER,
    })
    print(f"[trial-seed] Removed {r.deleted_count} previous trial row(s).")

    # Insert one doc per identity, sharing one batch id.
    for t in targets:
        assignment_id = str(uuid.uuid4())
        doc = {
            "id": assignment_id,
            "org_id": t["org_id"],
            # Worker snapshot.
            "worker_id": t["id"],
            "worker_name": t["worker_name"],
            "worker_phone": t["worker_phone"],
            "worker_role_id": t["worker_role_id"],
            "worker_kind": t["kind"],
            # SMS-shape fields.
            "site_id": None,                   # freeform site — matches the SMS
            "site_name": SMS["site_name"],
            "site_address": SMS["site_address"],
            "site_coords": None,
            "site_freeform": SMS["site_name"],
            "customer": SMS["customer"],
            # Dates.
            "date": SMS["date"],
            "date_local": SMS["date"],
            "date_utc": SMS["date"],
            # Assigner (attributed to a synthetic officer for the trial).
            "assigned_by": t["id"],
            "assigned_by_id": t["id"],
            "assigned_by_name": t["worker_name"],
            "assigned_at": SMS["issued_at"],
            "issued_at": SMS["issued_at"],
            # SMS parity (.132n7a).
            "task": SMS["task"],
            # NO supervisor_* keys — Paneltec has no supervisors.
            "truck_id": None,
            "truck_name": SMS["truck_name"],
            "truck_reg": SMS["truck_reg"],
            "staff_names": SMS["staff_names"],
            "is_trial_mirror": True,
            # Batch grouping.
            "job_batch_id": job_batch_id,
            # SMS stub compat.
            "sms_sent_at": None,
            "sms_message_id": None,
            "sms_provider": None,
            # Lifecycle. status=issued matches the SMS phrasing.
            "accepted_at": None,
            "declined_at": None,
            "completed_at": None,
            "status": SMS["status"],
            "notes": SMS["notes"],
            "preamble": None,
            "pdf_id": None,
            "pdf_url": None,
            "meta": {
                "source": "issue_job_form",
                "trial_mirror": True,
                "trial_marker": TRIAL_MARKER,
            },
        }
        await db.daily_job_assignments.insert_one(doc)
        print(f"  → inserted assignment {assignment_id} for kind={t['kind']} id={t['id']}")

    print(f"[trial-seed] job_batch_id: {job_batch_id}")
    print(f"[trial-seed] SMS date: {SMS['date']}  issued_at: {SMS['issued_at']}")
    print(f"[trial-seed] `.132n7a` /today fallback surfaces this until Stephen taps Accept.")
    return 0


if __name__ == "__main__":
    import asyncio
    sys.exit(asyncio.run(main()))
