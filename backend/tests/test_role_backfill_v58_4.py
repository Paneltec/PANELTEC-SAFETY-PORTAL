"""v160.3.9.58.4 — Assert the two silently-broken roles now carry
non-empty permission_tokens after the backfill script has run, and
the duplicate/test-artefact roles have been purged.

Uses a per-test motor client so event-loop lifecycle stays clean.
"""
from __future__ import annotations

import os
import pytest
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")


async def _db():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


@pytest.mark.asyncio
async def test_custom_cleaner_has_tokens():
    client, db = await _db()
    try:
        role = await db.roles.find_one({"role_id": "custom_cleaner"}, {"_id": 0})
        assert role is not None
        tokens = role.get("permission_tokens") or []
        assert len(tokens) > 0, "custom_cleaner still has 0 tokens"
        ref = await db.roles.find_one(
            {"role_id": "custom_construction_worker_l1"}, {"_id": 0})
        ref_tokens = (ref or {}).get("permission_tokens") or []
        assert len(tokens) >= len(ref_tokens) - 2
        for t in ("pre_starts.view", "hazards.view", "swms.view"):
            assert t in tokens, f"missing essential token {t}"
    finally:
        client.close()


@pytest.mark.asyncio
async def test_custom_mechanic_technician_has_tokens():
    client, db = await _db()
    try:
        role = await db.roles.find_one(
            {"role_id": "custom_mechanic_technician"}, {"_id": 0})
        assert role is not None
        tokens = role.get("permission_tokens") or []
        assert len(tokens) > 0
        for t in ("vehicles.view", "assets.view",
                  "pre_starts.view", "hazards.view"):
            assert t in tokens, f"missing essential token {t}"
    finally:
        client.close()


@pytest.mark.asyncio
async def test_backfill_audit_rows_present():
    client, db = await _db()
    try:
        rows = await db.admin_actions.find(
            {"actor": "system-cleanup-v58-4",
             "action": "backfill_role_tokens"},
            {"_id": 0},
        ).to_list(20)
        role_ids = {r["role_id"] for r in rows}
        assert "custom_cleaner" in role_ids
        assert "custom_mechanic_technician" in role_ids
    finally:
        client.close()


@pytest.mark.asyncio
async def test_duplicate_roles_purged():
    client, db = await _db()
    try:
        for rid in ("custom_construction_worker", "custom_mechanic",
                    "custom_newrole"):
            r = await db.roles.find_one({"role_id": rid}, {"_id": 0})
            assert r is None, f"{rid} should have been purged"
        uuid_role = await db.roles.find_one(
            {"id": "d6722b1e-168e-41a1-9018-450545c4e8a1"}, {"_id": 0})
        assert uuid_role is None
    finally:
        client.close()


@pytest.mark.asyncio
async def test_hidden_test_artefact_roles_purged():
    client, db = await _db()
    try:
        count = await db.roles.count_documents({
            "$or": [
                {"role_id": {"$regex": r"^custom_forms_test_"}},
                {"role_id": {"$regex": r"^custom_test_auditor_"}},
                {"role_id": {"$regex": r"^custom_schema_filter_"}},
            ],
        })
        assert count == 0, f"{count} pytest-artefact role(s) remain"
    finally:
        client.close()


@pytest.mark.asyncio
async def test_role_count_matches_expected_28_purged():
    """54 (pre-v58.4) − 4 duplicate − 24 test artefacts = 26."""
    client, db = await _db()
    try:
        n = await db.roles.count_documents({})
        assert n == 26, f"expected 26 roles after v58.4 sweep, got {n}"
    finally:
        client.close()
