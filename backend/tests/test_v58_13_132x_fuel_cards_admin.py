"""v58.13.132x — Fuel card attribution admin endpoints tests."""
from __future__ import annotations
import os
import sys

import pytest
import httpx

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")


def _api_base():
    return os.environ.get("BACKEND_API_BASE", "http://localhost:8001") + "/api"


@pytest.fixture(scope="module")
def admin_token():
    """Log in as the fixture admin and return a Bearer token."""
    r = httpx.post(
        f"{_api_base()}/auth/login",
        json={"email": "stephen@paneltec.com.au",
              "password": "Mcgstephen50#"},
        timeout=10.0,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def _H(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


# ─── List endpoint ───────────────────────────────────────────
def test_list_fuel_cards_all(admin_token):
    r = httpx.get(f"{_api_base()}/fleet/fuel/cards",
                   headers=_H(admin_token), timeout=10.0)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 67
    assert body["rows"], "no rows returned"
    # Ensure enrichment fields present
    first = body["rows"][0]
    for k in ("card_number", "attribution_kind", "asset_label",
               "worker_label", "fill_count"):
        assert k in first


def test_list_unassigned_only(admin_token):
    r = httpx.get(f"{_api_base()}/fleet/fuel/cards?unassigned_only=true",
                   headers=_H(admin_token), timeout=10.0)
    assert r.status_code == 200
    body = r.json()
    kinds = {row["attribution_kind"] for row in body["rows"]}
    assert kinds.issubset({"unassigned", "shared"})
    # .132v seeded 7 unassigned + 1 shared → total 8
    assert body["total"] == 8


def test_list_search_by_rego(admin_token):
    """Free-text search matches on registration."""
    r = httpx.get(f"{_api_base()}/fleet/fuel/cards?q=M76FV",
                   headers=_H(admin_token), timeout=10.0)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1
    cards = {row["card_number"] for row in body["rows"]}
    assert "21372" in cards  # Iveco M76FV


# ─── Patch endpoint (validation) ─────────────────────────────
def test_patch_rejects_missing_asset_id_for_vehicle_kind(admin_token):
    r = httpx.patch(
        f"{_api_base()}/fleet/fuel/cards/7684",
        headers=_H(admin_token),
        json={"attribution_kind": "vehicle"},  # no asset_id!
        timeout=10.0,
    )
    assert r.status_code == 400
    assert "asset_id required" in r.json()["detail"]


def test_patch_rejects_missing_worker_id_for_worker_kind(admin_token):
    r = httpx.patch(
        f"{_api_base()}/fleet/fuel/cards/7684",
        headers=_H(admin_token),
        json={"attribution_kind": "worker"},  # no worker_id
        timeout=10.0,
    )
    assert r.status_code == 400
    assert "worker_id required" in r.json()["detail"]


def test_patch_rejects_invalid_kind(admin_token):
    r = httpx.patch(
        f"{_api_base()}/fleet/fuel/cards/7684",
        headers=_H(admin_token),
        json={"attribution_kind": "nonsense"},
        timeout=10.0,
    )
    assert r.status_code == 400
    assert "invalid attribution_kind" in r.json()["detail"]


def test_patch_404_for_unknown_card(admin_token):
    r = httpx.patch(
        f"{_api_base()}/fleet/fuel/cards/DOES_NOT_EXIST_9999",
        headers=_H(admin_token),
        json={"attribution_kind": "unassigned"},
        timeout=10.0,
    )
    assert r.status_code == 404
