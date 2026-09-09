"""v58.13.132bd — Legacy-role → 4-core-role consolidation.

Backfills:
  1. `db.swms.applies_to.roles` — rewrites legacy tokens to core role_ids.
     Handles both list-item shapes: `"role_string"` and `{"role":"..."}`.
     Deduplicates and normalises every item to a plain string.
  2. `db.users.role` AND `db.users.role_id` — rewrites BOTH legacy fields to
     the same target core role_id. If either field is already core we keep
     that value and mirror it to the other field. If neither is core we
     consult USER_ROLE_MAP against `role` first, then `role_id`.

Mapping (Stephen-approved for `.132bd`):
  operator             → paneltec_civil
  foreman              → paneltec_civil
  general_user         → paneltec_civil
  worker               → paneltec_civil
  supervisor           → paneltec_civil
  manager              → admin
  hseq_manager         → admin
  hseq_lead            → admin
  responsible_manager  → admin
  auditor              → admin

Idempotent: re-running produces the same state.
Usage:
    python scripts/consolidate_legacy_roles_v58_13_132bd.py             # dry-run
    python scripts/consolidate_legacy_roles_v58_13_132bd.py --commit
"""
from __future__ import annotations
import argparse, asyncio, sys
from datetime import datetime, timezone
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from db import db  # noqa

CORE = {"admin", "paneltec_civil", "viatec_traffic", "external_contractor"}

# Same mapping applies to both SWMS role tokens and user role/role_id.
LEGACY_MAP = {
    "operator":            "paneltec_civil",
    "foreman":             "paneltec_civil",
    "general_user":        "paneltec_civil",
    "worker":              "paneltec_civil",
    "supervisor":          "paneltec_civil",
    "manager":             "admin",
    "hseq_manager":        "admin",
    "hseq_lead":           "admin",
    "responsible_manager": "admin",
    "auditor":             "admin",
}


def _canonical_role(item):
    """Return the canonical role string for a SWMS applies_to.roles list
    item, applying the legacy map. Item is either a string or {"role":"..."}."""
    if isinstance(item, str):
        raw = item
    elif isinstance(item, dict):
        raw = item.get("role") or item.get("role_id")
    else:
        raw = None
    if not raw:
        return None
    return LEGACY_MAP.get(raw, raw)


def _pick_user_target(role, role_id):
    """Determine the single core role_id both fields should hold.

    Preference order (matches how the backend permission engine reads
    these fields — `role_id` is authoritative, `role` is legacy mirror):
      1. If `role_id` is already core → use it.
      2. Else if `role` is already core → use it.
      3. Else map via LEGACY_MAP on `role_id` first, then `role`.

    This prevents accidental privilege escalation when the two fields
    disagree (e.g. `role='auditor'` [→admin] but `role_id='general_user'`
    [→paneltec_civil]: role_id wins so the user stays at worker level).
    """
    if role_id in CORE:
        return role_id
    if role in CORE:
        return role
    for candidate in (role_id, role):
        mapped = LEGACY_MAP.get(candidate)
        if mapped:
            return mapped
    return None


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()
    now_iso = datetime.now(timezone.utc).isoformat()

    # ── SWMS backfill ────────────────────────────────────────────
    swms_writes = []
    async for s in db.swms.find({}):
        raw = ((s.get("applies_to") or {}).get("roles")) or []
        if not raw:
            continue
        new_roles = []
        seen = set()
        touched = False
        for it in raw:
            can = _canonical_role(it)
            if not can:
                continue
            # Normalise to plain string.
            if isinstance(it, dict) or can != it:
                touched = True
            if can not in seen:
                seen.add(can)
                new_roles.append(can)
        if touched and new_roles != raw:
            swms_writes.append({"id": s["id"], "old": raw, "new": new_roles})

    # ── users.{role, role_id} backfill ───────────────────────────
    user_writes = []
    async for u in db.users.find({}):
        role = u.get("role")
        role_id = u.get("role_id")
        # Skip only if both fields are already core AND consistent.
        both_core = role in CORE and role_id in CORE
        consistent = role == role_id
        if both_core and consistent:
            continue
        target = _pick_user_target(role, role_id)
        if not target:
            continue
        if role == target and role_id == target:
            continue
        user_writes.append({
            "id": u.get("id") or str(u.get("_id")),
            "email": u.get("email"),
            "old_role": role,
            "old_role_id": role_id,
            "new": target,
        })

    print("═" * 60)
    print(f"SWMS docs to rewrite: {len(swms_writes)}")
    for w in swms_writes:
        print(f"  {w['id']}: {w['old']} → {w['new']}")
    print(f"User docs to rewrite: {len(user_writes)}")
    for w in user_writes:
        print(f"  {w['email']}: role {w['old_role']!r} / role_id {w['old_role_id']!r} → {w['new']!r}")
    print(f"commit={args.commit}")
    print("═" * 60)

    if not args.commit:
        print("(dry-run — no writes)")
        return

    for w in swms_writes:
        await db.swms.update_one(
            {"id": w["id"]},
            {"$set": {"applies_to.roles": w["new"],
                      "_role_backfilled_at": now_iso,
                      "updated_at": now_iso}},
        )
    for w in user_writes:
        await db.users.update_one(
            {"id": w["id"]} if w["id"] else {"email": w["email"]},
            {"$set": {"role": w["new"],
                      "role_id": w["new"],
                      "_role_backfilled_at": now_iso,
                      "updated_at": now_iso}},
        )
    print(f"\nWROTE: {len(swms_writes)} SWMS docs, {len(user_writes)} users")


if __name__ == "__main__":
    asyncio.run(main())
