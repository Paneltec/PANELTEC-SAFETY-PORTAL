"""v58.13.125 — Re-parse `rego_serial` from `name` for the 12 rows
whose `rego_serial` currently holds a Navixy tracker serial number
(18-digit numeric IDs) instead of the vehicle plate.

Uses `assets._parse_rego_from_label` (widened in `.125`) so the
extraction stays consistent with the write path.

## Usage
    Dry-run:  python /app/backend/scripts/reparse_rego_v58_13_125.py
    Commit:   python /app/backend/scripts/reparse_rego_v58_13_125.py --commit
    Reverse:  python /app/backend/scripts/reparse_rego_v58_13_125.py --reverse

Audit markers on committed rows:
    _rego_reparsed_v125:  true
    _prior_rego_serial:   "<Navixy device serial>"
    _rego_reparsed_at:    <ISO timestamp>
"""
from __future__ import annotations
import argparse
import asyncio
import re
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv


async def main(commit: bool, reverse: bool) -> int:
    load_dotenv("/app/backend/.env")
    sys.path.insert(0, "/app/backend")
    from db import db  # noqa: E402
    from assets import _parse_rego_from_label  # noqa: E402

    if reverse:
        print("─" * 78)
        print("v58.13.125 · reparse_rego  mode=REVERSE")
        print("─" * 78)
        n = 0
        async for row in db.assets.find(
            {"_rego_reparsed_v125": True},
            {"_id": 1, "id": 1, "_prior_rego_serial": 1},
        ):
            await db.assets.update_one(
                {"_id": row["_id"]},
                {"$set": {"rego_serial": row.get("_prior_rego_serial")},
                 "$unset": {"_rego_reparsed_v125": "",
                            "_prior_rego_serial": "",
                            "_rego_reparsed_at": ""}},
            )
            n += 1
        print(f"REVERSE complete: {n} row(s) restored.")
        return 0

    mode = "LIVE COMMIT" if commit else "DRY-RUN (read-only)"
    print("─" * 78)
    print(f"v58.13.125 · reparse_rego  mode={mode}")
    print("─" * 78)

    q = {"rego_serial": {"$regex": r"^\d{10,}$"}}
    proposals: list[tuple[str, str, str, str | None]] = []  # (id, before, name, parsed)
    async for a in db.assets.find(
        q,
        {"_id": 0, "id": 1, "rego_serial": 1, "name": 1},
    ):
        parsed = _parse_rego_from_label(a.get("name") or "")
        proposals.append((a["id"], a.get("rego_serial", ""), a.get("name") or "", parsed))

    would_null = would_parse = 0
    print(f"{'id[:8]':10} {'device_serial':17} {'name':45} {'new_rego':10}")
    for _id, before, nm, parsed in proposals:
        marker = parsed if parsed else "(null)"
        print(f"  {_id[:8]:10} {before:17} {nm[:45]:45} {marker}")
        if parsed:
            would_parse += 1
        else:
            would_null += 1

    print(f"\nTotal rows: {len(proposals)}   Extract: {would_parse}   Null (name fallback): {would_null}")

    if not commit:
        print("\nDRY-RUN complete — no rows written. Re-run with --commit.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    modified = 0
    for _id, before, nm, parsed in proposals:
        r = await db.assets.update_one(
            {"id": _id, "_rego_reparsed_v125": {"$ne": True}},  # idempotent
            {"$set": {
                "rego_serial": parsed,   # None is allowed — falls back to name in UI
                "_rego_reparsed_v125": True,
                "_prior_rego_serial": before,
                "_rego_reparsed_at": now,
            }},
        )
        modified += r.modified_count
    print(f"\nCOMMIT complete: {modified} row(s) updated.")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--commit", action="store_true")
    p.add_argument("--reverse", action="store_true")
    args = p.parse_args()
    if args.commit and args.reverse:
        print("ERROR: --commit and --reverse are mutually exclusive.")
        sys.exit(2)
    sys.exit(asyncio.run(main(commit=args.commit, reverse=args.reverse)))
