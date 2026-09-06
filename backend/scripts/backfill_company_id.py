"""v58.13.132b — Backfill company_id from simpro_company_id.

Iterates workers + users that have `simpro_company_id` but are missing
`company_id`, and sets it.  Also detects dual-company workers (same
simpro_employee_id appearing in both Co2 and Co3) and writes
`company_ids` + `primary_company_id`.

Usage:
    python3 backend/scripts/backfill_company_id.py --dry-run
    python3 backend/scripts/backfill_company_id.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from motor.motor_asyncio import AsyncIOMotorClient


def _load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


async def run(dry_run: bool) -> dict:
    url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = AsyncIOMotorClient(url)
    db = client[db_name]

    stats = {
        "workers_updated": 0,
        "workers_skipped": 0,
        "workers_dual": 0,
        "users_updated": 0,
        "users_skipped": 0,
        "users_dual": 0,
        "co2_workers": 0,
        "co3_workers": 0,
        "co2_users": 0,
        "co3_users": 0,
        "unknown_workers": 0,
        "unknown_users": 0,
    }

    # ─── Workers ───
    # Build simpro_employee_id → list of company_ids for dual detection
    sid_companies: dict[str, set[str]] = defaultdict(set)
    async for w in db.workers.find(
        {"simpro_company_id": {"$exists": True, "$ne": None}},
        {"_id": 0, "id": 1, "simpro_employee_id": 1, "simpro_company_id": 1,
         "company_id": 1, "company_ids": 1},
    ):
        sid = str(w.get("simpro_employee_id") or "")
        cid = str(w.get("simpro_company_id") or "")
        if sid and cid:
            sid_companies[sid].add(cid)

    async for w in db.workers.find(
        {"simpro_company_id": {"$exists": True, "$ne": None}},
        {"_id": 0, "id": 1, "simpro_employee_id": 1, "simpro_company_id": 1,
         "company_id": 1},
    ):
        cid = str(w.get("simpro_company_id") or "")
        sid = str(w.get("simpro_employee_id") or "")
        if not cid:
            stats["unknown_workers"] += 1
            continue
        if cid == "2":
            stats["co2_workers"] += 1
        elif cid == "3":
            stats["co3_workers"] += 1
        else:
            stats["unknown_workers"] += 1

        # Already has company_id set correctly?
        if w.get("company_id") == cid:
            stats["workers_skipped"] += 1
            continue

        update: dict = {"$set": {"company_id": cid}}
        companies_for_sid = sid_companies.get(sid, set())
        if len(companies_for_sid) > 1:
            update["$set"]["company_ids"] = sorted(companies_for_sid)
            update["$set"]["primary_company_id"] = "2"
            stats["workers_dual"] += 1

        if not dry_run:
            await db.workers.update_one({"id": w["id"]}, update)
        stats["workers_updated"] += 1

    # ─── Users ───
    # Build simpro_employee_id → list of company_ids for dual detection
    user_sid_companies: dict[str, set[str]] = defaultdict(set)
    async for u in db.users.find(
        {"simpro_company_id": {"$exists": True, "$ne": None}},
        {"_id": 0, "id": 1, "simpro_employee_id": 1, "simpro_company_id": 1},
    ):
        sid = str(u.get("simpro_employee_id") or "")
        cid = str(u.get("simpro_company_id") or "")
        if sid and cid:
            user_sid_companies[sid].add(cid)

    async for u in db.users.find(
        {"simpro_company_id": {"$exists": True, "$ne": None}},
        {"_id": 0, "id": 1, "simpro_employee_id": 1, "simpro_company_id": 1,
         "company_id": 1},
    ):
        cid = str(u.get("simpro_company_id") or "")
        sid = str(u.get("simpro_employee_id") or "")
        if not cid:
            stats["unknown_users"] += 1
            continue
        if cid == "2":
            stats["co2_users"] += 1
        elif cid == "3":
            stats["co3_users"] += 1
        else:
            stats["unknown_users"] += 1

        if u.get("company_id") == cid:
            stats["users_skipped"] += 1
            continue

        update = {"$set": {"company_id": cid}}
        companies_for_sid = user_sid_companies.get(sid, set())
        if len(companies_for_sid) > 1:
            update["$set"]["company_ids"] = sorted(companies_for_sid)
            update["$set"]["primary_company_id"] = "2"
            stats["users_dual"] += 1

        if not dry_run:
            await db.users.update_one({"id": u["id"]}, update)
        stats["users_updated"] += 1

    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="Backfill company_id from simpro_company_id")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    _load_env(Path(__file__).resolve().parents[1] / ".env")

    dry = args.dry_run
    stats = asyncio.run(run(dry))

    mode = "DRY-RUN" if dry else "APPLIED"
    print(f"\n{'=' * 50}")
    print(f"  Backfill company_id — {mode}")
    print(f"{'=' * 50}")
    print(f"  Workers: {stats['co2_workers']} Co2, {stats['co3_workers']} Co3, {stats['unknown_workers']} unknown")
    print(f"    Updated: {stats['workers_updated']}, Skipped (already set): {stats['workers_skipped']}, Dual-company: {stats['workers_dual']}")
    print(f"  Users: {stats['co2_users']} Co2, {stats['co3_users']} Co3, {stats['unknown_users']} unknown")
    print(f"    Updated: {stats['users_updated']}, Skipped (already set): {stats['users_skipped']}, Dual-company: {stats['users_dual']}")
    print(f"{'=' * 50}\n")


if __name__ == "__main__":
    main()
