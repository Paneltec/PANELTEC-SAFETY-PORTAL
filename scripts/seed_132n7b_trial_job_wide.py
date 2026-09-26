"""v58.13.132n7b — Wide-net trial-job seed.

Follow-up to `seed_132n7a_trial_job.py` after the user reported the
mobile Home tile still empty on the admin phone-preview iframe.

Root cause: the `.132n7a` seed only targeted
`worker_stephen@paneltec.com.au` (user id `21dddcc2-…`). But the
phone-preview iframe in the admin UI mints a synthetic preview session
whose `user["id"]` is a random `preview-<scope>-<hex>` subject — the
`/api/mobile/daily-jobs/today` endpoint therefore never resolves to
that user_id. When the admin picks a worker in the "Preview as
specific worker" dropdown, the JWT carries `email = <worker's real
email>` and the endpoint's email→workers-row fallback picks up that
worker's `workers.id`. Similarly, the admin's own JWT
(stephen@paneltec.com.au) falls back to the linked worker row via
email lookup.

Concrete identities in this env (org `3116f250-…`):

  worker_stephen@paneltec.com.au → users.id  21dddcc2-e184-…    (seeded)
  worker_stephen@paneltec.com.au → workers   (none)
  stephen@paneltec.com.au        → users.id  808cb7de-985a-…    (NOT seeded)
  stephen@paneltec.com.au        → workers.id dbddf739-5803-…   (NOT seeded)

The phone-preview picker only surfaces rows from the `workers`
collection, so `worker_stephen` never appears there — but `Stephen
Guy` (dbddf739) does. Seeding the trial job for BOTH
`stephen@paneltec.com.au` identities (user + worker row) means the
tile populates whether:
  • The admin binds the preview to Stephen Guy (dbddf739 match).
  • The admin logs into the mobile app directly (808cb7de match, or
    email fallback → dbddf739 match).
  • The admin logs in as `worker_stephen@paneltec.com.au` on the real
    device (21dddcc2 match — still covered by the .132n7a seed).

Idempotent: purges any prior `.132n7b_trial_seed`-tagged rows for the
targeted identities before inserting.

Ship: `.132n7b`.
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

TRIAL_MARKER = "132n7b_trial_seed"

# Wide net: BOTH admin + worker aliases, so every identity the
# phone-preview and mobile-app-real-device can present resolves to a
# seed doc.
TARGET_EMAILS = [
    "worker_stephen@paneltec.com.au",
    "stephen@paneltec.com.au",
]

# Verbatim SMS shape (matches .132n7a; keeps the officer's screenshot
# reproducible on the tile).
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
    "status": "issued",
}


async def _resolve_targets(db, email: str) -> list[dict]:
    """Return every identity match for `email` (users AND workers)."""
    out: list[dict] = []
    u = await db.users.find_one(
        {"email": email},
        {"_id": 0, "id": 1, "org_id": 1, "email": 1, "name": 1,
         "first_name": 1, "last_name": 1, "role_id": 1,
         "mobile": 1, "phone": 1},
    )
    if u:
        first = (u.get("first_name") or "").strip()
        last = (u.get("last_name") or "").strip()
        full = (u.get("name") or f"{first} {last}").strip() or email
        out.append({
            "kind": "user",
            "id": u["id"],
            "org_id": u["org_id"],
            "email": email,
            "worker_name": full,
            "worker_phone": u.get("mobile") or u.get("phone"),
            "worker_role_id": u.get("role_id"),
        })
    w = await db.workers.find_one(
        {"email": email, "deleted_at": None},
        {"_id": 0, "id": 1, "org_id": 1, "email": 1,
         "first_name": 1, "last_name": 1, "mobile": 1, "phone": 1},
    )
    if w:
        first = (w.get("first_name") or "").strip()
        last = (w.get("last_name") or "").strip()
        full = f"{first} {last}".strip() or email
        out.append({
            "kind": "worker",
            "id": w["id"],
            "org_id": w["org_id"],
            "email": email,
            "worker_name": full,
            "worker_phone": w.get("mobile") or w.get("phone"),
            "worker_role_id": None,
        })
    return out


async def main() -> int:
    from db import db

    # Resolve every identity for every target email.
    all_targets: list[dict] = []
    for email in TARGET_EMAILS:
        found = await _resolve_targets(db, email)
        if not found:
            print(f"[trial-seed] WARN: no identity found for {email!r}")
        for t in found:
            all_targets.append(t)

    if not all_targets:
        print("[trial-seed] No identities resolved for any target — aborting.")
        return 1

    print(f"[trial-seed] Resolved {len(all_targets)} identities:")
    for t in all_targets:
        print(f"  · {t['kind']:6s} email={t['email']!r} id={t['id']}  "
              f"name={t['worker_name']!r}")

    ids = list({t["id"] for t in all_targets})
    orgs = list({t["org_id"] for t in all_targets})

    # Idempotency: purge previous .132n7b rows for these identities.
    r = await db.daily_job_assignments.delete_many({
        "worker_id": {"$in": ids},
        "org_id": {"$in": orgs},
        "meta.trial_marker": TRIAL_MARKER,
    })
    print(f"[trial-seed] Purged {r.deleted_count} previous "
          f".132n7b trial row(s).")

    job_batch_id = str(uuid.uuid4())
    for t in all_targets:
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
            "site_id": None,
            "site_name": SMS["site_name"],
            "site_address": SMS["site_address"],
            "site_coords": None,
            "site_freeform": SMS["site_name"],
            "customer": SMS["customer"],
            # Dates.
            "date": SMS["date"],
            "date_local": SMS["date"],
            "date_utc": SMS["date"],
            # Assigner (attributed to the same identity for trial parity).
            "assigned_by": t["id"],
            "assigned_by_id": t["id"],
            "assigned_by_name": t["worker_name"],
            "assigned_at": SMS["issued_at"],
            "issued_at": SMS["issued_at"],
            # SMS parity.
            "task": SMS["task"],
            # NO supervisor_* keys — Paneltec has no supervisors.
            "truck_id": None,
            "truck_name": SMS["truck_name"],
            "truck_reg": SMS["truck_reg"],
            "staff_names": SMS["staff_names"],
            "is_trial_mirror": True,
            "job_batch_id": job_batch_id,
            "sms_sent_at": None,
            "sms_message_id": None,
            "sms_provider": None,
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
        print(f"  → inserted assignment {assignment_id} for "
              f"kind={t['kind']} id={t['id']} email={t['email']}")

    print(f"[trial-seed] job_batch_id: {job_batch_id}")
    print(f"[trial-seed] SMS date: {SMS['date']}  "
          f"issued_at: {SMS['issued_at']}")
    print(f"[trial-seed] Coverage: preview-with-worker-binding + "
          f"admin-direct-login + worker-real-device.")
    print(f"[trial-seed] Terminal states (accepted/declined) clear the "
          f"tile — re-run the script to reseed.")
    return 0


if __name__ == "__main__":
    import asyncio
    sys.exit(asyncio.run(main()))
