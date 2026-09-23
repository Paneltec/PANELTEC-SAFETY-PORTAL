#!/usr/bin/env python3
"""v58.13.132mg — One-shot backfill of `expires_at` + `display_name`
on `doc_files` rows whose filename contains an SDS-style expiry code.

Idempotent: rows that already have both fields set are skipped. Rows
whose filename doesn't match either pattern get `expires_at=None` and
`display_name=<hex-stripped-name>` so subsequent queries can still
filter cleanly.

Run:  python3 /app/scripts/backfill_filename_expiry.py --run
Dry:  python3 /app/scripts/backfill_filename_expiry.py            (default)
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys

sys.path.insert(0, "/app/backend")
os.chdir("/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from filename_expiry import parse_filename_expiry  # noqa: E402
from display_filename import display_filename  # noqa: E402


async def main(commit: bool) -> None:
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]

    scanned = 0
    already_backfilled = 0
    matched_expiry = 0
    unparseable = 0
    updated = 0
    sample_matched: list[dict] = []
    sample_unparseable: list[str] = []

    async for f in db.doc_files.find(
        {"deleted_at": None},
        {"_id": 0, "id": 1, "filename": 1,
         "display_name": 1, "expires_at": 1},
    ):
        scanned += 1
        if f.get("display_name") is not None and "expires_at" in f:
            already_backfilled += 1
            continue
        raw = f.get("filename") or ""
        # First strip legacy hex prefix, then parse expiry.
        stripped_hex = display_filename(raw) or raw
        parsed = parse_filename_expiry(stripped_hex)
        if parsed.expires_at:
            matched_expiry += 1
            if len(sample_matched) < 8:
                sample_matched.append({
                    "raw": raw, "clean": parsed.clean_name,
                    "expires_at": parsed.expires_at,
                    "raw_code": parsed.raw_code,
                })
        elif ("EXP" in raw.upper() or "Exp" in raw):
            unparseable += 1
            if len(sample_unparseable) < 8:
                sample_unparseable.append(raw)
        update = {
            "display_name": parsed.clean_name,
            "expires_at": parsed.expires_at,
        }
        if commit:
            await db.doc_files.update_one({"id": f["id"]},
                                             {"$set": update})
        updated += 1

    print(f"scanned:            {scanned}")
    print(f"already_backfilled: {already_backfilled}")
    print(f"matched_expiry:     {matched_expiry}")
    print(f"unparseable (had EXP-ish token): {unparseable}")
    print(f"rows_updated:       {updated}   (commit={commit})")
    print()
    print("=== sample_matched ===")
    for s in sample_matched:
        print(f"  {s['raw']!r}")
        print(f"    → clean={s['clean']!r}  expires_at={s['expires_at']}"
              f"  code={s['raw_code']}")
    print()
    print("=== sample_unparseable ===")
    for s in sample_unparseable:
        print(f"  {s!r}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true",
                       help="actually write to the DB (default is dry-run)")
    ns = ap.parse_args()
    asyncio.run(main(commit=ns.run))
