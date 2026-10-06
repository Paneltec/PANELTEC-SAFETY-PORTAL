"""Bind this installation's previously verified owner during ordinary image updates.

The fingerprint pins an immutable account ID, never a name, email or first admin.
Existing explicit environment configuration always takes precedence. No user,
role or grant records are created or changed. Ambiguous/missing accounts deny access.
"""
import hashlib
import os

OWNER_ACCOUNT_SHA256 = "3a518f7f6b56fb1ff44d51abd1bbe1f6f54e1d2d709918bf291224ce39a7443d"

async def configure_bundled_payroll_owner(db):
    if os.environ.get("PAYROLL_OWNER_USER_ID") or os.environ.get("PAYROLL_OWNER_ORG_ID"):
        return False
    matches = []
    async for user in db.users.find({"role": "admin"}, {"id": 1, "org_id": 1, "role": 1, "_id": 0}):
        identifier = user.get("id")
        if isinstance(identifier, str) and hashlib.sha256(identifier.encode()).hexdigest() == OWNER_ACCOUNT_SHA256:
            matches.append(user)
    if len(matches) != 1 or not isinstance(matches[0].get("org_id"), str) or not matches[0]["org_id"]:
        return False
    os.environ["PAYROLL_OWNER_USER_ID"] = matches[0]["id"]
    os.environ["PAYROLL_OWNER_ORG_ID"] = matches[0]["org_id"]
    return True
