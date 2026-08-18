"""v160.3.9.58.5 — Per-role mobile-modules override resolver.

Exercises the four contract points:
  · Inheritance base — no override, live role sees its category value.
  · Override wins  — override cell overrides the inherited value.
  · Same-as-inherited unsets — writing an override equal to the
    inherited value removes the doc entry (no drift).
  · Audit trail — every write appends to `admin_actions`.

Uses a per-test motor client + a synthetic org_id so we never touch
the live production `org_settings` doc.
"""
from __future__ import annotations

import os
import uuid
import pytest
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from httpx import AsyncClient, ASGITransport

load_dotenv("/app/backend/.env")


async def _db_and_app():
    """Spin up a client + an ASGI test app + a synthetic admin token."""
    from server import app
    from auth import create_access_token
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    # Look up a real admin user to sign the token — no writes to it.
    admin = await db.users.find_one({"role": "admin"}, {"_id": 0})
    assert admin, "at least one admin user must exist for this test"
    token = create_access_token(
        admin["id"], admin.get("email") or "admin@paneltec.com.au",
        token_version=admin.get("token_version", 0),
    )
    return client, db, app, token, admin


@pytest.mark.live_db_writes
@pytest.mark.asyncio
async def test_override_resolver_full_flow():
    client, db, app, token, admin = await _db_and_app()
    org_id = admin["org_id"]
    role_id = f"custom_test_v58_5_{uuid.uuid4().hex[:6]}"
    # Ensure a clean slate — remove any leftover override for this role_id.
    await db.org_settings.update_one(
        {"org_id": org_id},
        {"$unset": {f"mobile_modules_overrides.{role_id}": ""}},
    )
    try:
        async with AsyncClient(transport=ASGITransport(app=app),
                               base_url="http://test") as ac:
            headers = {"Authorization": f"Bearer {token}"}

            # ── Step 1: read baseline category value for pre_start ──
            r = await ac.get("/api/settings/mobile-modules", headers=headers)
            assert r.status_code == 200, r.text
            payload = r.json()
            worker_pre_start = bool(
                payload["mobile_modules"]["worker"].get("pre_start"))

            # ── Step 2: write an override that FLIPS the inherited value ──
            new_val = not worker_pre_start
            r = await ac.patch(
                "/api/settings/mobile-modules/overrides",
                headers=headers,
                json={"role_id": role_id, "module_key": "pre_start",
                      "enabled": new_val},
            )
            assert r.status_code == 200, r.text
            assert r.json()["override"] == new_val
            assert r.json()["inherited"] == worker_pre_start

            # Verify the override sits in the doc.
            doc = await db.org_settings.find_one({"org_id": org_id}, {"_id": 0})
            assert doc["mobile_modules_overrides"][role_id]["pre_start"] == new_val

            # ── Step 3: audit row was written ──
            audit = await db.admin_actions.find_one(
                {"action": "mobile_modules.override.write",
                 "role_id": role_id},
                sort=[("at", -1)],
            )
            assert audit is not None
            assert audit["module_key"] == "pre_start"
            assert audit["old_value"] is None       # first write
            assert audit["new_value"] == new_val
            assert audit["inherited"] == worker_pre_start

            # ── Step 4: writing the SAME value as inherited unsets the override ──
            r = await ac.patch(
                "/api/settings/mobile-modules/overrides",
                headers=headers,
                json={"role_id": role_id, "module_key": "pre_start",
                      "enabled": worker_pre_start},
            )
            assert r.status_code == 200
            assert r.json()["override"] is None    # unset
            doc = await db.org_settings.find_one({"org_id": org_id}, {"_id": 0})
            role_overrides = (doc.get("mobile_modules_overrides") or {}).get(role_id, {})
            assert "pre_start" not in role_overrides, \
                "override should have been UNSET when equal to inherited"

            # ── Step 5: legacy-category role_id is REJECTED ──
            r = await ac.patch(
                "/api/settings/mobile-modules/overrides",
                headers=headers,
                json={"role_id": "worker", "module_key": "pre_start",
                      "enabled": True},
            )
            assert r.status_code == 400
            assert "base category" in r.json().get("detail", "").lower()

            # ── Step 6: unknown module_key is REJECTED ──
            r = await ac.patch(
                "/api/settings/mobile-modules/overrides",
                headers=headers,
                json={"role_id": role_id, "module_key": "nonexistent_mod",
                      "enabled": True},
            )
            assert r.status_code == 400

            # ── Step 7: DELETE clears all overrides for the role ──
            # Seed a real override first.
            await ac.patch(
                "/api/settings/mobile-modules/overrides",
                headers=headers,
                json={"role_id": role_id, "module_key": "hazard",
                      "enabled": not payload["mobile_modules"]["worker"].get("hazard")},
            )
            r = await ac.delete(
                f"/api/settings/mobile-modules/overrides/{role_id}",
                headers=headers,
            )
            assert r.status_code == 200
            doc = await db.org_settings.find_one({"org_id": org_id}, {"_id": 0})
            assert role_id not in (doc.get("mobile_modules_overrides") or {}), \
                "DELETE should wipe the role's override sub-doc"
    finally:
        # Clean up our synthetic override doc — best-effort.
        await db.org_settings.update_one(
            {"org_id": org_id},
            {"$unset": {f"mobile_modules_overrides.{role_id}": ""}},
        )
        client.close()
