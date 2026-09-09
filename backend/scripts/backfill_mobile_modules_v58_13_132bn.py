"""v58.13.132bn — Rewrite legacy tokens in
`org_settings.mobile_modules_overrides` (and the sibling
`orgs.mobile_modules` field, if present) to the 4 core seed
role_ids.

Mapping (Stephen-approved — mirrors `.132bk`):
    worker      → paneltec_civil
    supervisor  → paneltec_civil
    foreman     → paneltec_civil
    contractor  → external_contractor
    hseq        → admin   (dropped — inert tier)

Collision policy: **union of enabled modules**.

`admin` remains as a legitimate storage bucket (unlike `.132bk`'s
form-allowlist) because the Mobile Modules matrix does support an
admin bucket at the schema level — the FE just renders it read-only.
`owner` is also kept for parity with the endpoint whitelist.

DB reality at ship time: `org_settings.mobile_modules_overrides`
is `{}` across every org (no live legacy config exists) so this
script is a no-op on today's data. It's shipped anyway for
defence-in-depth against future orgs that might import legacy
matrices.

Usage:
    python scripts/backfill_mobile_modules_v58_13_132bn.py             # dry-run
    python scripts/backfill_mobile_modules_v58_13_132bn.py --commit
"""
from __future__ import annotations
import argparse, asyncio, sys
from datetime import datetime, timezone
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from db import db  # noqa

CORE_ROLES = {"admin", "paneltec_civil", "viatec_traffic", "external_contractor"}
STRIP_KEYS = {"owner"}

LEGACY_MAP = {
    "worker":     "paneltec_civil",
    "supervisor": "paneltec_civil",
    "foreman":    "paneltec_civil",
    "contractor": "external_contractor",
    "hseq":       "admin",
    "paneltec_civil":      "paneltec_civil",
    "viatec_traffic":      "viatec_traffic",
    "external_contractor": "external_contractor",
    "admin":               "admin",
}


def _rewrite(matrix: dict) -> tuple[dict, bool]:
    merged: dict[str, dict[str, bool]] = {}
    for key, mod_map in (matrix or {}).items():
        if key in STRIP_KEYS:
            continue
        target = LEGACY_MAP.get(key)
        if target is None:
            continue
        bucket = merged.setdefault(target, {})
        for mod_key, val in (mod_map or {}).items():
            # union: OR the booleans together — if ANY source had it on,
            # the merged bucket has it on.
            bucket[mod_key] = bool(bucket.get(mod_key)) or bool(val)
    changed = merged != (matrix or {})
    return merged, changed


async def _process(coll_name: str, field: str, args) -> int:
    coll = getattr(db, coll_name)
    plan = []
    async for doc in coll.find({field: {"$exists": True}}, {"_id": 0}):
        old = doc.get(field) or {}
        new, changed = _rewrite(old)
        if changed:
            plan.append({"key": doc.get("id") or doc.get("org_id"),
                         "coll": coll_name, "field": field,
                         "old": old, "new": new})
    print(f"── {coll_name}.{field}: {len(plan)} docs need rewrite")
    for row in plan:
        print(f"    {row['key']}:")
        for k in (row["old"] or {}):
            n = len(row["old"][k]) if isinstance(row["old"][k], dict) else "?"
            marker = "→ DROP" if k in STRIP_KEYS else f"→ {LEGACY_MAP.get(k, k)}"
            print(f"      old {k!r:24s} ({n} entries)  {marker}")
        for k, mods in row["new"].items():
            print(f"      new {k!r:24s} ({len(mods)} entries)")
    if not args.commit:
        return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    for row in plan:
        filt = {"id": row["key"]} if coll_name == "orgs" else {"org_id": row["key"]}
        await coll.update_one(filt, {"$set": {
            row["field"]: row["new"],
            "_mobile_modules_per_role_backfilled_at": now_iso,
            "_mobile_modules_per_role_backfilled_version": "v58.13.132bn",
            "updated_at": now_iso,
        }})
    return len(plan)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    print("═" * 60)
    n1 = await _process("org_settings", "mobile_modules_overrides", args)
    n2 = await _process("orgs", "mobile_modules", args)
    print(f"\ncommit={args.commit}")
    print("═" * 60)

    if not args.commit:
        print("(dry-run — no writes)")
    else:
        print(f"WROTE: {n1} org_settings docs, {n2} orgs docs")


if __name__ == "__main__":
    asyncio.run(main())
