"""v160.3.9.33 — Phase 4d bulk data fix: assign every Simpro-linked user
to their Simpro-position role (unconditional, safe defaults).

Rationale
─────────
Users like Ian Stubbings, Matthew Smith, Jason Donnellan and the other
~60 Simpro-imported staff already have `simpro_position` set. Their
position IS their role. Making the admin click "Assign role" on every
row is the wrong flow — this script does it in one shot.

For each user in the caller org (Paneltec Civil):
  • If `is_test_fixture=True` or `is_test=True` → SKIP.
  • If `email` is a known real-account fixture → SKIP.
  • If current `role_id == "admin"` OR current `role == "admin"` → SKIP.
  • If `role_locked=True` (v4d Option C once shipped) → SKIP.
  • If `simpro_position` is unset → SKIP (admin still picks manually).
  • Else → assign `custom_<slug(simpro_position)>`, creating that role
    doc if missing (source="simpro_position_auto", tokens=[]). Sets
    `role_locked=False`, `role=<role_id>`, `activation_status="active"`,
    `role_assigned_at=now()`. Bumps `token_version`. One `user_audit`
    row per change with `action="bulk_role_reset_from_simpro_position"`.

Idempotent — the second run reports 0 changes.
"""
import asyncio
import sys

sys.path.insert(0, "/app/backend")

import re
from collections import Counter

from db import db
from models import new_id, now_iso


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    s = _SLUG_RE.sub("_", (name or "").strip().lower()).strip("_")
    return s or "role"


FIXTURE_EMAILS = frozenset({
    "stephen@paneltec.com.au",
    "hseq-lead-fixture@paneltec.com.au",
    "contractor-rep-fixture@paneltec.com.au",
    "worker-fixture@paneltec.com.au",
    "pending-activation-fixture@paneltec.com.au",
})


async def _ensure_position_role(position: str, actor_email: str) -> str:
    """Return custom_<slug(position)>, creating the role doc if missing.
    Mirrors roles_catalogue.create_role_from_position."""
    role_id = "custom_" + _slugify(position)
    existing = await db.roles.find_one({"role_id": role_id}, {"_id": 0})
    if existing:
        return role_id
    now = now_iso()
    doc = {
        "id": new_id(),
        "role_id": role_id,
        "name": position.strip(),
        "description": (f"Auto-created from Simpro position '{position.strip()}'. "
                        f"Configure permissions in Roles Admin."),
        "permission_tokens": [],
        "is_system": False,
        "is_active": True,
        "source": "simpro_position_auto",
        "supersedes_role_id": None,
        "pending_scoping_helper": False,
        "deleted_at": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.roles.insert_one(doc)
    await db.role_audit.insert_one({
        "id": new_id(),
        "role_id": role_id,
        "role_name": position.strip(),
        "action": "create_from_simpro",
        "before": None,
        "after": doc,
        "diff": {"created": True, "simpro_position": position.strip(),
                 "tokens_count": 0, "source": "simpro_position_auto",
                 "reason": "v4d bulk data fix"},
        "actor_user_id": None,
        "actor_email": actor_email,
        "at": now,
    })
    return role_id


async def main():
    admin = await db.users.find_one({"email": "stephen@paneltec.com.au"},
                                     {"_id": 0, "id": 1, "org_id": 1})
    if not admin:
        raise SystemExit("stephen@paneltec.com.au not found — aborting")
    org_id = admin["org_id"]
    actor_id = admin["id"]
    actor_email = "v4d-bulk-reset-script"

    # ─── BEFORE snapshot ───────────────────────────────────────────
    before_counts: Counter = Counter()
    async for u in db.users.find(
        {"org_id": org_id, "$or": [{"deleted_at": {"$exists": False}},
                                    {"deleted_at": None}]},
        {"_id": 0, "role_id": 1}):
        before_counts[u.get("role_id") or "(none)"] += 1

    # ─── Scan + apply ──────────────────────────────────────────────
    changed = []
    skipped = []
    now = now_iso()
    async for u in db.users.find(
        {"org_id": org_id, "$or": [{"deleted_at": {"$exists": False}},
                                    {"deleted_at": None}]},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "role_id": 1,
         "simpro_position": 1, "is_test_fixture": 1, "is_test": 1,
         "role_locked": 1, "is_archived": 1},
    ):
        # Filter guards.
        if u.get("email") in FIXTURE_EMAILS:
            skipped.append({"user": u, "reason": "known_fixture_email"}); continue
        if u.get("is_test_fixture") or u.get("is_test"):
            skipped.append({"user": u, "reason": "is_test_fixture"}); continue
        if u.get("role_id") == "admin" or u.get("role") == "admin":
            skipped.append({"user": u, "reason": "admin_role_preserved"}); continue
        if u.get("role_locked") is True:
            skipped.append({"user": u, "reason": "role_locked_true"}); continue
        pos = (u.get("simpro_position") or "").strip()
        if not pos:
            skipped.append({"user": u, "reason": "no_simpro_position"}); continue

        new_role_id = await _ensure_position_role(pos, actor_email)
        old_role_id = u.get("role_id")
        if old_role_id == new_role_id:
            skipped.append({"user": u, "reason": "already_correct"}); continue

        await db.users.update_one(
            {"id": u["id"]},
            {"$set": {
                "role_id": new_role_id,
                "role": new_role_id,
                "role_locked": False,
                "role_assigned_at": now,
                "activation_status": "active" if not u.get("is_archived") else "suspended",
                "status": "active" if not u.get("is_archived") else u.get("status", "active"),
                "updated_at": now,
            }, "$inc": {"token_version": 1}},
        )
        await db.user_audit.insert_one({
            "id": new_id(),
            "user_id": u["id"],
            "action": "bulk_role_reset_from_simpro_position",
            "before": {"role_id": old_role_id, "role": u.get("role")},
            "after": {"role_id": new_role_id, "role": new_role_id},
            "diff": {"reason": "v4d bulk data fix",
                     "simpro_position": pos,
                     "role_source": "simpro_position_auto"},
            "actor_user_id": actor_id,
            "actor_email": actor_email,
            "at": now,
        })
        changed.append({"user": u, "old": old_role_id, "new": new_role_id, "pos": pos})

    # ─── AFTER snapshot ────────────────────────────────────────────
    after_counts: Counter = Counter()
    async for u in db.users.find(
        {"org_id": org_id, "$or": [{"deleted_at": {"$exists": False}},
                                    {"deleted_at": None}]},
        {"_id": 0, "role_id": 1}):
        after_counts[u.get("role_id") or "(none)"] += 1

    # ─── Report ────────────────────────────────────────────────────
    print(f"\n{'=' * 68}")
    print(f"BULK ROLE RESET FROM SIMPRO POSITION — v160.3.9.33")
    print(f"{'=' * 68}")
    print(f"Users changed: {len(changed)}")
    print(f"Users skipped: {len(skipped)}")
    for c in changed:
        u = c["user"]
        print(f"  ✓  {(u.get('name') or '')[:22]:22}  {(u.get('email') or '')[:38]:38}  "
              f"{(c['old'] or '(none)')[:35]:35}  →  {c['new']:35}  "
              f"(pos={c['pos']})")

    skip_reasons: Counter = Counter(s["reason"] for s in skipped)
    print(f"\nSkip breakdown: {dict(skip_reasons)}")

    print(f"\n{'=' * 68}")
    print(f"ROLE-ID COUNTS  (before → after)")
    print(f"{'=' * 68}")
    all_ids = sorted(set(before_counts) | set(after_counts))
    for rid in all_ids:
        b = before_counts.get(rid, 0)
        a = after_counts.get(rid, 0)
        arrow = "  " if a == b else " →"
        marker = " CHANGED" if a != b else ""
        print(f"  {rid:45} {b:4d}{arrow}{a:4d}{marker}")

    # ─── Verification: Matthew Smith + Jason Donnellan ─────────────
    print(f"\n{'=' * 68}")
    print("VERIFICATION — Plumbers")
    print(f"{'=' * 68}")
    for match in ("matthew.*smith", "jason.*donnellan"):
        u = await db.users.find_one(
            {"$or": [{"email": {"$regex": match, "$options": "i"}},
                     {"name": {"$regex": match, "$options": "i"}}]},
            {"_id": 0, "name": 1, "email": 1, "role_id": 1, "role_locked": 1,
             "simpro_position": 1, "role": 1},
        )
        if u:
            print(f"  {u.get('name'):20}  {(u.get('email') or '')[:38]:38}  "
                  f"pos={(u.get('simpro_position') or '-'):20}  "
                  f"role_id={(u.get('role_id') or '-'):22}  "
                  f"role_locked={u.get('role_locked')}")

    print(f"\nDone. Script is idempotent — re-running will be a no-op.")


if __name__ == "__main__":
    asyncio.run(main())
