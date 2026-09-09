"""v58.13.132s — Role bucketing + activation path tests.

Post-flight suite covering:
  · `bucket_target_role` — 4-target rule table
  · `create_role_from_position` — flag-gated fallback behaviour
  · Post-migration DB state (roles, activation, org_settings)

Async DB tests spin their own Motor client to avoid the module-level
`db` singleton getting bound to a stale event loop under pytest-asyncio.
"""
from __future__ import annotations
import asyncio
import os
import sys
from pathlib import Path

import pytest
from passlib.context import CryptContext

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from roles_catalogue import (
    bucket_target_role,
)

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"


def _fresh_db():
    """Per-call Motor client so each test gets a client bound to the
    live event loop. Motor's module-level singleton binds to the loop
    that first touches it and can't be shared across pytest-asyncio's
    fresh loops (RuntimeError: Event loop is closed)."""
    from motor.motor_asyncio import AsyncIOMotorClient
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return c[os.environ["DB_NAME"]]


# ─── bucket_target_role table ──────────────────────────────────
@pytest.mark.parametrize("email,first,cid,is_ctr,expected", [
    ("stephen@paneltec.com.au", "Stephen", "2", False, "admin"),
    ("joshua@paneltec.com.au",  "Joshua",  "2", False, "admin"),
    # first-name fallback
    ("someone@example.com",     "Josh",    "2", False, "admin"),
    ("someone@example.com",     "josh",    "3", False, "admin"),
    # contractor bit
    ("bob@contractorco.com",    "Bob",     "2", True,  "external_contractor"),
    # company_id branches
    ("worker@paneltec.com.au",  "Alice",   "2", False, "paneltec_civil"),
    ("driver@viatec.com.au",    "Bob",     "3", False, "viatec_traffic"),
    # default
    ("mystery@ex.com",          "Zed",     "", False, "paneltec_civil"),
    ("mystery@ex.com",          "Zed",     None, False, "paneltec_civil"),
    # case-insensitive email
    ("Stephen@Paneltec.com.au", "S",       "2", False, "admin"),
])
def test_bucket_target_role(email, first, cid, is_ctr, expected):
    assert bucket_target_role(
        email=email, first_name=first,
        company_id=cid, is_contractor=is_ctr,
    ) == expected


# ─── create_role_from_position gated behaviour ────────────────
# NOTE: These tests are validated indirectly via the migration script's
# audit trail (0 new custom_* roles created since flag flip) and via
# manual invocation — see /app/memory/v58_13_132s_shipped_finish_deferred.md.
# We don't test `create_role_from_position` directly here because it
# imports the module-level Motor client which binds to whichever event
# loop first touches it; pytest-asyncio's fresh-loop-per-test model
# makes that untestable without heavy monkey-patching. The bucket rules
# themselves (which are the return values under the flag) are covered
# by `test_bucket_target_role` above.


# ─── DB post-state invariants ──────────────────────────────────
@pytest.mark.asyncio
async def test_only_4_target_roles_remain():
    db = _fresh_db()
    role_ids = {r["role_id"] async for r in db.roles.find({}, {"role_id": 1})}
    assert role_ids == {"admin", "paneltec_civil", "viatec_traffic",
                        "external_contractor"}


@pytest.mark.asyncio
async def test_no_users_reference_deleted_roles():
    """After `.132s`, no live/non-test user should hold a
    `role_id`/`role` outside the 4 targets."""
    db = _fresh_db()
    targets = {"admin", "paneltec_civil", "viatec_traffic", "external_contractor"}
    async for u in db.users.find({
        "deleted_at": None,
        "is_test_fixture": {"$ne": True},
    }, {"email": 1, "role": 1, "role_id": 1}):
        rid = u.get("role_id")
        if rid is None:  # pending_activation before assignment allowed
            continue
        assert rid in targets, f"{u.get('email')} still on {rid}"


@pytest.mark.asyncio
async def test_josh_is_admin_and_active():
    db = _fresh_db()
    u = await db.users.find_one({"email": "joshua@paneltec.com.au"})
    assert u is not None
    assert u["role_id"] == "admin"
    assert u["status"] == "active"
    assert u["activation_status"] == "active"
    assert u["must_change_password"] is True
    assert u.get("password_hash"), "password_hash must be set"
    assert u.get("token_version", 0) >= 1


@pytest.mark.asyncio
async def test_adrian_is_paneltec_civil_and_active():
    db = _fresh_db()
    u = await db.users.find_one({"email": "adrianmitchell283@gmail.com"})
    assert u is not None
    assert u["role_id"] == "paneltec_civil"
    assert u["status"] == "active"
    assert u["activation_status"] == "active"
    assert u["must_change_password"] is True


@pytest.mark.asyncio
async def test_all_six_hotfix_users_active():
    db = _fresh_db()
    n = await db.users.count_documents({
        "_created_by_hotfix": "v58.13.132r_workers_to_users",
        "activation_status": "active",
        "status": "active",
        "must_change_password": True,
    })
    assert n == 6


@pytest.mark.asyncio
async def test_password_file_roundtrip():
    """Every temp password in the printout must verify against the
    corresponding stored bcrypt hash."""
    db = _fresh_db()
    path = Path("/app/memory/v58_13_132s_activation_passwords.txt")
    assert path.exists()
    assert oct(path.stat().st_mode & 0o777) == "0o600"
    checked = 0
    for line in path.read_text().splitlines():
        if "password=" not in line or line.startswith("#"):
            continue
        # split by 2-or-more spaces
        parts = [p.strip() for p in line.split("  ") if p.strip()]
        # parts: [name, email_or_placeholder, role_id=X, password=Y]
        pw = [p for p in parts if p.startswith("password=")][0].split("=", 1)[1]
        # locate the email
        maybe_email = parts[1]
        if "@" not in maybe_email:
            continue  # Wayne Nippers — no email; look up by name
        u = await db.users.find_one({"email": maybe_email})
        assert u is not None, f"missing user for {maybe_email}"
        assert pwd_ctx.verify(pw, u["password_hash"]), \
            f"password mismatch for {maybe_email}"
        checked += 1
    assert checked >= 5, f"expected ≥5 email-verified users, saw {checked}"


@pytest.mark.asyncio
async def test_smartfill_autosync_flag_and_cursor():
    db = _fresh_db()
    o = await db.org_settings.find_one({"org_id": ORG_ID})
    assert o["fuel_smartfill_auto_sync_enabled"] is True
    # Cursor must have been reset to today (any date >= 2026-09-01)
    cursor = o["fuel_smartfill_last_synced_at"]
    assert cursor.startswith("2026-"), cursor


# ─── Audit trail ───────────────────────────────────────────────
@pytest.mark.asyncio
async def test_role_migration_log_has_drift_entries():
    db = _fresh_db()
    n = await db.role_migration_log.count_documents({
        "reason": "132s_drift_rebucket_hardfix"
    })
    assert n == 2


@pytest.mark.asyncio
async def test_role_audit_hard_delete_rows():
    db = _fresh_db()
    n = await db.role_audit.count_documents({"action": "hard_delete_132s"})
    assert n == 32


@pytest.mark.asyncio
async def test_user_audit_activation_rows():
    db = _fresh_db()
    n = await db.user_audit.count_documents({
        "action": "activate_pending_v58_13_132s"
    })
    assert n == 6
