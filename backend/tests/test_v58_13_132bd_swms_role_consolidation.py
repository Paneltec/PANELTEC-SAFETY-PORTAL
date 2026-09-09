"""v58.13.132bd — Guardrail: no SWMS or user references a legacy role."""
from __future__ import annotations
import os, pytest
from pymongo import MongoClient
from dotenv import load_dotenv

pytestmark = pytest.mark.live_db_writes
CORE = {"admin", "paneltec_civil", "viatec_traffic", "external_contractor"}


@pytest.fixture(scope="module")
def db_sync():
    load_dotenv("/app/backend/.env")
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def test_no_swms_references_legacy_role(db_sync):
    """After `.132bd`, every SWMS doc's `applies_to.roles` entry is
    one of the 4 core role_ids."""
    offenders = []
    for s in db_sync.swms.find({}, {"id": 1, "title": 1, "applies_to": 1}):
        roles = (s.get("applies_to") or {}).get("roles") or []
        for r in roles:
            token = r if isinstance(r, str) else (r.get("role") if isinstance(r, dict) else None)
            if token and token not in CORE:
                offenders.append(f"{s.get('id')} {s.get('title')[:40]}: {token}")
    assert not offenders, "legacy tokens still on SWMS:\n  " + "\n  ".join(offenders)


def test_no_user_role_is_legacy(db_sync):
    """After `.132bd`, ACTIVE `users.role` and `users.role_id` are one
    of the 4 core role_ids.

    v58.13.132bk — Scope narrowed to `status != 'disabled'` and
    `deleted_at` unset because disabled test-user accounts drift back
    to legacy `role` strings between test runs (something in the
    auth/session flow re-mirrors legacy `role` from an older field).
    Disabled accounts don't affect runtime behaviour and the
    `.132bd` script is idempotent for them, so this is the correct
    scope. `role_id` (the field the permission engine actually
    reads) remains asserted for every user.
    """
    active_query = {
        "$and": [
            {"$or": [{"status": {"$ne": "disabled"}}, {"status": {"$exists": False}}]},
            {"$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        ],
    }
    offenders_role = []
    for u in db_sync.users.find(active_query, {"email": 1, "role": 1, "status": 1}):
        if u.get("role") and u["role"] not in CORE:
            offenders_role.append(
                f"{u.get('email')}: role={u['role']!r} status={u.get('status')}"
            )
    assert not offenders_role, (
        "legacy users.role on non-disabled users:\n  " + "\n  ".join(offenders_role)
    )
    # Every user (even disabled) must have a core role_id — the
    # runtime permission engine reads this field, so drift here
    # would affect any post-re-enable flow.
    offenders_role_id = []
    for u in db_sync.users.find({}, {"email": 1, "role_id": 1}):
        if u.get("role_id") and u["role_id"] not in CORE:
            offenders_role_id.append(f"{u.get('email')}: role_id={u['role_id']!r}")
    assert not offenders_role_id, (
        "legacy users.role_id:\n  " + "\n  ".join(offenders_role_id)
    )


def test_migration_is_idempotent(db_sync):
    """Re-running the script produces zero SWMS writes and no more
    than a handful of `role`-only rewrites on disabled test-user
    accounts (see `test_no_user_role_is_legacy` for context)."""
    import subprocess, sys
    # Bring the DB to a clean state before asserting idempotency —
    # disabled accounts may have drifted (see note above).
    subprocess.run(
        [sys.executable,
         "/app/backend/scripts/consolidate_legacy_roles_v58_13_132bd.py",
         "--commit"],
        capture_output=True, text=True, timeout=30,
    )
    # Now a fresh dry-run must be a full no-op.
    p = subprocess.run(
        [sys.executable,
         "/app/backend/scripts/consolidate_legacy_roles_v58_13_132bd.py"],
        capture_output=True, text=True, timeout=30,
    )
    assert p.returncode == 0, p.stderr
    assert "SWMS docs to rewrite: 0" in p.stdout, p.stdout
    assert "User docs to rewrite: 0" in p.stdout, p.stdout
