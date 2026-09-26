"""v58.13.132p0 — Wide-net trial-job seed on the new schema.

Successor to `seed_132n7b_trial_job_wide.py`. Same wide-net coverage
(3 identities: worker_stephen users, stephen@paneltec.com.au users
row, stephen@paneltec.com.au workers row) but writes the LOCKED
`.132p0` schema — 7 SMS fields only, no task/supervisor/truck-split.

Idempotent via `meta.trial_marker = "132p0_trial_seed"`.

Run after the migration script:
    python3 /app/scripts/migrate_132p0_data_model_reset.py
    python3 /app/scripts/seed_132p0_trial_job_wide.py
"""
from __future__ import annotations

import asyncio
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

TRIAL_MARKER = "132p0_trial_seed"

TARGET_EMAILS = [
    "worker_stephen@paneltec.com.au",
    "stephen@paneltec.com.au",
]

# Locked 7-SMS-field payload — the same real SMS Stephen showed us,
# now shaped for the new schema.
SMS = {
    "truck":     "Cappellotto 2 - Volvo - XT48AK",
    "date":      "2026-09-15",
    "issued_at": datetime(2026, 9, 15, 7, 7, 0, tzinfo=SYDNEY_TZ)
                     .astimezone(timezone.utc).isoformat(),
    "site_name": "78 Corin Street West Launceston",
    "address":   "78 Corin Street West Launceston, TAS 7250",
    "customer":  "Shaw",
    "staff":     ["DANIEL BUTLER", "JARROD TARGETT", "JASON DONNELLAN"],
    "notes":     (
        "Kroll to site to expose main, ring Jason to complete tapping "
        "when exposed Tap 50mm connection to Main, all fittings to be "
        "supplied, after site visit"
    ),
}


async def _resolve_targets(db, email: str) -> list[dict]:
    """Return every identity match for `email` (users AND workers)."""
    out: list[dict] = []
    u = await db.users.find_one(
        {"email": email},
        {"_id": 0, "id": 1, "org_id": 1, "email": 1, "name": 1,
         "first_name": 1, "last_name": 1},
    )
    if u:
        first = (u.get("first_name") or "").strip()
        last = (u.get("last_name") or "").strip()
        full = (u.get("name") or f"{first} {last}").strip() or email
        out.append({
            "kind": "user", "id": u["id"], "org_id": u["org_id"],
            "email": email, "worker_name": full,
        })
    w = await db.workers.find_one(
        {"email": email, "deleted_at": None},
        {"_id": 0, "id": 1, "org_id": 1, "email": 1,
         "first_name": 1, "last_name": 1},
    )
    if w:
        first = (w.get("first_name") or "").strip()
        last = (w.get("last_name") or "").strip()
        full = f"{first} {last}".strip() or email
        out.append({
            "kind": "worker", "id": w["id"], "org_id": w["org_id"],
            "email": email, "worker_name": full,
        })
    return out


async def main() -> int:
    from db import db

    targets: list[dict] = []
    for email in TARGET_EMAILS:
        found = await _resolve_targets(db, email)
        if not found:
            print(f"[trial-seed 132p0] WARN: no identity found for {email!r}")
        targets.extend(found)

    if not targets:
        print("[trial-seed 132p0] no identities resolved — aborting.")
        return 1

    print(f"[trial-seed 132p0] Resolved {len(targets)} identities:")
    for t in targets:
        print(f"  · {t['kind']:6s} email={t['email']!r} id={t['id']}  "
              f"name={t['worker_name']!r}")

    ids = list({t["id"] for t in targets})
    orgs = list({t["org_id"] for t in targets})

    # Idempotency.
    r = await db.daily_job_assignments.delete_many({
        "worker_id": {"$in": ids},
        "org_id": {"$in": orgs},
        "meta.trial_marker": TRIAL_MARKER,
    })
    print(f"[trial-seed 132p0] Purged {r.deleted_count} previous "
          f".132p0 trial row(s).")

    job_batch_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    for t in targets:
        doc = {
            "id": str(uuid.uuid4()),
            "job_batch_id": job_batch_id,
            "org_id": t["org_id"],
            # Worker snapshot.
            "worker_id": t["id"],
            "worker_email": t["email"],
            "worker_name": t["worker_name"],
            # SMS fields (LOCKED).
            "truck":     SMS["truck"],
            "date":      SMS["date"],
            "site_name": SMS["site_name"],
            "address":   SMS["address"],
            "customer":  SMS["customer"],
            "staff":     list(SMS["staff"]),
            "notes":     SMS["notes"],
            # Lifecycle.
            "status":       "issued",
            "issued_at":    SMS["issued_at"],
            "accepted_at":  None,
            "declined_at":  None,
            "signed_on_at": None,
            "signed_on_gps": None,
            # Geo (unknown; migration + endpoints will backfill on
            # future creates).
            "site_id":  None,
            "site_lat": None,
            "site_lng": None,
            "truck_prestart_id": None,
            "site_prestart_id":  None,
            # Audit.
            "assigned_by_id": None,
            "created_at": now_iso,
            "updated_at": now_iso,
            "meta": {"source": "trial_seed", "trial_marker": TRIAL_MARKER},
        }
        await db.daily_job_assignments.insert_one(doc)
        print(f"  → inserted {doc['id']} for kind={t['kind']} "
              f"id={t['id']} email={t['email']}")

    print(f"[trial-seed 132p0] job_batch_id: {job_batch_id}")
    print(f"[trial-seed 132p0] Terminal states clear the tile — re-run to reseed.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
