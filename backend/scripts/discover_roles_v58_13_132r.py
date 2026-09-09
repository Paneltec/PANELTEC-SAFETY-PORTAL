"""v58.13.132r — Improved discovery that cross-references
users.simpro_employee_id → workers.company_id for company scoping.
READ-ONLY.
"""
from __future__ import annotations
import asyncio, sys, json
from collections import Counter

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from db import db  # noqa: E402


async def main():
    # ── Preload worker index by simpro_employee_id ────────
    worker_by_emp: dict = {}
    async for w in db.workers.find(
        {}, {"_id": 0, "simpro_employee_id": 1, "company_id": 1,
             "simpro_company_id": 1, "first_name": 1, "last_name": 1},
    ):
        emp = str(w.get("simpro_employee_id") or "")
        if emp:
            worker_by_emp[emp] = {
                "company_id": str(w.get("company_id") or w.get("simpro_company_id") or ""),
                "name": f"{w.get('first_name','')} {w.get('last_name','')}".strip(),
            }
    print(f"Loaded {len(worker_by_emp)} workers by simpro_employee_id")

    # ── Bucket every active user ──────────────────────────
    # v58.13.132r final — 4-target: HSEQ Officer merges into
    # company-scoped bucket (no standalone HSEQ role).
    hseq_role_keys: set = set()
    admin_role_keys = {
        "admin", "owner", "full_admin",
        "report_emailing_admin", "responsible_manager", "mechanic",
        "training_inductions_only",
        # custom-office roles that map to Admin:
        "custom_director", "custom_administration", "custom_admin_assistant",
        "custom_business_development_manager", "custom_operations_manager",
        "custom_mechanic_technician",
    }
    # HSEQ system roles now flow through the company-scoped rule
    # (they map to Paneltec Civil or Viatec Traffic Solutions
    # depending on the linked worker's Simpro company_id). If a HSEQ
    # user has NO company link, they land in Ambiguous for review.
    _hseq_pass_through = {
        "hseq_manager", "hseq_lead", "hseq_manager_readonly",
        "hseq_manager_creator", "custom_safety_and_compliance_manager",
    }
    contractor_keys = {"contractor_rep", "contractor_rep_submit_only", "contractor"}

    proposal = {
        "Admin": [],
        "Paneltec Civil": [], "Viatec Traffic Solutions": [],
        "External Contractor": [], "Ambiguous": [],
    }

    role_seen = Counter()
    async for u in db.users.find(
        {"deleted_at": None, "is_archived": {"$ne": True}},
        {"_id": 0, "id": 1, "email": 1, "role": 1, "role_id": 1,
         "company_id": 1, "company_scope": 1, "is_contractor": 1,
         "simpro_employee_id": 1, "name": 1, "position": 1,
         "activation_status": 1, "status": 1},
    ):
        role = (u.get("role_id") or u.get("role") or "").lower()
        role_seen[role] += 1
        cid = str(u.get("company_id") or "")
        is_ctr = bool(u.get("is_contractor"))
        emp = str(u.get("simpro_employee_id") or "")
        # Cross-reference from workers if user has no company_id.
        if not cid and emp and emp in worker_by_emp:
            cid = worker_by_emp[emp]["company_id"]
        display = u.get("email") or u.get("name") or u.get("id", "?")
        pos = u.get("position") or ""

        target = None
        if role in admin_role_keys:
            target = "Admin"
        elif is_ctr or role in contractor_keys or "contractor" in role:
            target = "External Contractor"
        elif cid == "2":
            # Includes HSEQ/field roles cross-referenced to Company 2.
            target = "Paneltec Civil"
        elif cid == "3":
            target = "Viatec Traffic Solutions"
        else:
            target = "Ambiguous"

        proposal[target].append({
            "display": display, "current_role": role or "(none)",
            "company_id": cid or "(none)", "is_contractor": is_ctr,
            "position": pos, "simpro_employee_id": emp,
            "activation_status": u.get("activation_status"),
        })

    print("\n=== Mapping counts (v2 with worker company cross-ref) ===")
    for bucket, members in proposal.items():
        print(f"    {bucket}: {len(members)} users")
    print(f"\n=== Role frequencies seen ({sum(role_seen.values())} total) ===")
    for k, n in role_seen.most_common():
        print(f"    {n:4d}  role={k}")

    print("\n=== AMBIGUOUS full list ===")
    for m in proposal["Ambiguous"]:
        print(f"    {m['display'][:35]:<35}  role={m['current_role']:<32}  "
              f"cid={m['company_id']:<6}  emp={m['simpro_employee_id'] or '-'}  "
              f"pos={m['position'][:30]}")

    print("\n=== Per-bucket first 15 ===")
    for bucket in ("Admin", "Paneltec Civil", "Viatec Traffic Solutions", "External Contractor"):
        print(f"\n    ── {bucket} ({len(proposal[bucket])}) ──")
        for m in proposal[bucket][:15]:
            print(f"        {m['display'][:35]:<35}  role={m['current_role']:<28}  cid={m['company_id']}  pos={m['position'][:25]}")
        if len(proposal[bucket]) > 15:
            print(f"        … + {len(proposal[bucket]) - 15} more")


if __name__ == "__main__":
    asyncio.run(main())
