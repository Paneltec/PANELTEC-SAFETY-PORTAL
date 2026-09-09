"""v58.13.132bk — Rewrite `db.orgs.<org>.role_form_allowlist` keys
from legacy tokens (`worker`, `supervisor`, `foreman`, `contractor`,
`hseq`) to the 4 core seed role_ids.

Mapping (Stephen-approved):
    worker      → paneltec_civil
    supervisor  → paneltec_civil
    foreman     → paneltec_civil
    contractor  → external_contractor
    hseq        → admin  (dropped — admin sees every form, allowlist is inert)

Collision policy: when multiple legacy keys map to the same core key
(e.g. worker + supervisor + foreman → paneltec_civil), the enabled
form ids are **unioned**.

`admin` and `owner` allowlists (legacy or new) are stripped entirely
after the merge because those tiers always see every form — a stored
allowlist is at best inert, at worst a footgun. The `.132bk` endpoint
now rejects PUT for admin/owner so they cannot be reintroduced.

Idempotent: dry-run reports 0 rewrites when the DB is already clean.

Usage:
    python scripts/backfill_forms_per_role_v58_13_132bk.py             # dry-run
    python scripts/backfill_forms_per_role_v58_13_132bk.py --commit
"""
from __future__ import annotations
import argparse
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from db import db  # noqa: E402

CORE_ROLES = {"admin", "paneltec_civil", "viatec_traffic", "external_contractor"}
STRIP_KEYS = {"admin", "owner"}  # inert tiers — remove after merge

LEGACY_MAP = {
    "worker":     "paneltec_civil",
    "supervisor": "paneltec_civil",
    "foreman":    "paneltec_civil",
    "contractor": "external_contractor",
    "hseq":       "admin",  # dropped after merge
    # No-op keys already in the target set:
    "paneltec_civil":      "paneltec_civil",
    "viatec_traffic":      "viatec_traffic",
    "external_contractor": "external_contractor",
}


def _rewrite_allowlist(rfa: dict) -> tuple[dict, bool]:
    """Return (new_dict, changed?). New dict is empty if the source
    had zero mappable keys after the strip step."""
    merged: dict[str, set[str]] = {}
    for key, ids in (rfa or {}).items():
        if key in STRIP_KEYS:
            # Explicit drop — inert tier.
            continue
        target = LEGACY_MAP.get(key)
        if target is None or target in STRIP_KEYS:
            # Legacy key mapping to a strip-tier (`hseq → admin`) or
            # unknown key → drop entirely.
            continue
        merged.setdefault(target, set()).update(x for x in (ids or []) if x)

    new_dict = {k: sorted(v) for k, v in merged.items()}
    changed = new_dict != {k: sorted(v or []) for k, v in (rfa or {}).items()
                           if k in CORE_ROLES and k not in STRIP_KEYS}
    return new_dict, changed


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    plan: list[dict] = []
    async for org in db.orgs.find(
        {}, {"_id": 0, "id": 1, "name": 1, "role_form_allowlist": 1},
    ):
        rfa = org.get("role_form_allowlist") or {}
        # If there's nothing to rewrite AND no strip-tier / legacy key
        # is present, skip entirely.
        has_legacy = any(k in LEGACY_MAP and k not in CORE_ROLES for k in rfa)
        has_strip = any(k in STRIP_KEYS for k in rfa)
        if not has_legacy and not has_strip:
            continue
        new_dict, _ = _rewrite_allowlist(rfa)
        plan.append({
            "org_id": org["id"], "name": org.get("name"),
            "old": rfa, "new": new_dict,
        })

    print("═" * 60)
    print(f"orgs needing rewrite: {len(plan)}")
    for row in plan:
        print(f"\n  {row['name']} ({row['org_id']}):")
        for k, ids in (row["old"] or {}).items():
            marker = "→ DROP" if k in STRIP_KEYS or LEGACY_MAP.get(k) in STRIP_KEYS \
                else f"→ {LEGACY_MAP.get(k, k)}"
            n = len(ids) if isinstance(ids, list) else "?"
            print(f"    old {k!r:24s} ({n} ids)  {marker}")
        for k, ids in row["new"].items():
            print(f"    new {k!r:24s} ({len(ids)} ids)")
    print(f"\ncommit={args.commit}")
    print("═" * 60)

    if not args.commit:
        print("(dry-run — no writes)")
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    for row in plan:
        await db.orgs.update_one(
            {"id": row["org_id"]},
            {"$set": {
                "role_form_allowlist": row["new"],
                "_forms_per_role_backfilled_at": now_iso,
                "_forms_per_role_backfilled_version": "v58.13.132bk",
                "updated_at": now_iso,
            }},
        )
    print(f"\nWROTE: {len(plan)} orgs")


if __name__ == "__main__":
    asyncio.run(main())
