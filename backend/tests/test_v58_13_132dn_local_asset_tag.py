"""v58.13.132dn — Local `assets.tag_label` field + PATCH endpoint.

Non-Navixy assets (Plant / Tool / Container / non-tracked Vehicles)
can carry a local tag drawn from the Navixy tag universe so they
appear alongside Navixy-tracked vehicles in the Fleet Register tag
filter/sort. Navixy-linked assets stay read-only (Navixy is the
source of truth).
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from unittest.mock import patch, AsyncMock

import pytest
import requests
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
ASSETS_MOD = APP_ROOT / "backend" / "assets.py"
TAGS_MOD = APP_ROOT / "backend" / "fleet_navixy_tags.py"
DRAWER_JSX = APP_ROOT / "frontend" / "src" / "components" / "AssetDrawer.jsx"
REGISTER_JSX = APP_ROOT / "frontend" / "src" / "pages" / "FleetRegister.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PWD = "Mcgstephen50#"


def _admin_headers():
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                      timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


def _mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ─── Source pins ────────────────────────────────────────────────

def test_patch_endpoint_registered():
    src = ASSETS_MOD.read_text(encoding="utf-8")
    assert '@router.patch("/{asset_id}/tag")' in src
    assert "class AssetTagIn" in src
    assert "tag_label: Optional[str]" in src
    # Rejects Navixy-linked with 409.
    assert 'raise HTTPException(\n            409' in src \
        or 'HTTPException(409' in src
    # Admin gate.
    assert '(user.get("role") or user.get("role_id")) != "admin"' in src \
        or 'user.get("role") != "admin"' in src
    # Validates against Navixy tag universe.
    assert "_fetch_navixy_tag_universe" in src


def test_navixy_tags_endpoint_merges_local():
    src = TAGS_MOD.read_text(encoding="utf-8")
    assert '"source": "navixy"' in src
    assert '"source": "local"' in src
    # Local tag query filters on non-navixy, non-deleted, non-retired.
    assert '"navixy_device_id": None' in src
    assert '"tag_label": {"$nin": [None, ""]}' in src


def test_frontend_asset_drawer_tag_row():
    src = DRAWER_JSX.read_text(encoding="utf-8")
    assert 'data-testid="asset-tag-row"' in src
    # Read-only pill for Navixy-linked assets.
    assert 'data-testid="asset-tag-navixy-readonly"' in src
    assert "sourced from Navixy" in src
    # Editable dropdown for non-Navixy admin.
    assert 'data-testid="asset-tag-select"' in src
    assert "— None / Untagged —" in src
    # PATCH call site.
    assert "/tag" in src
    assert "pendingTagLabel" in src


def test_frontend_fleet_register_source_pill_tooltip():
    src = REGISTER_JSX.read_text(encoding="utf-8")
    assert "tagSourceByVehicle" in src
    # Tooltip surfaces source.
    assert "Local" in src and "Navixy" in src
    assert "data-tag-source=" in src


# ─── Behavioural: PATCH endpoint ─────────────────────────────────

@pytest.mark.live_db_writes
def test_patch_happy_path_and_guards():
    hdr = _admin_headers()
    db = _mongo()
    u = db.users.find_one({"email": ADMIN_EMAIL}, {"_id": 0, "org_id": 1})
    assert u, "admin user must exist"
    org_id = u["org_id"]

    # Seed a non-Navixy Plant asset.
    tag_id = uuid.uuid4().hex[:6]
    plant_id = f"pytest-plant-{tag_id}"
    db.assets.insert_one({
        "id": plant_id,
        "org_id": org_id,
        "kind": "plant",
        "asset_type": "excavator",
        "name": f"Pytest Excavator {tag_id}",
        "rego_serial": None,
        "navixy_device_id": None,
        "status": "active",
        "deleted_at": None,
        "scan_token": f"pytest-scan-{tag_id}",
        "created_at": "2026-09-11T00:00:00+00:00",
        "created_by": "pytest",
    })
    # Seed a Navixy-linked stub for the 409 branch.
    navixy_id = f"pytest-navixy-{tag_id}"
    db.assets.insert_one({
        "id": navixy_id,
        "org_id": org_id,
        "kind": "vehicle",
        "asset_type": "ute",
        "name": f"Pytest Nav {tag_id}",
        "rego_serial": f"PYT{tag_id[:3]}",
        "navixy_device_id": 99999999,
        "status": "active",
        "deleted_at": None,
        "scan_token": f"pytest-scan-nav-{tag_id}",
        "created_at": "2026-09-11T00:00:00+00:00",
        "created_by": "pytest",
    })

    try:
        # Prime the /tag/list universe with a stub that includes
        # the label we want to set. Use the actual Navixy universe
        # (pulled from the live endpoint) so the validator sees
        # something legitimate.
        universe_resp = requests.get(f"{API}/api/fleet/navixy/tags",
                                     headers=hdr, timeout=30)
        assert universe_resp.status_code == 200
        labels = [
            (t["label"] if isinstance(t, dict) else t)
            for t in universe_resp.json().get("distinct_tags", [])
        ]
        if not labels:
            pytest.skip("no tags in Navixy universe — cannot exercise happy path")
        target_label = labels[0]

        # 1. Happy path — admin sets tag on non-Navixy asset.
        r = requests.patch(f"{API}/api/assets/{plant_id}/tag",
                           json={"tag_label": target_label},
                           headers=hdr, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["tag_label"] == target_label
        stored = db.assets.find_one({"id": plant_id}, {"tag_label": 1})
        assert stored["tag_label"] == target_label

        # 2. 409 — Navixy-linked asset rejects local tag.
        r2 = requests.patch(f"{API}/api/assets/{navixy_id}/tag",
                            json={"tag_label": target_label},
                            headers=hdr, timeout=30)
        assert r2.status_code == 409, r2.text
        assert "Navixy" in r2.json().get("detail", "")

        # 3. 400 — label not in Navixy universe.
        r3 = requests.patch(f"{API}/api/assets/{plant_id}/tag",
                            json={"tag_label": f"BogusLabel-{tag_id}"},
                            headers=hdr, timeout=30)
        assert r3.status_code == 400, r3.text

        # 4. Clear the tag with null.
        r4 = requests.patch(f"{API}/api/assets/{plant_id}/tag",
                            json={"tag_label": None},
                            headers=hdr, timeout=30)
        assert r4.status_code == 200
        assert r4.json()["tag_label"] is None

        # 5. 404 — unknown asset.
        r5 = requests.patch(f"{API}/api/assets/nonexistent-asset-id/tag",
                            json={"tag_label": None},
                            headers=hdr, timeout=30)
        assert r5.status_code == 404
    finally:
        db.assets.delete_one({"id": plant_id})
        db.assets.delete_one({"id": navixy_id})


@pytest.mark.live_db_writes
def test_patch_forbidden_for_non_admin():
    """Non-admin users get 403 even when the target is a non-Navixy
    asset. Uses the ephemeral hseq_lead fixture path if available;
    otherwise skips gracefully."""
    from tests.conftest import EPHEMERAL_PWD, EPHEMERAL_EMAIL_PREFIX
    hseq_email = f"{EPHEMERAL_EMAIL_PREFIX}hseq_lead@paneltec.internal"
    db = _mongo()
    user = db.users.find_one({"email": hseq_email})
    if not user:
        pytest.skip("ephemeral hseq_lead not seeded — run alongside "
                    "test_admin_guards suite to warm the fixture")
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": hseq_email, "password": EPHEMERAL_PWD},
                      timeout=30)
    if r.status_code != 200:
        pytest.skip(f"hseq_lead login unavailable: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    hdr = {"Authorization": f"Bearer {tok}"}
    # Seed a target asset.
    tag_id = uuid.uuid4().hex[:6]
    plant_id = f"pytest-plant-{tag_id}"
    org_id = user["org_id"]
    db.assets.insert_one({
        "id": plant_id, "org_id": org_id, "kind": "plant",
        "asset_type": "excavator", "name": f"Pytest {tag_id}",
        "rego_serial": None, "navixy_device_id": None,
        "status": "active", "deleted_at": None,
        "scan_token": f"pytest-scan-{tag_id}",
        "created_at": "2026-09-11T00:00:00+00:00",
    })
    try:
        r = requests.patch(f"{API}/api/assets/{plant_id}/tag",
                           json={"tag_label": "Some Tag"},
                           headers=hdr, timeout=30)
        assert r.status_code == 403, r.text
    finally:
        db.assets.delete_one({"id": plant_id})
