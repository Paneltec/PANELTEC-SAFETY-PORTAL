"""v58.13.132bc — One-time (idempotent) mirror of Paneltec Civil's
role permissions onto Viatec Traffic Solutions.

Task (Stephen · 2026-09-08):
    "Mirror Paneltec Civil permissions onto Viatec Traffic
    Solutions role — one-time copy, they must remain
    independently editable after."

Current state at ship time:
    roles.paneltec_civil    permissions={} permission_tokens=[]
    roles.viatec_traffic    permissions={} permission_tokens=[]
    permission_presets(role_id=paneltec_civil).permissions={}
    permission_presets(role_id=viatec_traffic).permissions={}
    → both roles are structurally identical (empty). Any future
    edit to Paneltec Civil that isn't followed by a manual copy to
    Viatec will drift. This script gives Stephen a re-runnable
    "sync now" button while the roles are still meant to track.

What this copies (from Paneltec Civil → Viatec Traffic Solutions):
    - `roles.permissions` (resource → action bool map)
    - `roles.permission_tokens` (legacy token list)
    - `roles.supersedes_role_id`
    - `permission_presets.permissions` (whichever preset row has
      role_id == paneltec_civil)

What is PRESERVED on the Viatec side (never overwritten):
    - id, role_id ('viatec_traffic'), name, slug, description,
      is_system, is_builtin, is_active, created_at, org_id
    - preset's id, key, role_id, name, based_on

Idempotency:
    Re-running with no source-side changes produces the same state
    — both writes set the target to a copy of the source and the
    source is untouched.

Usage:
    python scripts/mirror_paneltec_to_viatec_v58_13_132bc.py             # dry-run
    python scripts/mirror_paneltec_to_viatec_v58_13_132bc.py --commit
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


SRC_ROLE_ID = "paneltec_civil"
DST_ROLE_ID = "viatec_traffic"
COPIED_FIELDS = ("permissions", "permission_tokens", "supersedes_role_id")


async def _load_role(role_id: str) -> dict:
    doc = await db.roles.find_one({"role_id": role_id}, {"_id": 0})
    if not doc:
        raise SystemExit(f"roles.{role_id} not found — nothing to mirror")
    return doc


async def _load_preset(role_id: str) -> dict | None:
    return await db.permission_presets.find_one({"role_id": role_id}, {"_id": 0})


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    src = await _load_role(SRC_ROLE_ID)
    dst = await _load_role(DST_ROLE_ID)
    src_preset = await _load_preset(SRC_ROLE_ID)
    dst_preset = await _load_preset(DST_ROLE_ID)

    # ── plan role update ─────────────────────────────────────────
    role_update = {f: src.get(f) if f != "permission_tokens"
                   else (src.get(f) or [])
                   for f in COPIED_FIELDS}
    # Normalise permissions to a plain dict (never None).
    role_update["permissions"] = src.get("permissions") or {}

    role_delta = {
        f: (dst.get(f), role_update[f])
        for f in role_update
        if (dst.get(f) or ({} if f == "permissions" else [])) != role_update[f]
    }

    # ── plan preset update ───────────────────────────────────────
    preset_delta = {}
    if src_preset and dst_preset:
        src_perms = src_preset.get("permissions") or {}
        dst_perms = dst_preset.get("permissions") or {}
        if src_perms != dst_perms:
            preset_delta["permissions"] = (dst_perms, src_perms)

    print("─" * 60)
    print(f"Source: roles.{SRC_ROLE_ID}  (id={src.get('id')})")
    print(f"Target: roles.{DST_ROLE_ID}  (id={dst.get('id')})")
    print(f"Fields to copy on target role:  {list(role_update.keys())}")
    print(f"Role fields that will CHANGE:   {list(role_delta.keys())}")
    print(f"Preset fields that will CHANGE: {list(preset_delta.keys())}")
    print(f"commit={args.commit}")
    print("─" * 60)

    if not role_delta and not preset_delta:
        print("(no-op — target already identical to source)")

    if not args.commit:
        for f, (before, after) in role_delta.items():
            print(f"  role.{f}: {before!r} → {after!r}"[:200])
        for f, (before, after) in preset_delta.items():
            print(f"  preset.{f}: {before!r} → {after!r}"[:200])
        print("\n(dry-run — no writes) run with --commit to apply")
        return

    now_iso = datetime.now(timezone.utc).isoformat()

    # Real writes.
    if role_delta:
        await db.roles.update_one(
            {"role_id": DST_ROLE_ID},
            {"$set": {**role_update, "updated_at": now_iso,
                      "_mirrored_from": SRC_ROLE_ID,
                      "_mirrored_at": now_iso}},
        )
        print(f"WROTE roles.{DST_ROLE_ID}: {list(role_update.keys())}")

    if preset_delta:
        await db.permission_presets.update_one(
            {"role_id": DST_ROLE_ID},
            {"$set": {"permissions": src_preset["permissions"],
                      "updated_at": now_iso,
                      "_mirrored_from": SRC_ROLE_ID,
                      "_mirrored_at": now_iso}},
        )
        print(f"WROTE permission_presets.{DST_ROLE_ID}: permissions")

    print("\nComplete. Roles remain independently editable — no ongoing hard mirror.")


if __name__ == "__main__":
    asyncio.run(main())
