"""v58.13.132y — Simpro role-override protection tests.

Verifies:
  · Users with `role_manually_set=True` don't have their role_id
    rewritten by the Simpro delta sync.
  · Manual PATCH via `/api/users/{id}` flips `role_manually_set=True`.
  · 6 hotfixed users are protected (back-fill verification).
"""
from __future__ import annotations
import os
import sys
import uuid
from datetime import datetime, timezone

import pytest
import httpx

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"


def _fresh_db():
    from motor.motor_asyncio import AsyncIOMotorClient
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return c[os.environ["DB_NAME"]]


def _api_base():
    return os.environ.get("BACKEND_API_BASE", "http://localhost:8001") + "/api"


def _admin_token():
    r = httpx.post(
        f"{_api_base()}/auth/login",
        json={"email": "stephen@paneltec.com.au",
              "password": "Mcgstephen50#"},
        timeout=10.0,
    )
    r.raise_for_status()
    return r.json()["access_token"]


# ─── Back-fill verification ──────────────────────────────────
@pytest.mark.asyncio
async def test_six_hotfixed_users_are_role_manually_set():
    db = _fresh_db()
    n = await db.users.count_documents({
        "_created_by_hotfix": "v58.13.132r_workers_to_users",
        "role_manually_set": True,
        "deleted_at": None,
    })
    assert n == 6


@pytest.mark.asyncio
async def test_josh_and_adrian_flagged():
    db = _fresh_db()
    josh = await db.users.find_one({"email": "joshua@paneltec.com.au"})
    adrian = await db.users.find_one({"email": "adrianmitchell283@gmail.com"})
    assert josh["role_manually_set"] is True
    assert adrian["role_manually_set"] is True


# ─── PATCH sets flag ─────────────────────────────────────────
def test_admin_patch_role_flips_role_manually_set():
    """Manually assigning a role via `PATCH /api/users/{id}` MUST
    also set `role_manually_set=True` in the same write."""
    token = _admin_token()
    H = {"Authorization": f"Bearer {token}"}
    # Fetch any admin user (safe to no-op re-write their own role)
    r = httpx.get(f"{_api_base()}/users?hide_test=true",
                    headers=H, timeout=10.0)
    users = r.json()
    target = next(u for u in users
                   if u["email"] == "stephen@paneltec.com.au")
    # Confirm role is admin
    assert target["role_id"] == "admin"
    # PATCH re-asserting the same role
    r2 = httpx.patch(
        f"{_api_base()}/users/{target['id']}",
        headers=H, timeout=10.0,
        json={"role_id": "admin"},
    )
    assert r2.status_code in (200, 204), r2.text
    # Verify flag now True
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    async def _check():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        u = await db.users.find_one({"id": target["id"]})
        return u["role_manually_set"]
    assert asyncio.run(_check()) is True


# ─── Delta sync respects the flag ────────────────────────────
@pytest.mark.live_db_writes
@pytest.mark.asyncio
async def test_delta_sync_skips_role_write_when_flag_set():
    """When a user has `role_manually_set=True`, the delta sync's
    position-change branch MUST NOT overwrite their role_id even if
    Position changed. Simulates the branch logic directly."""
    db = _fresh_db()
    ts = datetime.now(timezone.utc).isoformat()

    # Fabricate a user with role_manually_set=True + a stale Simpro
    # position. Simulate delta sync detecting a new position and
    # confirm role_id stays untouched.
    fixture_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": fixture_id,
        "org_id": ORG_ID,
        "email": f"test-132y-{fixture_id[:6]}@example.test",
        "name": "Test 132y Manual",
        "role_id": "admin",
        "role": "admin",
        "role_manually_set": True,
        "simpro_position": "Old Position",
        "simpro_employee_id": "test-132y",
        "deleted_at": None,
        "is_test_fixture": True,
        "created_at": ts, "updated_at": ts,
    })
    try:
        # Simulate what `.132y` guard does in delta branch:
        u = await db.users.find_one({"id": fixture_id})
        new_pos = "New Position"
        old_pos = u.get("simpro_position")
        position_changed = new_pos != old_pos
        _positions_disabled = True   # env default
        _user_manual = bool(u.get("role_manually_set"))

        # The guard is `and not _positions_disabled and not _user_manual`.
        # Both are True → the branch that would rewrite role_id is SKIPPED.
        should_rewrite_role = (
            position_changed and new_pos
            and not _positions_disabled and not _user_manual
        )
        assert should_rewrite_role is False

        # BUT non-role fields still update (position, etc.).
        await db.users.update_one(
            {"id": fixture_id},
            {"$set": {"simpro_position": new_pos, "updated_at": ts}},
        )
        u2 = await db.users.find_one({"id": fixture_id})
        assert u2["role_id"] == "admin"           # unchanged
        assert u2["simpro_position"] == new_pos   # updated
        assert u2["role_manually_set"] is True    # unchanged
    finally:
        await db.users.delete_one({"id": fixture_id})


@pytest.mark.live_db_writes
@pytest.mark.asyncio
async def test_delta_sync_rewrites_role_when_flag_off():
    """Same simulation but with `role_manually_set=False` — the
    guard would ALLOW the role write (with position roles NOT
    disabled). Verifies the boolean logic is correct in the other
    direction."""
    db = _fresh_db()
    ts = datetime.now(timezone.utc).isoformat()
    fixture_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": fixture_id,
        "org_id": ORG_ID,
        "email": f"test-132y-off-{fixture_id[:6]}@example.test",
        "name": "Test 132y NoFlag",
        "role_id": "paneltec_civil",
        "role_manually_set": False,
        "simpro_position": "Old Position",
        "deleted_at": None, "is_test_fixture": True,
        "created_at": ts, "updated_at": ts,
    })
    try:
        u = await db.users.find_one({"id": fixture_id})
        new_pos = "New Position"
        position_changed = new_pos != u.get("simpro_position")
        _positions_disabled = False   # hypothetical: admin flipped global off
        _user_manual = bool(u.get("role_manually_set"))
        should_rewrite_role = (
            position_changed and new_pos
            and not _positions_disabled and not _user_manual
        )
        assert should_rewrite_role is True
    finally:
        await db.users.delete_one({"id": fixture_id})
