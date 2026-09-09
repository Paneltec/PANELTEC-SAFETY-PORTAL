"""v58.13.132bi — Fuel & SmartFill panel enrichment guardrails.

Coverage:
  1. GET /fleet/assets/{id}/fuel-summary returns the expected payload
     shape for a seeded vehicle with real transactions.
  2. PATCH /assets/{id} persists fuel_type + current_odometer_km +
     current_engine_hours (and stamps `*_updated_at` on numeric change).
  3. `match_confidence` resolves correctly for synthetic Key-matched,
     Card-matched, and unmatched vehicles.
  4. Cache TTL: two rapid calls return the same `generated_at` (proves
     the 60s TTL is honoured).
"""
from __future__ import annotations
import os
import time
import uuid
import asyncio
import pytest
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient
from dotenv import load_dotenv
import httpx

pytestmark = pytest.mark.live_db_writes


@pytest.fixture(scope="module")
def env():
    load_dotenv("/app/backend/.env")
    return {
        "mongo_url": os.environ["MONGO_URL"],
        "db_name": os.environ["DB_NAME"],
        "api_url": _read_frontend_env("REACT_APP_BACKEND_URL"),
    }


def _read_frontend_env(key: str) -> str:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"{key} not in /app/frontend/.env")


@pytest.fixture(scope="module")
def db_sync(env):
    return MongoClient(env["mongo_url"])[env["db_name"]]


@pytest.fixture(scope="module")
def token(env):
    """Rate-limit-aware admin login (see `.132bk` conftest note)."""
    last_err = None
    for attempt in range(6):
        try:
            r = httpx.post(
                f"{env['api_url']}/api/auth/login",
                json={"email": "stephen@paneltec.com.au",
                      "password": "Mcgstephen50#"},
                timeout=10,
            )
            if r.status_code == 429:
                time.sleep(2 * (attempt + 1))
                last_err = r.text
                continue
            r.raise_for_status()
            return r.json()["access_token"]
        except httpx.HTTPStatusError as e:  # noqa: PERF203
            last_err = str(e)
            if e.response.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"login failed after retries: {last_err}")


@pytest.fixture(scope="module")
def seeded_vehicle_id(db_sync):
    """Pick an existing asset with attributed fuel transactions."""
    tx = db_sync.fuel_transactions.find_one(
        {"asset_id": {"$ne": None}, "org_id": "3116f250-a4eb-43f3-98a5-2a3656d6cb63"},
        {"asset_id": 1},
    )
    assert tx, "no attributed fuel transactions in DB — cannot seed test"
    return tx["asset_id"]


# ── 1. Endpoint shape ─────────────────────────────────────────
EXPECTED_KEYS = {
    "asset_id", "generated_at", "match_confidence", "last_fill",
    "ytd", "rolling_30d", "consumption", "top_driver_90d",
    "anomaly_count_90d", "last_smartfill_sync_at", "has_any_transactions",
}


def test_fuel_summary_returns_expected_shape(env, token, seeded_vehicle_id):
    r = httpx.get(
        f"{env['api_url']}/api/fleet/assets/{seeded_vehicle_id}/fuel-summary",
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    missing = EXPECTED_KEYS - set(body.keys())
    assert not missing, f"missing keys: {missing}"
    # Nested shape assertions.
    assert isinstance(body["ytd"], dict) and \
        {"total_price", "total_litres", "fill_count"} <= set(body["ytd"])
    assert isinstance(body["rolling_30d"], dict) and \
        {"avg_litres_per_day", "avg_price_per_litre", "total_litres",
         "total_price", "fill_count"} <= set(body["rolling_30d"])
    assert isinstance(body["consumption"], dict) and \
        {"basis", "l_per_100km", "l_per_hour"} <= set(body["consumption"])
    assert body["match_confidence"] in {
        "matched_key", "matched_card", "matched_other", "not_matched",
    }
    if body["last_fill"] is not None:
        assert {"date", "time_local", "litres", "total_price", "station", "driver"} <= set(body["last_fill"])
    assert body["has_any_transactions"] is True
    assert isinstance(body["anomaly_count_90d"], int)


def test_fuel_summary_cache_ttl(env, token, seeded_vehicle_id):
    """Two rapid calls within the 60s TTL return the same
    `generated_at` — proves the cache is being hit."""
    url = f"{env['api_url']}/api/fleet/assets/{seeded_vehicle_id}/fuel-summary"
    h = {"Authorization": f"Bearer {token}"}
    r1 = httpx.get(url, headers=h, timeout=15).json()
    r2 = httpx.get(url, headers=h, timeout=15).json()
    assert r1["generated_at"] == r2["generated_at"], \
        "cache TTL not honoured — second call re-generated"


# ── 2. PATCH persistence ──────────────────────────────────────
def test_asset_update_persists_new_fuel_fields(env, token, db_sync, seeded_vehicle_id):
    """PUT /assets/{id} accepts fuel_type + current_odometer_km +
    current_engine_hours; DB reflects the write and
    `*_updated_at` stamps."""
    # Load current state.
    r = httpx.get(
        f"{env['api_url']}/api/assets/{seeded_vehicle_id}",
        headers={"Authorization": f"Bearer {token}"}, timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    original = {
        "current_odometer_km": body.get("current_odometer_km"),
        "current_engine_hours": body.get("current_engine_hours"),
        "fuel_type": body.get("fuel_type"),
    }

    # PUT with new numeric snapshots.
    new_odo = 999_888
    new_hrs = 4321.5
    put_body = {
        "kind": body["kind"], "name": body["name"],
        "asset_type": body["asset_type"],
        "rego_serial": body.get("rego_serial"),
        "make": body.get("make"), "model": body.get("model"),
        "year": body.get("year"), "owner": body.get("owner"),
        "notes": body.get("notes"), "status": body.get("status", "active"),
        "fuel_tank_capacity_l": body.get("fuel_tank_capacity_l"),
        "smartfill_key_code": body.get("smartfill_key_code"),
        "smartfill_card_number": body.get("smartfill_card_number"),
        "service_interval_days": body.get("service_interval_days"),
        "service_last_done_date": body.get("service_last_done_date"),
        "fuel_type": "Diesel",
        "current_odometer_km": new_odo,
        "current_engine_hours": new_hrs,
    }
    r = httpx.put(
        f"{env['api_url']}/api/assets/{seeded_vehicle_id}",
        json=put_body, headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r.status_code == 200, r.text

    # Direct DB read.
    doc = db_sync.assets.find_one({"id": seeded_vehicle_id},
                                  {"_id": 0, "fuel_type": 1,
                                   "current_odometer_km": 1,
                                   "current_engine_hours": 1,
                                   "current_odometer_updated_at": 1,
                                   "current_engine_hours_updated_at": 1})
    assert doc["fuel_type"] == "Diesel"
    assert doc["current_odometer_km"] == new_odo
    assert abs(doc["current_engine_hours"] - new_hrs) < 0.01
    # Updated-at stamps should have been set on this change.
    if original["current_odometer_km"] != new_odo:
        assert doc.get("current_odometer_updated_at"), "odometer stamp missing"
    if original["current_engine_hours"] != new_hrs:
        assert doc.get("current_engine_hours_updated_at"), "engine hours stamp missing"


# ── 3. match_confidence resolution ────────────────────────────
def test_match_confidence_synthetic_vehicles(db_sync):
    """Insert three synthetic assets + transactions and assert the
    resolver picks the right label for each."""
    from fleet_fuel import _match_confidence
    now_iso = datetime.now(timezone.utc).isoformat()
    org_id = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"

    # Vehicle A — Key match.
    a_id = f"pytest_bi_{uuid.uuid4().hex[:8]}"
    asset_a = {"id": a_id, "org_id": org_id,
               "smartfill_key_code": "TESTKEY001",
               "smartfill_card_number": None,
               "scan_token": f"tok_{uuid.uuid4().hex[:12]}",
               "deleted_at": None, "created_at": now_iso, "updated_at": now_iso,
               "name": "pytest key", "asset_type": "vehicle", "kind": "vehicle",
               "status": "active"}
    tx_a = {"asset_id": a_id, "org_id": org_id,
            "key_code": "TESTKEY001", "card_number": None,
            "match_status": "matched", "timestamp": now_iso, "deleted_at": None}

    # Vehicle B — Card match (via fuel_cards mapping).
    b_id = f"pytest_bi_{uuid.uuid4().hex[:8]}"
    asset_b = {"id": b_id, "org_id": org_id,
               "smartfill_key_code": None,
               "smartfill_card_number": "TESTCARD002",
               "scan_token": f"tok_{uuid.uuid4().hex[:12]}",
               "deleted_at": None, "created_at": now_iso, "updated_at": now_iso,
               "name": "pytest card", "asset_type": "vehicle", "kind": "vehicle",
               "status": "active"}
    tx_b = {"asset_id": b_id, "org_id": org_id,
            "key_code": None, "card_number": "TESTCARD002",
            "match_status": "matched_via_fuel_card", "timestamp": now_iso, "deleted_at": None}

    # Vehicle C — no transactions.
    c_id = f"pytest_bi_{uuid.uuid4().hex[:8]}"
    asset_c = {"id": c_id, "org_id": org_id,
               "smartfill_key_code": None,
               "smartfill_card_number": None,
               "scan_token": f"tok_{uuid.uuid4().hex[:12]}",
               "deleted_at": None, "created_at": now_iso, "updated_at": now_iso,
               "name": "pytest unmatched", "asset_type": "vehicle", "kind": "vehicle",
               "status": "active"}

    try:
        db_sync.assets.insert_many([asset_a, asset_b, asset_c])
        db_sync.fuel_transactions.insert_many([tx_a, tx_b])

        assert _match_confidence(asset_a, tx_a) == "matched_key"
        assert _match_confidence(asset_b, tx_b) == "matched_card"
        assert _match_confidence(asset_c, None) == "not_matched"

        # Explicit-fallback case: transaction attributed to asset but
        # neither key_code nor card_number matches (rego / fuzzy).
        tx_other = {"asset_id": a_id, "key_code": "DIFFERENT", "card_number": "DIFFERENT",
                    "match_status": "matched"}
        assert _match_confidence(asset_a, tx_other) == "matched_other"
    finally:
        db_sync.assets.delete_many({"id": {"$in": [a_id, b_id, c_id]}})
        db_sync.fuel_transactions.delete_many({"asset_id": {"$in": [a_id, b_id, c_id]}})


def test_normalise_fuel_type():
    from assets import _normalise_fuel_type
    assert _normalise_fuel_type("diesel") == "Diesel"
    assert _normalise_fuel_type("PETROL") == "Petrol"
    assert _normalise_fuel_type("adblue") == "AdBlue"
    assert _normalise_fuel_type("random garbage") == "Unknown"
    assert _normalise_fuel_type("") is None
    assert _normalise_fuel_type(None) is None


def test_version_bumped_to_132bi():
    from pathlib import Path
    import re
    version_js = Path("/app/frontend/src/lib/version.js").read_text()
    sw_js = Path("/app/frontend/public/service-worker.js").read_text()
    m = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]{1,3})", version_js)
    assert m and m.group(1) >= "bi", \
        f"RUNNING_VERSION letter regressed below '.132bi': {m and m.group(1)}"
    m2 = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]{1,3})", sw_js)
    assert m2 and m2.group(1) >= "bi", \
        f"CACHE_VERSION regressed below '.132bi': {m2 and m2.group(1)}"
