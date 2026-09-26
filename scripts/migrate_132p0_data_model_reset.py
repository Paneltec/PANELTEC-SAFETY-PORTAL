"""v58.13.132p0 — One-off migration: reset `daily_job_assignments`
to the locked 7-SMS-fields schema.

What it does (idempotent, safe to re-run):
  1. Combine legacy `truck_name` + ` - ` + `truck_reg` into a single
     `truck` string when neither is empty. If only one exists, use it.
     Doesn't touch docs that already carry a `truck` field.
  2. `$unset` legacy keys: task, supervisor_id, supervisor_name,
     supervisor_phone, truck_name, truck_reg, is_past_date_fallback.
  3. Rename `staff_names` → `staff` when present. (If both exist,
     the array in `staff_names` wins.)
  4. Set `status = "issued"` when the field is missing OR was one of
     the legacy `pending`/`pending_accept` values (both map to the
     new `issued`).
  5. Backfill `worker_email` from a users/workers lookup when
     `worker_id` is set but `worker_email` is missing.
  6. Backfill `updated_at` if missing.

Report: prints the counts touched per step and a final summary.
Never deletes rows; never mutates the shipped `.132p0` doc shape.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))


LEGACY_KEYS = [
    "task", "supervisor_id", "supervisor_name", "supervisor_phone",
    "truck_name", "truck_reg", "is_past_date_fallback",
    # Also purge the pre-.132p0 dual-date audit columns since the new
    # schema uses a single `date` field.
    "date_local", "date_utc",
    # And the SMS-stub metadata that never actually shipped.
    "sms_sent_at", "sms_message_id", "sms_provider",
    # Aggregation-pipeline artefacts from the .132n7 form.
    # NOTE: `site_address` and `site_coords` are HANDLED VIA RENAME
    # earlier (step 1b) — they land in `address` and
    # `site_lat`/`site_lng`. They're listed here anyway so any doc
    # that still has both fields ends up with only the new one.
    "site_address", "site_coords",
    "site_freeform", "preamble", "assigned_at", "assigned_by",
    "assigned_by_name", "worker_kind", "worker_phone",
    "worker_role_id",
]


async def main() -> int:
    from db import db

    collection = db.daily_job_assignments
    now_iso = datetime.now(timezone.utc).isoformat()

    total = await collection.count_documents({})
    print(f"[migrate 132p0] {total} row(s) in daily_job_assignments")

    # 1. Combine truck fields.
    combined = 0
    async for doc in collection.find(
        {"$and": [
            {"$or": [{"truck": None}, {"truck": ""}, {"truck": {"$exists": False}}]},
            {"$or": [
                {"$and": [{"truck_name": {"$exists": True}}, {"truck_name": {"$nin": [None, ""]}}]},
                {"$and": [{"truck_reg":  {"$exists": True}}, {"truck_reg":  {"$nin": [None, ""]}}]},
            ]},
        ]},
        {"_id": 1, "truck_name": 1, "truck_reg": 1},
    ):
        name = (doc.get("truck_name") or "").strip()
        reg  = (doc.get("truck_reg")  or "").strip()
        if name and reg:
            combined_val = f"{name} - {reg}"
        else:
            combined_val = name or reg or None
        if combined_val:
            await collection.update_one(
                {"_id": doc["_id"]},
                {"$set": {"truck": combined_val, "updated_at": now_iso}},
            )
            combined += 1
    print(f"[migrate 132p0]   1) combined truck_name+truck_reg → truck: {combined}")

    # 1b. Rename `site_address` → `address` where address is missing,
    # and lift `site_coords.{lat,lng}` into `site_lat`/`site_lng`.
    renamed_addr = 0
    async for doc in collection.find(
        {"$and": [
            {"site_address": {"$exists": True}},
            {"$or": [{"address": None},
                     {"address": ""},
                     {"address": {"$exists": False}}]},
        ]},
        {"_id": 1, "site_address": 1},
    ):
        val = (doc.get("site_address") or "").strip()
        if val:
            await collection.update_one(
                {"_id": doc["_id"]},
                {"$set": {"address": val, "updated_at": now_iso}},
            )
            renamed_addr += 1
    print(f"[migrate 132p0]   1b) rename site_address → address: {renamed_addr}")

    coords_lifted = 0
    async for doc in collection.find(
        {"site_coords": {"$exists": True, "$ne": None, "$type": "object"}},
        {"_id": 1, "site_coords": 1, "site_lat": 1, "site_lng": 1},
    ):
        sc = doc.get("site_coords") or {}
        lat = sc.get("lat") if doc.get("site_lat") in (None, "") else doc.get("site_lat")
        lng = sc.get("lng") if doc.get("site_lng") in (None, "") else doc.get("site_lng")
        if lat is not None or lng is not None:
            await collection.update_one(
                {"_id": doc["_id"]},
                {"$set": {"site_lat": lat, "site_lng": lng,
                          "updated_at": now_iso}},
            )
            coords_lifted += 1
    print(f"[migrate 132p0]   1c) lift site_coords → site_lat/site_lng: {coords_lifted}")

    # 2. $unset legacy keys — batched.
    unset_res = await collection.update_many(
        {"$or": [{k: {"$exists": True}} for k in LEGACY_KEYS]},
        {"$unset": {k: "" for k in LEGACY_KEYS},
         "$set": {"updated_at": now_iso}},
    )
    print(f"[migrate 132p0]   2) $unset legacy keys: {unset_res.modified_count} row(s)")

    # 3. Rename staff_names → staff.
    renamed = 0
    async for doc in collection.find(
        {"staff_names": {"$exists": True}},
        {"_id": 1, "staff_names": 1, "staff": 1},
    ):
        # Prefer staff_names (source of truth pre-.132p0). Empty
        # array is fine.
        val = doc.get("staff_names") or []
        await collection.update_one(
            {"_id": doc["_id"]},
            {"$set": {"staff": val, "updated_at": now_iso},
             "$unset": {"staff_names": ""}},
        )
        renamed += 1
    print(f"[migrate 132p0]   3) rename staff_names → staff: {renamed}")

    # 4. Normalise status.
    legacy_status_res = await collection.update_many(
        {"$or": [
            {"status": {"$exists": False}},
            {"status": None},
            {"status": ""},
            {"status": "pending"},
            {"status": "pending_accept"},
            {"status": "new"},
        ]},
        {"$set": {"status": "issued", "updated_at": now_iso}},
    )
    print(f"[migrate 132p0]   4) status → 'issued': {legacy_status_res.modified_count}")

    # 5. Backfill worker_email via users/workers lookup.
    to_backfill_email = collection.find(
        {"$and": [
            {"worker_id": {"$exists": True, "$ne": None}},
            {"$or": [
                {"worker_email": {"$exists": False}},
                {"worker_email": None},
                {"worker_email": ""},
            ]},
        ]},
        {"_id": 1, "org_id": 1, "worker_id": 1},
    )
    backfilled = 0
    async for doc in to_backfill_email:
        wid = doc.get("worker_id")
        org = doc.get("org_id")
        email = None
        u = await db.users.find_one({"id": wid, "org_id": org},
                                    {"_id": 0, "email": 1})
        if u and u.get("email"):
            email = u["email"]
        else:
            w = await db.workers.find_one(
                {"id": wid, "org_id": org, "deleted_at": None},
                {"_id": 0, "email": 1},
            )
            if w and w.get("email"):
                email = w["email"]
        if email:
            await collection.update_one(
                {"_id": doc["_id"]},
                {"$set": {"worker_email": email, "updated_at": now_iso}},
            )
            backfilled += 1
    print(f"[migrate 132p0]   5) backfilled worker_email: {backfilled}")

    # 6. `issued_at` fallback from `assigned_at` (legacy) or `created_at`.
    issued_at_fill = 0
    async for doc in collection.find(
        {"$or": [{"issued_at": {"$exists": False}},
                 {"issued_at": None}]},
        {"_id": 1, "created_at": 1},
    ):
        fallback = doc.get("created_at") or now_iso
        await collection.update_one(
            {"_id": doc["_id"]},
            {"$set": {"issued_at": fallback, "updated_at": now_iso}},
        )
        issued_at_fill += 1
    print(f"[migrate 132p0]   6) backfilled issued_at: {issued_at_fill}")

    # 7. Ensure the newly-required scalar columns exist (nulls OK).
    for col in ("site_lat", "site_lng", "site_id", "signed_on_at",
                "signed_on_gps", "truck_prestart_id", "site_prestart_id",
                "created_at", "job_batch_id"):
        res = await collection.update_many(
            {col: {"$exists": False}},
            {"$set": {col: None, "updated_at": now_iso}},
        )
        if res.modified_count:
            print(f"[migrate 132p0]     · added {col}=null on {res.modified_count} rows")

    # Final integrity peek — count docs still carrying purged keys.
    residual_legacy: dict = {}
    for k in LEGACY_KEYS:
        n = await collection.count_documents({k: {"$exists": True}})
        if n:
            residual_legacy[k] = n
    if residual_legacy:
        print(f"[migrate 132p0] ⚠ residual legacy keys still present: {residual_legacy}")
    else:
        print(f"[migrate 132p0] ✔ no legacy keys remain")

    print(f"[migrate 132p0] done — collection now conforms to .132p0 schema.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
