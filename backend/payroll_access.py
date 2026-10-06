"""Payroll requires an explicit per-user grant; role-wide grants never suffice."""
def payroll_allowed(user, overrides, action):
    if user.get("role") != "admin":
        return False
    grants = overrides.get("payroll") or {}
    if grants.get("view") is not True:
        return False
    if action in ("open", "view"):
        return True
    if action == "edit":
        return grants.get("edit") is True
    return False


# Pin these to Stephen's immutable account and organisation IDs at deployment.
# No email matching or first-user auto-enrolment: unset configuration denies access.
def is_payroll_owner(user):
    import os
    owner = os.environ.get("PAYROLL_OWNER_USER_ID", "")
    org = os.environ.get("PAYROLL_OWNER_ORG_ID", "")
    return bool(owner and org and user.get("id") == owner
                and user.get("org_id") == org and user.get("role") == "admin")

async def payroll_grants(user):
    from db import db
    if is_payroll_owner(user):
        return {"payroll": {"view": True, "edit": True}}
    row = await db.payroll_access.find_one({"_id": str(user.get("org_id")) + ":" + str(user.get("id"))})
    level = (row or {}).get("level", "none")
    return {"payroll": {"view": level in ("view", "edit"), "edit": level == "edit"}}
